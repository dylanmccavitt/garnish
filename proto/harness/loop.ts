import type {
  AssistantMessage,
  ChatMessage,
  GarnishTool,
  Harness,
  HarnessConfig,
  StopReason,
  ToolCall,
  ToolContext,
  ToolResult,
  ToolResultMessage,
  UserMessage,
} from "./types";

const contextDelimiter = "--- garnish ephemeral tutor context ---";

export function createHarness(config: HarnessConfig): Harness {
  const history: ChatMessage[] = [];
  let currentTurn: AbortController | null = null;
  let turn = 0;

  const emitUser = (message: UserMessage) => {
    config.sink.emit({ type: "message.user", source: message.source, text: message.text });
    history.push(message);
  };

  const drainUserMessages = (messages: UserMessage[] | undefined) => {
    for (const message of messages ?? []) emitUser(message);
    return (messages ?? []).length > 0;
  };

  async function send(text: string): Promise<void> {
    emitUser({ role: "user", source: "player", text });

    let keepGoing = true;
    while (keepGoing) {
      turn += 1;
      const controller = new AbortController();
      currentTurn = controller;
      config.sink.emit({ type: "turn.start", turn });

      const requestMessages = history.slice();
      const contextText = collectContext(config);
      if (contextText) {
        requestMessages.push({ role: "user", source: "tutor", text: contextText });
      }

      const visibleTools = config.hooks.toolFilter?.(config.tools) ?? config.tools;
      const turnResult = await runTurn(config, turn, requestMessages, visibleTools, controller);

      config.sink.emit({ type: "turn.end", turn, stopReason: turnResult.stopReason });
      if (currentTurn === controller) currentTurn = null;

      if (config.hooks.shouldStopAfterTurn?.(turn, turnResult.stopReason)) break;

      const hadFollowUps = drainUserMessages(config.hooks.getFollowUpMessages?.());
      keepGoing = turnResult.stopReason === "tool_use" || hadFollowUps;
    }
  }

  return {
    config,
    send,
    abort() {
      currentTurn?.abort();
    },
  };

  function collectContext(config: HarnessConfig): string | null {
    const blocks = (config.hooks.contextProviders ?? [])
      .map((provider) => provider())
      .filter((block): block is string => Boolean(block));
    if (blocks.length === 0) return null;
    return `${contextDelimiter}\n${blocks.join("\n\n---\n\n")}\n${contextDelimiter}`;
  }

  async function runTurn(
    config: HarnessConfig,
    turnNumber: number,
    requestMessages: ChatMessage[],
    visibleTools: GarnishTool[],
    controller: AbortController,
  ): Promise<{ stopReason: StopReason }> {
    let text = "";
    let thinking = "";
    let usage: AssistantMessage["usage"];
    let assistant: AssistantMessage | null = null;
    const streamedCalls = new Map<string, ToolCall>();
    const toolNamesByCall = new Map<string, string>();
    const answeredCalls = new Set<string>();

    try {
      for await (const event of config.streamFn({
        sessionId: config.sessionId,
        system: config.system,
        messages: requestMessages,
        tools: visibleTools,
        signal: controller.signal,
        model: config.model,
      })) {
        if (event.type === "text-delta") {
          text += event.text;
          config.sink.emit({ type: "assistant.delta", text: event.text });
        } else if (event.type === "thinking-delta") {
          thinking += event.text;
          config.sink.emit({ type: "assistant.thinking.delta", text: event.text });
        } else if (event.type === "usage") {
          usage = event.usage;
        } else if (event.type === "tool-call-start") {
          toolNamesByCall.set(event.callId, event.name);
        } else if (event.type === "tool-call-end") {
          const call = { callId: event.callId, name: event.name, input: event.input };
          toolNamesByCall.set(event.callId, event.name);
          streamedCalls.set(event.callId, call);
        } else if (event.type === "turn-end") {
          const message = withStreamedFallbacks(event.message, text, thinking, usage, streamedCalls);
          assistant = controller.signal.aborted ? { ...message, stopReason: "aborted" } : message;
          config.sink.emit({ type: "assistant.end", message: assistant, usage: assistant.usage });
        }
      }
    } catch (error) {
      assistant = {
        role: "assistant",
        text,
        thinking: thinking || undefined,
        toolCalls: Array.from(streamedCalls.values()),
        stopReason: controller.signal.aborted ? "aborted" : "error",
        errorMessage: controller.signal.aborted ? undefined : errorMessage(error),
        usage,
      };
      config.sink.emit({ type: "assistant.end", message: assistant, usage });
    }

    if (!assistant) {
      assistant = {
        role: "assistant",
        text,
        thinking: thinking || undefined,
        toolCalls: Array.from(streamedCalls.values()),
        stopReason: controller.signal.aborted ? "aborted" : "error",
        errorMessage: controller.signal.aborted ? undefined : "stream ended without turn-end",
        usage,
      };
      config.sink.emit({ type: "assistant.end", message: assistant, usage });
    }

    if (controller.signal.aborted && assistant.stopReason !== "aborted") {
      assistant = { ...assistant, stopReason: "aborted" };
    }

    history.push(assistant);

    const calls = assistant.toolCalls.length > 0 ? assistant.toolCalls : Array.from(streamedCalls.values());
    for (const call of calls) {
      if (answeredCalls.has(call.callId)) continue;
      const result = controller.signal.aborted
        ? emitSyntheticAbort(config, call)
        : await answerToolCall(config, turnNumber, call, visibleTools, controller);
      answeredCalls.add(call.callId);
      history.push(toToolMessage(call, result));
      drainUserMessages(config.hooks.getSteeringMessages?.());
    }

    for (const [callId, name] of toolNamesByCall) {
      if (!answeredCalls.has(callId) && controller.signal.aborted) {
        const call = streamedCalls.get(callId) ?? { callId, name, input: {} };
        const result = abortedResult();
        emitToolResult(config, call, result);
        history.push(toToolMessage(call, result));
      }
    }

    return { stopReason: assistant.stopReason };
  }

  async function answerToolCall(
    config: HarnessConfig,
    turnNumber: number,
    call: ToolCall,
    visibleTools: GarnishTool[],
    controller: AbortController,
  ): Promise<ToolResult> {
    const tool = visibleTools.find((candidate) => candidate.name === call.name);
    config.sink.emit({ type: "tool.call", callId: call.callId, tool: call.name, input: call.input });

    const ctx: ToolContext = {
      sessionId: config.sessionId,
      messageId: `turn-${turnNumber}`,
      callId: call.callId,
      signal: controller.signal,
      workspace: config.workspace,
      sessionTemp: config.sessionTemp,
    };

    let result = await config.hooks.beforeToolCall?.(call, ctx);
    if (!result) {
      if (!tool) {
        result = { output: `Tool not available: ${call.name}`, isError: true };
      } else {
        result = await runToolWithAbort(tool, call.input, ctx, controller.signal);
      }
    }

    emitToolResult(config, call, result);
    await config.hooks.afterToolCall?.(call, result, ctx);
    return result;
  }

  async function runToolWithAbort(
    tool: GarnishTool,
    input: unknown,
    ctx: ToolContext,
    signal: AbortSignal,
  ): Promise<ToolResult> {
    if (signal.aborted) return abortedResult();
    return Promise.race([
      tool.execute(input, ctx),
      new Promise<ToolResult>((resolve) => {
        signal.addEventListener("abort", () => resolve(abortedResult()), { once: true });
      }),
    ]);
  }

  function withStreamedFallbacks(
    message: AssistantMessage,
    text: string,
    thinking: string,
    usage: AssistantMessage["usage"],
    calls: Map<string, ToolCall>,
  ): AssistantMessage {
    return {
      ...message,
      text: message.text || text,
      thinking: message.thinking ?? (thinking || undefined),
      toolCalls: message.toolCalls.length > 0 ? message.toolCalls : Array.from(calls.values()),
      usage: message.usage ?? usage,
    };
  }

  function abortedResult(): ToolResult {
    return { output: "Tool call aborted", isError: true };
  }

  function emitSyntheticAbort(config: HarnessConfig, call: ToolCall): ToolResult {
    const result = abortedResult();
    emitToolResult(config, call, result);
    return result;
  }

  function toToolMessage(call: ToolCall, result: ToolResult): ToolResultMessage {
    return { role: "tool", callId: call.callId, name: call.name, output: result.output, isError: result.isError };
  }

  function emitToolResult(config: HarnessConfig, call: ToolCall, result: ToolResult) {
    liftFileEdited(config, result);
    config.sink.emit({
      type: "tool.result",
      callId: call.callId,
      tool: call.name,
      output: result.output,
      isError: result.isError ?? false,
      details: result.details,
    });
  }

  function liftFileEdited(config: HarnessConfig, result: ToolResult) {
    const fileEdited = (result.details as { fileEdited?: { path: string; kind: "write" | "edit"; summary: string } } | undefined)
      ?.fileEdited;
    if (fileEdited) config.sink.emit({ type: "file.edited", ...fileEdited });
  }

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
