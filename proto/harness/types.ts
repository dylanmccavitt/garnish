/**
 * PROTOTYPE — THROWAWAY. Shared contract for the Garnish Standalone prototype.
 *
 * This file is the prototype's "main bus": every slice imports from here and
 * NOBODY except the integrator edits it. It encodes ADR-10..21 shapes just far
 * enough to answer the seed questions in proto/README.md.
 */
import type { z } from "zod";

// ---------------------------------------------------------------------------
// Providers & streaming (ADR-11)
// ---------------------------------------------------------------------------

export type ProviderName = "anthropic" | "openai" | "scripted";

export type StopReason = "end_turn" | "tool_use" | "error" | "aborted";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface ToolCall {
  callId: string;
  name: string;
  input: unknown;
}

export interface AssistantMessage {
  role: "assistant";
  text: string;
  thinking?: string;
  toolCalls: ToolCall[];
  stopReason: StopReason;
  /** present when stopReason === "error" */
  errorMessage?: string;
  usage?: Usage;
  /** provider-opaque replay payload (e.g. OpenAI Responses output items). */
  providerRaw?: unknown;
}

export type UserSource = "player" | "tutor" | "steering";

export interface UserMessage {
  role: "user";
  text: string;
  source: UserSource;
}

export interface ToolResultMessage {
  role: "tool";
  callId: string;
  name: string;
  output: string;
  isError?: boolean;
}

export type ChatMessage = UserMessage | AssistantMessage | ToolResultMessage;

/** Garnish-owned stream-event union. Provider adapters map SSE onto this. */
export type StreamEvent =
  | { type: "text-delta"; text: string }
  | { type: "thinking-delta"; text: string }
  | { type: "tool-call-start"; callId: string; name: string }
  | { type: "tool-input-delta"; callId: string; delta: string }
  | { type: "tool-call-end"; callId: string; name: string; input: unknown }
  | { type: "usage"; usage: Usage }
  | { type: "turn-end"; message: AssistantMessage };

export interface StreamRequest {
  sessionId: string;
  system: string;
  messages: ChatMessage[];
  tools: ToolDescriptor[];
  signal: AbortSignal;
  model?: string;
}

/**
 * NEVER throws; errors/aborts are encoded on the final turn-end message
 * (stopReason "error" | "aborted"). (ADR-10)
 */
export type StreamFn = (req: StreamRequest) => AsyncIterable<StreamEvent>;

// ---------------------------------------------------------------------------
// Tools (ADR-14)
// ---------------------------------------------------------------------------

export interface ToolDescriptor {
  name: string;
  description: string;
  /** zod schema; adapters serialize per provider. */
  params: z.ZodTypeAny;
}

export interface ToolContext {
  sessionId: string;
  messageId: string;
  callId: string;
  signal: AbortSignal;
  /** absolute path of the scaffolded quest workspace */
  workspace: string;
  /** absolute path of the session temp dir (writable in sandbox) */
  sessionTemp: string;
}

export interface ToolResult {
  /** model-facing text; truncation must announce itself */
  output: string;
  /** structured data for TUI + verifier (never sent to the model) */
  details?: unknown;
  isError?: boolean;
}

export interface GarnishTool extends ToolDescriptor {
  execute(args: unknown, ctx: ToolContext): Promise<ToolResult>;
}

// ---------------------------------------------------------------------------
// Harness events (ADR-13) — the public contract of the curriculum
// ---------------------------------------------------------------------------

export interface HarnessEventBase {
  id: string;
  parentId: string | null;
  sessionId: string;
  /** monotonic per session */
  seq: number;
  ts: number;
}

export type HarnessEventPayload =
  | { type: "session.start"; workspace: string; provider: ProviderName; model?: string }
  | { type: "session.end" }
  | { type: "turn.start"; turn: number }
  | { type: "turn.end"; turn: number; stopReason: StopReason }
  | { type: "message.user"; source: UserSource; text: string }
  | { type: "auth.login"; provider: string; method: "oauth" | "api-key" | "scripted"; account?: string }
  | { type: "assistant.delta"; text: string }
  | { type: "assistant.thinking.delta"; text: string }
  | { type: "assistant.end"; message: AssistantMessage; usage?: Usage }
  | { type: "tool.call"; callId: string; tool: string; input: unknown }
  | {
      type: "tool.approval.requested";
      callId: string;
      tool: string;
      command?: string;
      risk: RiskTier;
      explanation: string;
    }
  | {
      type: "tool.approval.resolved";
      callId: string;
      approved: boolean;
      mode: "once" | "pattern" | "deny" | "deny-with-reason" | "auto";
      reason?: string;
      pattern?: string;
    }
  | { type: "tool.blocked"; callId: string; tool: string; reason: "locked" | "denied" | "sandbox"; teaching: string }
  | { type: "tool.result"; callId: string; tool: string; output: string; isError: boolean; details?: unknown }
  | { type: "file.edited"; path: string; kind: "write" | "edit"; summary: string }
  | { type: "quest.completed"; questId: string; xp: number }
  | { type: "unlock.applied"; unlockId: string; tools: string[] }
  | { type: "error"; message: string }
  | { type: "compaction" }; // reserved, unimplemented

export type HarnessEvent = HarnessEventBase & HarnessEventPayload;
export type HarnessEventType = HarnessEvent["type"];

/**
 * Note: `quest.completed` and `unlock.applied` are prototype additions on top
 * of the ADR-13 list — game moments must appear in the transcript/replay
 * (LOO-171 "session mirroring"). Retro decides whether they graduate.
 */

export interface EventBus {
  publish(e: HarnessEvent): void;
  subscribe(fn: (e: HarnessEvent) => void): () => void;
}

export interface SessionLog {
  readonly path: string;
  append(e: HarnessEvent): void;
  /** all events, oldest first */
  read(): HarnessEvent[];
}

/** Mints ordered events: fills id/parentId/sessionId/seq/ts, appends + publishes. */
export interface EventSink {
  emit(payload: HarnessEventPayload, parentId?: string | null): HarnessEvent;
  readonly bus: EventBus;
  readonly log: SessionLog;
  readonly sessionId: string;
}

// ---------------------------------------------------------------------------
// Approvals (ADR-18)
// ---------------------------------------------------------------------------

export type RiskTier = "safe" | "moderate" | "risky" | "critical";

export type ApprovalPolicy = "ask" | "allow" | "deny";

export interface ApprovalRequest {
  callId: string;
  tool: string;
  /** exact command for bash; stringified args otherwise */
  command: string;
  risk: RiskTier;
  explanation: string;
  suggestedPattern?: string;
}

export interface ApprovalDecision {
  approved: boolean;
  mode: "once" | "pattern" | "deny" | "deny-with-reason" | "auto";
  reason?: string;
  pattern?: string;
}

/** TUI (or headless auto-policy) answers approval requests through this. */
export type ApprovalPrompter = (req: ApprovalRequest) => Promise<ApprovalDecision>;

// ---------------------------------------------------------------------------
// Gates (ADR-16) + tier policy (ADR-18)
// ---------------------------------------------------------------------------

export interface GateCatalogEntry {
  tool: string;
  /** progression unlock id that grants this tool; null = always available */
  unlockId: string | null;
  /** per-tier default approval policy for this tool's risk classes */
  tierPolicy: Record<RiskTier, ApprovalPolicy>;
}

export type GateVisibility = "unlocked" | "tease" | "hidden";

export interface GateView {
  tool: string;
  visibility: GateVisibility;
  /** teaching line used for tool.blocked when teased */
  teaching?: string;
}

export interface GateEngine {
  /** tools visible to the model (unlocked only) */
  toolFilter(all: GarnishTool[]): GarnishTool[];
  /** full visibility map for TUI skill tree */
  views(all: GarnishTool[]): GateView[];
  /** apply an unlock live; monotonic */
  applyUnlock(unlockId: string): void;
  isUnlocked(tool: string): boolean;
  /** cheat: parity with fully-unlocked harness */
  unlockAll(): void;
}

// ---------------------------------------------------------------------------
// Loop (ADR-10)
// ---------------------------------------------------------------------------

export interface LoopHooks {
  /** tutor et al: ephemeral per-turn context blocks, never persisted (ADR-15) */
  contextProviders?: Array<() => string | null>;
  /** capability gates (ADR-16) */
  toolFilter?: (tools: GarnishTool[]) => GarnishTool[];
  /**
   * approvals + gate enforcement. Return null to proceed; return a ToolResult
   * to short-circuit (block/denial becomes the tool result, teaching in-band).
   */
  beforeToolCall?: (call: ToolCall, ctx: ToolContext) => Promise<ToolResult | null>;
  /** verifier-side decoration */
  afterToolCall?: (call: ToolCall, result: ToolResult, ctx: ToolContext) => Promise<void>;
  shouldStopAfterTurn?: (turn: number, stopReason: StopReason) => boolean;
  getSteeringMessages?: () => UserMessage[];
  getFollowUpMessages?: () => UserMessage[];
}

export interface HarnessConfig {
  sessionId: string;
  workspace: string;
  sessionTemp: string;
  system: string;
  streamFn: StreamFn;
  tools: GarnishTool[];
  hooks: LoopHooks;
  sink: EventSink;
  model?: string;
  provider: ProviderName;
}

export interface Harness {
  /** enqueue a player message and run turns until the loop goes idle */
  send(text: string): Promise<void>;
  /** abort the in-flight turn (one AbortController per turn) */
  abort(): void;
  readonly config: HarnessConfig;
}

// ---------------------------------------------------------------------------
// Scripted model (fake StreamFn driver for demos/tests)
// ---------------------------------------------------------------------------

export interface ScriptedToolCall {
  name: string;
  input: unknown;
}

export interface ScriptedTurn {
  /** streamed as text-delta chunks */
  text?: string;
  thinking?: string;
  toolCalls?: ScriptedToolCall[];
  stopReason?: StopReason;
}

// ---------------------------------------------------------------------------
// Scorecard (ADR-21)
// ---------------------------------------------------------------------------

export interface Scorecard {
  sessionId: string;
  tokens: { input: number; output: number };
  wallTimeMs: number;
  diffBytes: number;
  promptCount: number;
  approvals: { approved: number; denied: number; auto: number };
  blocked: number;
}
