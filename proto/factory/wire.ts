import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createRulesEngine } from "../approvals";
import { classifyCommand } from "../approvals/classify";
import { createGateEngine } from "../gates";
import { createEventSink } from "../harness";
import { createHarness } from "../harness/loop";
import type { ApprovalDecision, ApprovalRequest, EventSink, GateCatalogEntry, RiskTier, ToolCall, ToolContext, ToolResult } from "../harness/types";
import { sandboxAvailability } from "../sandbox";
import { createCoreTools, scaffoldWorkspace } from "../tools";
import { createFactoryEngine } from "./engine";
import { createHandActions } from "./hand";
import { GREETER_BUG_FAMILY } from "./ore";
import { circuitAllows, createCircuit, type Circuit } from "./policy";
import { forgeSkillArtifact, skillBrief } from "./skills";
import { evaluateChecks, startShipVerifier } from "./verify";
import type { FactoryState, FactoryWireOptions, MachineState, TaskItem, WiredFactory } from "./types";
import { FACTORY_RESEARCH_TRACK, FACTORY_VARIANT_PLAN } from "./types";

type FactoryWireOptionsWithWorld = FactoryWireOptions & { worldName?: string };
const BARE_AGENT_UNLOCK = "machine-bare-agent";
const gateTierPolicy: Record<RiskTier, "ask"> = {
  safe: "ask",
  moderate: "ask",
  risky: "ask",
  critical: "ask",
};

const factoryGateCatalog: Array<GateCatalogEntry & { teaching: string }> = [
  { tool: "read", unlockId: BARE_AGENT_UNLOCK, tierPolicy: gateTierPolicy, teaching: "Read is locked: research + build the bare agent first." },
  { tool: "write", unlockId: BARE_AGENT_UNLOCK, tierPolicy: gateTierPolicy, teaching: "Write is locked: research + build the bare agent first." },
  { tool: "edit", unlockId: BARE_AGENT_UNLOCK, tierPolicy: gateTierPolicy, teaching: "Edit is locked: research + build the bare agent first." },
  { tool: "bash", unlockId: BARE_AGENT_UNLOCK, tierPolicy: gateTierPolicy, teaching: "Bash is locked: research + build the bare agent first." },
];

export async function wireFactory(opts: FactoryWireOptionsWithWorld): Promise<WiredFactory> {
  const { workspace, sessionTemp } = scaffoldWorkspace(opts.root ? { root: opts.root } : {});
  const root = join(workspace, "..");
  const sessionId = crypto.randomUUID();
  const sessionLogPath = join(root, ".garnish-proto", "sessions", `${sessionId}.jsonl`);
  const sink = createEventSink({ sessionId, logPath: sessionLogPath });
  const sandbox = sandboxAvailability();
  const tools = createCoreTools({ workspace, sessionTemp, sandbox: sandbox.mode });
  const gates = createGateEngine({ catalog: factoryGateCatalog, unlocked: new Set() });
  const circuit = createCircuit({ workspace, sink });
  const engine = createFactoryEngine({
    sink,
    workspace,
    family: GREETER_BUG_FAMILY,
    variantPlan: FACTORY_VARIANT_PLAN,
    research: FACTORY_RESEARCH_TRACK,
  });

  let harnessBusy = false;
  let kickInFlight = false;
  let stopped = false;
  let latestSkillContent: string | null = null;
  let bareAgentUnlocked = false;

  const beforeToolCall = createFactoryApprovalHook({ sink, gates, circuit, prompter: opts.prompter });
  const system = [
    "You are the Garnish factory agent. Fix only the current greeter ore item under src/ore.",
    "When the routing belt sends a BELT brief, work that item directly. Prefer the provided skill recipe and policy circuit.",
  ].join("\n");

  const harness = createHarness({
    sessionId,
    workspace,
    sessionTemp,
    system,
    streamFn: opts.streamFn,
    tools,
    hooks: {
      toolFilter: (all) => gates.toolFilter(all),
      beforeToolCall,
    },
    sink,
    model: opts.model,
    provider: opts.provider,
  });

  const originalSend = harness.send.bind(harness);
  harness.send = async (text, source = "player") => {
    harnessBusy = true;
    try {
      await originalSend(text, source);
    } finally {
      harnessBusy = false;
      queueMicrotask(() => {
        if (!stopped) void beltKick();
      });
    }
  };

  const hand = createHandActions({ workspace, sink, engine, harnessSend: (text) => harness.send(text) });
  const verifier = startShipVerifier({ sink, engine, workspace, evaluateChecks });
  const worldName = opts.worldName ?? "factory";
  const unsubscribeWorldSummary = sink.bus.subscribe((event) => {
    if (event.type !== "item.shipped" && event.type !== "machine.built" && event.type !== "session.end") return;
    writeWorldSummary({ root, name: worldName, state: engine.state() });
  });

  const unsubscribeAutomation = sink.bus.subscribe((event) => {
    if (event.type === "machine.built" && event.kind === "bare-agent" && !bareAgentUnlocked) {
      bareAgentUnlocked = true;
      gates.applyUnlock(BARE_AGENT_UNLOCK);
      sink.emit({ type: "unlock.applied", unlockId: BARE_AGENT_UNLOCK, tools: ["read", "write", "edit", "bash"] });
    }

    // Unpowered belt does ONE pull when built (or when explicitly kicked);
    // continuous item-to-item chaining needs an active powered shift.
    const shouldKick = (event.type === "item.shipped" && engine.state().power.shiftActive)
      || (event.type === "machine.built" && event.kind === "routing-belt")
      || (event.type === "touch.recorded" && event.kind === "power");
    if (shouldKick && !harnessBusy && !stopped) {
      queueMicrotask(() => {
        if (!stopped) void beltKick();
      });
    }
  });

  sink.emit({ type: "session.start", workspace, provider: opts.provider, model: opts.model });
  await engine.enqueue(1);

  async function beltKick(): Promise<void> {
    if (kickInFlight || harnessBusy || stopped) return;
    const state = engine.state();
    const nextItem = state.items.find((item) => item.status === "queued") ?? null;
    if (!engine.hasMachine("routing-belt") || state.currentItemId !== null || nextItem === null) return;
    if (state.power.shiftActive && !engine.drawPower()) return;

    const brief = beltBrief(nextItem);
    const item = engine.startNext("agent");
    if (item === null) return;

    kickInFlight = true;
    try {
      await harness.send(brief, "steering");
    } finally {
      kickInFlight = false;
    }
  }

  function beltBrief(item: TaskItem): string {
    const recipe = engine.hasMachine("skill") ? skillBrief(currentSkillContent()) : "";
    return `BELT: ${item.id} — ${item.title}. ${item.brief}${recipe}`;
  }

  function currentSkillContent(): string {
    if (latestSkillContent !== null) return latestSkillContent;
    const skillMachine = engine.state().machines.find((machine) => machine.kind === "skill" && machine.artifact !== undefined);
    if (skillMachine?.artifact === undefined) return "";
    const artifactPath = join(workspace, skillMachine.artifact);
    if (!existsSync(artifactPath)) return "";
    latestSkillContent = readFileSync(artifactPath, "utf8");
    return latestSkillContent;
  }

  return {
    harness,
    sink,
    engine,
    hand,
    verifier,
    workspace,
    root,
    sessionLogPath,
    beltKick,
    async forgeSkill(name: string): Promise<MachineState> {
      const artifact = forgeSkillArtifact({ workspace, name, family: GREETER_BUG_FAMILY });
      latestSkillContent = artifact.content;
      return engine.buildMachine("skill", { name, label: `Skill: ${name}`, artifact: artifact.path });
    },
    async wireCircuit(patterns: string[]): Promise<MachineState> {
      for (const pattern of patterns) circuit.append(pattern);
      return engine.buildMachine("policy-circuit", { name: "circuit", label: "Policy Circuit", artifact: ".garnish/policies/circuit.txt" });
    },
    stop() {
      if (stopped) return;
      stopped = true;
      unsubscribeAutomation();
      engine.stop();
      verifier.stop();
      sink.emit({ type: "session.end" });
      unsubscribeWorldSummary();
    },
  };
}

function writeWorldSummary(opts: { root: string; name: string; state: FactoryState }): void {
  const shipped = opts.state.shippedCount;
  const summary = {
    name: opts.name,
    shipped,
    science: { red: shipped },
    machines: opts.state.machines.map((machine) => machine.label),
    updatedAt: new Date().toISOString(),
  };
  mkdirSync(opts.root, { recursive: true });
  writeFileSync(join(opts.root, "world.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
}

function createFactoryApprovalHook(opts: {
  sink: EventSink;
  gates: { isUnlocked(tool: string): boolean };
  circuit: Circuit;
  prompter: (req: ApprovalRequest) => Promise<ApprovalDecision>;
}) {
  return async (call: ToolCall, _ctx: ToolContext): Promise<ToolResult | null> => {
    if (!opts.gates.isUnlocked(call.name)) {
      const teaching = "Tool locked: research + build the bare agent first.";
      opts.sink.emit({ type: "tool.blocked", callId: call.callId, tool: call.name, reason: "locked", teaching });
      return { isError: true, output: teaching };
    }

    const rule = opts.circuit.ruleString(call);
    if (circuitAllows(opts.circuit.patterns(), rule)) {
      const matched = opts.circuit.patterns().find((pattern) => createRulesEngine({ sessionAllows: [pattern] }).evaluate(rule).outcome === "allow");
      opts.sink.emit({ type: "tool.approval.resolved", callId: call.callId, approved: true, mode: "auto", pattern: matched });
      return null;
    }

    const request = approvalRequest(call, rule);
    opts.sink.emit({
      type: "tool.approval.requested",
      callId: call.callId,
      tool: call.name,
      command: request.command,
      risk: request.risk,
      explanation: request.explanation,
    });
    const decision = await opts.prompter(request);
    opts.sink.emit({
      type: "tool.approval.resolved",
      callId: call.callId,
      approved: decision.approved,
      mode: decision.mode,
      reason: decision.reason,
      pattern: decision.pattern,
    });

    if (decision.approved) {
      if (decision.mode === "pattern") opts.circuit.append(decision.pattern ?? request.suggestedPattern ?? suggestedPattern(rule));
      return null;
    }

    const teaching = decision.reason ?? "The player denied this tool call.";
    opts.sink.emit({ type: "tool.blocked", callId: call.callId, tool: call.name, reason: "denied", teaching });
    return { isError: true, output: teaching };
  };
}

function approvalRequest(call: ToolCall, rule: string): ApprovalRequest {
  if (call.name === "bash") {
    const cmd = fieldString(call.input, "cmd");
    const risk = classifyCommand(cmd);
    return { callId: call.callId, tool: call.name, command: rule, risk: risk.tier, explanation: risk.explanation, suggestedPattern: suggestedPattern(rule) };
  }
  const risk: RiskTier = call.name === "read" ? "safe" : "moderate";
  const explanation = call.name === "read" ? "Read-only workspace inspection." : "This tool can change workspace files.";
  return { callId: call.callId, tool: call.name, command: rule, risk, explanation, suggestedPattern: suggestedPattern(rule) };
}

function suggestedPattern(rule: string): string {
  const parts = rule.split(/\s+/).filter(Boolean);
  if (parts[0] === "bash" && parts[1] !== undefined) return `bash ${parts[1]} *`;
  if ((parts[0] === "read" || parts[0] === "write" || parts[0] === "edit") && parts[1] !== undefined) {
    const slash = parts[1].lastIndexOf("/");
    return slash < 0 ? `${parts[0]} *` : `${parts[0]} ${parts[1].slice(0, slash + 1)}*`;
  }
  return `${parts[0] ?? rule} *`;
}

function fieldString(input: unknown, key: string): string {
  if (input === null || typeof input !== "object" || !(key in input)) return "";
  const value = Reflect.get(input, key);
  return typeof value === "string" ? value : String(value ?? "");
}
