import type { Quest } from "../core";
import type { ProgressionStore } from "../cli";
import { foldEvents, type ProgressionGraph, type ProgressionState } from "../progression";
import type { PiEventHandler, PiExtensionContext, PiExtensionEvent } from "./index";

/**
 * ADR-7 tutor bridge, two seams split by change rate:
 * - Static identity framing -> APPEND_SYSTEM.md at provision time (appends, never replaces).
 * - Active quest payload -> per-call injection through the Pi `context` event.
 */

export const TUTOR_FRAMING = [
  "## Garnish tutor",
  "",
  "Garnish is active: this harness is a guided learning environment.",
  "You are also the learner's tutor. Explain what you do, connect actions to the",
  "active quest, and encourage the learner to drive.",
  "Never mark quests complete yourself and never claim a quest passed —",
  "quest completion is verified mechanically by Garnish from real events and",
  "artifacts. If asked whether a quest is done, point the learner to the quest",
  "log (/quest) or `garnish status`.",
  "",
].join("\n");

export interface TutorProvisionEffects {
  readonly writeFile: (path: string, content: string) => void | Promise<void>;
}

/** Provision-time seam: write static framing to APPEND_SYSTEM.md under the agent dir. */
export async function writeTutorFraming(agentDir: string, effects: TutorProvisionEffects): Promise<string> {
  const path = `${agentDir}/APPEND_SYSTEM.md`;
  await effects.writeFile(path, TUTOR_FRAMING);
  return path;
}

export interface TutorHintPolicy {
  readonly text: string;
}

export interface TutorDeps {
  readonly graph: ProgressionGraph;
  readonly quests: readonly Quest[];
  readonly store: ProgressionStore;
  readonly hintPolicy?: TutorHintPolicy;
  readonly maxPayloadBytes?: number;
}

/** Pi context-event slice: handlers may append messages consumed by the next model call. */
export interface TutorContextEvent extends PiExtensionEvent {
  readonly type: "context";
  readonly messages: unknown[];
}

export interface TutorInjection {
  readonly role: "user";
  readonly content: string;
  readonly garnish: "tutor-context";
}

export interface TutorHandle {
  readonly renderPayload: () => Promise<string>;
  readonly lastInjected: () => string | undefined;
}

const DEFAULT_MAX_PAYLOAD_BYTES = 1024;
const DEFAULT_HINT_POLICY = "Hints are opt-in: offer one only when the learner asks; opening hints affects the No-Hint Clear badge.";

export function renderQuestPayload(
  state: ProgressionState,
  graph: ProgressionGraph,
  quests: readonly Quest[],
  hintPolicy: string = DEFAULT_HINT_POLICY,
  maxBytes: number = DEFAULT_MAX_PAYLOAD_BYTES,
): string {
  const active = activeQuest(state, graph, quests);
  const header = "[Garnish quest context — verified mechanically; do not self-certify]";

  if (active === undefined) {
    return `${header}\nNo active quest: all required quests are complete. XP: ${state.xpTotal}.`;
  }

  const requiredInLevel = quests.filter((quest) => `${quest.level}` === `${active.level}` && quest.required);
  const doneInLevel = requiredInLevel.filter((quest) =>
    state.completedQuests.map(String).includes(`${quest.id}`),
  ).length;

  const lines = [
    header,
    `Active quest: ${active.title} (${active.id}) — level ${active.level}, ${active.xp} XP${active.required ? "" : ", optional"}.`,
    `Progress: ${doneInLevel}/${requiredInLevel.length} required quests done in this level; total XP ${state.xpTotal}.`,
    `Instructions: ${active.description}`,
    "Acceptance checks:",
    ...active.checks.map((check, index) => `  ${index + 1}. ${describeTutorCheck(check)}`),
    `Hint policy: ${hintPolicy}`,
  ];

  let payload = lines.join("\n");
  if (byteLength(payload) > maxBytes) {
    // Trim the description first; checks and progress are the load-bearing content.
    const overshoot = byteLength(payload) - maxBytes;
    const trimmedDescription = active.description.slice(0, Math.max(0, active.description.length - overshoot - 16));
    lines[3] = `Instructions: ${trimmedDescription}…`;
    payload = lines.join("\n");
  }
  if (byteLength(payload) > maxBytes) {
    payload = payload.slice(0, maxBytes);
  }
  return payload;
}

export function registerTutorBridge(
  pi: { readonly on: (event: string, handler: PiEventHandler) => void },
  deps: TutorDeps,
): TutorHandle {
  let lastInjected: string | undefined;

  const renderPayload = async (): Promise<string> => {
    const state = foldEvents(await deps.store.readEvents(), deps.graph);
    return renderQuestPayload(
      state,
      deps.graph,
      deps.quests,
      deps.hintPolicy?.text ?? DEFAULT_HINT_POLICY,
      deps.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES,
    );
  };

  pi.on("context", (event: PiExtensionEvent, _ctx: PiExtensionContext) => {
    const messages = (event as TutorContextEvent).messages;
    if (!Array.isArray(messages)) {
      return;
    }
    // Synchronous fold over the store snapshot keeps injection per-call and disk-free.
    const maybeEvents = deps.store.readEvents();
    if (maybeEvents instanceof Promise) {
      // Async stores cannot block the model call; skip injection rather than stall chat.
      return;
    }
    const state = foldEvents(maybeEvents, deps.graph);
    const payload = renderQuestPayload(
      state,
      deps.graph,
      deps.quests,
      deps.hintPolicy?.text ?? DEFAULT_HINT_POLICY,
      deps.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES,
    );
    lastInjected = payload;
    const injection: TutorInjection = { role: "user", content: payload, garnish: "tutor-context" };
    messages.push(injection);
  });

  return {
    renderPayload,
    lastInjected: () => lastInjected,
  };
}

function activeQuest(
  state: ProgressionState,
  graph: ProgressionGraph,
  quests: readonly Quest[],
): Quest | undefined {
  const completed = new Set<string>(state.completedQuests.map(String));
  const firstLevel = [...graph.levels].sort((left, right) => left.order - right.order)[0];
  const unlockedLevels = new Set<string>([
    ...(firstLevel === undefined ? [] : [`${firstLevel.id}`]),
    ...state.unlockSet.levels.map(String),
    ...state.completedLevels.map(String),
  ]);

  return quests.find(
    (quest) =>
      quest.required &&
      !completed.has(`${quest.id}`) &&
      unlockedLevels.has(`${quest.level}`) &&
      quest.prereqs.every((prereq) => completed.has(`${prereq}`)),
  );
}

function describeTutorCheck(check: Quest["checks"][number]): string {
  switch (check.type) {
    case "event":
      return `harness event ${check.match.event}${check.sameSession === true ? " (same session)" : ""}`;
    case "file_exists":
      return `file exists: ${check.path}`;
    case "json_path":
      return `config value at ${check.path} in ${check.file}`;
    case "yaml_path":
      return `config value at ${check.path} in ${check.file}`;
    case "command":
      return `command succeeds: ${typeof check.command === "string" ? check.command : check.command.join(" ")}`;
    case "git":
      return "git repository reaches the target state";
    case "mcp_handshake":
      return "MCP server responds to a handshake";
    case "skill_valid":
      return `valid skill at ${check.path}`;
    case "confirm":
      return check.prompt ?? "explicit learner confirmation";
  }
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}
