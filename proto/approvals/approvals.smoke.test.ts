import { describe, expect, test } from "bun:test";

import type {
  ApprovalDecision,
  ApprovalPrompter,
  EventBus,
  EventSink,
  HarnessEvent,
  HarnessEventPayload,
  SessionLog,
  ToolContext,
} from "../harness/types";
import { defaultCatalog, createGateEngine } from "../gates";
import { classifyCommand, createApprovalHook, createRulesEngine } from "./index";

function captureSink() {
  const events: HarnessEvent[] = [];
  const sink: EventSink = {
    sessionId: "session-smoke",
    bus: {
      publish() {},
      subscribe() {
        return () => {};
      },
    } satisfies EventBus,
    log: {
      path: "memory://approvals-smoke",
      append(event) {
        events.push(event);
      },
      read() {
        return events;
      },
    } satisfies SessionLog,
    emit(payload: HarnessEventPayload, parentId: string | null = null) {
      const event: HarnessEvent = {
        id: `event-${events.length + 1}`,
        parentId,
        sessionId: this.sessionId,
        seq: events.length + 1,
        ts: events.length + 1,
        ...payload,
      };
      this.log.append(event);
      this.bus.publish(event);
      return event;
    },
  };
  return { sink, events };
}

function ctx(callId = "call-1"): ToolContext {
  return {
    sessionId: "session-smoke",
    messageId: "message-1",
    callId,
    signal: new AbortController().signal,
    workspace: "/tmp/garnish-workspace",
    sessionTemp: "/tmp/garnish-session",
  };
}


function approvalsHarness(decisions: ApprovalDecision[] = [], unlocked = ["l0-hands", "l1-shell"]) {
  const { sink, events } = captureSink();
  const requests: Parameters<ApprovalPrompter>[0][] = [];
  const catalog = defaultCatalog();
  const gates = createGateEngine({ catalog, unlocked: new Set(unlocked) });
  const rules = createRulesEngine();
  const hook = createApprovalHook({
    sink,
    prompter: async (request) => {
      requests.push(request);
      const decision = decisions.shift();
      if (!decision) throw new Error(`unexpected approval request for ${request.command}`);
      return decision;
    },
    gates,
    rules,
    tier: () => 0,
    catalog,
  });
  return { events, hook, requests };
}

describe("approval command classifier", () => {
  test("classifies safe, moderate, risky, critical, compound max risk, and shell wrappers", () => {
    const cases = [
      { command: "git status --short", tier: "safe" },
      { command: "touch notes.txt", tier: "moderate" },
      { command: "curl https://example.com", tier: "risky" },
      { command: "rm -rf /tmp/garnish-smoke", tier: "critical" },
      { command: "git status --short && curl https://example.com", tier: "risky" },
      { command: "bash -c 'git status --short'", tier: "safe" },
    ] as const;

    expect(cases.map(({ command, tier }) => [command, classifyCommand(command).tier, tier])).toEqual(
      cases.map(({ command, tier }) => [command, tier, tier]),
    );
    expect(classifyCommand("git status --short && curl https://example.com").explanation.startsWith("compound command takes highest risk")).toBe(true);
  });
});

describe("approval rules engine", () => {
  test("denies beat session allows and suggested patterns stop at command prefixes", () => {
    const rules = createRulesEngine({ sessionAllows: ["git push*"] });

    expect(rules.evaluate("git push --force origin main")).toEqual({
      outcome: "deny",
      matchedRule: "deny:force-push",
    });

    expect(rules.evaluate("bun test proto/approvals")).toEqual({ outcome: "ask", matchedRule: "default:ask" });
    expect(rules.suggestPattern("git status --short --branch")).toBe("git status*");

    rules.addSessionAllow("bun test*");
    expect(rules.evaluate("bun test proto/approvals")).toEqual({
      outcome: "allow",
      matchedRule: "session:bun test*",
    });
  });
});

describe("approval hook", () => {
  test("short-circuits locked tools with a teaching block event", async () => {
    const { events, hook, requests } = approvalsHarness([], []);

    const result = await hook(
      { callId: "write-1", name: "write", input: { path: "notes.txt", content: "hi" } },
      ctx("write-1"),
    );

    expect(requests).toEqual([]);
    expect(result).toEqual({
      isError: true,
      output: "Complete the L0 unlock to write new files.",
    });
    expect(events.map(({ type }) => type)).toEqual(["tool.blocked"]);
    expect(events[0]).toEqual(expect.objectContaining({
      type: "tool.blocked",
      callId: "write-1",
      tool: "write",
      reason: "locked",
      teaching: "Complete the L0 unlock to write new files.",
    }));
  });

  test("asks for bash approval and records requested/resolved events", async () => {
    const { events, hook, requests } = approvalsHarness([{ approved: true, mode: "once" }]);

    const result = await hook(
      { callId: "bash-1", name: "bash", input: { command: "bun test proto/approvals" } },
      ctx("bash-1"),
    );

    expect(result).toBeNull();
    expect(requests).toEqual([
      expect.objectContaining({
        callId: "bash-1",
        tool: "bash",
        command: "bun test proto/approvals",
        risk: "moderate",
        suggestedPattern: "bun test*",
      }),
    ]);
    expect(events.map(({ type }) => type)).toEqual(["tool.approval.requested", "tool.approval.resolved"]);
    expect(events[0]).toEqual(expect.objectContaining({
      type: "tool.approval.requested",
      callId: "bash-1",
      tool: "bash",
      command: "bun test proto/approvals",
      risk: "moderate",
    }));
    expect(events[1]).toEqual(expect.objectContaining({
      type: "tool.approval.resolved",
      callId: "bash-1",
      approved: true,
      mode: "once",
    }));
  });

  test("returns a ToolResult when the player denies with a reason", async () => {
    const { events, hook } = approvalsHarness([{ approved: false, mode: "deny-with-reason", reason: "Run the smaller approvals suite first." }]);

    const result = await hook(
      { callId: "bash-2", name: "bash", input: { command: "bun test proto" } },
      ctx("bash-2"),
    );

    expect(result).toEqual({
      isError: true,
      output: "Denied bun test proto: Run the smaller approvals suite first.",
    });
    expect(events.map(({ type }) => type)).toEqual([
      "tool.approval.requested",
      "tool.approval.resolved",
      "tool.blocked",
    ]);
    expect(events[1]).toEqual(expect.objectContaining({
      type: "tool.approval.resolved",
      callId: "bash-2",
      approved: false,
      mode: "deny-with-reason",
      reason: "Run the smaller approvals suite first.",
    }));
    expect(events[2]).toEqual(expect.objectContaining({
      type: "tool.blocked",
      callId: "bash-2",
      tool: "bash",
      reason: "denied",
      teaching: "Denied bun test proto: Run the smaller approvals suite first.",
    }));
  });

  test("escalates teaching on the third identical denial block", async () => {
    const { events, hook } = approvalsHarness();
    const input = { command: "git push --force origin main" };

    const first = await hook({ callId: "bash-3a", name: "bash", input }, ctx("bash-3a"));
    const second = await hook({ callId: "bash-3b", name: "bash", input }, ctx("bash-3b"));
    const third = await hook({ callId: "bash-3c", name: "bash", input }, ctx("bash-3c"));

    expect(first?.output.startsWith("Denied git push --force origin main:")).toBe(true);
    expect(second?.output.startsWith("Denied git push --force origin main:")).toBe(true);
    expect(third).toEqual({
      isError: true,
      output: expect.stringContaining("Stuck: the same call was blocked 3×"),
    });
    expect(events.map(({ type }) => type)).toEqual(["tool.blocked", "tool.blocked", "tool.blocked"]);
    expect(events[2]).toEqual(expect.objectContaining({
      type: "tool.blocked",
      callId: "bash-3c",
      tool: "bash",
      reason: "denied",
      teaching: expect.stringContaining("try a different approach or ask the player"),
    }));
  });
});
