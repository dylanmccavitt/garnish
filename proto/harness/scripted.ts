import type { AssistantMessage, ScriptedTurn, StreamFn, ToolCall, Usage } from "./types";

export function scriptedStream(turns: ScriptedTurn[]): StreamFn {
  let nextTurn = 0;

  return async function* stream(req) {
    const turn = turns[nextTurn++] ?? { text: "(script exhausted)", stopReason: "end_turn" as const };
    const text = turn.text ?? "";
    const thinking = turn.thinking ?? "";
    const toolCalls: ToolCall[] = (turn.toolCalls ?? []).map((call, index) => ({
      callId: `script-${nextTurn}-${index + 1}`,
      name: call.name,
      input: call.input,
    }));

    for (let offset = 0; offset < text.length; offset += 10) {
      if (req.signal.aborted) break;
      yield { type: "text-delta", text: text.slice(offset, offset + 10) };
    }

    for (let offset = 0; offset < thinking.length; offset += 10) {
      if (req.signal.aborted) break;
      yield { type: "thinking-delta", text: thinking.slice(offset, offset + 10) };
    }

    for (const call of toolCalls) {
      if (req.signal.aborted) break;
      yield { type: "tool-call-start", callId: call.callId, name: call.name };
      const serialized = JSON.stringify(call.input);
      for (let offset = 0; offset < serialized.length; offset += 10) {
        if (req.signal.aborted) break;
        yield { type: "tool-input-delta", callId: call.callId, delta: serialized.slice(offset, offset + 10) };
      }
      yield { type: "tool-call-end", callId: call.callId, name: call.name, input: call.input };
    }

    const usage: Usage = {
      inputTokens: JSON.stringify(req.messages).length,
      outputTokens: text.length + thinking.length + JSON.stringify(turn.toolCalls ?? []).length,
    };
    yield { type: "usage", usage };

    const message: AssistantMessage = {
      role: "assistant",
      text,
      thinking: thinking || undefined,
      toolCalls,
      stopReason: req.signal.aborted ? "aborted" : turn.stopReason ?? (toolCalls.length > 0 ? "tool_use" : "end_turn"),
      usage,
    };
    yield { type: "turn-end", message };
  };
}
