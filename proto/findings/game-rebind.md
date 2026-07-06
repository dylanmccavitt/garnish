# Game rebind findings

## Verdict

The v1 main bus does rebind onto the standalone first-party event taxonomy without adding new check kinds. The critical path worked with the existing loader, `event`, `yaml_path`, and `command` checks:

- `tool.result` matched the v1 verifier's event DSL as an arbitrary event name.
- `file.edited` matched as an arbitrary event name and its `path` matcher worked when the bridge copied HarnessEvent payload fields into the v1 verifier payload.
- `tool.approval.resolved` matched `approved: true` with no DSL changes.
- Replay/idempotence is a bridge/progression responsibility, not verifier magic: the verifier bridge keeps a completed quest set and the progression fold ignores duplicate `quest_completed` events.

## DSL rebind result

Name matching is name-agnostic. `src/verifier` compares `event.name` directly with `check.match.event`; it does not hardcode the old OMP names. The shim required is only shape adaptation:

- HarnessEvent has `{ type, sessionId, seq, ...payload }`.
- v1 verifier wants `{ name, sessionId, seq, payload }`.
- The proto bridge maps `name = HarnessEvent.type` and copies all event-specific fields into `payload`.

That means ADR-13 can keep first-party dotted names (`tool.result`, `file.edited`, `tool.approval.resolved`) if the production verifier bridge preserves this mapping. No `tool_result` compatibility alias is required for these proto packs.

## Loader format friction

The loader format is usable but rigid:

- Pack metadata must be `pack.yml`, `pack.yaml`, or `pack.json`.
- Quests must be Markdown files with YAML front matter; the Markdown body becomes `description`.
- Level ids and quest ids must be lowercase slugs, so dotted ids are not available for quest/level naming.
- Quest `unlocks` must reference feature ids declared by the same pack's level unlocks or by `knownFeatureIds`. Cross-pack feature declarations are not available through plain `loadPacks([dir])`.

For the prototype this was fine, but production standalone packs should either keep feature declarations local to the pack or add a top-level catalog pass before strict graph validation.

## Progression API reuse verdict

`src/progression` was reusable for the important part: deterministic event folding and derived unlocks. The prototype uses v1 `foldEvents` and `deriveUnlocks` with JSONL events under `<workspace>/.garnish-proto/progression/events.jsonl`.

The friction is API shape, not semantics:

- v1 progression is pure functions over an in-memory graph and event array.
- The standalone bridge API requested by the slice is synchronous and does not accept a graph.
- Loading proto pack graphs is async, so `createProgression({ root, onUnlock })` cannot directly reuse the loader without changing the contract.

The prototype therefore uses a tiny local static progression graph matching the proto packs. That is the largest incompatibility found. Production should pass the loaded quest graph into progression creation, or make progression creation async, rather than duplicate graph facts.

## Event-taxonomy gaps for LOO-170/171/172/174

The existing check DSL covered the needed proof points, but these taxonomy edges are worth tightening in the spec:

- `file.edited` is necessary as its own first-party event. Relying only on `tool.result` details would make checks too tool-specific and would not cover future editor implementations.
- `tool.result` should continue to expose `tool` and `isError`; v1 maps `success` from `!isError` cleanly.
- `tool.approval.resolved` should keep a top-level `approved` boolean. This avoided any custom assertion/check type.
- Quest and unlock events (`quest.completed`, `unlock.applied`) belong in the replay/session taxonomy if the UI and transcript need deterministic game mirroring.
- For command checks, the v1 verifier only sees command output through its probe, not through `tool.result`. That is fine for deterministic checks, but the spec should be explicit that command verification is a verifier probe against workspace state, not an agent self-report.

## L0/L1 arc authored

The demoable arc is:

1. L0 `look-around`: complete when a `read` tool emits successful `tool.result`.
2. L0 `first-edit`: complete when `{workspace}/quest-state.yml` contains `first_edit: GARNISH_PROTO_FIRST_EDIT` and the harness emits `file.edited` for that path.
3. Completing all required L0 quests unlocks `l0-hands` (`write`, `edit`) and `l1-shell` (`bash`). This resolves the bash chicken-egg by making bash-with-approvals available at the start of L1.
4. L1 `fix-bug-prove-it`: complete when a command check can prove `{workspace}/src/bug.txt` contains `GARNISH_BUG_FIXED` and the event stream includes `tool.approval.resolved` with `approved: true`.

The L1 pack also declares `l1-shell` locally so v1 loader validation accepts the quest unlock reference. Progression idempotence prevents a duplicate grant after L0 has already unlocked it.

## Tutor verdict

The tutor can be derived entirely from verifier state. The provider renders the active quest, current verifier status, and the literal check lines from the loaded pack data, then repeats the standing rule that the tutor never certifies completion. The smoke test keeps the block under 1200 bytes and verifies that the real `yaml_path` and `file.edited` checks appear.

## Smoke proof

`bun test ./proto/game` passes with 2 tests / 18 assertions. The tests cover:

- v1 loader loading both proto packs.
- bad pack ids still being rejected by v1 graph validation.
- hand-fed first-party HarnessEvents driving `look-around` then `first-edit`.
- L0 progression fold granting `l0-hands` and `l1-shell` exactly once.
- duplicate edit replay not double-completing or double-granting.
- tutor block size and real acceptance check rendering.
- L1 command + approval check completing after the bug marker is fixed.

Note: on Bun 1.3.14 in this workspace, `bun test proto/game` is treated as a filter and does not resolve as a path; Bun's own diagnostic says to prefix `./`. The path command `bun test ./proto/game` is the equivalent runnable proof for this slice.
