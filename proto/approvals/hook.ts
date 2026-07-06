import type {
  ApprovalDecision,
  ApprovalPrompter,
  EventSink,
  GateCatalogEntry,
  GateEngine,
  LoopHooks,
  RiskTier,
  ToolCall,
  ToolContext,
  ToolResult,
} from "../harness/types";
import { tierPolicyFor, type PrototypeGateCatalogEntry } from "../gates/catalog";
import { classifyCommand } from "./classify";
import type { RulesEngine } from "./rules";

export function createApprovalHook(opts: {
  sink: EventSink;
  prompter: ApprovalPrompter;
  gates: GateEngine;
  rules: RulesEngine;
  tier: () => number;
  catalog: GateCatalogEntry[];
}): NonNullable<LoopHooks["beforeToolCall"]> {
  const doom = createDoomLoopTracker();

  return async (call: ToolCall, ctx: ToolContext): Promise<ToolResult | null> => {
    if (!opts.gates.isUnlocked(call.name)) {
      const view = opts.gates.views([]).find((item) => item.tool === call.name);
      const teaching = doom.teach(call.name, call.input, view?.teaching ?? `${call.name} is locked. Use currently unlocked tools and finish the visible quest first.`);
      opts.sink.emit({ type: "tool.blocked", callId: call.callId, tool: call.name, reason: "locked", teaching });
      return blocked(teaching);
    }

    if (call.name !== "bash") return null;

    const command = commandFromInput(call.input);
    const risk = classifyCommand(command);
    const rule = opts.rules.evaluate(command);

    if (rule.outcome === "deny") {
      const teaching = doom.teach(call.name, call.input, `Denied ${command}: ${risk.explanation}. Rule ${rule.matchedRule ?? "deny"} blocked it.`);
      opts.sink.emit({ type: "tool.blocked", callId: call.callId, tool: call.name, reason: "denied", teaching });
      return blocked(teaching);
    }

    if (rule.outcome === "allow" && rule.matchedRule?.startsWith("session:")) {
      opts.sink.emit({ type: "tool.approval.resolved", callId: call.callId, approved: true, mode: "auto", pattern: rule.matchedRule.slice("session:".length) });
      return null;
    }

    const policy = policyFor(opts.catalog, opts.gates, opts.tier(), risk.tier);
    if (policy === "deny") {
      const teaching = doom.teach(call.name, call.input, `Denied ${command}: ${risk.explanation}. This tier denies ${risk.tier} commands.`);
      opts.sink.emit({ type: "tool.blocked", callId: call.callId, tool: call.name, reason: "denied", teaching });
      return blocked(teaching);
    }

    if (policy === "allow") {
      opts.sink.emit({ type: "tool.approval.resolved", callId: call.callId, approved: true, mode: "auto" });
      return null;
    }

    const request = {
      callId: call.callId,
      tool: call.name,
      command,
      risk: risk.tier,
      explanation: risk.explanation,
      suggestedPattern: opts.rules.suggestPattern(command),
    };
    opts.sink.emit({
      type: "tool.approval.requested",
      callId: call.callId,
      tool: call.name,
      command,
      risk: risk.tier,
      explanation: risk.explanation,
    });
    const decision = await opts.prompter(request);
    opts.sink.emit(resolvedEvent(call.callId, decision));

    if (decision.approved) {
      if (decision.mode === "pattern") opts.rules.addSessionAllow(decision.pattern ?? request.suggestedPattern);
      return null;
    }

    const why = decision.mode === "deny-with-reason" && decision.reason ? decision.reason : "The player denied this command.";
    const teaching = doom.teach(call.name, call.input, `Denied ${command}: ${why}`);
    opts.sink.emit({ type: "tool.blocked", callId: call.callId, tool: call.name, reason: "denied", teaching });
    return blocked(teaching);
  };
}

function policyFor(catalog: GateCatalogEntry[], gates: GateEngine, level: number, tier: RiskTier) {
  const bash = catalog.find((entry) => entry.tool === "bash") as PrototypeGateCatalogEntry | undefined;
  const dangerZone = Boolean((gates as GateEngine & { hasUnlock?: (unlockId: string) => boolean }).hasUnlock?.("danger-zone"));
  return (bash?.tierPolicies?.[level] ?? tierPolicyFor(level, dangerZone))[tier] === "deny" && dangerZone && tier === "critical"
    ? "ask"
    : (bash?.tierPolicies?.[level] ?? tierPolicyFor(level, dangerZone))[tier];
}

function commandFromInput(input: unknown): string {
  if (typeof input === "string") return input;
  if (typeof input === "object" && input !== null) {
    const record = input as Record<string, unknown>;
    if (typeof record.command === "string") return record.command;
    if (typeof record.cmd === "string") return record.cmd;
  }
  return JSON.stringify(input);
}

function resolvedEvent(callId: string, decision: ApprovalDecision) {
  return {
    type: "tool.approval.resolved" as const,
    callId,
    approved: decision.approved,
    mode: decision.mode,
    reason: decision.reason,
    pattern: decision.pattern,
  };
}

function blocked(output: string): ToolResult {
  return { output, isError: true };
}

function createDoomLoopTracker() {
  let lastKey = "";
  let count = 0;
  return {
    teach(tool: string, input: unknown, teaching: string) {
      const key = `${tool}:${stable(input)}`;
      if (key === lastKey) count += 1;
      else lastKey = key, count = 1;
      return count >= 3 ? `Stuck: the same call was blocked 3× — try a different approach or ask the player. ${teaching}` : teaching;
    },
  };
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`;
}
