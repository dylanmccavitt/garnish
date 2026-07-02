import type { ProgressionEvent, Quest } from "../core";
import type { VersionHandshake } from "../adapter";
import { deriveUnlocks, foldEvents, type ProgressionGraph, type ProgressionState } from "../progression";
import {
  createScheduler,
  evaluateQuest,
  type MaybePromise,
  type Probes,
  type SchedulerTimer,
  type VerifierEvent,
} from "../verifier";

/**
 * Structural slice of the Pi (omp) extension API observed in the LOO-118 spike.
 * Pi-specific shapes live here only; core/verifier/progression never import them.
 */
export interface PiExtensionContext {
  readonly hasUI: boolean;
  readonly ui: {
    readonly notify: (message: string, level?: "info" | "warning" | "error") => void;
  };
  readonly appendEntry?: (customType: string, data: Readonly<Record<string, unknown>>) => void;
}

export interface PiExtensionEvent {
  readonly type: string;
  readonly [key: string]: unknown;
}

export type PiEventHandler = (event: PiExtensionEvent, ctx: PiExtensionContext) => void;

export interface PiExtensionApi {
  readonly on: (event: string, handler: PiEventHandler) => void;
}

export interface ProgressionStore {
  readonly readEvents: () => MaybePromise<readonly ProgressionEvent[]>;
  readonly appendEvents: (events: readonly ProgressionEvent[]) => MaybePromise<void>;
}

export interface GarnishExtensionDeps {
  readonly graph: ProgressionGraph;
  readonly quests: readonly Quest[];
  readonly probes: Probes;
  readonly store: ProgressionStore;
  readonly handshake: (reportedVersion: string | undefined) => VersionHandshake;
  readonly now: () => number;
  readonly isoNow?: () => string;
  readonly paths?: Readonly<Record<string, string>>;
  readonly debounceMs?: number;
  readonly timer?: SchedulerTimer;
  readonly onError?: (error: unknown) => void;
}

export interface GarnishExtensionHandle {
  readonly isPaused: () => boolean;
  readonly recordedEvents: () => readonly VerifierEvent[];
  readonly evaluateNow: () => Promise<void>;
}

const PI_EVENTS = [
  "session_start",
  "session_shutdown",
  "turn_start",
  "turn_end",
  "agent_start",
  "agent_end",
  "tool_call",
  "tool_result",
  "tool_approval_requested",
  "tool_approval_resolved",
] as const;

export function createGarnishExtension(deps: GarnishExtensionDeps): (pi: PiExtensionApi) => GarnishExtensionHandle {
  return (pi: PiExtensionApi): GarnishExtensionHandle => {
    const recorded: VerifierEvent[] = [];
    let seq = 0;
    let paused = false;
    let pauseNotified = false;
    let currentSessionId: string | undefined;
    let latestCtx: PiExtensionContext | undefined;
    let evaluating: Promise<void> = Promise.resolve();

    const isoNow = deps.isoNow ?? (() => new Date(deps.now()).toISOString());

    const pause = (reason: string, guidance?: readonly string[]) => {
      paused = true;
      if (!pauseNotified) {
        pauseNotified = true;
        try {
          latestCtx?.ui.notify(`Garnish quests paused: ${reason}`, "warning");
          for (const line of guidance ?? []) {
            latestCtx?.ui.notify(line, "info");
          }
        } catch {
          // Never let UI failures escape into chat.
        }
      }
    };

    const evaluateActiveQuests = async (): Promise<void> => {
      if (paused) {
        return;
      }
      const log = await deps.store.readEvents();
      const state = foldEvents(log, deps.graph);
      const pending = activeQuests(deps.quests, state, deps.graph);
      const completions: ProgressionEvent[] = [];

      for (const quest of pending) {
        const result = await evaluateQuest(quest, {
          probes: deps.probes,
          events: recorded,
          currentSessionId,
          paths: deps.paths,
        });
        if (result.status !== "pass") {
          continue;
        }
        completions.push({
          at: isoNow(),
          type: "quest_completed",
          quest_id: quest.id,
          level_id: quest.level,
          required: quest.required,
          xp: quest.xp,
        });
      }

      if (completions.length === 0) {
        return;
      }

      await deps.store.appendEvents(completions);
      const afterCompletion = foldEvents([...log, ...completions], deps.graph);
      const unlocks = deriveUnlocks(afterCompletion, deps.graph);
      if (unlocks.length > 0) {
        await deps.store.appendEvents(unlocks);
      }

      try {
        for (const completion of completions) {
          if (completion.type !== "quest_completed") {
            continue;
          }
          latestCtx?.ui.notify(`Quest complete: ${completion.quest_id} (+${completion.xp} XP)`, "info");
          latestCtx?.appendEntry?.("garnish-quest-completed", {
            questId: `${completion.quest_id}`,
            xp: completion.xp,
            at: completion.at,
          });
        }
        for (const unlock of unlocks) {
          const label = unlock.target.type === "feature" ? `feature ${unlock.target.id}` : `level ${unlock.target.id}`;
          latestCtx?.ui.notify(`Unlocked: ${label}`, "info");
        }
      } catch {
        // Feedback is best-effort; state is already durable.
      }
    };

    const scheduleEvaluation = () => {
      evaluating = evaluating.then(() =>
        evaluateActiveQuests().catch((error) => {
          deps.onError?.(error);
          pause("verification failed; progress tracking is paused for this session");
        }),
      );
    };

    const scheduler = createScheduler({
      debounceMs: deps.debounceMs ?? 250,
      now: deps.now,
      timer: deps.timer,
      onTrigger: () => {
        scheduleEvaluation();
      },
    });

    const record = (event: PiExtensionEvent, ctx: PiExtensionContext) => {
      latestCtx = ctx;
      const sessionId = typeof event.sessionId === "string" ? event.sessionId : currentSessionId;
      recorded.push({
        name: event.type,
        seq: (seq += 1),
        sessionId,
        payload: normalizePayload(event),
      });
    };

    for (const eventName of PI_EVENTS) {
      pi.on(eventName, (event, ctx) => {
        try {
          if (eventName === "session_start") {
            latestCtx = ctx;
            currentSessionId = typeof event.sessionId === "string" ? event.sessionId : `session-${seq + 1}`;
            const reported = typeof event.version === "string" ? event.version : undefined;
            const shake = deps.handshake(reported);
            if (shake.status === "paused") {
              pause(
                `Pi version mismatch (reported ${shake.reportedVersion}, certified ${shake.certifiedVersion})`,
                shake.doctor,
              );
              return;
            }
            paused = false;
            pauseNotified = false;
            record(event, ctx);
            scheduler.questActivated();
            return;
          }

          if (paused) {
            return;
          }

          record(event, ctx);

          if (eventName === "turn_end") {
            scheduler.turnEnd();
          } else if (eventName === "agent_end" || eventName === "tool_result") {
            // Immediate path keeps the 10s auto-complete contract (PRD AC-2).
            scheduler.manualCheck();
          }
        } catch (error) {
          deps.onError?.(error);
          pause("internal error while tracking progress");
        }
      });
    }

    return {
      isPaused: () => paused,
      recordedEvents: () => recorded,
      evaluateNow: async () => {
        scheduleEvaluation();
        await evaluating;
      },
    };
  };
}

function activeQuests(quests: readonly Quest[], state: ProgressionState, graph: ProgressionGraph): Quest[] {
  const completed = new Set<string>(state.completedQuests.map(String));
  const firstLevel = [...graph.levels].sort((left, right) => left.order - right.order)[0];
  const unlockedLevels = new Set<string>([
    ...(firstLevel === undefined ? [] : [`${firstLevel.id}`]),
    ...state.unlockSet.levels.map(String),
    ...state.completedLevels.map(String),
  ]);

  return quests.filter((quest) => {
    if (completed.has(`${quest.id}`)) {
      return false;
    }
    if (!unlockedLevels.has(`${quest.level}`)) {
      return false;
    }
    return quest.prereqs.every((prereq) => completed.has(`${prereq}`));
  });
}

function normalizePayload(event: PiExtensionEvent): Readonly<Record<string, unknown>> {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event)) {
    if (key === "type") {
      continue;
    }
    payload[key] = value;
  }
  return payload;
}
