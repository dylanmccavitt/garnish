import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlockParam,
  MessageCreateParamsStreaming,
  MessageParam,
  RawMessageStreamEvent,
  Tool,
} from "@anthropic-ai/sdk/resources/messages/messages";

import type { AssistantMessage, ChatMessage, StopReason, StreamEvent, StreamFn, StreamRequest, ToolCall, Usage } from "../harness/types";
import { serializeToolParams } from "./index";

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";

interface AnthropicClientLike {
  messages: {
    create(
      params: MessageCreateParamsStreaming,
      options?: { signal?: AbortSignal },
    ): Promise<AsyncIterable<RawMessageStreamEvent>> | AsyncIterable<RawMessageStreamEvent>;
  };
}

interface AnthropicAssembly {
  events: StreamEvent[];
  message: AssistantMessage;
}

interface ToolDraft {
  callId: string;
  name: string;
  json: string;
}

export function anthropicMessagesFromHistory(messages: ChatMessage[]): MessageParam[] {
  return messages.map((message): MessageParam => {
    if (message.role === "user") {
      return { role: "user", content: [{ type: "text", text: message.text }] };
    }
    if (message.role === "tool") {
      return {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: message.callId, content: message.output, is_error: message.isError }],
      };
    }

    const content: ContentBlockParam[] = [];
    if (message.thinking) content.push({ type: "thinking", thinking: message.thinking, signature: "prototype-replay" });
    if (message.text) content.push({ type: "text", text: message.text });
    for (const call of message.toolCalls) {
      content.push({ type: "tool_use", id: call.callId, name: call.name, input: call.input });
    }
    return { role: "assistant", content: content.length ? content : [{ type: "text", text: "" }] };
  });
}

export function anthropicRequestParams(req: StreamRequest, model: string): MessageCreateParamsStreaming {
  return {
    model,
    max_tokens: 1024,
    stream: true,
    system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
    messages: anthropicMessagesFromHistory(req.messages),
    tools: req.tools.map((tool): Tool => {
      const serialized = serializeToolParams(tool);
      return {
        name: serialized.name,
        description: serialized.description,
        input_schema: serialized.schema as Tool.InputSchema,
      };
    }),
  };
}

export function collectAnthropicEvents(providerEvents: Iterable<RawMessageStreamEvent>): AnthropicAssembly {
  const events: StreamEvent[] = [];
  const toolDrafts = new Map<number, ToolDraft>();
  const toolCalls: ToolCall[] = [];
  let text = "";
  let thinking = "";
  let usage: Usage | undefined;
  let stopReason: StopReason = "end_turn";

  for (const event of providerEvents) {
    if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
      const draft = { callId: event.content_block.id, name: event.content_block.name, json: "" };
      toolDrafts.set(event.index, draft);
      events.push({ type: "tool-call-start", callId: draft.callId, name: draft.name });
      continue;
    }

    if (event.type === "content_block_delta") {
      if (event.delta.type === "text_delta") {
        text += event.delta.text;
        events.push({ type: "text-delta", text: event.delta.text });
      } else if (event.delta.type === "thinking_delta") {
        thinking += event.delta.thinking;
        events.push({ type: "thinking-delta", text: event.delta.thinking });
      } else if (event.delta.type === "input_json_delta") {
        const draft = toolDrafts.get(event.index);
        if (draft) {
          draft.json += event.delta.partial_json;
          events.push({ type: "tool-input-delta", callId: draft.callId, delta: event.delta.partial_json });
        }
      }
      continue;
    }

    if (event.type === "content_block_stop") {
      const draft = toolDrafts.get(event.index);
      if (draft) {
        const input = parseJsonObject(draft.json);
        const call = { callId: draft.callId, name: draft.name, input };
        toolCalls.push(call);
        events.push({ type: "tool-call-end", callId: draft.callId, name: draft.name, input });
      }
      continue;
    }

    if (event.type === "message_delta") {
      const nextUsage: Usage = {
        inputTokens: event.usage.input_tokens ?? 0,
        outputTokens: event.usage.output_tokens,
      };
      if (event.usage.cache_read_input_tokens != null) nextUsage.cacheReadTokens = event.usage.cache_read_input_tokens;
      if (event.usage.cache_creation_input_tokens != null) nextUsage.cacheWriteTokens = event.usage.cache_creation_input_tokens;
      usage = nextUsage;
      events.push({ type: "usage", usage: nextUsage });
      if (event.delta.stop_reason === "tool_use") stopReason = "tool_use";
      else if (event.delta.stop_reason === "end_turn") stopReason = "end_turn";
      else if (event.delta.stop_reason) stopReason = "end_turn";
    }
  }

  const message: AssistantMessage = {
    role: "assistant",
    text,
    thinking: thinking || undefined,
    toolCalls,
    stopReason,
    usage,
    providerRaw: { content: { text, thinking: thinking || undefined, toolCalls } },
  };
  events.push({ type: "turn-end", message });
  return { events, message };
}

export function anthropicStream(opts: { apiKey: string; model?: string }): StreamFn {
  const client = new Anthropic({ apiKey: opts.apiKey });
  return anthropicStreamFromClient(client, opts.model ?? DEFAULT_ANTHROPIC_MODEL);
}

export function anthropicStreamFromClient(client: AnthropicClientLike, model: string = DEFAULT_ANTHROPIC_MODEL): StreamFn {
  return async function* stream(req) {
    try {
      const providerStream = await client.messages.create(anthropicRequestParams(req, req.model ?? model), { signal: req.signal });
      const providerEvents: RawMessageStreamEvent[] = [];
      for await (const event of providerStream) {
        if (req.signal.aborted) throw new Error("aborted");
        providerEvents.push(event);
      }
      for (const event of collectAnthropicEvents(providerEvents).events) yield event;
    } catch (error) {
      yield { type: "turn-end", message: errorMessage(req.signal.aborted ? "aborted" : "error", error) };
    }
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

function errorMessage(stopReason: "aborted" | "error", error: unknown): AssistantMessage {
  return {
    role: "assistant",
    text: "",
    toolCalls: [],
    stopReason,
    errorMessage: stopReason === "error" ? error instanceof Error ? error.message : String(error) : undefined,
  };
}
