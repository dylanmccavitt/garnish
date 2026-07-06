import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { chmod, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import type { RawMessageStreamEvent } from "@anthropic-ai/sdk/resources/messages/messages";
import type { Response, ResponseInputItem, ResponseStreamEvent } from "openai/resources/responses/responses";
import type { StreamEvent, StreamRequest, ToolDescriptor } from "../harness/types";
import { collectAnthropicEvents, anthropicMessagesFromHistory, anthropicStream, anthropicStreamFromClient } from "./anthropic";
import { resolveAuth } from "./auth";
import { collectOpenAIEvents, openAIInputFromHistory, openaiStream, openaiStreamFromClient } from "./openai";
import { serializeToolParams } from "./index";

const envSnapshot = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in envSnapshot)) delete process.env[key];
  }
  Object.assign(process.env, envSnapshot);
});

test("auth prefers env and rejects non-0600 auth file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "garnish-auth-"));
  try {
    const authFile = join(dir, "auth.json");
    await writeFile(authFile, JSON.stringify({ anthropic: { apiKey: "file-anthropic" }, openaiApiKey: "file-openai" }));
    await chmod(authFile, 0o644);
    process.env.GARNISH_PROTO_AUTH_FILE = authFile;
    delete process.env.ANTHROPIC_API_KEY;
    expect(resolveAuth("anthropic")).toBeNull();

    process.env.ANTHROPIC_API_KEY = "env-anthropic";
    expect(resolveAuth("anthropic")).toEqual({ apiKey: "env-anthropic" });

    delete process.env.ANTHROPIC_API_KEY;
    await chmod(authFile, 0o600);
    expect(resolveAuth("anthropic")).toEqual({ apiKey: "file-anthropic" });
    expect(resolveAuth("openai")).toEqual({ apiKey: "file-openai" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("serializes zod v4 params once as JSON schema", () => {
  const tool: ToolDescriptor = {
    name: "add",
    description: "Add two numbers",
    params: z.object({ a: z.number(), b: z.number() }),
  };
  const serialized = serializeToolParams(tool);
  expect(serialized.schema.type).toBe("object");
  expect(serialized.schema.properties).toMatchObject({ a: { type: "number" }, b: { type: "number" } });
  expect(serialized.schema.required).toEqual(["a", "b"]);
});

test("Anthropic history conversion and stream assembly preserve tool calls", () => {
  const history = anthropicMessagesFromHistory([
    { role: "user", source: "player", text: "add" },
    { role: "assistant", text: "", toolCalls: [{ callId: "call_1", name: "add", input: { a: 1, b: 2 } }], stopReason: "tool_use" },
    { role: "tool", callId: "call_1", name: "add", output: "3" },
  ]);
  expect(history[1]).toMatchObject({ role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "add", input: { a: 1, b: 2 } }] });
  expect(history[2]).toMatchObject({ role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "3" }] });

  const assembled = collectAnthropicEvents(asAnthropicEvents([
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } },
    { type: "content_block_delta", index: 1, delta: { type: "thinking_delta", thinking: "plan" } },
    { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "call_2", name: "add", input: {} } },
    { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: "{\"a\":1" } },
    { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: ",\"b\":2}" } },
    { type: "content_block_stop", index: 2 },
    {
      type: "message_delta",
      delta: { stop_reason: "tool_use", stop_sequence: null, stop_details: null, container: null },
      usage: { input_tokens: 10, output_tokens: 4, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 },
    },
  ]));

  expect(assembled.events.map((event) => event.type)).toEqual([
    "text-delta",
    "thinking-delta",
    "tool-call-start",
    "tool-input-delta",
    "tool-input-delta",
    "tool-call-end",
    "usage",
    "turn-end",
  ]);
  expect(assembled.message).toMatchObject({ text: "hi", thinking: "plan", stopReason: "tool_use", toolCalls: [{ callId: "call_2", name: "add", input: { a: 1, b: 2 } }] });
  expect(assembled.message.usage).toEqual({ inputTokens: 10, outputTokens: 4, cacheReadTokens: 3, cacheWriteTokens: 2 });
});

test("OpenAI replay and stream assembly preserve provider output items", () => {
  const providerOutput: ResponseInputItem[] = [
    { type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Use add", annotations: [] }] },
    { type: "function_call", id: "fc_1", call_id: "call_1", name: "add", arguments: "{\"a\":1,\"b\":2}", status: "completed" },
  ];
  const input = openAIInputFromHistory([
    { role: "user", source: "player", text: "add" },
    { role: "assistant", text: "Use add", toolCalls: [{ callId: "call_1", name: "add", input: { a: 1, b: 2 } }], stopReason: "tool_use", providerRaw: { output: providerOutput } },
    { role: "tool", callId: "call_1", name: "add", output: "3" },
  ]);
  expect(input[0]).toMatchObject({ type: "message", role: "user" });
  expect(input[1]).toBe(providerOutput[0]);
  expect(input[2]).toBe(providerOutput[1]);
  expect(input[3]).toMatchObject({ type: "function_call_output", call_id: "call_1", output: "3" });

  const assembled = collectOpenAIEvents(asOpenAIEvents([
    { type: "response.output_text.delta", delta: "hi", output_index: 0, content_index: 0, item_id: "msg_2", sequence_number: 1, logprobs: [] },
    { type: "response.output_item.added", output_index: 1, item: { type: "function_call", id: "fc_2", call_id: "call_2", name: "add", arguments: "", status: "in_progress" }, sequence_number: 2 },
    { type: "response.function_call_arguments.delta", item_id: "fc_2", output_index: 1, delta: "{\"a\":4", sequence_number: 3 },
    { type: "response.function_call_arguments.delta", item_id: "fc_2", output_index: 1, delta: ",\"b\":5}", sequence_number: 4 },
    { type: "response.function_call_arguments.done", item_id: "fc_2", output_index: 1, name: "add", arguments: "{\"a\":4,\"b\":5}", sequence_number: 5 },
    { type: "response.completed", sequence_number: 6, response: responseFixture("hi", providerOutput) },
  ]));

  expect(assembled.events.map((event) => event.type)).toEqual([
    "text-delta",
    "tool-call-start",
    "tool-input-delta",
    "tool-input-delta",
    "tool-call-end",
    "usage",
    "turn-end",
  ]);
  expect(assembled.message).toMatchObject({ text: "hi", stopReason: "tool_use", toolCalls: [{ callId: "call_2", name: "add", input: { a: 4, b: 5 } }] });
  expect(assembled.message.providerRaw).toEqual({ output: providerOutput });
});

test("adapter streams never throw on provider errors", async () => {
  const req = requestFixture();
  const anthropicEvents = await collect(anthropicStreamFromClient({ messages: { create: async () => throwingEvents<RawMessageStreamEvent>() } })(req));
  expect(anthropicEvents.at(-1)).toMatchObject({ type: "turn-end", message: { stopReason: "error", errorMessage: "boom" } });

  const openAIEvents = await collect(openaiStreamFromClient({ responses: { stream: () => throwingEvents<ResponseStreamEvent>(), create: async () => throwingEvents<ResponseStreamEvent>() } })(req));
  expect(openAIEvents.at(-1)).toMatchObject({ type: "turn-end", message: { stopReason: "error", errorMessage: "boom" } });
});

test.skipIf(process.env.GARNISH_PROTO_LIVE !== "1" || !process.env.ANTHROPIC_API_KEY)("live Anthropic one tool round-trip", async () => {
  const stream = anthropicStream({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });
  const first = await collect(stream(requestFixture("Please call add with a=1 and b=2.")));
  const callEnd = first.find((event): event is Extract<StreamEvent, { type: "tool-call-end" }> => event.type === "tool-call-end");
  expect(callEnd).toBeTruthy();
  const secondReq = requestFixture("Return the tool result in one short sentence.");
  const firstEnd = first.at(-1);
  secondReq.messages = [
    { role: "user", source: "player", text: "Please call add with a=1 and b=2." },
    firstEnd?.type === "turn-end" ? firstEnd.message : { role: "assistant", text: "", toolCalls: [], stopReason: "error" },
    { role: "tool", callId: callEnd?.callId ?? "", name: callEnd?.name ?? "add", output: "3" },
  ];
  const second = await collect(stream(secondReq));
  expect(second.at(-1)).toMatchObject({ type: "turn-end", message: { stopReason: "end_turn" } });
});

test.skipIf(process.env.GARNISH_PROTO_LIVE !== "1" || !process.env.OPENAI_API_KEY)("live OpenAI one tool round-trip", async () => {
  const stream = openaiStream({ apiKey: process.env.OPENAI_API_KEY ?? "" });
  const first = await collect(stream(requestFixture("Please call add with a=1 and b=2.")));
  const callEnd = first.find((event): event is Extract<StreamEvent, { type: "tool-call-end" }> => event.type === "tool-call-end");
  expect(callEnd).toBeTruthy();
  const secondReq = requestFixture("Return the tool result in one short sentence.");
  const firstEnd = first.at(-1);
  secondReq.messages = [
    { role: "user", source: "player", text: "Please call add with a=1 and b=2." },
    firstEnd?.type === "turn-end" ? firstEnd.message : { role: "assistant", text: "", toolCalls: [], stopReason: "error" },
    { role: "tool", callId: callEnd?.callId ?? "", name: callEnd?.name ?? "add", output: "3" },
  ];
  const second = await collect(stream(secondReq));
  expect(second.at(-1)).toMatchObject({ type: "turn-end" });
});

function requestFixture(text = "hello"): StreamRequest {
  return {
    sessionId: "session-test",
    system: "You are a terse test assistant. Use tools when asked.",
    messages: [{ role: "user", source: "player", text }],
    tools: [{ name: "add", description: "Add two numbers", params: z.object({ a: z.number(), b: z.number() }) }],
    signal: new AbortController().signal,
  };
}

function responseFixture(outputText: string, output: ResponseInputItem[]): Response {
  return {
    id: "resp_1",
    created_at: 0,
    output_text: outputText,
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: null,
    model: "gpt-5.2",
    object: "response",
    output,
    parallel_tool_calls: true,
    temperature: null,
    tool_choice: "auto",
    tools: [],
    top_p: null,
    status: "completed",
    usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18, input_tokens_details: { cached_tokens: 5 }, output_tokens_details: { reasoning_tokens: 0 } },
  } as Response;
}

async function collect(iterable: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

async function* throwingEvents<T>(): AsyncIterable<T> {
  throw new Error("boom");
}

function asAnthropicEvents(events: unknown[]): RawMessageStreamEvent[] {
  return events as RawMessageStreamEvent[];
}

function asOpenAIEvents(events: unknown[]): ResponseStreamEvent[] {
  return events as ResponseStreamEvent[];
}
