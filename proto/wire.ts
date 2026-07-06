/**
 * PROTOTYPE — THROWAWAY. Integration wiring: assembles every slice into one
 * playable harness. This file is the proof that the ADR-10 seams carry the
 * whole game with no privileged channels.
 */
import { join } from "node:path";

import { createEventSink, deriveScorecard } from "./harness";
import { createHarness } from "./harness/loop";
import type {
  ApprovalPrompter,
  EventSink,
  GateEngine,
  GateView,
  Harness,
  ProviderName,
  Scorecard,
  StreamFn,
} from "./harness/types";
import { createApprovalHook, createRulesEngine } from "./approvals";
import { defaultCatalog } from "./gates";
import { createGateEngine } from "./gates";
import {
  createProgression,
  createTutorProvider,
  defaultQuestPackDir,
  renderCheck,
  startVerifier,
  tutorSystemPromptSection,
  type ProgressionBridge,
  type VerifierBridge,
} from "./game";
import { sandboxAvailability, type SandboxAvailability } from "./sandbox";
import { createCoreTools, scaffoldWorkspace } from "./tools";

export interface QuestPanelView {
  title: string;
  checks: Array<{ line: string; done: boolean }>;
}

export interface WiredHarness {
  harness: Harness;
  sink: EventSink;
  verifier: VerifierBridge;
  progression: ProgressionBridge;
  gates: GateEngine;
  sandbox: SandboxAvailability;
  workspace: string;
  root: string;
  sessionLogPath: string;
  scorecard(): Scorecard;
  questView(): QuestPanelView | null;
  gateViews(): GateView[];
  tutorBlock(): string | null;
  stop(): void;
}

export interface WireOptions {
  streamFn: StreamFn;
  provider: ProviderName;
  prompter: ApprovalPrompter;
  /** scratch root; a temp dir is created when omitted */
  root?: string;
  model?: string;
}

export async function wireHarness(opts: WireOptions): Promise<WiredHarness> {
  const { workspace, sessionTemp } = scaffoldWorkspace(opts.root ? { root: opts.root } : {});
  const root = join(workspace, "..");
  const sessionId = crypto.randomUUID();
  const sessionLogPath = join(root, ".garnish-proto", "sessions", `${sessionId}.jsonl`);

  const sink = createEventSink({ sessionId, logPath: sessionLogPath });
  const sandbox = sandboxAvailability();
  const tools = createCoreTools({ workspace, sessionTemp, sandbox: sandbox.mode });
  const catalog = defaultCatalog();
  const gates = createGateEngine({ catalog, unlocked: new Set() });

  const progression = createProgression({
    root,
    onUnlock: (unlockId, unlockedTools) => {
      gates.applyUnlock(unlockId);
      sink.emit({ type: "unlock.applied", unlockId, tools: unlockedTools });
    },
  });

  const verifier = await startVerifier({
    bus: sink.bus,
    sink,
    questSource: defaultQuestPackDir(),
    workspace,
    onQuestComplete: (quest, xp) => progression.grantQuest(quest.id, xp),
  });

  const tutor = createTutorProvider({ verifier });
  const rules = createRulesEngine({});
  const beforeToolCall = createApprovalHook({
    sink,
    prompter: opts.prompter,
    gates,
    rules,
    tier: () => progression.state().completedLevels.length,
    catalog,
  });

  const system = [
    tutorSystemPromptSection(),
    "You operate real tools on a real scaffolded git repo. Use only the tools you have been granted; locked verbs are earned through quests.",
  ].join("\n\n");

  const harness = createHarness({
    sessionId,
    workspace,
    sessionTemp,
    system,
    streamFn: opts.streamFn,
    tools,
    provider: opts.provider,
    model: opts.model,
    sink,
    hooks: {
      contextProviders: [tutor],
      toolFilter: (all) => gates.toolFilter(all),
      beforeToolCall,
    },
  });

  sink.emit({ type: "session.start", workspace, provider: opts.provider, model: opts.model });

  return {
    harness,
    sink,
    verifier,
    progression,
    gates,
    sandbox,
    workspace,
    root,
    sessionLogPath,
    scorecard: () => deriveScorecard(sink.log.read()),
    questView: () => {
      const quest = verifier.activeQuest();
      if (quest === null) return null;
      const state = verifier.checkStates();
      const results = state?.questId === quest.id ? state.checks : [];
      return {
        title: `${quest.title} (+${quest.xp} XP)`,
        checks: quest.checks.map((check, index) => ({
          line: renderCheck(check),
          done: results[index]?.result.status === "pass",
        })),
      };
    },
    gateViews: () => gates.views(tools),
    tutorBlock: () => tutor(),
    stop: () => {
      sink.emit({ type: "session.end" });
      verifier.stop();
    },
  };
}
