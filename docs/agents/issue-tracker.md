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

Done (merged + bridge-closed): LOO-116 license, LOO-117 bridge (verified live via PR #1
auto-close), LOO-118 spike (PR #2), LOO-119 scaffold (PR #1), LOO-120 core types (PR #4),
LOO-121 certified runtime (PR #3), LOO-122 pack loader (PR #6), LOO-123 progression (PR #5),
LOO-124 verifier (PR #8), LOO-125 gate rendering (PR #7). M0 complete.
In Progress: LOO-126 extension core, LOO-127 L0 pack, LOO-128 CLI surfaces.
Everything else is Backlog until its blockers close.

## Notes

- License: MIT (LICENSE, commit 39fe8ef; decision recorded on LOO-116).
- Pi adapter contract findings: `docs/spikes/pi-extension-api-findings.md` (LOO-118, PR #2).
  Notable: approval denial = `tool_approval_resolved.approved=false` (no `approval_denied`
  event); `appendEntry` before `reload()` not durable headless; `PI_CODING_AGENT_DIR`
  isolates sessions/config/auth but omp still writes `~/.omp/logs/`.
