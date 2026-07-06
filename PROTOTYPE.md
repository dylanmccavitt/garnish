# Garnish Standalone prototype walkthrough

## 1. What this is

This is a **map-seed prototype** for the Garnish Standalone harness: a fast, throwaway run that tests whether Garnish can own its agent loop, event taxonomy, gates, approvals, verifier, and TUI without a third-party harness. The code under `proto/` is not the product; the learning is. **THROWAWAY:** demo it, annotate the answers, fold the findings back into PRD v2 / ARD v2 and the LOO-155..179 issue chain, then delete or absorb the validated pieces. Keep the seven questions from [`proto/README.md`](proto/README.md#questions-this-run-must-answer) open while watching.

## 2. 60-second setup in Cursor Cloud

Cursor Cloud is a Linux VM. Per [`AGENTS.md`](AGENTS.md#cursor-cloud-specific-instructions), Bun is already installed at `~/.bun/bin` and on `PATH`.

```sh
bun install
```

No API key is needed for the default demo paths:

```sh
bun run proto:demo
bun run proto
```

Optional live-provider path only:

```sh
export ANTHROPIC_API_KEY=...
# or
export OPENAI_API_KEY=...
```

Then run:

```sh
bun run proto:live
```

## 3. Act I — headless walkthrough: `bun run proto:demo`

Run the scripted no-TTY demo first:

```sh
bun run proto:demo
```

Use this act when the VM terminal is cramped, non-interactive, or does not support the TUI alt-screen cleanly. It should be deterministic enough to replay and compare.

Guided script:

1. **Opening banner and scratch state.** The demo should identify itself as the Garnish Standalone prototype, show that state is scratch-only under `.garnish-proto/`, and remind you that the run is throwaway.
   - **Watch for:** the harness making its own session/log boundary instead of delegating to a third-party harness.
2. **L0 player message.** The scripted player asks the first training-style question, kicking off the L0 lesson.
   - **Watch for:** the transcript reading like a game turn, not a raw SDK dump.
3. **Streaming agent turn.** The scripted model streams its response in chunks.
   - **Watch for:** incremental stream events in the transcript and replay log, not one opaque final blob.
4. **Read tool call.** The agent uses the safe read tool against the scaffolded temp workspace.
   - **Watch for:** a tool result that is visible to the verifier and session log.
5. **Locked-tool teaching block.** The agent reaches for a tool that L0 has not unlocked yet.
   - **Watch for:** the game saying “not yet” in teaching language, with a tease for what unlocks later, instead of silently hiding capability.
6. **Approval ask.** A risky or write-like action requests approval.
   - **Watch for:** the approval request naming the action, risk, and available decisions.
7. **Denial with reason feeds back.** The scripted player denies the approval with a reason, and the next agent turn receives that denial as context.
   - **Watch for:** the reason appearing in the agent-visible event stream so the model can adapt, not merely in UI chrome.
8. **Unlock celebration.** Completing the L0 teaching moment unlocks the next capability.
   - **Watch for:** a celebratory event that is game-readable and replayable, not a side-effect-only UI flourish.
9. **Verifier quest completions.** The verifier marks the L0 → L1 quest checks complete.
   - **Watch for:** existing check semantics being satisfied by first-party harness events; no special demo-only check kind should be needed.
10. **Final scorecard.** The demo prints a scorecard summarizing quests, approvals, tools, gates, and replay status.
    - **Watch for:** a replay-determinism line. The point is not just “the demo ended”; the point is that the same event log can be replayed into the same scorecard.
11. **Linux sandbox warning.** On Cursor Cloud Linux, the macOS Seatbelt sandbox cannot run.
    - **Watch for:** a loud no-sandbox / Linux-deferred warning. That is a prototype finding, not a demo bug: the spec currently names macOS Seatbelt, while the cloud demo environment is Linux.

## 4. Act II — interactive TUI: `bun run proto`

Run the scripted-model TUI next:

```sh
bun run proto
```

No API key is needed. The model is scripted; the value here is the harness/TUI feel.

**Progress is a real save.** State lives under `~/.garnish-proto` (override with
`GARNISH_PROTO_HOME`; wipe with `bun run proto -- --reset`). On relaunch the
wizard offers `Continue` (kept XP, quests, unlocked verbs, workspace) or
`New game`.

**It opens with the onboarding wizard** (text-mode, before the TUI): Sprig the
pixel mascot welcomes you, then a "pantry pass" menu lists sign-in options —
omp-parity OAuth providers (Anthropic PKCE, OpenAI Codex device-code;
Cursor/Copilot/Gemini/Kimi/xAI marked coming soon) plus `1) Demo Kitchen`
(no account). Press `1` + Enter for the offline path: a fake device-code
ceremony signs you in and completes the "Mise en place" tutorial quest via the
`auth.login` event.

Mission-Control layout (clean monogrid; sprites carry the color — pixel art
generated with Codex imagegen, baked to terminal half-blocks):

- **Header bar:** pixel Sprig + workspace, real `LVL · XP · TOK` metrics.
- **Objective banner:** always-visible `OBJECTIVE ▸ …` (or `BOSS FIGHT ▸ …`)
  naming the active quest and exactly what to try.
- **Transcript (main, left):** flowing chat stuck to the bottom — streaming
  tokens, tool chips, teaching blocks, clean celebration rows inline.
- **Right rail:** Quest (checks + `NEXT UP` hint), Verbs (skill tree with
  teased locks), `UP NEXT` unlock preview, Progress Log (game moments).
- **Atlas (`Tab`):** full-screen map — levels, quests (✓/▸), unlock reward
  chips, BOSS rows with pixel boss portraits (L1's boss is The Goodbye
  Greeter), plus teaser levels (Lore Library, Skill Forge).
- **Bottom:** status word (`AWAITING INPUT / STREAMING / RUNNING TOOL /
  AWAITING APPROVAL`) + input box whose placeholder tells you what to type
  next, then a dim hotkey bar.
- **Approval modal:** z-indexed overlay when the agent asks for a gated or
  risky action.

Keys:

- `Enter` — submit the current player message or accept the focused prompt.
- `Esc` — back out of the current prompt/modal when available.
- `Ctrl+C` — quit the prototype.
- Approval keys when an approval prompt is focused:
  - `a` — allow / approve.
  - `p` — approve for the current session or policy-shaped path, if offered by the prototype.
  - `d` — deny.
  - `r` — deny with a reason / request revision, if offered by the prototype.

Three-minute suggested play script:

1. Ask: `what's my quest?`
   - **Watch for:** the game explaining the L0 objectives in player language.
2. Complete the L0 read/tool-awareness quests.
   - Try a simple request that makes the agent inspect the scaffolded workspace.
   - **Watch for:** read-tool events feeding the verifier.
3. Let the agent bump into a locked capability.
   - **Watch for:** tease → teaching block → unlock path, not a dead error.
4. When an approval modal appears, deny one approval.
   - Use `d` or `r` and give a short reason if prompted.
   - **Watch for:** the transcript reflecting the denial and the next turn adapting to it.
5. Continue until the unlock celebration and L0 → L1 completion appear.
   - **Watch for:** celebration, quest completion, and scorecard all agreeing about what happened.

If the TUI behaves poorly in Cursor Cloud, do not debug it live for the founder. Capture the symptom, then fall back to:

```sh
bun run proto:demo
```

## 5. Act III — optional live provider: `bun run proto:live`

Only run this act when you intentionally want to test provider adapters and have a key available:

```sh
export ANTHROPIC_API_KEY=...
# or
export OPENAI_API_KEY=...
bun run proto:live
```

Use the same play script as Act II. Compare what changes when a real provider streams instead of the scripted model:

- Does the provider stream map cleanly into the same event union?
- Do approvals and denials remain visible to the model at the right time?
- Does `store:false` / item replay behavior stay compatible with deterministic replay expectations?
- Does the game still feel like Garnish, or does raw provider behavior leak through?

## 6. What we're weaving out

Annotate these while watching the demo. They are copied from [`proto/README.md`](proto/README.md#questions-this-run-must-answer) so the walkthrough and prototype stay tied to the same questions.

- [ ] **Loop seams (ADR-10):** do the seven hook seams carry gates, approvals, tutor, and verifier without privileged channels or hidden coupling?
  - Notes:
- [ ] **Taxonomy (ADR-13):** does the first-party event union satisfy the existing closed check DSL with zero new check kinds? Is replay deterministic?
  - Notes:
- [ ] **TUI (ADR-17 / LOO-155):** does OpenTUI+React on Bun deliver a streaming transcript + modal + celebration juice, on macOS *and* the Linux VM?
  - Notes:
- [ ] **Sandbox (ADR-20 / LOO-156):** does `Bun.spawn` + `sandbox-exec` inline profile work? What does "Linux deferred" cost when cloud sandboxes are the test environment?
  - Notes:
- [ ] **Providers (ADR-11):** do Messages API and Responses API (`store:false`, item replay) both map cleanly onto one stream-event union?
  - Notes:
- [ ] **Gates (ADR-16):** are live mid-session unlocks race-free through `toolFilter`, and does hide-then-tease read as a game?
  - Notes:
- [ ] **Feel (M3 exit bar):** is the L0 slice "unmistakably a game"?
  - Notes:

## 7. Troubleshooting

### No TTY or broken alt-screen

Use the headless script:

```sh
bun run proto:demo
```

That is the safest path for CI-like terminals, shared logs, and VM terminals that do not expose a full interactive TTY.

### Terminal is too small

Resize the Cursor terminal before running the TUI:

```sh
bun run proto
```

If panes wrap badly or modals obscure the transcript, record the terminal size as a TUI finding and use the headless demo for the walkthrough.

### `TERM` is missing or too minimal

Check the terminal type:

```sh
echo $TERM
```

If it is empty or set to something very small like `dumb`, set a common xterm-compatible value for the session and retry:

```sh
export TERM=xterm-256color
bun run proto
```

If the VM still does not render the TUI reliably, treat that as a Cursor Cloud readiness finding and continue with:

```sh
bun run proto:demo
```

### Linux sandbox warning

Cursor Cloud is Linux. The prototype's Seatbelt sandbox path is macOS-specific, so the Linux VM should warn loudly that it is running without Seatbelt rather than pretending to be sandboxed. Capture the wording in the findings; do not hide it from the demo.

## Real demo (mp4)

Render the running demo to an mp4 when proof needs to be shareable:

```sh
bun run demo:mp4
bun run demo:mp4:tui
```

See `.agents/skills/real-demo/SKILL.md` for the repo-standard "real demo" workflow and recording rules.
