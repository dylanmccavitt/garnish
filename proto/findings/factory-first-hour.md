# Factory first-hour findings (proto #4)

Question under test (decision ledger Q9): **does automating yourself out of the
loop feel like Factorio — or like configuring CI?**

Verdict: **crown, with one condition.** It feels like Factorio exactly when
machine-building happens *inside* the play loop as a response to felt pain —
and drifts toward CI-config the moment authoring becomes a cold command. The
best moment in the slice is answering item-4's edit approval with
`[p]attern`: one keystroke both resolves the prompt AND permanently wires the
policy circuit (persisted to `.garnish/policies/circuit.txt`). That is
building-while-running. By contrast the `/wire read *` commands typed between
items read as configuration. Spec rule for v3: **every machine must be
buildable as an in-flow response to a touch you just suffered** — menus and
cold commands are fallbacks, not the path.

## The descent is the game

`TOUCHES/ITEM 4 → 3 → 4 → 1 → 0 → 0 → 0` (headless beats assert it; the TUI
strip renders it live). The **bump at item-3 is the best beat in the slice**:
researching the bare agent makes touches go back UP (prompt + clarify +
everything-ask approvals = 4 again). Automation isn't free until you author
skills and policies — the first burner miner being clunky is precisely the
Factorio curve. Keep the bump in PRD v3; do not tune it away.

Sub-answers to the ledger's secondary questions:

- **Staged UI reads as progress**: yes. Headers literally announce it
  (`STAGE 1 · queue strip online`, `STAGE 2 · mini-map online`); the hour-0
  screen (bare transcript + input, nothing else) is unrecognizable next to the
  hour-1 screen (strip + FACTORY FLOOR pane with machines lit and artifact
  paths). LOO-175's bar is meetable.
- **Brownout teaches, doesn't annoy**: pull-time placement (between items)
  plus a red banner (`⚡ BROWNOUT — grid over budget (6120/800 tokens) — /feed
  the grid to resume`) reads as a survival event, one `/feed` resumes the
  shift, and per-item zero-touch accounting stays intact (power touches carry
  `itemId: null`). Mid-item brownout deferred — riskier, probably the "annoy"
  variant.
- **Hand-crafting is fun-tedious in the right dose**: the cat/grep/fix ritual
  is charming for item-1 and already grating by item-2 — which is exactly the
  pressure that makes researching the miner feel earned. 4 hand touches is
  the right size; do not add more ceremony.

## What worked (keep)

- **Substrate reuse was total.** Zero rebuilds: loop + 7 seams, event
  sink/JSONL/replay, tools/sandbox, rules engine, gate engine, scripted model
  all carried. The factory is ~15 new files under `proto/factory/` + one TUI
  variant.
- **`sameItem:` went into the v1 engine cleanly** (31 added lines, exact
  `sameSession` mirror, no surprises — `proto/findings/factory-sameitem.md`).
  The closed-DSL-plus-taxonomy-growth bet holds: zero-touch is provable
  in-engine as `event(touch.recorded count=0) sameItem: true` and
  discriminates item-7 (pass) from item-1 (fail).
- **Machines as authored on-disk artifacts** (`.garnish/skills/greeter-fix.md`,
  `.garnish/policies/circuit.txt`, `.garnish/machines/*.md`) with the map pane
  showing the artifact paths — "the factory is your harness config" is
  legible on screen.
- **Belt power semantics** (discovered via the interactive tape failing):
  unpowered belt does ONE pull per build/kick; item-to-item chaining requires
  an active shift. Without this, `/power` was meaningless because the belt
  drained the queue pre-shift. Graduate this rule to ARD v3's power model.
- **Ore generator interface generalizes**: second variant cost ~30 lines;
  items alternate variants with distinct scaffolds/checks/hand-fixes.

## What didn't (spec lessons, all hit during integration)

1. **UI state must derive from engine state, not event folds.** The TUI kept a
   200-event ring buffer; streaming deltas evicted `item.enqueued`/
   `machine.built` and the stage REGRESSED to bare chat mid-game. Fix:
   `stageFromState(factoryState())` + HUD refresh from authoritative state;
   events feed only transcript/moments. This sharpens the earlier "don't build
   a second UI event model" finding with a concrete failure mode.
2. **Scripted turns need explicit `stopReason: "end_turn"` per work item.**
   Defaulted `tool_use` chained one send through the entire remaining script;
   in the TUI the open approval modal then swallowed `/forge greeter-fix` as a
   deny-reason ("ge greeter-fix"). Turn-boundary discipline is part of the
   episode contract.
3. **The loop must be the only `message.user` emitter.** A pre-emitted belt
   brief (for log ordering) duplicated every brief; removed. `send(text,
   source)` (one-line additive loop change) is the right seam for machine
   speech; the `"PASTE: "` prefix classification is a wart to replace with a
   first-class hand-action event in v3.
4. **mp4 frame inspection remains the highest-value verification loop** — 4th
   proto running. Tests + 16 headless beats were green while frames caught:
   stage regression, modal keystroke leakage, queue-strip line wrap
   (`✓×N` collapse fix), and a red-on-red brownout meter (flash bg == fg,
   literally invisible).

## Warts accepted (proto-grade, note for v3)

- Interactive `/mine` starts items in `hand` mode even when the agent works
  them (no `/pull`-as-agent command); mode attribution is cosmetic here.
- Power meter state word can clip in the map pane (banner carries the state).
- Factory events have no glyph/moment juice (base `glyphLegend` predates
  them); `research.completed` deserves a celebration and currently gets none —
  the research cascade at 3 shipped is nearly invisible.
- Skill recipe reaches the model inline in the belt brief (observable in
  `message.user`), not via `contextProviders` — fine for proof, revisit for
  token hygiene.

## Evidence

- Gates: `tsc --noEmit` clean · 88 tests / 0 fail (`bun test ./proto`) ·
  13/13 legacy beats (`bun run proto:demo`) · 16/16 factory beats
  (`bun run proto:factory:demo`, deterministic across runs).
- Brownout: exactly one, `seq` between item-5 `item.shipped` and item-6
  `item.started`, followed by a `touch.recorded kind=power itemId=null`.
- mp4 proofs (gitignored): `demo/garnish-demo-factory.mp4` (headless beat
  table) and `demo/garnish-demo-factory-tui.mp4` (interactive: stage 0 → 1 →
  2, clean approvals, pattern wiring, shift, brownout banner, fed meter
  `⚡ 33867/50800`, final `TOUCHES/ITEM 4 3 4 1 0 0 0`).

## Fold-back

Per the ledger's next actions: retro → synthesize PRD v3 + ARD v3 (this file +
`factory-sameitem.md` are the decision-encoding notes), then re-stamp M2–M4
issues against factory nouns. The taxonomy additions (`item.*`,
`touch.recorded`, `machine.built`, `research.completed`, `shift.*`,
`power.brownout`), `sameItem:`, `send(text, source)`, and the belt power rule
graduate; the prefix protocols and mode-attribution warts do not.

## Proto #5 addendum (founder-feedback wave: sprites, hints, floor, world menu)

Founder verdict on #4: descent + bare start good; sprites bad; needs guidance;
wants to SEE the factory working; startup should feel like a video-game menu
with per-project worlds. This wave answered all four on the same slice:

- **Machine sprites via Codex imagegen graduate.** `codex exec --enable
  image_generation -s workspace-write` produced six machine PNGs
  (miner/belt/assembler/circuit/ore/bolt) baked through `px2ansi` — all six
  read as their machines at terminal scale (frame-verified). Pipeline note:
  quality-gate thresholds must scale with sprite size (a 10px sprite maxes at
  5 half-block rows).
- **`nextActionHint(state)` is the tutorializer.** Eight prioritized rules
  derived purely from `FactoryState`, rendered as a dim `HINT …` row above the
  input at every stage, plus one SPRIG boot tip. The bare start now teaches
  itself: frame-verified `HINT /mine — item-1 waits in the queue` at hour zero.
  This is the gamified-learning seam — hints are state-derived, never scripted
  to the episode.
- **The mini-map became a live FACTORY FLOOR**: connected vertical chain (ore →
  burner agent → routing belt lane → assembler → circuit → ship) with
  built/dim states, per-node detail (current item id, rule count, ship
  totals), an animated belt dot while an agent item is in flight (unit-tested;
  too brief to freeze-frame with the scripted model), and the power meter at
  the base. "Watch your factory work" reads on screen.
- **World menu lands the save-slot feel.** Text-mode startup: Sprig banner,
  numbered world slots with per-world factory summaries (`7 shipped · red ×7 ·
  4 machines · 2m ago` from `<world>/world.json`), `n) new world`, `q) quit`.
  Each world is its own `wireFactory` root — machines/skills/policies persist
  per world across launches. `--world <name>` bypasses for tapes/CI.
- **Boot-race lesson (2nd instance of the class):** any event emitted between
  `startTui()` returning and the async renderer mounting is invisible to the
  UI (the SPRIG tip vanished). Deferred emit is the proto patch; the v3 seam
  should be an async `startTui`/onReady. Same root cause as #4's stage
  regression: the UI must not depend on catching live events it might miss.

**Open question for the ledger (founder raised, unresolved):** how factories
span real projects. The menu-as-project-directory FEEL is validated (world =
workspace = mini-factory with its own machines/skills), but binding worlds to
real repos contradicts ledger Q2's "real repos never enter gameplay;
graduation = exporting the factory". Candidate resolution for PRD v3: worlds
stay in-game; the EXPORT flow targets a chosen real repo per world, so "your
proj directory" is the export surface, not the play surface. Needs a founder
grilling pass before v3 is stamped.

Wave evidence: `tsc` clean · 94 tests / 0 fail · 13/13 + 16/16 beats ·
re-recorded mp4s frame-verified (menu slots + Sprig banner, SPRIG boot tip,
/mine hint, six machine sprites on the floor, brownout banner + meter).
