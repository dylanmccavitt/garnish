# Pi extension API spike findings

Linear: https://linear.app/dylanmccavitt/issue/LOO-118

Date: 2026-07-01

## Scope

This spike empirically checked the Pi/OMP adapter assumptions from `docs/ard.md` §2 against the installed `omp` binary.

Non-goals honored: no production Garnish code, no OMP fork/patch, no L1 pack content other than the approval-denied finding, and no v2 portability work.

## OMP version/build observed

- `omp --version` => `omp/16.2.13`
- `omp --help` header => `omp v16.2.13`; `-p, --print` is documented as non-interactive mode.
- Extension capture runtime from `spikes/pi-extension-api/captures/11-autoload-events-tools.jsonl:1`:
  - Node: `v24.3.0`
  - Bun: `1.3.14`
- No separate build hash was exposed by `omp --version` or `omp --help`.

## OMP docs read before writing code

Required docs were read through `omp://`:

- `omp://extensions.md`
- `omp://extension-loading.md`
- `omp://settings.md`
- `omp://skills.md`
- `omp://mcp-config.md`
- `omp://system-prompt-customization.md`

Additional docs used for exact approval/headless/env behavior:

- `omp://approval-mode.md`
- `omp://environment-variables.md`
- `omp://skills/authoring-extensions.md`
- `omp://hooks.md`
- `omp://rpc.md`

Key API names confirmed from docs before implementation:

- Extension module default factory: `export default function (pi) { ... }`
- Event registration: `pi.on(event, handler)`
- Required event names in this spike: `session_start`, `tool_call`, `tool_result`, `context`, `agent_end`
- Approval-related event names documented by OMP: `tool_approval_requested`, `tool_approval_resolved`
- Runtime tool gating: `pi.getActiveTools()`, `pi.setActiveTools(...)`
- Session persistence: `pi.appendEntry(customType, data)`, `ctx.sessionManager.getBranch()`
- HUD/headless UI: `ctx.ui.setWidget(...)`, `ctx.ui.setStatus(key, text)`, `ctx.ui.notify(message, type)`, `ctx.hasUI`
- Command context reload: `ctx.reload()` from `pi.registerCommand(...)` handlers
- Extension loading from the active agent directory: `$PI_CODING_AGENT_DIR/extensions/...`

## Spike artifacts committed

- Throwaway extension: `spikes/pi-extension-api/index.js`
- Fixture file used by real `read` tool calls: `spikes/pi-extension-api/fixture.txt`
- Approval-deny overlay: `spikes/pi-extension-api/approval-deny.config.yml`
- Event/behavior captures:
  - `spikes/pi-extension-api/captures/11-autoload-events-tools.jsonl`
  - `spikes/pi-extension-api/captures/12-autoload-reload-command.jsonl`
  - `spikes/pi-extension-api/captures/12-autoload-reload-session-after.json`
  - `spikes/pi-extension-api/captures/13-autoload-approval-deny-config.jsonl`
  - `spikes/pi-extension-api/captures/14-autoload-approval-always-ask.jsonl`
  - `spikes/pi-extension-api/captures/16-autoload-isolation-report.json`
  - `spikes/pi-extension-api/captures/16-autoload-isolation-probe.jsonl`
  - `spikes/pi-extension-api/captures/18-target-isolation-report.json`
  - `spikes/pi-extension-api/captures/18-target-isolation-probe.jsonl`

The extension was copied into `$PI_CODING_AGENT_DIR/extensions/pi-extension-api/index.js` for the real autoload runs; the primary evidence runs did **not** use `-e`.

## Reproduction setup

The successful runs used a disposable temp root with:

```bash
export PI_CODING_AGENT_DIR="$TMP/agent"
export GARNISH_PI_SPIKE_LOG_DIR="$REPO/spikes/pi-extension-api/captures"
export GARNISH_PI_SPIKE_RUN="<run-label>"
```

For full-home isolation probes, `HOME` was also pointed at a temp home so OMP's always-on rotating logs did not target the real home directory:

```bash
export HOME="$TMP/home"
```

The extension autoload path was prepared with:

```bash
mkdir -p "$PI_CODING_AGENT_DIR/extensions/pi-extension-api"
cp spikes/pi-extension-api/index.js "$PI_CODING_AGENT_DIR/extensions/pi-extension-api/index.js"
```

Provider/auth files needed in the temp agent dir:

```bash
cp ~/.omp/agent/config.yml "$PI_CODING_AGENT_DIR/config.yml"
cp ~/.omp/agent/agent.db "$PI_CODING_AGENT_DIR/agent.db"
cp ~/.omp/agent/agent.db-shm "$PI_CODING_AGENT_DIR/agent.db-shm"
cp ~/.omp/agent/agent.db-wal "$PI_CODING_AGENT_DIR/agent.db-wal"
cp ~/.omp/agent/models.db "$PI_CODING_AGENT_DIR/models.db"
cp ~/.omp/agent/models.db-shm "$PI_CODING_AGENT_DIR/models.db-shm"
cp ~/.omp/agent/models.db-wal "$PI_CODING_AGENT_DIR/models.db-wal"
```

Those files were copied only; contents were not read, printed, or summarized. An empty temp agent dir failed with `No models available`. Copying only `config.yml` + `agent.db` still failed because the live SQLite sidecars were needed for usable auth/model state in this local setup.

## Commands run and results

### Version/help checks

```bash
omp --version
# omp/16.2.13

omp --help
# confirmed -p/--print, -e/--extension, --config, --approval-mode, --no-title, --max-time
```

### Agent-dir relocation check

```bash
PI_CODING_AGENT_DIR=/var/folders/kk/k4gwllpx1cb8yl9n5t1stn8h0000gn/T/garnish-loo118-omp-3oonmywf/agent \
  PI_CONFIG_DIR=/var/folders/kk/k4gwllpx1cb8yl9n5t1stn8h0000gn/T/garnish-loo118-omp-3oonmywf/config-root \
  omp config path
# /var/folders/kk/k4gwllpx1cb8yl9n5t1stn8h0000gn/T/garnish-loo118-omp-3oonmywf/agent
```

### Event/tool/HUD/setActiveTools run

Extension loaded from `$PI_CODING_AGENT_DIR/extensions/pi-extension-api/index.js`; no `-e` flag.

```bash
GARNISH_PI_SPIKE_RUN=11-autoload-events-tools \
PI_CODING_AGENT_DIR=/var/folders/kk/k4gwllpx1cb8yl9n5t1stn8h0000gn/T/garnish-loo118-autoload-x9jq7bdk/agent \
PI_CONFIG_DIR=/var/folders/kk/k4gwllpx1cb8yl9n5t1stn8h0000gn/T/garnish-loo118-autoload-x9jq7bdk/config-root \
OMP_AUTH_BROKER_SNAPSHOT_CACHE=/var/folders/kk/k4gwllpx1cb8yl9n5t1stn8h0000gn/T/garnish-loo118-autoload-x9jq7bdk/auth-broker-snapshot.enc \
omp -p --no-title --max-time 120 \
  "Use the read tool to read /Users/dylanmccavitt/projects/garnish-loo-118/spikes/pi-extension-api/fixture.txt, then call the garnish_spike_echo tool with text autoload, then answer with a one-line summary of both results."
# Read fixture: “Garnish Pi extension API spike fixture.”; echo result: `garnish_spike_echo:autoload`.
```

### Reload run

```bash
GARNISH_PI_SPIKE_RUN=12-autoload-reload-command \
PI_CODING_AGENT_DIR=/var/folders/kk/k4gwllpx1cb8yl9n5t1stn8h0000gn/T/garnish-loo118-autoload-x9jq7bdk/agent \
PI_CONFIG_DIR=/var/folders/kk/k4gwllpx1cb8yl9n5t1stn8h0000gn/T/garnish-loo118-autoload-x9jq7bdk/config-root \
OMP_AUTH_BROKER_SNAPSHOT_CACHE=/var/folders/kk/k4gwllpx1cb8yl9n5t1stn8h0000gn/T/garnish-loo118-autoload-x9jq7bdk/auth-broker-snapshot.enc \
omp -p --no-title --max-time 60 "/garnish-spike-reload autoload-reload"
# (no output); command handler ran and ctx.reload() returned.
```

### Approval-deny by config run

```bash
GARNISH_PI_SPIKE_RUN=13-autoload-approval-deny-config \
PI_CODING_AGENT_DIR=/var/folders/kk/k4gwllpx1cb8yl9n5t1stn8h0000gn/T/garnish-loo118-autoload-x9jq7bdk/agent \
PI_CONFIG_DIR=/var/folders/kk/k4gwllpx1cb8yl9n5t1stn8h0000gn/T/garnish-loo118-autoload-x9jq7bdk/config-root \
OMP_AUTH_BROKER_SNAPSHOT_CACHE=/var/folders/kk/k4gwllpx1cb8yl9n5t1stn8h0000gn/T/garnish-loo118-autoload-x9jq7bdk/auth-broker-snapshot.enc \
omp -p --no-title --max-time 90 \
  --config /Users/dylanmccavitt/projects/garnish-loo-118/spikes/pi-extension-api/approval-deny.config.yml \
  "Use the bash tool to run pwd, then tell me whether it succeeded or was denied."
# Denied. The `bash` tool did not run `pwd`; it was blocked by user policy.
```

### Approval-deny by headless `always-ask` run

```bash
GARNISH_PI_SPIKE_RUN=14-autoload-approval-always-ask \
PI_CODING_AGENT_DIR=/var/folders/kk/k4gwllpx1cb8yl9n5t1stn8h0000gn/T/garnish-loo118-autoload-x9jq7bdk/agent \
PI_CONFIG_DIR=/var/folders/kk/k4gwllpx1cb8yl9n5t1stn8h0000gn/T/garnish-loo118-autoload-x9jq7bdk/config-root \
OMP_AUTH_BROKER_SNAPSHOT_CACHE=/var/folders/kk/k4gwllpx1cb8yl9n5t1stn8h0000gn/T/garnish-loo118-autoload-x9jq7bdk/auth-broker-snapshot.enc \
omp -p --no-title --max-time 60 --approval-mode always-ask \
  "Use the bash tool to run pwd, then tell me whether it succeeded or was denied."
# Denied. The `bash` tool did not run `pwd`; it returned an approval-required error with no interactive UI available.
```

### Isolation probes

Primary targeted session/config isolation evidence:

```bash
HOME=/var/folders/kk/k4gwllpx1cb8yl9n5t1stn8h0000gn/T/garnish-loo118-target-isolation-hdh9oyh8/home \
PI_CODING_AGENT_DIR=/var/folders/kk/k4gwllpx1cb8yl9n5t1stn8h0000gn/T/garnish-loo118-target-isolation-hdh9oyh8/agent \
OMP_AUTH_BROKER_SNAPSHOT_CACHE=/var/folders/kk/k4gwllpx1cb8yl9n5t1stn8h0000gn/T/garnish-loo118-target-isolation-hdh9oyh8/auth-broker-snapshot.enc \
GARNISH_PI_SPIKE_RUN=18-target-isolation-probe \
omp -p --no-title --max-time 60 "Say exactly TARGET_ISOLATION_PROBE."
# TARGET_ISOLATION_PROBE
```

`captures/18-target-isolation-report.json` records `targeted_real_changed_count: 0`; the real `~/.omp/agent/config.yml`, real `~/.omp/agent/extensions`, and the real session slug for the temp cwd were unchanged/nonexistent before and after.

A broader full-tree probe without changing `HOME` is in `captures/16-autoload-isolation-report.json`. It found OMP wrote `~/.omp/logs/omp.2026-07-01.log` even with `PI_CONFIG_DIR` and `PI_CODING_AGENT_DIR` set to temp paths. That matches `omp://skills/authoring-extensions.md`, which says OMP writes structured logs under `~/.omp/logs/`.

## Observed events

All required events were observed against real `omp -p` runs:

| Event | Evidence |
|---|---|
| `session_start` | `captures/11-autoload-events-tools.jsonl:2` |
| `tool_call` | `captures/11-autoload-events-tools.jsonl:7` (`read`) and `:10` (`garnish_spike_echo`) |
| `tool_result` | `captures/11-autoload-events-tools.jsonl:8` (`read`) and `:12` (`garnish_spike_echo`) |
| `context` | `captures/11-autoload-events-tools.jsonl:6`, `:9`, `:13` |
| `agent_end` | `captures/11-autoload-events-tools.jsonl:14` |
| `tool_approval_requested` | `captures/14-autoload-approval-always-ask.jsonl:7` |
| `tool_approval_resolved` | `captures/14-autoload-approval-always-ask.jsonl:8` |

Sample excerpts, shortened to the contract-relevant fields:

```jsonl
{"kind":"event","eventName":"session_start","event":{"type":"session_start"},"ctx":{"hasUI":false,"branchLength":2}}
{"kind":"event","eventName":"context","event":{"type":"context","messages":[...]}}
{"kind":"event","eventName":"tool_call","event":{"type":"tool_call","toolName":"read","input":{"path":"/Users/dylanmccavitt/projects/garnish-loo-118/spikes/pi-extension-api/fixture.txt"}}}
{"kind":"event","eventName":"tool_result","event":{"type":"tool_result","toolName":"read","isError":false}}
{"kind":"event","eventName":"tool_call","event":{"type":"tool_call","toolName":"garnish_spike_echo","input":{"text":"autoload"}}}
{"kind":"event","eventName":"tool_result","event":{"type":"tool_result","toolName":"garnish_spike_echo","content":[{"type":"text","text":"garnish_spike_echo:autoload"}],"isError":false}}
{"kind":"event","eventName":"agent_end","event":{"type":"agent_end","messages":[...]}}
```

## HUD/headless behavior

Evidence: `captures/11-autoload-events-tools.jsonl:2-3`.

Observed in `omp -p` print mode:

- `ctx.hasUI` was `false`.
- `ctx.ui.setStatus("garnish-spike", ...)` returned without throwing.
- `ctx.ui.notify(...)` returned without throwing.
- `ctx.ui.setWidget("garnish-spike", { placement: "aboveEditor", lines: [...] })` returned without throwing.
- No HUD output appeared in stdout, as expected for headless/print mode.

Conclusion: HUD calls are safe in print/headless mode, but they are no-op/default-returning there. This confirms the ARD §2.1 headless-degrade assumption for the three HUD APIs exercised. Interactive rendering was not exercised by this spike.

## `setActiveTools` behavior

Evidence: `captures/11-autoload-events-tools.jsonl:5`, `:10-12`.

The extension registered a `defaultInactive: true` tool named `garnish_spike_echo`. On `session_start`, it called:

1. `pi.getActiveTools()`
2. `pi.setActiveTools([...without garnish_spike_echo])`
3. `pi.getActiveTools()`
4. `pi.setActiveTools([...with garnish_spike_echo])`
5. `pi.getActiveTools()`

Observed:

- `getActiveTools()` returned an array of active tool names.
- After the active step, the list included `garnish_spike_echo`.
- The model could call `garnish_spike_echo` in the same print-mode session, and `tool_call`/`tool_result` fired for it.

Conclusion: runtime inactive-to-active tool gating works within a real session.

## `reload()` behavior

Evidence:

- `captures/12-autoload-reload-command.jsonl:6-10`
- `captures/12-autoload-reload-session-after.json`

Observed:

- A registered slash command `/garnish-spike-reload` executed in `omp -p` print mode.
- The command handler called HUD APIs, appended `garnish-pi-spike-reload-marker`, then called `ctx.reload()`.
- `ctx.reload()` returned to the command handler (`reload_returned` was logged).
- No second `session_start` event was logged in that process.
- The persisted session file after reload contained only `title` and `session` records; no `custom` entries survived (`containsSpikeCustomEntries: false`).

Conclusion: `ctx.reload()` is callable from an extension command in print mode, but a command-only print-mode reload did **not** preserve custom session entries appended immediately before reload. For Garnish, do not rely on `appendEntry()` immediately before `reload()` as the only durable state write in headless command flows; write Garnish state to its own file before reload and rebuild from durable state on the next `session_start`.

## Isolation result

Evidence:

- `captures/18-target-isolation-report.json`
- `captures/16-autoload-isolation-report.json`
- `omp://settings.md` and `omp://environment-variables.md` for `PI_CODING_AGENT_DIR`
- `omp://skills/authoring-extensions.md` for OMP logs under `~/.omp/logs/`

Findings:

1. `PI_CODING_AGENT_DIR` does relocate OMP's agent dir. `omp config path` printed the temp agent dir.
2. In the targeted isolation run, real `~/.omp/agent/config.yml`, real `~/.omp/agent/extensions`, and the real `~/.omp/agent/sessions/<temp-cwd-slug>` location were unchanged/nonexistent before and after. The new session file appeared under the temp agent dir.
3. A full-tree `~/.omp` untouched claim is **false** for stock OMP because OMP writes structured logs to `~/.omp/logs/omp.<date>.log`. The broad probe observed that log mtime/size changed during a temp-agent run.
4. Therefore, the adapter contract should be worded narrowly: `PI_CODING_AGENT_DIR` isolates sessions/config/auth stores, but not all global OMP state unless OMP gains a log-dir override or Garnish launches with an isolated `HOME`/environment.

## Approval-denied answer

Docs discovery:

- `omp://extensions.md` documents `tool_approval_requested` and `tool_approval_resolved`.
- No `approval_denied` event is documented.

Empirical results:

1. With `--approval-mode always-ask` in headless print mode, OMP emitted:

```jsonl
{"kind":"event","eventName":"tool_approval_requested","event":{"toolName":"bash","approvalMode":"always-ask"}}
{"kind":"event","eventName":"tool_approval_resolved","event":{"toolName":"bash","approved":false,"reason":"no interactive UI available"}}
```

Evidence: `captures/14-autoload-approval-always-ask.jsonl:7-8`.

2. With `tools.approval.bash: deny` in a config overlay, no `tool_approval_requested`, no `tool_approval_resolved`, no `tool_call`, and no `tool_result` were observed for the blocked `bash` call. The model received a blocked-tool result and the extension saw only later `context`/`agent_end` events. Evidence: `captures/13-autoload-approval-deny-config.jsonl:6-8`.

Answer:

- There is no `approval_denied` event.
- Approval prompt denial is observable as `tool_approval_resolved` with `approved: false` when the approval flow is entered.
- A static user-policy deny (`tools.approval.<tool>: deny`) did not enter the approval event flow in this run.
- For Garnish checks, use `event(tool_approval_resolved where approved == false)` for real approval-flow denials; for policy-deny or cases where no approval event appears, degrade to `confirm` or a config probe.

Interactive user-click denial was not exercised because this spike was constrained to headless/non-interactive runs.

## Risks and adapter notes

- **Log isolation risk:** OMP's structured logs write under `~/.omp/logs/` even when sessions/config/auth use a temp agent dir. Garnish should either accept this as non-session state, launch with isolated `HOME`, or request/use an OMP log-dir override if one becomes available.
- **Reload durability risk:** `appendEntry()` immediately before `ctx.reload()` did not survive the command-only print-mode reload probe. Garnish should persist progression state outside the session before reload.
- **Approval semantics split:** `tool_approval_resolved.approved=false` covers approval-flow denial; `tools.approval.<tool>: deny` is not the same event surface.
- **Headless HUD:** safe no-op behavior is confirmed, but interactive widget placement/rendering was not tested here.
- **Auth copying:** this local setup needed SQLite DB sidecars (`-wal`, `-shm`) in addition to the main DB files. Reproduction scripts should copy the trio atomically or use a clean auth flow.
- **Event payload size:** `context` and `agent_end` payloads can be large. The spike extension redacts secret-looking keys and truncates nested payloads before writing JSONL.

## Adapter-contract assumptions table for `docs/ard.md` §2

| ARD §2 assumption | Status | Evidence / correction |
|---|---:|---|
| Extensions are TS/JS modules exporting a default factory `(pi) => void`. | confirmed | `spikes/pi-extension-api/index.js`; factory loaded in `captures/11-autoload-events-tools.jsonl:1`. |
| User extension directory under active agent dir loads modules. | confirmed | Extension copied to `$PI_CODING_AGENT_DIR/extensions/pi-extension-api/index.js`; primary runs used no `-e`; factory loaded. |
| Settings `extensions:` array loads modules. | unknown | Documented in `omp://extension-loading.md`; not exercised because this spike used the temp agent extension dir. |
| Project `<cwd>/.omp/extensions` loads modules. | unknown | Documented in `omp://extension-loading.md`; not exercised. |
| Extensions are in-process/not sandboxed. | confirmed | Extension used Node `fs`/`path` to write JSONL directly from event handlers; docs also state unsandboxed. |
| `session_start` event fires. | confirmed | `captures/11-autoload-events-tools.jsonl:2`. |
| `agent_end` event fires. | confirmed | `captures/11-autoload-events-tools.jsonl:14`. |
| `session_shutdown`, `agent_start`, `turn_start`, `turn_end` lifecycle events are available. | unknown | Documented in `omp://extensions.md`; not subscribed/exercised in this spike. |
| `tool_call` fires before tool execution. | confirmed | `read` and `garnish_spike_echo` `tool_call` records precede their `tool_result` records in `captures/11-autoload-events-tools.jsonl:7-12`. Blocking from `tool_call` was not exercised. |
| `tool_result` fires after tool execution. | confirmed | `captures/11-autoload-events-tools.jsonl:8` and `:12`. Patching tool results was not exercised. |
| `context` event fires per provider request. | confirmed | `captures/11-autoload-events-tools.jsonl:6`, `:9`, `:13`; mutation/replacement behavior not exercised. |
| `before_agent_start`, `sendMessage`, `sendUserMessage` support message injection. | unknown | Documented in `omp://extensions.md`; not exercised. |
| `getActiveTools` / `setActiveTools` can live-unlock tools. | confirmed | `captures/11-autoload-events-tools.jsonl:5`, then model called `garnish_spike_echo` at `:10-12`. |
| `registerCommand` can add slash commands. | confirmed | `/garnish-spike-reload` ran under `omp -p`; `captures/12-autoload-reload-command.jsonl:6-10`. |
| `ctx.ui.setWidget`, `setStatus`, `notify` are safe headless no-ops. | confirmed | `ctx.hasUI:false`, all three calls `ok:true` in `captures/11-autoload-events-tools.jsonl:2-3`. |
| Interactive HUD rendering works. | unknown | Not exercised; only headless print mode was tested. |
| Dialog APIs (`confirm`, `select`, `input`) are available for HITL checks. | unknown | Documented in `omp://extensions.md`/`omp://hooks.md`; not exercised. |
| `appendEntry(customType, data)` persists extension state and can be rebuilt via `ctx.sessionManager.getBranch()`. | confirmed | Normal session-start append was visible in later branch summaries (`captures/11-autoload-events-tools.jsonl:6`). Caveat: append immediately before `reload()` did not survive the command-only print-mode reload (`captures/12-autoload-reload-session-after.json`). |
| `reload()` is available from command context. | confirmed | Called from `/garnish-spike-reload`; `reload_returned` in `captures/12-autoload-reload-command.jsonl:10`. |
| `reload()` preserves session/context state in headless command-only flow. | false | Persisted reload session contained only `title` and `session`, no spike custom entries: `captures/12-autoload-reload-session-after.json`. |
| `PI_CODING_AGENT_DIR` relocates agent dir/session/config/auth store. | confirmed | `omp config path` printed temp agent dir; `captures/18-target-isolation-report.json` shows temp session/config writes. |
| `PI_CODING_AGENT_DIR` alone leaves all normal `~/.omp` state untouched. | false | Broad probe observed `~/.omp/logs/omp.2026-07-01.log` mtime/size changed; `omp://skills/authoring-extensions.md` documents logs under `~/.omp/logs/`. Sessions/config were isolated. |
| Settings live at global `config.yml` and project `.omp/config.yml`; arrays replace wholesale. | confirmed | Read `omp://settings.md`; evidence is doc-grounded only because this spike did not mutate project config arrays. |
| Built-in tool gates via per-tool toggles plus runtime `setActiveTools`. | confirmed | Runtime `setActiveTools` confirmed; persisted per-tool toggles beyond approval were not exercised. |
| `tools.approvalMode` controls approval prompts. | confirmed | `--approval-mode always-ask` emitted approval events and denied headless due no UI: `captures/14-autoload-approval-always-ask.jsonl:7-8`. |
| Static `tools.approval.<tool>: deny` is observable as approval event. | false | Config-deny run showed no approval events for denied `bash`: `captures/13-autoload-approval-deny-config.jsonl:6-8`. |
| Approval denial event is named `approval_denied`. | false | Not documented and not observed; actual approval-flow denial surfaced as `tool_approval_resolved` with `approved:false`. |
| Skills allowlists and custom directories require reload because prompt is baked at session start. | unknown | Read `omp://skills.md`/`omp://settings.md`; not exercised. |
| MCP config paths and `/mcp reload` behavior. | unknown | Read `omp://mcp-config.md`; not exercised. |
| `disabledExtensions` controls extension/plugin disabling. | unknown | Read `omp://extension-loading.md`/`omp://settings.md`; not exercised. |
| `disabledProviders` gates context discovery/model providers. | unknown | Read `omp://settings.md`; not exercised. |
| `APPEND_SYSTEM.md` appends while preserving defaults. | unknown | Read `omp://system-prompt-customization.md`; not exercised. |
| `SYSTEM.md` replaces default stable instructions. | unknown | Read `omp://system-prompt-customization.md`; not exercised. |
| Dynamic active quest content can ride the `context` event. | unknown | `context` event firing is confirmed above; actual content injection/replacement was not exercised. |

## Bottom line for Garnish

The core extension adapter path is viable for v1: events, headless-safe HUD calls, runtime tool unlocks, slash command registration, and approval-flow denial events all work against OMP 16.2.13. Two ARD assumptions need tightening before implementation:

1. Treat `PI_CODING_AGENT_DIR` as session/config/auth isolation, not full `~/.omp` isolation, because OMP logs still target `~/.omp/logs/` unless the launch environment isolates `HOME`.
2. Treat `reload()` as a terminal/reset boundary; persist Garnish state outside the session before calling it, and rebuild on the next `session_start`.
