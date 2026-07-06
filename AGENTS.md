# Garnish — agent guide

Garnish is a terminal game that teaches agentic coding craft fluency with its own
purpose-built harness and TUI (Bun + TypeScript).

## Agent skills

This repo runs the Factorio workflow kit. The per-repo envelope is in
`.agents/envelope/` — read it before planning or building:

- `linear-map.md` — Linear team/project/label/state map + the GitHub bridge.
- `domain.md` — domain glossary.
- `commands.md` — build/test/lint/run + default branch.
- `templates/` — PR/issue/doc templates.

Repo-specific skills and agents live in `.agents/skills/` and `.agents/agents/`.

## Pointers

- Tracker map and planning links: `docs/agents/issue-tracker.md`.
- v1 PRD/ARD: `docs/prd.md`, `docs/ard.md` (ARD §1 and ADR-8/9 are superseded
 for v-next by the standalone-harness decision; see the Garnish Standalone
 project brief in Linear).
- Verify before done: `bun run typecheck` and `bun test`.

## Cursor Cloud specific instructions

- Runtime is **Bun** (installed at `~/.bun/bin`, already on PATH via `~/.bashrc`).
  There is no `node_modules`-vs-Bun ambiguity: use `bun` for everything. Standard
  commands live in `.agents/envelope/commands.md` and `package.json` scripts.
- There is **no lint script**; `bun run typecheck` (`tsc --noEmit`) is the static gate.
- Running the CLI end-to-end via `garnish init` requires an **external certified Pi
  runtime binary `omp` (version `16.2.13`)** that is *not* part of this repo. Without
  it, `init` fails at the version handshake and `status`/`quest` report "not
  initialized". To drive the full flow in a sandbox, point `GARNISH_OMP_SOURCE` at a
  binary whose `--version` prints `omp/16.2.13` (or put such an `omp` on PATH).
- `GARNISH_ROOT` overrides where state is written (default `~/.garnish`); set it to a
  scratch dir to keep test runs isolated. Use `garnish init --no-launch` to skip
  spawning the interactive TUI, and pipe answers (provider / speedrun / sandbox) for
  non-interactive init, e.g. `printf 'anthropic\nn\n\n' | bun run garnish init --no-launch`.
