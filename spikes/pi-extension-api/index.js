import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const captureDir = process.env.GARNISH_PI_SPIKE_LOG_DIR || path.join(moduleDir, "captures");
const runLabel = sanitizeFilePart(process.env.GARNISH_PI_SPIKE_RUN || new Date().toISOString());
const logPath = path.join(captureDir, `${runLabel}.jsonl`);
const moduleState = {
  bootId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
  factoryCalls: 0,
  sessionStarts: 0,
  contextEvents: 0,
  activeToolExerciseCount: 0,
  hudExerciseCount: 0,
  reloadRequested: false,
};

function sanitizeFilePart(value) {
  return String(value || "run").replace(/[^A-Za-z0-9_.-]+/g, "-").slice(0, 120) || "run";
}

function isSecretKey(key) {
  return /token|secret|api[-_]?key|authorization|password|credential|cookie/i.test(String(key));
}

function safeJson(value, depth = 0, seen = new WeakSet()) {
  if (value == null) return value;
  if (typeof value === "string") return value.length > 1200 ? `${value.slice(0, 1200)}…[truncated:${value.length}]` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack?.split("\n").slice(0, 4).join("\n") };
  if (depth >= 5) return `[MaxDepth ${Object.prototype.toString.call(value)}]`;
  if (typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    if (Array.isArray(value)) return value.slice(0, 30).map((item) => safeJson(item, depth + 1, seen));
    if (value instanceof Set) return { type: "Set", values: Array.from(value).slice(0, 60).map((item) => safeJson(item, depth + 1, seen)) };
    if (value instanceof Map) return { type: "Map", entries: Array.from(value.entries()).slice(0, 60).map(([k, v]) => [safeJson(k, depth + 1, seen), safeJson(v, depth + 1, seen)]) };
    const output = {};
    for (const [key, nested] of Object.entries(value).slice(0, 80)) {
      output[key] = isSecretKey(key) ? "[REDACTED_BY_SPIKE]" : safeJson(nested, depth + 1, seen);
    }
    return output;
  }
  return String(value);
}

function appendRecord(record) {
  fs.mkdirSync(captureDir, { recursive: true });
  fs.appendFileSync(logPath, `${JSON.stringify({ ts: new Date().toISOString(), ...safeJson(record) })}\n`);
}

function summarizeContext(ctx) {
  if (!ctx) return undefined;
  let branchLength;
  let spikeEntries = [];
  try {
    const branch = ctx.sessionManager?.getBranch?.() || [];
    branchLength = branch.length;
    spikeEntries = branch
      .filter((entry) => entry?.type === "custom" && String(entry.customType || "").startsWith("garnish-pi-spike"))
      .slice(-10)
      .map((entry) => ({ customType: entry.customType, data: entry.data }));
  } catch (error) {
    spikeEntries = [{ error: safeJson(error) }];
  }
  return {
    hasUI: Boolean(ctx.hasUI),
    cwd: ctx.cwd,
    isIdle: safeCall(() => ctx.isIdle?.()),
    hasPendingMessages: safeCall(() => ctx.hasPendingMessages?.()),
    contextUsage: safeCall(() => ctx.getContextUsage?.()),
    uiMethodArities: ctx.ui
      ? {
          setWidget: ctx.ui.setWidget?.length,
          setStatus: ctx.ui.setStatus?.length,
          notify: ctx.ui.notify?.length,
          confirm: ctx.ui.confirm?.length,
        }
      : undefined,
    branchLength,
    spikeEntries,
  };
}

function safeCall(fn) {
  try {
    return safeJson(fn());
  } catch (error) {
    return { error: safeJson(error) };
  }
}

function normalizeToolNames(value) {
  if (!value) return [];
  const items = value instanceof Set ? Array.from(value) : Array.isArray(value) ? value : typeof value === "object" ? Object.values(value) : [];
  return items
    .map((item) => (typeof item === "string" ? item : item?.name || item?.id || item?.toolName))
    .filter((name) => typeof name === "string" && name.length > 0);
}

async function exerciseHud(ctx, phase) {
  moduleState.hudExerciseCount += 1;
  const results = [];
  const calls = [
    ["setStatus", () => ctx.ui?.setStatus?.("garnish-spike", `${phase}: hasUI=${Boolean(ctx.hasUI)}`)],
    ["notify", () => ctx.ui?.notify?.(`Garnish Pi spike HUD probe (${phase})`, "info")],
    ["setWidget", () =>
      ctx.ui?.setWidget?.("garnish-spike", {
        placement: "aboveEditor",
        lines: ["Garnish Pi spike", `phase=${phase}`, `hasUI=${Boolean(ctx.hasUI)}`],
      })],
  ];
  for (const [api, fn] of calls) {
    try {
      const result = await Promise.resolve(fn());
      results.push({ api, ok: true, result });
    } catch (error) {
      results.push({ api, ok: false, error });
    }
  }
  appendRecord({ kind: "hud_probe", phase, results, ctx: summarizeContext(ctx), moduleState });
}

async function exerciseActiveTools(pi, phase) {
  moduleState.activeToolExerciseCount += 1;
  const toolName = "garnish_spike_echo";
  const record = { kind: "active_tools_probe", phase, toolName, attempts: [] };
  try {
    const before = await pi.getActiveTools();
    const beforeNames = normalizeToolNames(before);
    record.before = { type: Object.prototype.toString.call(before), names: beforeNames };

    const without = beforeNames.filter((name) => name !== toolName);
    await pi.setActiveTools(without);
    const afterInactive = await pi.getActiveTools();
    const inactiveNames = normalizeToolNames(afterInactive);
    record.attempts.push({ step: "set-inactive", ok: true, names: inactiveNames });

    const withTool = Array.from(new Set([...inactiveNames, toolName]));
    await pi.setActiveTools(withTool);
    const afterActive = await pi.getActiveTools();
    record.attempts.push({ step: "set-active", ok: true, names: normalizeToolNames(afterActive) });
    record.confirmedActive = normalizeToolNames(afterActive).includes(toolName);
  } catch (error) {
    record.error = error;
  }
  appendRecord(record);
}

async function appendSpikeEntry(pi, customType, data) {
  try {
    await pi.appendEntry(customType, data);
    appendRecord({ kind: "append_entry", customType, ok: true, data });
  } catch (error) {
    appendRecord({ kind: "append_entry", customType, ok: false, error, data });
  }
}

export default function garnishPiExtensionApiSpike(pi) {
  moduleState.factoryCalls += 1;
  appendRecord({
    kind: "extension_factory_loaded",
    moduleState,
    logPath,
    pid: process.pid,
    node: process.version,
    bun: globalThis.Bun?.version,
    env: {
      PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
      GARNISH_PI_SPIKE_RUN: process.env.GARNISH_PI_SPIKE_RUN,
      GARNISH_PI_SPIKE_LOG_DIR: process.env.GARNISH_PI_SPIKE_LOG_DIR,
    },
  });

  pi.setLabel?.("Garnish Pi extension API spike");

  const { z } = pi.zod;
  pi.registerTool({
    name: "garnish_spike_echo",
    label: "Garnish Spike Echo",
    description: "Echoes text for the Garnish Pi extension API spike; intentionally activated at runtime by setActiveTools.",
    parameters: z.object({ text: z.string().default("ok").describe("Text to echo") }),
    defaultInactive: true,
    approval: "read",
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      appendRecord({ kind: "extension_tool_execute", toolCallId, params, signalAborted: Boolean(signal?.aborted), ctx: summarizeContext(ctx) });
      onUpdate?.({ content: [{ type: "text", text: "garnish_spike_echo update" }] });
      return {
        content: [{ type: "text", text: `garnish_spike_echo:${params.text}` }],
        details: { echoed: params.text, bootId: moduleState.bootId },
      };
    },
  });

  pi.registerCommand("garnish-spike-reload", {
    description: "Append a spike marker, exercise headless HUD, then call ctx.reload().",
    handler: async (args, ctx) => {
      moduleState.reloadRequested = true;
      const marker = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      appendRecord({ kind: "reload_command_start", args, marker, ctx: summarizeContext(ctx), moduleState });
      await exerciseHud(ctx, "reload-command-before");
      await appendSpikeEntry(pi, "garnish-pi-spike-reload-marker", { marker, args, bootId: moduleState.bootId, sessionStarts: moduleState.sessionStarts });
      appendRecord({ kind: "reload_calling_ctx_reload", marker });
      const result = await ctx.reload();
      appendRecord({ kind: "reload_returned", marker, result });
    },
  });

  const events = [
    "session_start",
    "tool_call",
    "tool_result",
    "context",
    "agent_end",
    "tool_approval_requested",
    "tool_approval_resolved",
  ];

  for (const eventName of events) {
    pi.on(eventName, async (event, ctx) => {
      if (eventName === "context") moduleState.contextEvents += 1;
      appendRecord({ kind: "event", eventName, event, ctx: summarizeContext(ctx), moduleState });

      if (eventName === "session_start") {
        moduleState.sessionStarts += 1;
        await exerciseHud(ctx, `session-start-${moduleState.sessionStarts}`);
        await appendSpikeEntry(pi, "garnish-pi-spike-session-start", { bootId: moduleState.bootId, sessionStarts: moduleState.sessionStarts, ctx: summarizeContext(ctx) });
        await exerciseActiveTools(pi, `session-start-${moduleState.sessionStarts}`);
      }
    });
  }
}
