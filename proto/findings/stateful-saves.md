# Stateful saves

## Design verdict

The prototype now has a real local save root instead of a scratch-only story. `GARNISH_PROTO_HOME` points at the save directory, otherwise the default is `~/.garnish-proto`. A normal interactive run wires the harness through that root, so relaunching the TUI preserves the player profile, quest repository, progression fold, and per-session transcripts.

## Save layout

- `<root>/profile.json` stores the signed-in profile: provider, method, optional account, and creation timestamp.
- `<root>/workspace/` is the quest repo the agent edits. It is scaffolded once and then reused if `workspace/.git` already exists, so player-visible files and git history survive relaunch.
- `<root>/session-temp/` remains scratch space for a run, but it lives beside the durable workspace.
- `<root>/.garnish-proto/progression/events.jsonl` keeps the existing progression bridge convention. Passing the save root as the progression root preserves the v1-shaped bridge path while moving it under the durable save.
- `<root>/sessions/*.jsonl` stores run transcripts separately from progression. Each launch gets a new session log, so the demo can show a fresh session while still folding old progress.

## How event-sourced progress works here

Progression remains append-only and fold-driven. Quest completion calls `progression.grantQuest()`, which appends `quest_completed` records to `events.jsonl`; the bridge folds those events through the proto progression graph to derive completed quests, completed levels, total XP, and feature unlocks. Derived unlock events are persisted and replayed through the construction-time `onUnlock` callback, so a second `wireHarness({ saveRoot })` starts with gates pre-unlocked and emits `unlock.applied` into the new session log. That gives the player an experiential "welcome back" moment without inventing a separate steering/user message.

Session JSONL and progression JSONL have different jobs:

- Progression JSONL is the canonical long-lived game state: quest completion, XP, levels, and unlocks.
- Session JSONL is the replayable transcript for one launch: chat messages, tool calls/results, approvals, unlock narration, and scorecard material.

The durable workspace is the third leg. Progression can say "first edit is done," but the player also needs the edited repo to still be there. The workspace idempotence rule prevents relaunch from overwriting `quest-state.yml`, `PROOF.yml`, or any other quest artifacts.

## Resume UX implemented in this slice

When `profile.json` exists, `main.ts` folds progression events before onboarding and passes pure resume stats into the wizard. The first interactive screen becomes:

1. Continue as `<account ?? provider>` — `<n>` quests done · `<xp>` XP
2. New game (wipes the save)

Continue skips provider selection and reuses the saved profile. New game calls `resetSave()` and then follows the normal provider flow. `--reset` performs the same wipe before onboarding. After successful sign-in, onboarding writes `profile.json`, so the next launch has a resume identity.

## What v2 still needs

- Session resume and progression resume should be treated as distinct product choices. This slice resumes progression and workspace state but intentionally starts a new session transcript on each launch. A future "resume exact chat" feature would need to pick a prior `<root>/sessions/*.jsonl`, replay it into provider context, and decide how to handle stale tool state.
- Save slots are not modeled. The current root is one local profile/world. Multiple tutorials, accounts, or branches need a slot index and UI copy before this leaves prototype mode.
- Cloud sync is a non-goal here. The save format is local JSON/JSONL plus a git repo; that is syncable later, but conflict handling, credential boundaries, and account identity are deliberately out of scope.
- Profile storage is not credential storage. OAuth/API credentials still live in the auth store; `profile.json` only records the provider identity needed for resume UX.

## LOO-171 / LOO-169 re-scope input

- LOO-171 should separate durable progression replay from session replay. The production contract needs to name which event streams are canonical for game state and which are replay artifacts for transcript/debugging.
- LOO-171 should keep unlock narration replayable. Re-emitting `unlock.applied` into a new session when folded state already contains unlocks made the resume state visible without adding hidden UI state.
- LOO-169 should include resume/new-game onboarding as part of setup, not as an afterthought. Provider selection, profile persistence, reset behavior, and the first visible progress summary all belong to the same first-run/resume funnel.
- LOO-169 should specify whether account changes imply a wipe, a new slot, or migration. This prototype reuses one local save root and lets New Game wipe it.

## Proof run

- `bun test ./proto/save.smoke.test.ts ./proto/tools ./proto/game` passed: save root env override, profile round-trip, reset behavior, workspace idempotence, and wire-level progression resume.
- `bun test ./proto/onboarding.smoke.test.ts` passed for the pure onboarding seams, including the new Continue/New menu helpers.
- `bunx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "proto/save|proto/onboarding|proto/main|proto/wire|proto/tools"` produced no matching diagnostics.
