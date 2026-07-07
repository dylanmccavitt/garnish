# Issue Tracker — Garnish

Tracker: Linear

## Linear

- Team: Loom (`LOO`)
- Project: Garnish
- Project URL: https://linear.app/dylanmccavitt/project/garnish-19ceee7bd725
- Project ID: `8605167b-8479-4dcb-b1f7-e6c3dca7eb86`

## Planning documents

- PRD — Garnish: https://linear.app/dylanmccavitt/document/prd-garnish-f4b93b442997
- ARD — Garnish: https://linear.app/dylanmccavitt/document/ard-garnish-cf395973f74d
- Quest Inventory — Garnish Core Pack: https://linear.app/dylanmccavitt/document/quest-inventory-garnish-core-pack-49b81216c2f6

## Related projects

- Garnish Standalone — purpose-built harness & TUI (DECIDED 2026-07-02, state: Planned):
  https://linear.app/dylanmccavitt/project/garnish-standalone-purpose-built-harness-and-tui-98f6de260a93
  Brief + decision record: https://linear.app/dylanmccavitt/document/brief-garnish-standalone-purpose-built-harness-and-tui-2527da9a5034
  Research spike (2026-07-02): https://linear.app/dylanmccavitt/document/research-spike-garnish-standalone-harness-architecture-2026-07-02-4a7d1435bfd3
  PRD v2 (ACCEPTED 2026-07-04): https://linear.app/dylanmccavitt/document/prd-v2-garnish-standalone-purpose-built-harness-and-tui-632ac25c9788
  ARD v2 (ACCEPTED 2026-07-04): https://linear.app/dylanmccavitt/document/ard-v2-garnish-standalone-architecture-decisions-c71d90cbecef
  Prototype retro (2026-07-06): https://linear.app/dylanmccavitt/document/prototype-retro-garnish-standalone-map-seed-run-2026-07-06-7f955a42c984
  — throwaway map-seed prototype of the full v2 spec on branch `prototype/garnish-standalone`
  (never merges; demo: `bun run proto:demo` / `bun run proto`, walkthrough in `PROTOTYPE.md`,
  Cursor Cloud-ready). All 12 demo beats pass; spec held. PRD/ARD v2 carry "Prototype
  amendments (2026-07-06)" sections; re-scope comments posted on LOO-155/156/159/160/161/162/
  164/165/166/170/171/173/174/179. Delete or absorb the proto/ tree once re-scopes land.
  FACTORIO PIVOT (DECIDED 2026-07-06): game design superseded — the factory vision (start
  bare like pi, automate yourself out of the loop machine-by-machine; UI is the progress bar;
  tokens are electricity; ore = procedural task families; graduation = export the factory).
  Decision ledger (9 grilled Qs): https://linear.app/dylanmccavitt/document/decision-record-factorio-pivot-2026-07-06-the-factory-vision-for-9646047ca1b0
  Harness substrate (M0/M1: LOO-157, 159-165) survives verbatim; M2-M4 to be re-stamped
  after proto #4 (first-hour vertical slice, new thread). The three TUI variants
  (expedition/dungeon/arcade, commit aa036f3) are scratched; findings files remain reference.
  Implementation issues (stamped 2026-07-04): 25 dependency-ordered issues LOO-155..LOO-179
  under project milestones M0-M4, wired with Linear blocked-by relations.
  - Unblocked (Todo): LOO-155 OpenTUI React/Solid spike, LOO-156 Bun+Seatbelt spike,
    LOO-157 auth, LOO-158 delete omp surfaces, LOO-159 event taxonomy/bus/session log
  - M0 loop+providers: LOO-160 loop core, LOO-162 Anthropic adapter, LOO-161 OpenAI adapter
  - M1 tools+safety: LOO-163 core tools, LOO-164 approvals engine, LOO-165 Seatbelt sandbox
  - M2 TUI: LOO-166 foundation, LOO-168 transcript, LOO-167 approval modal, LOO-169 CLI rebind
  - M3 rebind+L0/L1: LOO-170 verifier, LOO-171 progression, LOO-172 tutor, LOO-173 gates,
    LOO-174 L0-L1 packs+surfaces, LOO-176 headless e2e, LOO-175 exit gate (HITL)
  - M4: LOO-177 scorecards, LOO-178 graduation export, LOO-179 curriculum re-scope (HITL)
  Decision: fully own harness — own agent loop + TUI, omp dropped. Repeals ARD §1/ADR-8/9
  for v-next. Evolve this repo; no fresh repo. Main bus (packs, verifier, progression,
  gates, curriculum) carries over. v1 omp-coupled work (LOO-148/149/150,
  adapter/extension/runtime fallout) is paused/cancelled unless v1 maintenance is
  explicitly revived; portable pack authoring continues.

## GitHub

- Repository: https://github.com/DylanMcCavitt/garnish
- Default branch: `main`
- Visibility: public

## Workflow convention

- Use Linear for planning and issue tracking.
- Use GitHub for code delivery.
- One Linear issue -> one branch -> one PR.
- Branches should include the Linear issue identifier once implementation issues exist.
- Pull requests should link the Linear issue and rely on the GitHub/Linear bridge when configured.

## Implementation issues (stamped 2026-07-01)

29 dependency-ordered issues live in the Garnish project, wired with Linear blocked-by
relations and grouped under project milestones M0-M5 (M5 is a v2 placeholder with no issues).

- Meta / unblocked: LOO-116 (license decision, HITL), LOO-117 (Linear/GitHub bridge, HITL),
  LOO-118 (Pi extension API spike), LOO-119 (repo scaffold)
- M0 skeleton: LOO-120 core types, LOO-122 pack loader, LOO-123 progression, LOO-124 verifier
- M1 adapter + CLI: LOO-121 certified runtime, LOO-125 gate render, LOO-130 init wizard, LOO-128 CLI surface
- M2 extension: LOO-126 ext core, LOO-132 HUD/commands, LOO-129 live unlocks, LOO-135 tutor bridge,
  LOO-136 scripted E2E, LOO-139 live L0->L1 walkthrough (HITL exit gate)
- M3 core pack: LOO-127 L0, LOO-131 L1, LOO-137 L2, LOO-140 L3
- M4 core pack + polish: LOO-141 L4, LOO-142 L5, LOO-143 L6, LOO-144 L7 capstone,
  LOO-133 third-party packs, LOO-134 eject, LOO-138 polish

Content-pack chain edges (L0->...->L7) are merge order only: levels share the one in-repo core
pack and the loader rejects unknown quest ids; authoring may parallelize.

Done (merged + bridge-closed), 21 of 29: LOO-116..LOO-128 (see PRs #1-#11 above/git log),
LOO-129 live unlocks (PR #14), LOO-130 init wizard (PR #15), LOO-131 L1 pack + `approved`
event matcher (PR #12), LOO-132 HUD + /quest (PR #13), LOO-135 tutor bridge (PR #16,
live-smoke verified: "what's my quest?" answered with the real L0 checks), LOO-136
scripted E2E happy path (PR #18), LOO-137 L2 Lore pack (PR #17), LOO-139 M2 exit gate
(PR #19 — live L0->L1 walkthrough on real omp 16.2.13; evidence + 7 fixed live defects
recorded on the issue; fallout filed as LOO-148/149/150).
M0 + M1 + M2 complete. Next unblocked: LOO-140 L3 Skill Tree pack, LOO-148/149/150 fallout.
Notes: certified-runtime source for walkthroughs:
`GARNISH_OMP_SOURCE=~/.local/share/garnish/omp-source/16.2.13/omp-16.2.13` (sibling
`pi_natives.darwin-arm64.node` required next to source AND installed binary — LOO-148;
host omp GC prunes `~/.omp/natives/<old>`). Mint `omp token anthropic` immediately
before launching (short TTL). Extension redeploys need a session restart (LOO-150).
Notes: L0 status-screen uses `command(garnish status exit=0)` (no OR in the DSL);
deny-once is a real `event(tool_approval_resolved approved=false)` check per the spike.

## Notes

- License: MIT (LICENSE, commit 39fe8ef; decision recorded on LOO-116).
- Pi adapter contract findings: `docs/spikes/pi-extension-api-findings.md` (LOO-118, PR #2).
  Notable: approval denial = `tool_approval_resolved.approved=false` (no `approval_denied`
  event); `appendEntry` before `reload()` not durable headless; `PI_CODING_AGENT_DIR`
  isolates sessions/config/auth but omp still writes `~/.omp/logs/`.
