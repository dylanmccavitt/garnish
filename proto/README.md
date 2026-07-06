# PROTOTYPE — Garnish Standalone harness (THROWAWAY)

> **This directory is a map-seed prototype. It never ships.** Its only output
> is answers: findings fold back into PRD v2 / ARD v2 and the LOO-155..179
> issues, then this code is deleted or absorbed slice by slice.

Spec under test: [PRD v2](https://linear.app/dylanmccavitt/document/prd-v2-garnish-standalone-purpose-built-harness-and-tui-632ac25c9788)
· [ARD v2](https://linear.app/dylanmccavitt/document/ard-v2-garnish-standalone-architecture-decisions-c71d90cbecef)

## Fixed constraints (the terrain)

- Bun + TypeScript, single repo, zod v4, yaml — no new deps beyond the pinned
  provider SDKs and OpenTUI/React.
- The v1 main bus (`src/core`, `src/loader`, `src/verifier`, `src/progression`)
  is reused as-is — the prototype REBINDS it, never edits it.
- macOS Seatbelt is the only specced sandbox; the demo VM (Cursor Cloud) is
  Linux. The sandbox slice must degrade loudly, and that mismatch is itself a
  finding.
- BYO API key; every demo path must also run with a scripted model and no key.

## Questions this run must answer

1. **Loop seams (ADR-10):** do the seven hook seams carry gates, approvals,
   tutor, and verifier without privileged channels or hidden coupling?
2. **Taxonomy (ADR-13):** does the first-party event union satisfy the existing
   closed check DSL with zero new check kinds? Is replay deterministic?
3. **TUI (ADR-17 / LOO-155):** does OpenTUI+React on Bun deliver a streaming
   transcript + modal + celebration juice, on macOS *and* the Linux VM?
4. **Sandbox (ADR-20 / LOO-156):** does `Bun.spawn` + `sandbox-exec` inline
   profile work? What does "Linux deferred" cost when cloud sandboxes are the
   test environment?
5. **Providers (ADR-11):** do Messages API and Responses API (`store:false`,
   item replay) both map cleanly onto one stream-event union?
6. **Gates (ADR-16):** are live mid-session unlocks race-free through
   `toolFilter`, and does hide-then-tease read as a game?
7. **Feel (M3 exit bar):** is the L0 slice "unmistakably a game"?

## Layout

| path | slice |
| -- | -- |
| `harness/types.ts` | shared contract (integrator-owned; do not edit) |
| `harness/` | event sink, bus, JSONL log, replay, scorecard, loop |
| `providers/` | anthropic, openai adapters + auth |
| `tools/`, `sandbox/` | read/write/edit/bash + Seatbelt profile |
| `approvals/`, `gates/` | rules engine, classifier, gate engine |
| `game/` | proto L0/L1 packs, verifier/progression/tutor rebind |
| `tui/` | OpenTUI React surfaces + headless no-op |
| `findings/` | one Markdown findings file per slice — the real deliverable |

## Run

```sh
bun run proto:demo     # scripted headless walkthrough — no key, no TTY needed
bun run proto          # interactive TUI, scripted model (no key needed)
bun run proto:live     # interactive TUI, real provider (needs ANTHROPIC_API_KEY or OPENAI_API_KEY)
bun test proto         # slice smoke tests
```

State is scratch-only: progression/session files live under `.garnish-proto/`
(gitignored) inside a scaffolded temp workspace. Wipe freely.
