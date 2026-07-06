import type { EventBus, GateView, HarnessEvent, HarnessEventPayload, Scorecard } from "../harness/types";
import { startTui } from "./index";

type Listener = (event: HarnessEvent) => void;

class FakeBus implements EventBus {
  private listeners = new Set<Listener>();

  publish(event: HarnessEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

const bus = new FakeBus();
let seq = 0;
let questDone = false;
let writeUnlocked = false;
let blocked = 0;
let approvals = { approved: 0, denied: 0, auto: 0 };

function event(payload: HarnessEventPayload, parentId: string | null = null): HarnessEvent {
  seq += 1;
  return { id: `evt-${seq}`, parentId, sessionId: "tui-dev", seq, ts: Date.now(), ...payload } as HarnessEvent;
}

function publish(payload: HarnessEventPayload, parentId?: string | null): void {
  bus.publish(event(payload, parentId ?? null));
}

const tui = startTui({
  bus,
  send(text) {
    publish({ type: "message.user", source: "player", text });
    publish({ type: "assistant.delta", text: `Heard: ${text}. ` });
    publish({ type: "assistant.end", message: { role: "assistant", text: `Heard: ${text}.`, toolCalls: [], stopReason: "end_turn" } });
  },
  abort() {
    publish({ type: "error", message: "Abort requested from Esc." });
  },
  gateViews(): GateView[] {
    return [
      { tool: "read", visibility: "unlocked" },
      { tool: "edit", visibility: writeUnlocked ? "unlocked" : "tease", teaching: "Complete the first quest to unlock edits." },
      { tool: "bash", visibility: "tease", teaching: "Needs approval pattern practice." },
      { tool: "deploy", visibility: "hidden" },
    ];
  },
  questView() {
    return { title: "Patch the beacon", checks: [{ line: "Inspect the broken file", done: true }, { line: "Approve one safe command", done: approvals.approved > 0 }, { line: "Celebrate the unlock", done: questDone }] };
  },
  scorecard(): Scorecard {
    return { sessionId: "tui-dev", tokens: { input: 128, output: questDone ? 760 : 210 }, wallTimeMs: seq * 250, diffBytes: writeUnlocked ? 420 : 0, promptCount: 1, approvals, blocked };
  },
  onExit() {
    tui.stop();
    process.exit(0);
  },
});

const script: Array<[number, () => void]> = [
  [150, () => publish({ type: "session.start", workspace: process.cwd(), provider: "scripted", model: "tui-dev" })],
  [450, () => publish({ type: "message.user", source: "player", text: "Fix the beacon and teach me the gate." })],
  [800, () => publish({ type: "assistant.thinking.delta", text: "Need to inspect the quest state, then request one risky command approval." })],
  [1150, () => publish({ type: "assistant.delta", text: "I’ll inspect the beacon, then ask before running anything risky. " })],
  [1450, () => publish({ type: "tool.call", callId: "read-1", tool: "read", input: { path: "beacon.ts" } })],
  [1750, () => publish({ type: "tool.result", callId: "read-1", tool: "read", output: "export const beacon = false", isError: false })],
  [2150, () => publish({ type: "tool.blocked", callId: "edit-1", tool: "edit", reason: "locked", teaching: "Edits unlock after you prove inspection first." })],
  [2550, () => {
    const request = { callId: "bash-1", tool: "bash", command: "bun test proto/tui", risk: "moderate" as const, explanation: "Runs only the TUI smoke tests in this prototype slice.", suggestedPattern: "bun test proto/tui" };
    publish({ type: "tool.approval.requested", ...request });
    void tui.prompter(request).then((decision) => {
      if (decision.approved) approvals = { ...approvals, approved: approvals.approved + 1 };
      else approvals = { ...approvals, denied: approvals.denied + 1 };
      publish({ type: "tool.approval.resolved", callId: request.callId, approved: decision.approved, mode: decision.mode, reason: decision.reason, pattern: decision.pattern });
    });
    setTimeout(() => process.stdin.emit("data", Buffer.from("a")), 1200);
  }],
  [4300, () => publish({ type: "tool.result", callId: "bash-1", tool: "bash", output: "1 pass, 0 fail", isError: false })],
  [4700, () => { writeUnlocked = true; publish({ type: "unlock.applied", unlockId: "edit-tool", tools: ["edit"] }); }],
  [5150, () => publish({ type: "file.edited", path: "beacon.ts", kind: "edit", summary: "flipped beacon to true" })],
  [5600, () => { questDone = true; publish({ type: "quest.completed", questId: "patch-beacon", xp: 120 }); }],
  [6100, () => publish({ type: "assistant.end", message: { role: "assistant", text: "Beacon patched. New verb unlocked.", toolCalls: [], stopReason: "end_turn" } })],
];

for (const [delay, action] of script) setTimeout(action, delay);
setTimeout(() => {
  tui.stop();
  process.exit(0);
}, 9000);
