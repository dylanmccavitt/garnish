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
  id: string;
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
  /** durable save root; keeps workspace, progression, and sessions across runs */
  saveRoot?: string;
  model?: string;
  /** who the player signed in as; emitted as auth.login for tutorial checks */
  auth?: { provider: string; method: "oauth" | "api-key" | "scripted"; account?: string };
}

export async function wireHarness(opts: WireOptions): Promise<WiredHarness> {
  const scaffoldRoot = opts.saveRoot ?? opts.root;
  const { workspace, sessionTemp } = scaffoldWorkspace(scaffoldRoot ? { root: scaffoldRoot } : {});
  const root = join(workspace, "..");
  const sessionId = crypto.randomUUID();
  const sessionLogPath = opts.saveRoot
    ? join(root, "sessions", `${sessionId}.jsonl`)
    : join(root, ".garnish-proto", "sessions", `${sessionId}.jsonl`);

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
    initialCompleted: new Set(progression.state().completedQuests.map(String)),
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
  const auth = opts.auth ?? {
    provider: opts.provider === "scripted" ? "demo-kitchen" : opts.provider,
    method: opts.provider === "scripted" ? ("scripted" as const) : ("api-key" as const),
  };
  sink.emit({ type: "auth.login", provider: auth.provider, method: auth.method, account: auth.account });

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
        id: quest.id,
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
