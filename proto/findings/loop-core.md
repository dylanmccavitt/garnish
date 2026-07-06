# Loop core findings

## Verdict

ADR-10 is sufficient for the prototype loop. The single orchestrator can cover the game-facing mechanics without adding another seam: tutor context, capability filtering, approval/block teaching, verifier decoration, steering, follow-ups, and aborts all fit the declared hook set.

## What worked

- The 1:1 hook map is enough for game mechanics:
  - `contextProviders` can inject tutor state per turn without polluting replay history.
  - `toolFilter` cleanly models unlocked tool visibility before the provider request is built.
  - `beforeToolCall` is the right place for approvals/gates because returning a `ToolResult` teaches the model in-band and keeps replay history complete.
  - `afterToolCall` is enough for verifier/progression side effects that should observe the real or short-circuited result.
  - `shouldStopAfterTurn`, `getSteeringMessages`, and `getFollowUpMessages` are enough to keep the loop idle/active without a max-steps knob.
- Sequential tool dispatch made abort and replay semantics tractable. There is only one unanswered call at a time in normal execution, and every assistant tool call can be followed by exactly one tool result in history.
- Treating provider throws as an assistant `stopReason: "error"` worked, even though the `StreamFn` contract says adapters should never throw. The loop-level guard is worth keeping as a last-resort adapter boundary.
- Synthesized aborted tool results are important. Without them, an aborted assistant message with tool calls would not replay cleanly into providers that require matching tool result messages.

## What did not work / surprises

- The event taxonomy in `types.ts` has no `tool.execute` event even though ADR-10 wording says "tool.execute with per-turn AbortSignal." I interpreted that as invoking the tool's `execute` method, not emitting a harness event. If the TUI needs a visible "tool is now running" state, ADR-13/types should add that event explicitly; otherwise `tool.call` followed by `tool.result` is enough.
- Abort is cleanest while streaming or before dispatch. If a real tool ignores `AbortSignal`, the prototype races execution against the abort signal and records an aborted result immediately; the underlying promise may still settle later. That is acceptable for a throwaway harness, but production tools should be required to honor the signal and stop side effects.
- Steering drain timing is subtle. Draining after each tool result means steering lands between sequential tool calls, as requested, but it also means steering becomes part of the next provider request rather than changing already-planned tool calls in the same assistant turn. That matches provider protocol reality and should be stated in ADR-10.
- Follow-up messages after `turn.end` are a good replacement for a max-steps knob, but they can create accidental infinite loops if a hook keeps returning messages. ADR-10 deliberately removes a max-step knob; LOO-160 should make hook authors responsible for one-shot/drained queue semantics.
- Bun 1.3.14 did not treat `bun test proto/harness/loop.smoke.test.ts` as a path filter in this repo; it required `bun test ./proto/harness/loop.smoke.test.ts`. The test file itself is green with the explicit relative path.

## Steering-drain timing recommendation

Keep this order:

1. stream assistant turn to `assistant.end`;
2. append assistant message to history;
3. for each tool call sequentially:
   - emit `tool.call`;
   - run `beforeToolCall` / execute / `afterToolCall`;
   - append exactly one tool result to history;
   - drain steering messages into history/events;
4. emit `turn.end`;
5. drain follow-up messages;
6. continue if `tool_use` or follow-ups exist, unless `shouldStopAfterTurn` stops.

This preserves replay-clean history and makes steering/follow-up visibly user-authored rather than hidden loop state.

## LOO-160 re-scope notes

- Specify whether a running-tool event is required. If yes, add `tool.execute` to `HarnessEventPayload`; do not rely on consumers inferring running state from `tool.call`.
- Specify that steering queues are consumed after tool results and affect subsequent requests, not in-flight tool selection.
- Specify that queue hooks must drain their own messages; no loop-level max-step guard exists by design.
- Specify adapter conformance: providers should encode failures as final assistant messages, but the harness still guards thrown errors as `stopReason: "error"` for safety.
- Specify abort expectations for real tools: honoring `AbortSignal` should be part of the tool contract if side effects matter.
