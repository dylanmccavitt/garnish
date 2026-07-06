# TUI slice findings (ADR-17 / LOO-155 React half)

## What was built

- `proto/tui/index.ts` exposes the internal seam:
  - `startTui({ bus, send, abort, gateViews, questView, scorecard, onExit })`
  - returns `{ prompter, stop }`
- OpenTUI-specific code stays behind that seam:
  - alt-screen `createCliRenderer({ screenMode: "alternate-screen" })`
  - React root mounting
  - keyboard handling
  - approval modal rendering
  - frame-loop/timeline celebration effects
- The TUI is only a bus subscriber for harness state. It does not get a privileged event channel.
- View state is driven from bus events plus the three polled view functions:
  - `gateViews()`
  - `questView()`
  - `scorecard()`
- Pure seams extracted and smoke-tested:
  - event to transcript model reducer
  - event to glyph/game-moment legend
  - approval modal state machine
- `proto/tui/dev.tsx` is a self-driving demo with fake bus events, an approval request, a blocked tool teaching callout, an unlock, and a quest completion celebration.

## LOO-155 React verdict

React + OpenTUI 0.4.3 + Bun is viable for the prototype, with caveats.

What worked:

- React state maps naturally to the event-bus subscriber model.
- The pinned `@opentui/react` primitives were enough for the ADR-17 surfaces: transcript, sidebar, input, modal, and simple animation layer.
- `useKeyboard` gave the right shape for Enter / Esc / Ctrl+C and modal hotkeys.
- `useTimeline` was enough for prototype-grade juice: an XP burst banner and glyph shower update without hand-rolling a render loop.
- Bun could import and test the React/OpenTUI files through `bun test ./proto/tui`; no extra bundler step was needed.

What did not work cleanly:

- OpenTUI 0.4.3's public React docs are usable but thin for production edge cases. The prototype needed local `.d.ts` inspection for renderer config and JSX support.
- The project tsconfig does not set `jsxImportSource`, so every `.tsx` file needs `/** @jsxImportSource @opentui/react */`. That is a small but real leak from the chosen UI backend into component files.
- `startTui` is synchronous by contract, while `createCliRenderer()` is async. The prototype hides this by booting in the background and making `stop()` tolerate an in-flight boot. That is the largest seam mismatch.
- The approval prompter promise and modal UI need a tiny in-memory controller outside the bus because the promise resolver is not itself an event. The request/resolved facts are still bus events, but the pending promise is local UI state.
- Rendering without a real TTY produces degraded captured output. It is still useful for smoke evidence, but not for pixel/box-layout confidence.

React vs Solid:

- Solid was intentionally not evaluated in this slice. ADR-17 can keep Ink viable as the fallback candidate, but this prototype only answers the React/OpenTUI half requested by LOO-155.

## Internal UI layer leakiness

Verdict: mostly contained, but not perfectly sealed.

Contained well:

- Callers only see `startTui`, `prompter`, and `stop`.
- Harness events, gates, quest, and scorecard remain contract types from `proto/harness/types.ts`.
- Headless mode can simply never call `startTui`; no alternate API is needed.
- The TUI can be replaced by Ink if the replacement preserves the same `ApprovalPrompter` and start/stop shape.

Leaks observed:

1. Async renderer boot leaks into lifecycle semantics. A future production seam should either make `startTui` async or split `createTui()` from `start()`.
2. JSX import source is component-local friction. If this survives the prototype, tsconfig or a TUI-local convention should own it.
3. The approval modal cannot be purely event-reduced because a promise resolver must live somewhere. That is acceptable local UI state, but the spec should explicitly allow ephemeral UI promise state outside the event log.
4. OpenTUI keyboard event names (`return`, `escape`, `ctrl`) are now normalized inside `app.tsx`; an Ink fallback would need the same internal normalization.

Spec change recommended:

- ADR-17 should define the internal UI seam as async unless there is a strong reason not to:
  - `startTui(...): Promise<{ prompter; stop }>` is cleaner for OpenTUI.
  - If sync remains required, document that rendering starts best-effort and failures call `onExit()`.

## Game feel and juice ceiling

The prototype can reach "recognizably a game" quickly:

- Quest checks updating live in the sidebar read clearly.
- Teased locked tools with lock glyphs and teaching hints communicate progression.
- `quest.completed` as an XP burst plus shower makes success visible.
- `unlock.applied` as a `NEW VERB` banner is the right language for tool unlocks.
- The bottom game log is useful because it narrates why the UI changed instead of only changing numbers.

Can it become "unmistakably a game"?

Yes, but only if the spec commits to stronger art direction than this prototype:

- persistent verb inventory with unlock animations
- richer quest-complete ceremony than one banner
- stronger level/XP progression math from the game slice
- visible consequences when a blocked tool teaches a future unlock
- a consistent glyph/color legend across transcript, sidebar, and celebrations

Juice ceiling with OpenTUI 0.4.3 looks high enough for L0/L1. The frame loop is sufficient for lightweight animation. I would not spend prototype time on particle systems or complex markdown effects; the biggest game-feel lift is better progression copy and ceremony timing, not more render machinery.

## Markdown / renderables

- Markdown parser perfection remains a non-goal.
- The transcript model keeps text bodies simple and renders code/diff-ish surfaces as compact terminal lines for now.
- OpenTUI includes `code`, `diff`, and `markdown` renderables, but this slice stayed mostly in-house to keep ADR-17 fallback-friendly. Future work can selectively use those renderables behind the same component boundary.

## `tui.pty.md` note — manual run evidence

Command attempted:

```sh
bun proto/tui/dev.tsx
```

Harness invocation requested a PTY. This environment reported: `pty requested but unavailable in this environment; ran without a terminal`.

Observed from the captured run anyway:

- The app started and painted the alt-screen layout bytes.
- Transcript, quest panel, skill tree, command box, approval modal, and celebration text all rendered into the capture.
- The approval modal appeared with the exact command, moderate tier, explanation, suggested pattern, and hotkey options.
- The scripted stdin approval path advanced the quest check to `Approve one safe command`.
- `unlock.applied` produced a `NEW VERB · edit` glyph banner.
- `quest.completed` advanced the final quest check.

Frame stability:

- In the non-real-TTY capture, frames smear together because terminal control codes are captured as text instead of interpreted. That is expected and not a reliable flicker signal.
- No crash occurred during the 9-second scripted run.

Flicker:

- Not possible to judge from this non-TTY capture. Needs a real terminal pass on macOS Ghostty and the Linux VM.

Input latency:

- The scripted synthetic `a` key reached the modal and resolved the approval before the next scripted tool result. That proves the key path works, but not human-perceived latency.

OpenTUI + React + Bun held up:

- Yes for startup, rendering, event updates, keyboard path, modal resolution, and timeline animation in this local run.
- Unknown for true interactive flicker/latency because the available harness did not provide a real PTY despite requesting one.

## Verification

- `bun test proto/tui` with Bun 1.3.14 treated `proto/tui` as a name filter rather than a path and failed before loading tests. Bun's own diagnostic said to use `./proto/tui` for path mode.
- `bun test ./proto/tui` passed: 3 tests, 12 expectations.
- `bun proto/tui/dev.tsx` ran to completion for the self-driving demo; captured output showed the expected surfaces and game events.
