import { expect, test } from "bun:test";
import { readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parse as parseYaml } from "yaml";

import { queuedPrompter, runGarnish } from "../../src/cli";
import type defaultEntry from "../../src/extension/entry";
import type { GarnishEntryHandle, GarnishPi } from "../../src/extension/entry";
import type { PiEventHandler, PiExtensionContext, PiExtensionEvent } from "../../src/extension";
import type { UnlockExtensionContext } from "../../src/extension/unlocks";

/**
 * PRD proof plan, scripted E2E happy path (LOO-136): fresh temp agent dir →
 * non-interactive `garnish init` → L0 Tutorial Island completion via the REAL bundled
 * extension driven by recorded event fixtures + real artifacts → unlock application →
 * status/quest output. Re-proves PRD AC-1, AC-2, AC-4, AC-5; never touches ~/.omp.
 */

const repoRootDir = fileURLToPath(new URL("../..", import.meta.url));
const fixturePath = fileURLToPath(new URL("./fixtures/l0-session.jsonl", import.meta.url));

type PrdCriterion = "AC-1" | "AC-2" | "AC-4" | "AC-5";

/** Failure output names the regressed PRD acceptance criterion (issue requirement). */
function prove(ac: PrdCriterion, detail: string, condition: boolean): void {
  if (!condition) {
    throw new Error(`PRD ${ac} regressed: ${detail}`);
  }
}

interface FakeSession {
  readonly notifications: string[];
  readonly activeTools: string[];
  readonly reloads: () => number;
  readonly ctx: UnlockExtensionContext;
}

function createFakeSessionContext(): FakeSession {
  const notifications: string[] = [];
  const activeTools: string[] = [];
  let reloads = 0;
  const ctx = {
    hasUI: false,
    ui: {
      notify: (message: string) => {
        notifications.push(message);
      },
      setWidget: () => {},
      setStatus: () => {},
    },
    appendEntry: () => {},
    session: {
      getActiveTools: () => [...activeTools],
      setActiveTools: (tools: readonly string[]) => {
        activeTools.splice(0, activeTools.length, ...tools);
      },
      reload: () => {
        reloads += 1;
      },
    },
  } as unknown as UnlockExtensionContext;
  return { notifications, activeTools, reloads: () => reloads, ctx };
}

interface FakePi {
  readonly pi: GarnishPi;
  readonly emit: (event: PiExtensionEvent, ctx: PiExtensionContext) => void;
  readonly commandNames: () => readonly string[];
}

function createFakePi(): FakePi {
  const handlers = new Map<string, PiEventHandler[]>();
  const commands = new Map<string, unknown>();
  const pi = {
    on: (event: string, handler: PiEventHandler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    registerCommand: (name: string, handler: unknown) => {
      commands.set(name, handler);
    },
  } as GarnishPi;
  return {
    pi,
    emit: (event, ctx) => {
      for (const handler of handlers.get(event.type) ?? []) {
        handler(event, ctx);
      }
    },
    commandNames: () => [...commands.keys()],
  };
}

async function dirSignature(path: string): Promise<{ entries: readonly string[]; configMtime: number }> {
  const entries = await readdir(path).catch(() => [] as string[]);
  const configMtime = await stat(join(path, "agent", "config.yml"))
    .then((s) => s.mtimeMs)
    .catch(() => -1);
  return { entries: [...entries].sort((a, b) => a.localeCompare(b)), configMtime };
}

function yamlRecord(text: string): Readonly<Record<string, unknown>> {
  const parsed = parseYaml(text) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("expected a YAML mapping");
  }
  return parsed as Readonly<Record<string, unknown>>;
}

function toolEnabled(config: Readonly<Record<string, unknown>>, tool: string): boolean {
  const entry = config[tool];
  return (
    typeof entry === "object" &&
    entry !== null &&
    !Array.isArray(entry) &&
    (entry as Readonly<Record<string, unknown>>).enabled === true
  );
}

test("scripted E2E happy path: init → L0 → unlock → status (PRD AC-1/2/4/5)", async () => {
  const userOmp = join(homedir(), ".omp");
  const ompBefore = await dirSignature(userOmp);

  const root = await mkdtemp(join(tmpdir(), "garnish-e2e-"));
  try {
    // Hermetic certified-runtime source: CI must not depend on a host-global omp
    // (issue non-goal). The install pipeline itself stays real: resolve → copy →
    // chmod → exec --version → parse → handshake.
    const ompSource = join(root, "omp-source");
    await writeFile(
      ompSource,
      '#!/bin/sh\nif [ "$1" = "--version" ]; then\n  echo "omp/16.2.13"\n  exit 0\nfi\necho "e2e omp stub: interactive run not supported" >&2\nexit 64\n',
      { mode: 0o755 },
    );

    // --- Non-interactive init (AC-1) ---
    const init = await runGarnish(["init", "--no-launch"], {
      rootDir: root,
      repoRootDir,
      env: { GARNISH_OMP_SOURCE: ompSource },
      prompter: queuedPrompter(["anthropic", "n", ""]),
    });
    prove("AC-1", `init failed: ${init.text}`, init.exitCode === 0);
    prove("AC-1", "init text names the certified runtime", init.text.includes("certified Pi 16.2.13"));

    const agentDir = join(root, "agent");
    const binaryPath = join(root, "runtime", "pi", "omp-16.2.13", "bin", "omp");
    const binaryStat = await stat(binaryPath);
    prove("AC-1", "certified runtime binary installed into Garnish-owned storage", binaryStat.isFile());
    prove("AC-1", "installed binary is executable", (binaryStat.mode & 0o100) !== 0);
    prove(
      "AC-1",
      "installed binary is a real copy of the resolved source",
      (await readFile(binaryPath, "utf8")) === (await readFile(ompSource, "utf8")),
    );

    const configText = await readFile(join(agentDir, "config.yml"), "utf8");
    const config = yamlRecord(configText);
    prove("AC-1", "generated config carries the Garnish marker", configText.includes("Generated by Garnish"));
    prove("AC-1", "provider key lands as an env-var reference", configText.includes("apiKeyRef: ANTHROPIC_API_KEY"));
    prove("AC-4", "locked baseline gates file tools off in config", !toolEnabled(config, "read"));
    prove("AC-4", "locked baseline gates shell off in config", !toolEnabled(config, "bash"));
    const mcpJson = JSON.parse(await readFile(join(agentDir, "mcp.json"), "utf8")) as {
      disabledServers: readonly string[];
    };
    prove("AC-4", "locked baseline disables the demo MCP server", mcpJson.disabledServers.includes("garnish-demo"));

    const bundlePath = join(agentDir, "extensions", "garnish", "index.js");
    const bundleStat = await stat(bundlePath);
    prove("AC-1", "extension bundle installed for autoload", bundleStat.isFile() && bundleStat.size > 1024);

    const stateFile = JSON.parse(await readFile(join(agentDir, "garnish", "state.json"), "utf8")) as {
      activeLevel: string;
      packs: readonly string[];
      runtime: { certifiedVersion: string };
    };
    prove("AC-1", "Tutorial Island is the active level", stateFile.activeLevel === "tutorial-island");
    prove("AC-1", "core packs installed (L0 active, later levels visible but locked)", stateFile.packs.includes("l0-tutorial-island"));
    prove("AC-1", "state records the certified version", stateFile.runtime.certifiedVersion === "16.2.13");

    const shimStat = await stat(join(root, "bin", "garnish"));
    prove("AC-1", "garnish command shim provisioned", shimStat.isFile() && (shimStat.mode & 0o100) !== 0);
    const framing = await readFile(join(agentDir, "APPEND_SYSTEM.md"), "utf8");
    prove("AC-1", "tutor framing appended at provision time", framing.length > 0);

    // --- L0 completion through the REAL bundled extension (AC-2) ---
    // Dynamic import is required here: the specifier is produced at runtime by
    // `garnish init` bundling src/extension/entry.ts into the temp agent dir.
    const bundleModule = (await import(pathToFileURL(bundlePath).href)) as { default: typeof defaultEntry };
    const fake = createFakePi();
    const session = createFakeSessionContext();

    const savedAgentDir = process.env.PI_CODING_AGENT_DIR;
    let handle: GarnishEntryHandle;
    try {
      process.env.PI_CODING_AGENT_DIR = agentDir;
      handle = bundleModule.default(fake.pi);
    } finally {
      if (savedAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = savedAgentDir;
      }
    }
    prove("AC-2", `extension activated from the provisioned agent dir (${handle.reason ?? "ok"})`, handle.active);
    expect(fake.commandNames()).toContain("quest");
    expect(fake.commandNames()).toContain("unlock");

    // Recorded extension-event fixture playback (real omp event shapes: agent_end
    // carries messages[], session_start carries the reported version).
    const fixtureEvents = (await readFile(fixturePath, "utf8"))
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as PiExtensionEvent);
    for (const event of fixtureEvents) {
      fake.emit(event, session.ctx);
    }

    // Quests complete in prereq waves; iterate evaluation until the event log settles.
    const eventsPath = join(agentDir, "garnish", "events.jsonl");
    let previousLog = "";
    for (let round = 0; round < 6; round += 1) {
      await handle.core?.evaluateNow();
      const currentLog = await readFile(eventsPath, "utf8").catch(() => "");
      if (currentLog === previousLog) {
        break;
      }
      previousLog = currentLog;
    }

    const logLines = previousLog
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as { type: string; quest_id?: string; target?: { type: string; id: string } });
    const completed = logLines.filter((event) => event.type === "quest_completed").map((event) => event.quest_id);
    for (const quest of ["install-certified-pi", "connect-agent", "second-turn", "status-screen"]) {
      prove("AC-2", `quest ${quest} auto-completed from fixtures + real artifacts`, completed.includes(quest));
    }
    prove(
      "AC-2",
      "completion feedback is visible (notify)",
      session.notifications.some((message) => message.includes("Quest complete: connect-agent (+20 XP)")),
    );

    const unlockTargets = logLines
      .filter((event) => event.type === "unlock")
      .map((event) => `${event.target?.type}:${event.target?.id}`);
    prove("AC-4", "L0 completion unlocks the file tools feature", unlockTargets.includes("feature:tool:file"));
    prove("AC-4", "L0 completion unlocks the shell feature", unlockTargets.includes("feature:tool:shell"));
    prove("AC-4", "L0 completion unlocks the next level (L1 visibility)", unlockTargets.includes("level:first-quest"));

    // --- Live unlock application (AC-4) ---
    await handle.unlocks?.applyUnlocks();
    for (const tool of ["bash", "edit", "glob", "grep", "read", "write"]) {
      prove("AC-4", `unlock applied live: ${tool} active without manual config edits`, session.activeTools.includes(tool));
    }
    prove(
      "AC-4",
      "live tool unlock needs no session reload",
      handle.unlocks !== undefined && handle.unlocks.reloadCount() === 0,
    );

    // Tutor bridge stays grounded post-unlock (ADR-7 visibility).
    const contextMessages: unknown[] = [];
    fake.emit({ type: "context", sessionId: "e2e-session-1", messages: contextMessages } as PiExtensionEvent, session.ctx);
    prove("AC-5", "tutor context injection references the next quest", `${handle.tutor?.lastInjected()}`.includes("first-file"));

    // --- Status / quest surfaces (AC-5) ---
    const status = await runGarnish(["status"], { rootDir: root, repoRootDir });
    prove("AC-5", `garnish status exits 0 (${status.text})`, status.exitCode === 0);
    prove("AC-5", "status shows earned XP", status.text.includes("XP: 50"));
    prove("AC-5", "status marks Tutorial Island complete", status.text.includes("tutorial-island ✓"));
    prove("AC-5", "status shows per-quest state", status.text.includes("[x] install-certified-pi"));
    prove("AC-5", "status shows the unlocked next level's quests", status.text.includes("first-file"));
    prove("AC-5", `status points at the next quest, got:\n${status.text}`, status.text.includes("Next: first-file"));

    const quest = await runGarnish(["quest"], { rootDir: root, repoRootDir });
    prove("AC-5", `garnish quest exits 0 (${quest.text})`, quest.exitCode === 0);
    prove("AC-5", "quest names the active quest", quest.text.includes("Active quest: first-file"));
    prove("AC-5", "quest shows the full text and checks", quest.text.includes("Checks:"));

    // --- Config-baked gate write keeps the learner's auth (AC-4 config-level gate) ---
    const unlockAll = await runGarnish(["unlock", "--all"], { rootDir: root, repoRootDir });
    prove("AC-4", `unlock --all exits 0 (${unlockAll.text})`, unlockAll.exitCode === 0);
    const unlockedConfigText = await readFile(join(agentDir, "config.yml"), "utf8");
    const unlockedConfig = yamlRecord(unlockedConfigText);
    prove("AC-4", "config gate re-render enables unlocked tools", toolEnabled(unlockedConfig, "read"));
    const providers = unlockedConfig.providers as Readonly<Record<string, { apiKeyRef?: string }>> | undefined;
    prove(
      "AC-4",
      `gate re-render preserves the provider key reference (auth survives unlocks), got:\n${unlockedConfigText}`,
      providers?.anthropic?.apiKeyRef === "ANTHROPIC_API_KEY",
    );

    // No settle wait needed: every evaluation chains on the handle's `evaluating`
    // promise (awaited above), and a late debounce trigger after rm() is a no-op —
    // probes fail closed and the extension pauses instead of writing.
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  const ompAfter = await dirSignature(userOmp);
  prove("AC-1", "the user's real ~/.omp agent dir is untouched", ompAfter.configMtime === ompBefore.configMtime);
  expect(ompAfter.entries).toEqual(ompBefore.entries);
}, 30000);
