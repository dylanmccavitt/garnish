# Demo documentation findings

## What worked

- `proto/README.md` already names the exact public scripts the founder walkthrough should use: `bun run proto:demo`, `bun run proto`, and `bun run proto:live`. That made it possible to keep `PROTOTYPE.md` aligned without inventing flags or extra setup.
- The Cursor Cloud section in `AGENTS.md` is clear that Bun is preinstalled and on `PATH`, so the walkthrough can be short: `bun install`, then run the prototype scripts.
- The prototype questions in `proto/README.md` translate cleanly into an annotatable founder checklist. That should make the demo useful even if the prototype misbehaves.
- Cursor's `.cursor/environment.json` supports a minimal `install` plus `terminals` shape, so the repo can greet a cloud VM with a safe `bun run proto:demo || true` terminal without snapshot assumptions.

## What did not work / gaps hit

- The demo docs had to describe expected surfaces before the demo implementation exists in this checkout. `PROTOTYPE.md` intentionally phrases panes and event names as things to watch for, but the prototype still needs the actual headless output to match the walkthrough closely enough for a founder to follow.
- The exact TUI key handling is not yet proven in Cursor Cloud. `Enter`, `Esc`, `Ctrl+C`, and approval keys `a`/`p`/`d`/`r` are documented as the intended demo contract, but OpenTUI alt-screen behavior inside the Cursor Cloud terminal remains an unknown.
- Cursor Cloud TTY behavior is a demo-readiness risk: no-TTY terminals, tmux/shared terminal behavior, alt-screen redraw, small terminal dimensions, and `$TERM` defaults may differ from local macOS. The docs steer the founder to `bun run proto:demo` as the reliable fallback.
- The sandbox story is necessarily awkward in the VM: Cursor Cloud is Linux while the specced sandbox path is macOS Seatbelt. The walkthrough calls the loud no-sandbox warning a finding, not a bug, because hiding that mismatch would make the prototype less useful.
- `proto/README.md` says every demo path must run with no key, but the root package scripts are not present in this slice. The integrator still needs to add `proto`, `proto:demo`, and `proto:live` exactly as named there before the walkthrough is executable.
- The walkthrough needs the headless demo to print a clear replay-determinism line. Without that line, founders will see a completed script but not the ADR-13 answer the prototype is supposed to expose.
- The approval denial path needs visible feedback in both headless and TUI modes. If denial reasons only affect internal state, the demo will fail to show why owning the harness loop matters.

## Spec / issue feedback

- PRD v2 / ARD v2 should explicitly call out a two-path demo contract: headless deterministic walkthrough for cloud/CI/no-TTY environments, and interactive TUI for game feel. Treat headless as first-class, not as a fallback afterthought.
- ADR-20 / LOO-156 should name the Linux cloud-demo sandbox behavior directly: loud no-sandbox warning, no silent fake sandbox, and a founder-visible explanation of what remains protected versus deferred.
- LOO-155 should include Cursor Cloud terminal acceptance notes: minimum useful terminal size, `$TERM` expectation, alt-screen behavior, and what command to use when TUI rendering fails.
- The scorecard should include replay determinism as a named line item, because it is one of the easiest founder-visible proofs that the event taxonomy is doing real work.
- The demo should keep command names stable and boring. The docs now assume only `bun run proto:demo`, `bun run proto`, `bun run proto:live`, and `bun install`; any script rename will break the cloud onboarding story.
