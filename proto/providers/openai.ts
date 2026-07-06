import OpenAI from "openai";
import type {
  FunctionTool,
  Response,
  ResponseCreateParamsStreaming,
  ResponseFunctionToolCall,
  ResponseInput,
  ResponseInputItem,
  ResponseOutputItem,
  ResponseStreamEvent,
} from "openai/resources/responses/responses";

import type { AssistantMessage, ChatMessage, StopReason, StreamEvent, StreamFn, StreamRequest, ToolCall, Usage } from "../harness/types";
import { serializeToolParams } from "./index";

export const DEFAULT_OPENAI_MODEL = "gpt-5.2";

interface OpenAIClientLike {
  responses: {
    stream(params: ResponseCreateParamsStreaming, options?: { signal?: AbortSignal }): AsyncIterable<ResponseStreamEvent>;
    create(params: ResponseCreateParamsStreaming, options?: { signal?: AbortSignal }): Promise<AsyncIterable<ResponseStreamEvent>>;
  };
}

interface OpenAIAssembly {
  events: StreamEvent[];
  message: AssistantMessage;
}

interface ToolDraft {
  callId: string;
  itemId?: string;
  name: string;
  json: string;
  started: boolean;
}

export function openAIInputFromHistory(messages: ChatMessage[]): ResponseInput {
  const input: ResponseInput = [];
  for (const message of messages) {
    if (message.role === "user") {
      input.push({ role: "user", content: [{ type: "input_text", text: message.text }], type: "message" });
      continue;
    }
    if (message.role === "tool") {
      input.push({ type: "function_call_output", call_id: message.callId, output: message.output });
      continue;
    }

    const rawOutput = outputItemsFromProviderRaw(message.providerRaw);
    if (rawOutput) {
      input.push(...rawOutput);
      continue;
    }
    if (message.text) input.push({ role: "assistant", content: message.text, type: "message" });
    for (const call of message.toolCalls) {
      input.push({
        type: "function_call",
        call_id: call.callId,
        name: call.name,
        arguments: JSON.stringify(call.input ?? {}),
        status: "completed",
      });
    }
  }
  return input;
}

export function openAIRequestParams(req: StreamRequest, model: string): ResponseCreateParamsStreaming {
  return {
    model,
    instructions: req.system,
    input: openAIInputFromHistory(req.messages),
    prompt_cache_key: req.sessionId,
    store: false,
    stream: true,
    tools: req.tools.map((tool): FunctionTool => {
      const serialized = serializeToolParams(tool);
      return {
        type: "function",
        name: serialized.name,
        description: serialized.description,
        parameters: serialized.schema,
        strict: false,
      };
    }),
  };
}

export function collectOpenAIEvents(providerEvents: Iterable<ResponseStreamEvent>): OpenAIAssembly {
  const events: StreamEvent[] = [];
  const draftsByOutput = new Map<number, ToolDraft>();
  const draftsByItem = new Map<string, ToolDraft>();
  const toolCalls: ToolCall[] = [];
  let text = "";
  let usage: Usage | undefined;
  let stopReason: StopReason = "end_turn";
  let errorMessage: string | undefined;
  let providerRaw: unknown;

  for (const event of providerEvents) {
    if (event.type === "response.output_text.delta") {
      text += event.delta;
      events.push({ type: "text-delta", text: event.delta });
      continue;
    }

    if (event.type === "response.output_item.added" && event.item.type === "function_call") {
      const draft = draftFromFunctionCall(event.item);
      draftsByOutput.set(event.output_index, draft);
      if (draft.itemId) draftsByItem.set(draft.itemId, draft);
      emitToolStart(events, draft);
      if (draft.json) events.push({ type: "tool-input-delta", callId: draft.callId, delta: draft.json });
      continue;
    }

    if (event.type === "response.function_call_arguments.delta") {
      const draft = draftsByOutput.get(event.output_index) ?? draftsByItem.get(event.item_id);
      if (draft) {
        emitToolStart(events, draft);
        draft.json += event.delta;
        events.push({ type: "tool-input-delta", callId: draft.callId, delta: event.delta });
      }
      continue;
    }

    if (event.type === "response.function_call_arguments.done") {
      let draft = draftsByOutput.get(event.output_index) ?? draftsByItem.get(event.item_id);
      if (!draft) {
        draft = { callId: event.item_id, itemId: event.item_id, name: event.name, json: "", started: false };
        draftsByOutput.set(event.output_index, draft);
        draftsByItem.set(event.item_id, draft);
      }
      emitToolStart(events, draft);
      draft.name = event.name;
      draft.json = event.arguments;
      const input = parseJsonObject(event.arguments);
      toolCalls.push({ callId: draft.callId, name: draft.name, input });
      events.push({ type: "tool-call-end", callId: draft.callId, name: draft.name, input });
      continue;
    }

    if (event.type === "response.output_item.done" && event.item.type === "function_call") {
      const draft = draftsByOutput.get(event.output_index) ?? draftFromFunctionCall(event.item);
      draftsByOutput.set(event.output_index, draft);
      if (draft.itemId) draftsByItem.set(draft.itemId, draft);
      if (!toolCalls.some((call) => call.callId === draft.callId)) {
        emitToolStart(events, draft);
        const input = parseJsonObject(draft.json);
        toolCalls.push({ callId: draft.callId, name: draft.name, input });
        events.push({ type: "tool-call-end", callId: draft.callId, name: draft.name, input });
      }
      continue;
    }

    if (event.type === "response.refusal.done") {
      stopReason = "error";
      errorMessage = event.refusal;
      continue;
    }

    if (event.type === "error") {
      stopReason = "error";
      errorMessage = event.message;
      continue;
    }

    if (event.type === "response.failed") {
      stopReason = "error";
      errorMessage = event.response.error?.message ?? event.response.status ?? "response failed";
      providerRaw = { output: event.response.output };
      if (event.response.usage) usage = usageFromResponse(event.response);
      continue;
    }

    if (event.type === "response.completed") {
      providerRaw = { output: event.response.output };
      usage = usageFromResponse(event.response);
      events.push({ type: "usage", usage });
      stopReason = toolCalls.length ? "tool_use" : "end_turn";
    }
  }

  const message: AssistantMessage = {
    role: "assistant",
    text,
    toolCalls,
    stopReason,
    errorMessage,
    usage,
    providerRaw,
  };
  events.push({ type: "turn-end", message });
  return { events, message };
}

export function openaiStream(opts: { apiKey: string; model?: string }): StreamFn {
  const client = new OpenAI({ apiKey: opts.apiKey });
  return openaiStreamFromClient(client, opts.model ?? DEFAULT_OPENAI_MODEL);
}

export function openaiStreamFromClient(client: OpenAIClientLike, model: string = DEFAULT_OPENAI_MODEL): StreamFn {
  return async function* stream(req) {
    try {
      const params = openAIRequestParams(req, req.model ?? model);
      const providerStream = client.responses.stream ? client.responses.stream(params, { signal: req.signal }) : await client.responses.create(params, { signal: req.signal });
      const providerEvents: ResponseStreamEvent[] = [];
      for await (const event of providerStream) {
        if (req.signal.aborted) throw new Error("aborted");
        providerEvents.push(event);
      }
      for (const event of collectOpenAIEvents(providerEvents).events) yield event;
    } catch (error) {
      yield { type: "turn-end", message: errorTurn(req.signal.aborted ? "aborted" : "error", error) };
    }
  };
}

function outputItemsFromProviderRaw(raw: unknown): ResponseInput | null {
  if (!raw || typeof raw !== "object" || !("output" in raw) || !Array.isArray(raw.output)) return null;
  const outputItems = raw.output.filter(isReplayableOutputItem);
  return outputItems.length ? outputItems : null;
}

function isReplayableOutputItem(item: unknown): item is ResponseInputItem {
  return Boolean(item && typeof item === "object" && "type" in item);
}

function draftFromFunctionCall(item: ResponseFunctionToolCall): ToolDraft {
  return {
    callId: item.call_id,
    itemId: item.id,
    name: item.name,
    json: item.arguments,
    started: false,
  };
}

function emitToolStart(events: StreamEvent[], draft: ToolDraft): void {
  if (draft.started) return;
  draft.started = true;
  events.push({ type: "tool-call-start", callId: draft.callId, name: draft.name });
}

function usageFromResponse(response: Response): Usage {
  return {
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
    cacheReadTokens: response.usage?.input_tokens_details.cached_tokens,
  };
}

function parseJsonObject(value: string): unknown {
  if (!value) return {};
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function errorTurn(stopReason: "aborted" | "error", error: unknown): AssistantMessage {
  return {
    role: "assistant",
    text: "",
    toolCalls: [],
    stopReason,
    errorMessage: stopReason === "error" ? error instanceof Error ? error.message : String(error) : undefined,
  };
}
