# Integration findings (delegator/integrator pass)

Wiring the seven slices into `proto/wire.ts` + `proto/demo.ts` + `proto/main.ts`
surfaced issues no single slice could see. All demo beats pass end-to-end on
macOS under Seatbelt (`bun run proto:demo` → 12/12 PASS).

## Cross-slice defects found at integration

1. **Unlock-id drift.** Gates catalog said `l0-tools`/`l1-bash`; packs +
   progression said `l0-hands`/`l1-shell`. Unlocks would never have applied.
   Spec lesson: unlock ids are a cross-cutting contract (packs ↔ progression ↔
   gate catalog) and need a single declared source — LOO-173/174 should name
   where ids live (pack data is the natural home; the catalog should consume,
   not declare).
2. **Curriculum chicken-egg.** `first-edit` required the write tool, but
   `l0-hands` (granting write) derived from completing the level containing
   `first-edit`. v1 progression grants unlocks only at LEVEL completion, so the
   arc deadlocked. Fixed by splitting L0 into two levels (look-around →
   `l0-hands`; first-edit → `l1-shell`). Spec lesson for LOO-174/179: with
   level-granularity unlocks, every tool a quest needs must be granted by an
   EARLIER level — authoring tooling should validate this reachability
   statically (loader or `garnish pack lint`).
3. **Tier graduation raced past approval literacy.** With tier =
   completedLevels and the specced arc (tier 1 auto-allows safe, tier 2
   moderate), bash arrived at tier 2 — where safe AND moderate already
   auto-allow. The learner would never see an approval prompt. Fixed in proto
   catalog by lagging graduation one tier. Spec lesson (ADR-18/LOO-164/173):
   the gate catalog must guarantee ask-tier overlap with each tool's arrival —
   graduation must LAG the tool, or approval literacy is never practiced.
4. **Auto-approvals satisfy quest approval checks.** `event(
   tool.approval.resolved approved=true)` matches `mode: "auto"` resolutions.
   A quest meant to teach approval judgment can complete via tier auto-allow.
   LOO-170/174: the check DSL likely needs `mode` matching (or the taxonomy
   needs `approved_by: player|policy`) — decide before reauthoring packs.
5. **Bash input key mismatch.** Approval hook extracted `input.command`; the
   bash tool schema uses `cmd`. Command classification would have run on a JSON
   blob. One-line fix; contract lesson: the tool arg schema is part of the
   approvals contract, pin it in types.
6. **`Bun.file().textSync()` does not exist** — progression resume would have
   crashed on any non-fresh root; slice tests only used fresh roots. tsc
   caught it (below).

## Toolchain findings

- **Bun's transpiler is not a type gate.** All slices ran green under `bun
  test` while `tsc --noEmit` had 60 diagnostics in 9 files, including one real
  runtime bug (textSync). Keep `tsc` as the merge gate for v2 work; slice-level
  `bun test` alone is false confidence.
- **`bun test proto/...` is a name filter, not a path** when `bunfig.toml` sets
  `[test] root = "./tests"` — every agent hit it. Use `bun test ./proto/...`
  or revisit the test root for v2.
- `Omit<HarnessEvent, ...>` collapses the discriminated union — helpers must
  take `HarnessEventPayload`. Worth a note in the v2 event module docs.

## Verified working end-to-end (macOS, Seatbelt on)

- Full L0→L1 arc: 3 quests, 2 live mid-session unlocks, XP 35, level COMPLETE.
- Locked-tool teaching block in-band; denial-with-reason returned to the model
  and visibly adapted to in the next turn.
- Tier policy differentiation in one session: moderate command asks (deny →
  retry → approve), safe command auto-allows.
- Replay determinism: fold-twice identical over the 61-event JSONL.
- Scorecard from the session log alone: prompts 4, approvals 1✔/1✖/1auto,
  blocked 2, tokens 19163/1482.
- TUI (`bun proto/tui/dev.tsx`) renders all surfaces in a PTY; interactive
  latency/flicker still needs a human pass (Act II of PROTOTYPE.md).

## Not exercised

- Live provider smokes (adapters unit-tested keyless; run `proto:live` with a
  key for the Act III pass).
- Linux run (Cursor Cloud VM is the intended venue — sandbox degrades to a
  loud warning by design).
- Resume-from-log UX (replay determinism proven; no `garnish resume` surface).

## Proto-v2 wave addendum (auth + retro theme + onboarding)

- Cross-slice import drift again required an integration catch (`bun test
  ./proto` failing while every slice passed in isolation): **bun's
  `mock.module()` leaks partial mocks process-wide across the full test run**,
  breaking sibling suites with "Export named X not found". Rule for v2 work:
  design pure seams that take dependencies as arguments; never `mock.module`
  shared modules in a multi-suite run.
- The `theme.ts` re-point trick (keeping old TUI_* constant names aliased to
  new tokens) let two agents recolor the whole TUI with zero file collisions —
  worth repeating as a palette-migration pattern.
- omp's OAuth registry ported shape-first cleanly (see
  `proto/findings/auth-omp.md`); the offline "Demo Kitchen" mock provider is
  what makes onboarding demoable in CI/VMs with no accounts — keep that
  pattern for LOO-157/169.
- Verified by frame inspection of the re-recorded mp4: wizard menu with
  omp-parity providers, retro green/purple palette, Sprig mascot, NEXT UP
  hints, mise-en-place quest completing off `auth.login`, celebrations with
  purple accents. 13/13 headless beats pass (4 quests, XP 40).

## Proto-v3 wave addendum (pixel sprites + monogrid + atlas/bosses + saves)

- **Codex imagegen → terminal sprite pipeline works**: `codex exec` (ChatGPT
  auth, image_generation feature) produced 5 pixel-art PNGs; `scripts/
  px2ansi.ts` downsamples (ffmpeg nearest-neighbor) and bakes half-block cell
  data + raw-ANSI rows into `proto/tui/pixel-sprites.ts`. Roundtrip verified
  by rebuilding a PNG from the baked cells. Rule: raw ANSI only in text-mode
  surfaces; OpenTUI renders cellRows via styled chunks (PixelSpriteView).
- **Resume surfaced three cross-session bugs** only visible by frame-checking
  the recorded mp4: (1) the verifier's completed-set was session-scoped —
  resumed saves re-ran finished quests (fixed: seed `initialCompleted` from
  the progression fold in wire); (2) header LVL/XP derived from a scorecard
  hack, not the save (fixed: `progress()` seam from progression state);
  (3) the scripted model replayed its queue from turn 1 after resume,
  desyncing story from saved progress (fixed: script segment selection by
  completed-quest ids). Spec lesson for LOO-159/171: session resume and
  progression resume are different axes and every consumer must say which
  one it derives from.
- Known cosmetic: input placeholder can show a stray typed char next to the
  hint after fast tape input; not worth prototype time.
