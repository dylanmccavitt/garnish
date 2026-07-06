# Atlas Bosses

## What changed

- Added a proto-local atlas graph with three playable levels and two teaser levels.
- Added the full-screen `ATLAS` overlay so the player can see the current objective, locked quests, upcoming unlocks, and boss silhouettes from inside the TUI.
- Reused the same hint source for the header objective, quest log, and atlas rows so guidance does not drift.
- Reframed `fix-bug-prove-it` as `The Goodbye Greeter` in player-facing copy while preserving its quest id/checks.

## Does the atlas make “what to do next” obvious?

Yes for the proto path. A fresh run now has three redundant cues:

1. The header objective strip says `OBJECTIVE ▸ Mise en place — What's my quest?`.
2. The quest log keeps the active quest/checks visible and adds `UP NEXT write · edit from Tutorial Island` under Verbs.
3. Pressing Tab opens the atlas, where Tutorial Island is active, its first quest is marked `▸`, later levels are locked, and reward chips show `unlocks: write · edit`.

That is enough for v3: the player can see the current quest, the next unlock, the locked path, and future teaser systems without reading pack YAML or inferring progression from tool errors.

## Boss framing verdict

Good enough for the standalone prototype. Only `fix-bug-prove-it` is marked as a real boss, the atlas gives it a named boss card (`BOSS · The Goodbye Greeter`) with the generated boss sprite, and the app objective switches from `OBJECTIVE` to `BOSS FIGHT` when it is active. Teaser bosses stay as dim `???` silhouettes, which preserves anticipation without inventing unsupported content.

The clean monogrid direction is preserved: no skull glyphs, no raw ANSI in OpenTUI text, and boss labeling is text-plus-pixel-sprite rather than noisy emoji/ASCII.

## Pack schema needed for LOO-174/179

Atlas data is still hardcoded because the current pack metadata does not carry enough game-facing presentation data. To stop hardcoding, packs need:

- Level display titles independent from proto/internal names.
- Per-level reward presentation that resolves unlock ids to player-facing tool chips (`l0-hands` → `write`, `edit`; `l1-shell` → `bash`).
- Quest presentation fields: short objective hint, boss boolean, optional boss title, and optional sprite key.
- Teaser/future level declarations that can expose unknown quest silhouettes and future rewards without requiring runnable checks yet.
- Ordering and dependency metadata explicit enough for UI to distinguish active, done, locked, and teaser states without deriving from current active quest id alone.

Until those fields exist, the atlas hardcodes the L0/L1 graph facts locally by design.

## Proof

- `bun test ./proto/tui` → 12 passing tests across 3 files.
- `bunx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "proto/tui/atlas|proto/tui/app|proto/tui/questlog|proto/game/atlas"` → no matching type errors.
