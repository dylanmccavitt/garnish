import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { parse as parseYaml } from "yaml";

import { handshake, runtimePaths, type GateConfigEffects } from "../adapter";
import { createFsEventStore, loadInstalledState } from "../cli/state";
import type { Probes, RunCommandOptions, RunCommandResult, SkillValidity } from "../verifier";
import { createGarnishExtension, type GarnishExtensionHandle, type PiExtensionApi } from "./index";
import { registerGarnishHud, type GarnishHudHandle, type HudPi } from "./hud";
import { registerLiveUnlocks, type LiveUnlockHandle, type UnlockPi } from "./unlocks";
import { registerTutorBridge, type TutorHandle } from "./tutor";

/**
 * Real composition root for the Pi extension. `garnish init` bundles this file with
 * `bun build --target node` into $PI_CODING_AGENT_DIR/extensions/garnish/index.js.
 *
 * Constraints proven by the LOO-118 spike and the live demo attempt:
 * - module init and factory body stay synchronous (async module init loads as nothing);
 * - graph/quests are pre-serialized JSON written by init, read with readFileSync;
 * - durable state lives in {agent_dir}/garnish/events.jsonl, never in session entries.
 */

export type GarnishPi = PiExtensionApi & HudPi & UnlockPi;

export interface GarnishEntryHandle {
  readonly active: boolean;
  readonly reason?: string;
  readonly core?: GarnishExtensionHandle;
  readonly hud?: GarnishHudHandle;
  readonly unlocks?: LiveUnlockHandle;
  readonly tutor?: TutorHandle;
}

export default function garnishExtension(pi: GarnishPi): GarnishEntryHandle {
  const agentDir = process.env.PI_CODING_AGENT_DIR;
  if (agentDir === undefined || agentDir.length === 0) {
    return { active: false, reason: "PI_CODING_AGENT_DIR is not set" };
  }

  try {
    const { graph, quests, state, eventsPath } = loadInstalledState(agentDir);
    const garnishRootDir = dirname(agentDir);
    const paths = runtimePaths({ garnishRootDir });
    const sandboxDir = state.sandboxDir ?? join(garnishRootDir, "sandbox");
    const store = createFsEventStore(eventsPath);
    const probes = createRealProbes(garnishRootDir);
    const checkPaths: Readonly<Record<string, string>> = { agent_dir: agentDir, sandbox: sandboxDir };
    const gateEffects: GateConfigEffects = {
      mkdirp: (path) => {
        mkdirSync(path, { recursive: true });
      },
      writeFile: (path, content) => {
        writeFileSync(path, content, "utf8");
      },
      readFile: (path) => (existsSync(path) ? readFileSync(path, "utf8") : undefined),
    };

    const core = createGarnishExtension({
      graph,
      quests,
      probes,
      store,
      handshake,
      now: () => Date.now(),
      paths: checkPaths,
    })(pi);
    const hud = registerGarnishHud(pi, {
      graph,
      quests,
      store,
      probes,
      now: () => new Date().toISOString(),
      paths: checkPaths,
    });
    const unlocks = registerLiveUnlocks(pi, {
      graph,
      quests,
      store,
      runtimePaths: paths,
      gateEffects,
      now: () => new Date().toISOString(),
    });
    const tutor = registerTutorBridge(pi, { graph, quests, store });

    return { active: true, core, hud, unlocks, tutor };
  } catch (error) {
    // Never break the learner's chat: an unprovisioned or corrupt Garnish dir means
    // the extension stays dormant. `garnish doctor` is the recovery route.
    return { active: false, reason: error instanceof Error ? error.message : `${error}` };
  }
}

function createRealProbes(garnishRootDir: string): Probes {
  return {
    fileExists: (path: string) => existsSync(path),
    readFile: (path: string) => readFileSync(path, "utf8"),
    runCommand: (command: readonly string[] | string, options?: RunCommandOptions): RunCommandResult => {
      const spawnOptions = {
        cwd: options?.cwd,
        env: { ...process.env, ...(options?.env ?? {}) },
        timeout: options?.timeoutMs,
        encoding: "utf8" as const,
      };
      const result =
        typeof command === "string"
          ? spawnSync("/bin/sh", ["-c", command], spawnOptions)
          : spawnSync(resolveCommandBinary(command[0] ?? "", garnishRootDir), command.slice(1), spawnOptions);
      return {
        exitCode: result.status ?? 1,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
      };
    },
    mcpHandshake: () => ({
      ok: false,
      error: "MCP handshake probe is not available in the v1 extension (L4 scope)",
    }),
    skillValid: (path: string): SkillValidity => {
      try {
        const text = readFileSync(path, "utf8");
        const match = text.match(/^---\n([\s\S]*?)\n---/);
        if (match?.[1] === undefined) {
          return { valid: false, errors: ["missing frontmatter block"] };
        }
        const frontmatter = parseYaml(match[1]) as unknown;
        if (typeof frontmatter !== "object" || frontmatter === null || Array.isArray(frontmatter)) {
          return { valid: false, errors: ["frontmatter is not a mapping"] };
        }
        const record = frontmatter as Readonly<Record<string, unknown>>;
        const name = typeof record.name === "string" ? record.name : undefined;
        const description = typeof record.description === "string" ? record.description : undefined;
        if (name === undefined || description === undefined) {
          return { valid: false, errors: ["frontmatter needs string `name` and `description`"] };
        }
        return { valid: true, name, description };
      } catch (error) {
        return { valid: false, errors: [error instanceof Error ? error.message : `${error}`] };
      }
    },
    confirm: () => undefined,
  };
}

/**
 * `command` checks in packs invoke `garnish …`; inside the learner's session that binary
 * is the shim init wrote into Garnish-owned storage, not something on PATH.
 */
function resolveCommandBinary(binary: string, garnishRootDir: string): string {
  if (binary !== "garnish") {
    return binary;
  }
  const explicit = process.env.GARNISH_BIN;
  if (explicit !== undefined && explicit.length > 0) {
    return explicit;
  }
  return join(garnishRootDir, "bin", "garnish");
}
