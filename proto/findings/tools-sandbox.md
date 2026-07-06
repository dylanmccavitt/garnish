# Tools + sandbox slice findings

## Verdict: Bun.spawn + inline Seatbelt profile (LOO-156)

- `Bun.spawn(["sandbox-exec", "-p", profile, "bash", "-lc", cmd])` works for ordinary shell commands when the profile is supplied inline; no temp profile file is needed.
- Capturing stdout/stderr from Bun pipes and awaiting `proc.exited` was enough for model-facing output and `{ exitCode, durationMs }` details.
- `sandbox-exec` failures are not uniformly teachable by default: several Seatbelt denials exit `134` with empty stdout/stderr. The prototype maps empty `134` under Seatbelt to the same teachable sandbox-blocked message.
- `bun test proto/tools` in Bun 1.3.14 is treated as a test-file filter, not a directory path. The equivalent path invocation that actually runs this slice is `bun test ./proto/tools`.

## What worked

- Core tools are small and useful on the GarnishTool contract:
  - `read` returns line-numbered workspace-relative file contents and self-announces truncation.
  - `write` creates parent directories and emits `details.fileEdited` with `{ path, kind: "write", summary: "+N bytes" }`.
  - `edit` performs exact string replacement and refuses 0-match and multi-match edits with counts in model-facing output.
  - All core file tools resolve paths through the workspace and refuse lexical or symlink escapes.
- Seatbelt blocks writes outside the workspace while allowing workspace writes. The smoke test proves:
  - `touch "$HOME/garnish-proto-escape"` is blocked by the sandbox.
  - `curl -I --max-time 2 https://example.com` is blocked with network disabled.
  - `touch sandbox-ok` in the workspace succeeds.
- Non-macOS degrade is straightforward: `sandboxAvailability()` returns `mode: "none"` with a loud reason, and the bash tool prepends `[sandbox disabled: Seatbelt unavailable; command ran without OS sandboxing]` to model-facing output.

## What did not work / surprises

- A strict allow-list of read subpaths made even `true`/`echo` abort on this macOS runner. The practical profile had to allow broad `file-read*` and then constrain `file-write*` tightly. This still matches the high-level teaching model (reads are okay, writes are constrained), but it is looser than the initial ADR-20 phrasing of “reads from system paths + workspace.”
- `sandbox-exec` is brittle with non-existent or symlinked subpaths. Some profiles that referenced ordinary-looking paths aborted with no stderr. Filtering/realpathing helped, but the reliable prototype answer was broad read + narrow write.
- The assignment’s literal probe `touch /tmp/../$HOME/garnish-proto-escape` fails on macOS before Seatbelt gets a useful denial because `/tmp` is a symlink to `/private/tmp`, making the expanded path land under `/private/Users/...` rather than `/Users/...`. The smoke test keeps that command as a failing escape probe, and separately uses `touch "$HOME/garnish-proto-escape"` to prove an actual Seatbelt denial.

## .git-protection tension (LOO-156 / LOO-165)

- Protecting `workspace/.git` with an explicit `deny file-write*` does stop `.git` writes, but it also breaks read-only `git status --short` in this prototype profile: it exits `134` with no stderr and is surfaced as a sandbox block.
- This is likely because Git wants to touch lock/index/cache state even for commands users perceive as read-only, or because the runtime denial is too coarse to distinguish harmless repository internals from protected config writes.
- Spec recommendation: do not promise “Git read-only commands work while `.git` writes are fully denied” without a deeper Seatbelt profile spike. Either:
  1. keep `.git` protected and teach that Git commands may be blocked in sandboxed bash, or
  2. allow `.git` writes inside a disposable quest workspace and rely on workspace throwaway semantics, while protecting user-global Git config and shell/env/SSH paths.

## Profile allowances bash/git forced

- Working profile shape:
  - `(deny default)`
  - allow `process*`, self signal, `sysctl-read`, metadata reads
  - allow broad `file-read*`
  - allow `file-write*` only under the realpathed workspace and session temp
  - explicit write denies for workspace `.git`, `.garnish`, `.env`, `.ssh` and user shell/env/SSH config paths
  - deny network unless `allowNetwork` is true
- The broad read allowance is the main spec pressure point. Trying to enumerate `/usr`, `/bin`, `/System`, `/Library`, `/private/tmp`, Bun cache, and Git config was not stable enough for a throwaway demo harness.

## Linux deferred cost / Cursor-cloud demo story

- Linux currently runs with `sandbox: "none"`; the command still executes and emits a one-line warning in the tool output.
- That is acceptable for Cursor-cloud smoke/demo only if the surrounding VM/container is already disposable and externally sandboxed. It is not an ADR-20 security boundary.
- Cost of deferring Linux sandboxing: any Linux demo can prove loop/tool UX and quest behavior, but cannot prove the OS sandbox safety story. The spec should say Linux bash is an explicit degraded mode until a real Linux backend is chosen (bubblewrap, nsjail, firejail, or container-per-session).
