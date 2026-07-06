# Providers slice findings

## Verdict

ADR-11 is directionally right: using Anthropic Messages streaming and OpenAI Responses streaming keeps provider specifics at the adapter edge and maps cleanly onto Garnish `StreamEvent`. ADR-12 also held up: env-first auth plus a strict `0600` JSON file is enough for the prototype and easy to test without logging keys.

## What worked

- `z.toJSONSchema()` from zod v4 was enough to define tool schemas once and serialize per provider.
  - Anthropic accepts the same object shape as `input_schema` once it is known to be an object schema.
  - OpenAI Responses accepts the same schema as `FunctionTool.parameters`; I set `strict: false` in the prototype because zod's full JSON Schema output can exceed OpenAI strict-schema subset expectations.
- Anthropic streaming maps naturally:
  - `content_block_delta` `text_delta` -> `text-delta`
  - `thinking_delta` -> `thinking-delta`
  - `tool_use` block start + `input_json_delta` + block stop -> tool-call start/input/end
  - `message_delta.usage` -> `usage`
- OpenAI Responses streaming also maps, but with more bookkeeping:
  - `response.output_text.delta` -> `text-delta`
  - `response.output_item.added` starts function calls
  - `response.function_call_arguments.delta/done` streams and finalizes arguments
  - `response.completed` carries final usage and output items for replay
- `store:false` manual replay is viable for this prototype if `AssistantMessage.providerRaw` carries the raw OpenAI `response.output` array. Replaying those output items is more robust than reconstructing assistant text + function calls from Garnish fields alone.
- Anthropic prompt caching API surface matched ADR-11: the system prompt can be sent as a text block with `{ cache_control: { type: "ephemeral" } }`. The pinned SDK also exposes a top-level cache control, but the explicit system block breakpoint is clearer for the prototype.
- OpenAI `prompt_cache_key` exists in the pinned SDK's `ResponseCreateParamsBase`, so using `sessionId` as the cache key is straightforward.

## What did not work / surprises

- The "~200 LOC per adapter" claim is only half honest:
  - `anthropic.ts`: 186 LOC, close to the target.
  - `openai.ts`: 270 LOC, mostly because Responses item replay and function-call assembly need more indexing and fallback logic.
  - If tests and auth are included, the slice is much larger than the ADR implies.
- OpenAI `store:false` means `providerRaw` is not optional if we care about high-fidelity replay. Garnish's normalized `AssistantMessage` can preserve text and tool calls, but it loses OpenAI item IDs, output item shape, assistant phase fields, and any future reasoning/encrypted reasoning items. For replay, `providerRaw` should intentionally carry at least `{ output: response.output }`.
- OpenAI has both `client.responses.stream(...)` and `client.responses.create({ stream: true, ... })`. The pinned SDK's stream helper is iterable and accumulates snapshots; this prototype uses `responses.stream` first because it exposes the intended helper surface while still accepting `store:false` params.
- OpenAI refusal/error events do not map to a dedicated Garnish refusal type. I mapped them to final `turn-end` with `stopReason: "error"` and `errorMessage`; that is runnable, but product semantics may want a separate refusal stop reason later.
- Anthropic prior-thinking replay is awkward. The prototype stores thinking in Garnish and includes it in `providerRaw`, but replaying thinking back as a synthetic block requires a placeholder signature. For real replay, either do not replay thinking to Anthropic or persist the provider-native content blocks exactly.
- Bun 1.3.14 treats `bun test proto/providers` as a filter rather than a directory path in this repo. `bun test ./proto/providers` is the working equivalent and passed keyless.

## Model choices verified against pinned SDK types

- Anthropic default: `claude-sonnet-5`.
  - The pinned `@anthropic-ai/sdk@0.110.0` `Model` type includes `claude-sonnet-5`, `claude-sonnet-4-6`, and `claude-sonnet-4-5`.
  - I chose the current Sonnet alias rather than the older ADR example.
- OpenAI default: `gpt-5.2`.
  - The pinned `openai@6.45.0` `ChatModel`/`ResponsesModel` types include `gpt-5.2`; `gpt-5.5` appears in current docs but is not in the installed SDK type list.

## Suggested re-scope for LOO-161 / LOO-162 / LOO-157

- Treat OpenAI `providerRaw.output` persistence as required for any issue that claims durable stateless replay with `store:false`.
- Do not promise provider adapters stay at ~200 LOC once replay, refusal semantics, usage, and tests are included. Anthropic can; OpenAI probably cannot without hiding complexity in shared helpers.
- Keep prompt-cache measurement out of this prototype. The SDK params are present, but proving cache-hit behavior needs live calls and token accounting over repeated sessions.
- Decide whether Garnish wants a distinct refusal stop reason before polishing providers. Mapping refusals to `error` is serviceable for throwaway demos but semantically muddy.
- If Anthropic thinking replay matters, carry provider-native content blocks in `providerRaw`; do not synthesize signed thinking blocks from normalized text.

## Proof run

- `bun test ./proto/providers` passed keyless: 5 pass, 2 live tests skipped, 0 fail.
- Provider-only TypeScript check passed with:
  - `bunx tsc --noEmit --ignoreConfig --skipLibCheck --moduleResolution Bundler --module ESNext --target ES2022 --types bun-types --strict proto/providers/anthropic.ts proto/providers/openai.ts proto/providers/auth.ts proto/providers/index.ts proto/providers/providers.smoke.test.ts proto/harness/types.ts`
