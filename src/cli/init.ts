import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import {
  createLaunchSpec,
  ensureRuntime,
  renderGateConfig,
  v1GateCatalog,
  writeGateConfig,
  type GateCatalog,
  type GateConfigEffects,
  type LaunchSpec,
  type RuntimeEffects,
  type RuntimeInfo,
} from "../adapter";
import type { ProgressionEvent, UnlockEvent } from "../core";
import { loadPack, type QuestGraph } from "../loader";
import { foldEvents, type ProgressionGraph } from "../progression";
import { writeTutorFraming } from "../extension/tutor";
import type { CommandOutcome } from "./index";

export interface Prompter {
  readonly ask: (question: string, defaultAnswer?: string) => string | Promise<string>;
}

export interface InitFsEffects {
  readonly mkdirp: (path: string) => void | Promise<void>;
  readonly writeFile: (path: string, content: string) => void | Promise<void>;
  readonly copyDir: (source: string, destination: string) => void | Promise<void>;
  readonly appendFile: (path: string, content: string) => void | Promise<void>;
}

export interface InitDeps {
  readonly garnishRootDir: string;
  readonly packSourceDir: string;
  readonly prompter: Prompter;
  readonly runtimeEffects: RuntimeEffects;
  readonly gateEffects: GateConfigEffects;
  readonly fs: InitFsEffects;
  readonly launch: (spec: LaunchSpec) => void | Promise<void>;
  readonly now: () => string;
  readonly catalog?: GateCatalog;
}

export interface InitResult extends CommandOutcome {
  readonly promptCount: number;
  readonly runtime: RuntimeInfo;
  readonly providerEnvVar: string;
  readonly speedrunUnlocks: readonly UnlockEvent[];
  readonly sandboxDir: string;
  readonly launchSpec: LaunchSpec;
}

const PROVIDER_ENV: Readonly<Record<string, string>> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

/**
 * `garnish init` — ARD 5.1. At most five prompts:
 *   1. provider (anthropic / openai / other:<ENV_VAR>)
 *   2. speedrun offer (n / all / <level order>)
 *   3. sandbox directory (default: <garnish root>/sandbox)
 * Non-interactive mode supplies the same answers through a queued Prompter.
 */
export async function initCommand(deps: InitDeps): Promise<InitResult> {
  let promptCount = 0;
  const ask = async (question: string, defaultAnswer?: string): Promise<string> => {
    promptCount += 1;
    if (promptCount > 5) {
      throw new Error("garnish init must use at most five prompts");
    }
    const answer = `${await deps.prompter.ask(question, defaultAnswer)}`.trim();
    return answer.length === 0 && defaultAnswer !== undefined ? defaultAnswer : answer;
  };

  // 1. Certified runtime into Garnish-owned storage (ADR-2/ADR-9).
  const runtime = await ensureRuntime(deps.runtimeEffects, { garnishRootDir: deps.garnishRootDir });
  if (runtime.handshake.status !== "ok") {
    return {
      text: `init: certified runtime verification failed\n${runtime.handshake.doctor.join("\n")}`,
      exitCode: 1,
      promptCount,
      runtime,
      providerEnvVar: "",
      speedrunUnlocks: [],
      sandboxDir: "",
      launchSpec: { command: "", args: [], env: {} },
    };
  }
  const paths = runtime.paths;

  // 2. Provider — env-var reference only; raw keys are never persisted (PRD rule).
  const providerAnswer = (
    await ask("Provider? [anthropic/openai/other:<ENV_VAR>]", "anthropic")
  ).toLowerCase();
  const providerName = providerAnswer.startsWith("other:") ? "other" : providerAnswer;
  const providerEnvVar = providerAnswer.startsWith("other:")
    ? providerAnswer.slice("other:".length).trim().toUpperCase()
    : (PROVIDER_ENV[providerAnswer] ?? PROVIDER_ENV.anthropic ?? "ANTHROPIC_API_KEY");

  // 3. Speedrun offer (skips gates, never awards XP; Speedrunner badge stays earnable).
  const speedrunAnswer = (await ask("Speedrun mode? [n/all/<level order>]", "n")).toLowerCase();

  // 4. Sandbox — a disposable learning dir, never an existing project by default.
  const sandboxDir = await ask("Sandbox directory?", `${paths.garnishRootDir}/sandbox`);

  // Activate the real L0 pack: copy into Garnish-owned storage and validate via the loader.
  const packsDir = `${paths.agentDir}/garnish/packs`;
  const l0Dir = `${packsDir}/l0-tutorial-island`;
  await deps.fs.mkdirp(packsDir);
  await deps.fs.copyDir(deps.packSourceDir, l0Dir);
  const l0: QuestGraph = await loadPack(l0Dir);

  const progressionGraph: ProgressionGraph = {
    levels: l0.levels.map((entry) => ({
      id: entry.id,
      order: entry.order,
      quests: entry.quests,
      unlocks: entry.unlocks,
    })),
    quests: l0.quests.map((entry) => ({
      id: entry.id,
      level: entry.level,
      required: entry.required,
      xp: entry.xp,
      unlocks: entry.unlocks,
    })),
    unlockEdges: l0.unlockEdges,
  };

  // Speedrun unlocks go through progression events (reason "speedrun", no xp_award).
  const speedrunUnlocks: UnlockEvent[] = [];
  if (speedrunAnswer !== "n" && speedrunAnswer !== "no" && speedrunAnswer.length > 0) {
    const at = deps.now();
    const levels =
      speedrunAnswer === "all"
        ? progressionGraph.levels
        : progressionGraph.levels.filter((entry) => `${entry.order}` === speedrunAnswer);
    for (const levelEntry of levels) {
      speedrunUnlocks.push({
        at,
        type: "unlock",
        target: { type: "level", id: levelEntry.id },
        reason: "speedrun",
      });
      for (const featureId of levelEntry.unlocks ?? []) {
        speedrunUnlocks.push({
          at,
          type: "unlock",
          target: { type: "feature", id: featureId },
          reason: "speedrun",
        });
      }
    }
  }

  const garnishDir = `${paths.agentDir}/garnish`;
  await deps.fs.mkdirp(garnishDir);
  if (speedrunUnlocks.length > 0) {
    const lines = speedrunUnlocks.map((event) => JSON.stringify(event)).join("\n");
    await deps.fs.appendFile(`${garnishDir}/events.jsonl`, `${lines}\n`);
  }

  // Gated config from the folded unlock set (empty log = locked L0 baseline).
  const log: ProgressionEvent[] = [...speedrunUnlocks];
  const state = foldEvents(log, progressionGraph);
  const rendered = renderGateConfig(state.unlockSet, deps.catalog ?? v1GateCatalog);
  await writeGateConfig(paths, rendered, deps.gateEffects);

  // Merge the provider key REFERENCE into the Garnish-owned config.yml.
  const configData = parseYaml(rendered.configYml);
  const withProviders = {
    ...(isRecord(configData) ? configData : {}),
    providers: { [providerName]: { apiKeyRef: providerEnvVar } },
  };
  await deps.fs.writeFile(
    `${paths.agentDir}/config.yml`,
    `# Generated by Garnish. Do not edit; Garnish owns these arrays and replaces them wholesale.\n${stringifyYaml(withProviders)}`,
  );

  // ADR-7 static tutor framing — appends via APPEND_SYSTEM.md, never replaces defaults.
  await writeTutorFraming(paths.agentDir, { writeFile: deps.fs.writeFile });

  // Derived snapshot consumed by the L0 install-certified-pi check.
  await deps.fs.writeFile(
    `${garnishDir}/state.json`,
    `${JSON.stringify(
      {
        activeLevel: "tutorial-island",
        packs: ["l0-tutorial-island"],
        runtime: { certifiedVersion: runtime.version ?? "" },
        sandboxDir,
      },
      null,
      2,
    )}\n`,
  );

  await deps.fs.mkdirp(sandboxDir);

  // Launch the certified binary with Garnish-owned isolation env.
  const launchSpec = createLaunchSpec(paths, { cwd: sandboxDir });
  await deps.launch(launchSpec);

  const speedrunNote =
    speedrunUnlocks.length > 0
      ? `\nSpeedrun: unlocked ahead without XP — clear skipped quests later to earn XP and the Speedrunner badge.`
      : "";
  return {
    text: `Garnish ready — certified Pi ${runtime.version} installed, Tutorial Island (onboarding) active.${speedrunNote}`,
    exitCode: 0,
    promptCount,
    runtime,
    providerEnvVar,
    speedrunUnlocks,
    sandboxDir,
    launchSpec,
  };
}

export interface QueuedPrompter extends Prompter {
  readonly askedQuestions: string[];
}

export function queuedPrompter(answers: readonly string[]): QueuedPrompter {
  const queue = [...answers];
  const askedQuestions: string[] = [];
  return {
    askedQuestions,
    ask(question: string, defaultAnswer?: string): string {
      askedQuestions.push(question);
      const next = queue.shift();
      return next === undefined || next.length === 0 ? (defaultAnswer ?? "") : next;
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
