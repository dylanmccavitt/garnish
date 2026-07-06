import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createHarness } from "./loop";
import { scriptedStream } from "./scripted";
import type {
  ChatMessage,
  EventBus,
  EventSink,
  GarnishTool,
  Harness,
  HarnessConfig,
  HarnessEvent,
  HarnessEventPayload,
  SessionLog,
  StreamFn,
  StreamRequest,
  ToolResult,
  UserMessage,
} from "./types";

interface Fixture {
  harness: Harness;
  events: HarnessEvent[];
  requests: StreamRequest[];
}

function makeSink(sessionId = "s-loop"): { sink: EventSink; events: HarnessEvent[] } {
  const events: HarnessEvent[] = [];
  const subscribers: Array<(event: HarnessEvent) => void> = [];
  const bus: EventBus = {
    publish(event) {
      for (const subscriber of subscribers) subscriber(event);
    },
    subscribe(fn) {
      subscribers.push(fn);
      return () => {
        const index = subscribers.indexOf(fn);
        if (index >= 0) subscribers.splice(index, 1);
      };
    },
  };
  const log: SessionLog = {
    path: ".garnish-proto/test-session.jsonl",
    append(event) {
      events.push(event);
    },
    read() {
      return events.slice();
    },
  };
  let seq = 0;
  const sink: EventSink = {
    bus,
    log,
    sessionId,
    emit(payload: HarnessEventPayload, parentId: string | null = null) {
      const event: HarnessEvent = {
        ...payload,
        id: `e-${++seq}`,
        parentId,
        sessionId,
        seq,
        ts: seq,
      };
      log.append(event);
      bus.publish(event);
      return event;
    },
  };
  return { sink, events };
}

function captureStream(streamFn: StreamFn, requests: StreamRequest[]): StreamFn {
  return (request) => {
    requests.push({ ...request, messages: request.messages.map(copyMessage) });
    return streamFn(request);
  };
}

function copyMessage(message: ChatMessage): ChatMessage {
  return structuredClone(message) as ChatMessage;
}

function echoTool(output = "tool ok"): GarnishTool {
  return {
    name: "echo",
    description: "fake echo tool",
    params: z.any(),
    async execute(): Promise<ToolResult> {
      return { output };
    },
  };
}

function makeFixture(overrides: Partial<HarnessConfig>): Fixture {
  const { sink, events } = makeSink();
  const requests: StreamRequest[] = [];
  const streamFn = overrides.streamFn ?? scriptedStream([]);
  const config: HarnessConfig = {
    sessionId: overrides.sessionId ?? "s-loop",
    workspace: overrides.workspace ?? "/tmp/garnish-workspace",
    sessionTemp: overrides.sessionTemp ?? "/tmp/garnish-session",
    system: overrides.system ?? "system prompt",
    streamFn: captureStream(streamFn, requests),
    tools: overrides.tools ?? [echoTool()],
    hooks: overrides.hooks ?? {},
    sink: overrides.sink ?? sink,
    model: overrides.model,
    provider: overrides.provider ?? "scripted",
  };
  return { harness: createHarness(config), events, requests };
}

describe("createHarness", () => {
  test("scripted two-turn tool run emits ordered events and replay-clean history", async () => {
    const fixture = makeFixture({
      streamFn: scriptedStream([
        { text: "use tool", toolCalls: [{ name: "echo", input: { value: 1 } }] },
        { text: "done", stopReason: "end_turn" },
      ]),
    });

    await fixture.harness.send("hello");

    expect(fixture.events.map((event) => event.type)).toEqual([
      "message.user",
      "turn.start",
      "assistant.delta",
      "assistant.end",
      "tool.call",
      "tool.result",
      "turn.end",
      "turn.start",
      "assistant.delta",
      "assistant.end",
      "turn.end",
    ]);
    expect(fixture.events.filter((event) => event.type === "turn.end").map((event) => event.stopReason)).toEqual([
      "tool_use",
      "end_turn",
    ]);
    expect(fixture.requests).toHaveLength(2);
    expect(fixture.requests[1].messages).toMatchObject([
      { role: "user", text: "hello", source: "player" },
      { role: "assistant", text: "use tool", stopReason: "tool_use" },
      { role: "tool", name: "echo", output: "tool ok", isError: undefined },
    ]);
  });

  test("beforeToolCall short-circuits and persists returned ToolResult", async () => {
    let executeCount = 0;
    const shortCircuit: ToolResult = { output: "blocked in-band", isError: true };
    const fixture = makeFixture({
      streamFn: scriptedStream([
        { text: "try", toolCalls: [{ name: "echo", input: { value: 2 } }] },
        { text: "saw block", stopReason: "end_turn" },
      ]),
      tools: [
        {
          ...echoTool(),
          async execute(): Promise<ToolResult> {
            executeCount += 1;
            return { output: "should not run" };
          },
        },
      ],
      hooks: {
        async beforeToolCall() {
          return shortCircuit;
        },
      },
    });

    await fixture.harness.send("hello");

    expect(executeCount).toBe(0);
    expect(fixture.events.find((event) => event.type === "tool.result")).toMatchObject({
      output: "blocked in-band",
      isError: true,
    });
    expect(fixture.requests[1].messages.at(-1)).toMatchObject({
      role: "tool",
      output: "blocked in-band",
      isError: true,
    });
  });

  test("abort mid-stream ends aborted and synthesizes tool results", async () => {
    let sawToolCall!: () => void;
    const toolCallSeen = new Promise<void>((resolve) => {
      sawToolCall = resolve;
    });
    const streamFn: StreamFn = async function* stream(request) {
      yield { type: "text-delta", text: "working" };
      yield { type: "tool-call-start", callId: "abort-call", name: "echo" };
      yield { type: "tool-call-end", callId: "abort-call", name: "echo", input: { slow: true } };
      sawToolCall();
      await new Promise<void>((resolve) => request.signal.addEventListener("abort", () => resolve(), { once: true }));
      yield {
        type: "turn-end",
        message: {
          role: "assistant",
          text: "working",
          toolCalls: [{ callId: "abort-call", name: "echo", input: { slow: true } }],
          stopReason: "aborted",
        },
      };
    };
    const fixture = makeFixture({ streamFn });

    const sendPromise = fixture.harness.send("stop soon");
    await toolCallSeen;
    fixture.harness.abort();
    await sendPromise;

    expect(fixture.events.find((event) => event.type === "turn.end")).toMatchObject({ stopReason: "aborted" });
    expect(fixture.events.find((event) => event.type === "tool.result")).toMatchObject({
      callId: "abort-call",
      output: "Tool call aborted",
      isError: true,
    });
    expect(fixture.requests).toHaveLength(1);
  });

  test("contextProviders reach requests but are not persisted to history", async () => {
    let contextCount = 0;
    let followUpSent = false;
    const fixture = makeFixture({
      streamFn: scriptedStream([
        { text: "first", stopReason: "end_turn" },
        { text: "second", stopReason: "end_turn" },
      ]),
      hooks: {
        contextProviders: [() => `ctx-${++contextCount}`],
        getFollowUpMessages(): UserMessage[] {
          if (followUpSent) return [];
          followUpSent = true;
          return [{ role: "user", source: "tutor", text: "follow up" }];
        },
      },
    });

    await fixture.harness.send("hello");

    expect(fixture.requests).toHaveLength(2);
    const firstLastMessage = fixture.requests[0].messages.at(-1);
    const secondLastMessage = fixture.requests[1].messages.at(-1);
    expect(firstLastMessage).toMatchObject({ role: "user", source: "tutor" });
    expect(firstLastMessage?.role === "user" ? firstLastMessage.text : undefined).toContain("ctx-1");
    expect(secondLastMessage?.role === "user" ? secondLastMessage.text : undefined).toContain("ctx-2");
    expect(JSON.stringify(fixture.requests[1].messages.slice(0, -1))).not.toContain("ctx-1");
  });
});
