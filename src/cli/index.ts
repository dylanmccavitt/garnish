import {
  catalogFeatureIds,
  handshake,
  renderGateConfig,
  v1GateCatalog,
  writeGateConfig,
  type GateCatalog,
  type GateConfigEffects,
  type RuntimePaths,
} from "../adapter";
import type { FeatureId, LevelId, ProgressionEvent, Quest, UnlockEvent } from "../core";
import {
  foldEvents,
  type ProgressionGraph,
  type ProgressionState,
} from "../progression";
import type { MaybePromise } from "../verifier";

export interface CommandOutcome {
  readonly text: string;
  readonly exitCode: number;
}

export interface ProgressionStore {
  readonly readEvents: () => MaybePromise<readonly ProgressionEvent[]>;
  readonly appendEvents: (events: readonly ProgressionEvent[]) => MaybePromise<void>;
}

export interface CliDeps {
  readonly graph: ProgressionGraph;
  readonly quests?: readonly Quest[];
  readonly store: ProgressionStore;
  readonly now: () => string;
  readonly catalog?: GateCatalog;
  readonly runtimePaths?: RuntimePaths;
  readonly gateEffects?: GateConfigEffects;
}

export interface DoctorDeps {
  readonly runtimeInstalled: () => MaybePromise<boolean>;
  readonly reportedVersion: () => MaybePromise<string | undefined>;
  readonly isolatedConfigPresent: () => MaybePromise<boolean>;
}

type QuestDisplayState = "complete" | "active" | "available" | "locked";

interface QuestLine {
  readonly quest: ProgressionGraph["quests"][number];
  readonly state: QuestDisplayState;
  readonly isNext: boolean;
}

export function renderStatus(state: ProgressionState, graph: ProgressionGraph): string {
  const lines: string[] = [];
  const currentLevel = state.currentLevel === null ? undefined : findLevel(graph, `${state.currentLevel}`);
  const levelLabel = currentLevel === undefined ? "all levels complete" : `Level ${currentLevel.order} — ${currentLevel.id}`;

  lines.push(`Garnish — ${levelLabel}`);
  lines.push(`XP: ${state.xpTotal}`);

  if (state.badges.length > 0) {
    const badgeText = state.badges
      .map((award) => (award.levelId === undefined ? `${award.badge}` : `${award.badge} (${award.levelId})`))
      .join(", ");
    lines.push(`Badges: ${badgeText}`);
  }

  const questLines = computeQuestLines(state, graph);
  for (const level of [...graph.levels].sort((left, right) => left.order - right.order)) {
    lines.push("");
    lines.push(`Level ${level.order}: ${level.id}${state.completedLevels.includes(level.id) ? " ✓" : ""}`);
    for (const entry of questLines.filter((line) => `${line.quest.level}` === `${level.id}`)) {
      const marker =
        entry.state === "complete" ? "[x]" : entry.state === "locked" ? "[·]" : "[ ]";
      const suffix = entry.isNext ? "  ← next" : entry.quest.required ? "" : "  (optional)";
      lines.push(`  ${marker} ${entry.quest.id}${suffix}`);
    }
  }

  const next = questLines.find((line) => line.isNext);
  lines.push("");
  lines.push(next === undefined ? "Next: nothing — all required quests complete." : `Next: ${next.quest.id}`);

  return lines.join("\n");
}

export async function statusCommand(deps: CliDeps): Promise<CommandOutcome> {
  const state = foldEvents(await deps.store.readEvents(), deps.graph);
  return { text: renderStatus(state, deps.graph), exitCode: 0 };
}

export async function questCommand(deps: CliDeps): Promise<CommandOutcome> {
  const state = foldEvents(await deps.store.readEvents(), deps.graph);
  const next = computeQuestLines(state, deps.graph).find((line) => line.isNext);

  if (next === undefined) {
    return { text: "No active quest — all required quests are complete.", exitCode: 0 };
  }

  const quest = (deps.quests ?? []).find((candidate) => `${candidate.id}` === `${next.quest.id}`);
  const lines: string[] = [`Active quest: ${next.quest.id}`];

  if (quest !== undefined) {
    lines.push(`Title: ${quest.title}`);
    lines.push(`XP: ${quest.xp}${quest.required ? "" : "  (optional)"}`);
    lines.push("");
    lines.push(quest.description);
    lines.push("");
    lines.push("Checks:");
    for (const check of quest.checks) {
      lines.push(`  - ${describeCheck(check)}`);
    }
  } else {
    lines.push(`XP: ${next.quest.xp ?? 0}`);
    lines.push("(full quest text unavailable — pack quests not provided)");
  }

  return { text: lines.join("\n"), exitCode: 0 };
}

export interface UnlockOptions {
  readonly all?: boolean;
  readonly level?: string;
}

export async function unlockCommand(deps: CliDeps, options: UnlockOptions): Promise<CommandOutcome> {
  if (options.all !== true && options.level === undefined) {
    return { text: "unlock: pass --all or --level <id|N>", exitCode: 2 };
  }

  const events = await deps.store.readEvents();
  const state = foldEvents(events, deps.graph);
  const at = deps.now();
  const unlocks: UnlockEvent[] = [];

  if (options.all === true) {
    for (const feature of catalogFeatureIds(deps.catalog ?? v1GateCatalog)) {
      if (!state.unlockSet.features.includes(feature)) {
        unlocks.push(featureUnlock(feature, at));
      }
    }
    for (const level of deps.graph.levels) {
      if (!state.unlockSet.levels.includes(level.id)) {
        unlocks.push(levelUnlock(level.id, at));
      }
    }
  } else if (options.level !== undefined) {
    const level = findLevel(deps.graph, options.level);
    if (level === undefined) {
      const known = deps.graph.levels.map((entry) => `${entry.id} (${entry.order})`).join(", ");
      return { text: `unlock: unknown level "${options.level}". Known levels: ${known}`, exitCode: 1 };
    }
    if (!state.unlockSet.levels.includes(level.id)) {
      unlocks.push(levelUnlock(level.id, at));
    }
    for (const feature of level.unlocks ?? []) {
      if (!state.unlockSet.features.includes(feature)) {
        unlocks.push(featureUnlock(feature, at));
      }
    }
  }

  if (unlocks.length === 0) {
    return { text: "Nothing to unlock — already unlocked.", exitCode: 0 };
  }

  await deps.store.appendEvents(unlocks);

  const updated = foldEvents([...events, ...unlocks], deps.graph);
  if (deps.runtimePaths !== undefined && deps.gateEffects !== undefined) {
    const rendered = renderGateConfig(updated.unlockSet, deps.catalog ?? v1GateCatalog);
    await writeGateConfig(deps.runtimePaths, rendered, deps.gateEffects);
  }

  const summary = unlocks
    .map((event) => (event.target.type === "feature" ? `feature ${event.target.id}` : `level ${event.target.id}`))
    .join(", ");
  return {
    text: `Unlocked: ${summary}\nNote: skipped quests award no XP. Clear them later to earn XP and the Speedrunner badge.`,
    exitCode: 0,
  };
}

export async function doctorCommand(deps: DoctorDeps): Promise<CommandOutcome> {
  const lines: string[] = ["Garnish doctor"];
  let exitCode = 0;

  const installed = await deps.runtimeInstalled();
  lines.push(`Certified runtime installed: ${installed ? "yes" : "NO"}`);
  if (!installed) {
    exitCode = 1;
    lines.push("  → Run `garnish init` to install the certified Pi runtime.");
  }

  const reported = await deps.reportedVersion();
  const shake = handshake(reported);
  if (shake.status === "ok") {
    lines.push(`Version handshake: ok (${shake.reportedVersion})`);
  } else {
    exitCode = 1;
    lines.push(`Version handshake: MISMATCH (reported ${shake.reportedVersion}, certified ${shake.certifiedVersion})`);
    for (const guidance of shake.doctor) {
      lines.push(`  → ${guidance}`);
    }
  }

  const configPresent = await deps.isolatedConfigPresent();
  lines.push(`Isolated Garnish config: ${configPresent ? "present" : "MISSING"}`);
  if (!configPresent) {
    exitCode = 1;
    lines.push("  → Run `garnish init` (or `garnish unlock --level 0`) to regenerate the gated config.");
  }

  if (exitCode === 0) {
    lines.push("All checks passed.");
  }

  return { text: lines.join("\n"), exitCode };
}

export interface MainDeps {
  readonly cli: CliDeps;
  readonly doctor: DoctorDeps;
}

export async function main(argv: readonly string[], deps: MainDeps): Promise<CommandOutcome> {
  const [command, ...rest] = argv;

  switch (command) {
    case "status":
      return statusCommand(deps.cli);
    case "quest":
      return questCommand(deps.cli);
    case "unlock":
    case "cheat":
      return unlockCommand(deps.cli, parseUnlockArgs(rest));
    case "doctor":
      return doctorCommand(deps.doctor);
    default:
      return { text: usage(), exitCode: 2 };
  }
}

export function usage(): string {
  return [
    "garnish <command>",
    "",
    "Commands:",
    "  status            show level, XP, badges, and per-quest progress",
    "  quest             show the active quest's full text and checks",
    "  unlock --all      unlock everything (escape hatch; no XP awarded)",
    "  unlock --level N  unlock one level by id or order",
    "  cheat             alias for unlock",
    "  doctor            diagnose runtime, version handshake, and config",
  ].join("\n");
}

function parseUnlockArgs(args: readonly string[]): UnlockOptions {
  const options: { all?: boolean; level?: string } = {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--all") {
      options.all = true;
    } else if (args[index] === "--level") {
      options.level = args[index + 1];
      index += 1;
    }
  }
  return options;
}

function computeQuestLines(state: ProgressionState, graph: ProgressionGraph): QuestLine[] {
  const orderedLevels = [...graph.levels].sort((left, right) => left.order - right.order);
  const completedQuests = new Set<string>(state.completedQuests.map(String));
  const lines: QuestLine[] = [];
  let nextAssigned = false;

  for (const level of orderedLevels) {
    const levelUnlocked =
      level.order === orderedLevels[0]?.order ||
      state.unlockSet.levels.includes(level.id) ||
      state.completedLevels.includes(level.id);
    const levelQuests = graph.quests.filter((quest) => `${quest.level}` === `${level.id}`);

    for (const quest of levelQuests) {
      if (completedQuests.has(`${quest.id}`)) {
        lines.push({ quest, state: "complete", isNext: false });
        continue;
      }
      if (!levelUnlocked) {
        lines.push({ quest, state: "locked", isNext: false });
        continue;
      }
      const isNext = !nextAssigned && quest.required;
      if (isNext) {
        nextAssigned = true;
      }
      lines.push({ quest, state: isNext ? "active" : "available", isNext });
    }
  }

  return lines;
}

function findLevel(graph: ProgressionGraph, selector: string): ProgressionGraph["levels"][number] | undefined {
  if (/^\d+$/.test(selector)) {
    const order = Number.parseInt(selector, 10);
    return graph.levels.find((level) => level.order === order);
  }
  return graph.levels.find((level) => `${level.id}` === selector);
}

function featureUnlock(feature: FeatureId, at: string): UnlockEvent {
  return { at, type: "unlock", target: { type: "feature", id: feature }, reason: "cheat" };
}

function levelUnlock(level: LevelId, at: string): UnlockEvent {
  return { at, type: "unlock", target: { type: "level", id: level }, reason: "cheat" };
}

function describeCheck(check: Quest["checks"][number]): string {
  switch (check.type) {
    case "event": {
      const extras: string[] = [];
      if (check.match.count !== undefined) {
        extras.push(`count ${JSON.stringify(check.match.count)}`);
      }
      if (check.match.min_assistant_turns !== undefined) {
        extras.push(`min_assistant_turns ${check.match.min_assistant_turns}`);
      }
      if (check.sameSession === true) {
        extras.push("same session");
      }
      return `event ${check.match.event}${extras.length > 0 ? ` (${extras.join(", ")})` : ""}`;
    }
    case "file_exists":
      return `file exists: ${check.path}`;
    case "json_path":
      return `json ${check.file} ${check.path}`;
    case "yaml_path":
      return `yaml ${check.file} ${check.path}`;
    case "command":
      return `command: ${typeof check.command === "string" ? check.command : check.command.join(" ")}`;
    case "git":
      return "git repository state";
    case "mcp_handshake":
      return `MCP handshake: ${typeof check.server === "string" ? check.server : JSON.stringify(check.server)}`;
    case "skill_valid":
      return `skill valid: ${check.path}`;
    case "confirm":
      return `confirm: ${check.prompt ?? check.id ?? "user confirmation"}`;
  }
}
