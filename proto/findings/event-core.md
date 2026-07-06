# Event Core Findings

## Constraint line

PROTOTYPE — THROWAWAY. This slice is boxed in by the frozen `proto/harness/types.ts` contract and by ADR-13's requirement that the same typed event feed drive both durable replay and live UI/verifier subscribers.

## What worked

- A single `HarnessEvent` discriminated union is enough for the event spine. `createEventSink()` can fill `id`, `parentId`, `sessionId`, `seq`, and `ts` without every caller learning envelope mechanics.
- Sync in-process fan-out is the right prototype default. It keeps TUI/verifier ordering identical to the JSONL order, and subscriber failures can be isolated with a small `try/catch` around each subscriber.
- Append-only JSONL is a good session substrate for this prototype: easy to inspect, easy to replay, and deterministic when folded by `replaySession(events)`.
- Initializing a sink from existing log contents is worth doing even in the prototype: `seq` and the default parent continue from the last persisted event when a session resumes into the same log path.
- Treating TUI and verifier as peer subscribers is mechanically simple. There is no special channel in the bus API, which helped keep the event core boring.

## What did not work / sharp edges

- `id + parentId` is useful, but only barely in this slice. It earns its place for grouping deltas and child tool/file events under the last durable event, and for post-hoc trace visualization. It does not yet prove that the loop needs a true tree instead of a simple ordered stream plus `turn` metadata. ADR-13/LOO-159 should require one concrete consumer of the tree view before making `parentId` permanent.
- Delta coalescing on write is the right call. Persisting every token delta would make JSONL replay noisy and non-deterministic-looking without improving resume, while the live bus still gives the TUI every delta it needs. The durable fact is `assistant.end`; deltas are presentation.
- The default parent rule, `explicit parentId ?? last non-delta event id ?? null`, is simple and works for linear sessions, but parallel tool calls may want explicit parent IDs from the loop. ADR-13 should say callers must pass `parentId` when emitting events for a specific tool call or approval branch.
- `SessionLog.read()` parses every line every time. That is fine for the prototype and for deterministic replay, but real sessions will eventually want streaming read or checkpoints. Do not add SQLite yet; JSONL answered this slice's question.
- Scorecard diff bytes need a convention because `file.edited.summary` is plain text. This slice uses `+N/-M bytes` and sums `N + M` as churn bytes, not net bytes. ADR-21 should either bless that convention or move byte counts into structured `details` on the event.

## Spec changes recommended

- ADR-13 should explicitly define delta durability: `assistant.delta` and `assistant.thinking.delta` are bus-only; `assistant.end` is the replay source of truth.
- ADR-13 should specify resume sequence behavior: opening a sink on an existing session log continues from the last persisted `seq` and parent, rather than starting at `1`.
- LOO-159 should include a trace-tree demo or remove the hard requirement for `parentId`. Right now the tree is promising but under-proven.
- ADR-21 should define `diffBytes` as churn bytes and stop relying on parsing prose if scorecards become product-visible.

## Proof

- `bun test ./proto/harness` passes: 4 tests, 14 assertions.
- Note: on this Bun version, `bun test proto/harness` is treated as a filter and does not run path tests unless prefixed with `./`; the equivalent path command above is the verified one.
