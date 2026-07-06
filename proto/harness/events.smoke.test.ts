import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import {
  createBus,
  createEventSink,
  deriveScorecard,
  replaySession,
  type HarnessEvent,
  type HarnessEventPayload,
} from "./index";

const tempRoots: string[] = [];

function tempLogPath(): string {
  const root = mkdtempSync(join(tmpdir(), "garnish-event-core-"));
  tempRoots.push(root);
  return join(root, "sessions", "smoke.jsonl");
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("event core", () => {
  test("emit writes non-delta events and fans out with seq and parent chain", () => {
    const delivered: HarnessEvent[] = [];
    const bus = createBus();
    bus.subscribe((event) => delivered.push(event));
    bus.subscribe(() => {
      throw new Error("subscriber failure must not break publish");
    });

    const sink = createEventSink({ sessionId: "session-a", logPath: tempLogPath(), bus });

    const started = sink.emit({
      type: "session.start",
      workspace: "/repo",
      provider: "scripted",
      model: "fake",
    });
    const user = sink.emit({ type: "message.user", source: "player", text: "hello" });

    expect(delivered).toEqual([started, user]);
    expect(started.seq).toBe(1);
    expect(started.parentId).toBeNull();
    expect(user.seq).toBe(2);
    expect(user.parentId).toBe(started.id);
    expect(sink.log.read()).toEqual([started, user]);
  });

  test("assistant deltas are bus-only and do not become parents", () => {
    const delivered: HarnessEvent[] = [];
    const sink = createEventSink({ sessionId: "session-b", logPath: tempLogPath() });
    sink.bus.subscribe((event) => delivered.push(event));

    const user = sink.emit({ type: "message.user", source: "player", text: "compose" });
    const delta = sink.emit({ type: "assistant.delta", text: "draft" });
    const thinking = sink.emit({ type: "assistant.thinking.delta", text: "scratch" });
    const assistant = sink.emit({
      type: "assistant.end",
      message: {
        role: "assistant",
        text: "final",
        toolCalls: [],
        stopReason: "end_turn",
      },
      usage: { inputTokens: 2, outputTokens: 3 },
    });

    expect(delivered).toEqual([user, delta, thinking, assistant]);
    expect(delta.parentId).toBe(user.id);
    expect(thinking.parentId).toBe(user.id);
    expect(assistant.parentId).toBe(user.id);
    expect(sink.log.read()).toEqual([user, assistant]);
  });

  test("replaySession is deterministic for persisted chat events", () => {
    const sink = createEventSink({ sessionId: "session-c", logPath: tempLogPath() });

    sink.emit({ type: "message.user", source: "player", text: "run status" });
    sink.emit({
      type: "assistant.end",
      message: {
        role: "assistant",
        text: "calling tool",
        toolCalls: [{ callId: "call-1", name: "status", input: { verbose: true } }],
        stopReason: "tool_use",
      },
    });
    sink.emit({
      type: "tool.result",
      callId: "call-1",
      tool: "status",
      output: "ok",
      isError: false,
    });

    const logEvents = sink.log.read();
    const first = replaySession(logEvents);
    const second = replaySession(logEvents);

    expect(first).toEqual(second);
    expect(first).toEqual({
      lastSeq: 3,
      messages: [
        { role: "user", source: "player", text: "run status" },
        {
          role: "assistant",
          text: "calling tool",
          toolCalls: [{ callId: "call-1", name: "status", input: { verbose: true } }],
          stopReason: "tool_use",
        },
        { role: "tool", callId: "call-1", name: "status", output: "ok", isError: false },
      ],
    });
  });

  test("deriveScorecard folds a session log", () => {
    let seq = 0;
    const event = (ts: number, payload: HarnessEventPayload): HarnessEvent => ({
      id: `e-${++seq}`,
      parentId: seq === 1 ? null : `e-${seq - 1}`,
      sessionId: "session-score",
      seq,
      ts,
      ...payload,
    } as HarnessEvent);

    const events: HarnessEvent[] = [
      event(100, { type: "session.start", workspace: "/repo", provider: "scripted" }),
      event(150, { type: "message.user", source: "player", text: "first" }),
      event(180, { type: "message.user", source: "tutor", text: "hint" }),
      event(220, {
        type: "assistant.end",
        message: {
          role: "assistant",
          text: "done",
          toolCalls: [],
          stopReason: "end_turn",
        },
        usage: { inputTokens: 10, outputTokens: 4 },
      }),
      event(260, { type: "file.edited", path: "proto/x.ts", kind: "write", summary: "+120/-30 bytes" }),
      event(300, { type: "tool.approval.resolved", callId: "a", approved: true, mode: "once" }),
      event(330, { type: "tool.approval.resolved", callId: "b", approved: false, mode: "deny" }),
      event(360, { type: "tool.approval.resolved", callId: "c", approved: true, mode: "auto" }),
      event(500, {
        type: "tool.blocked",
        callId: "d",
        tool: "write",
        reason: "locked",
        teaching: "not yet",
      }),
    ];

    expect(deriveScorecard(events)).toEqual({
      sessionId: "session-score",
      tokens: { input: 10, output: 4 },
      wallTimeMs: 400,
      diffBytes: 150,
      promptCount: 1,
      approvals: { approved: 1, denied: 1, auto: 1 },
      blocked: 1,
    });
  });
});
