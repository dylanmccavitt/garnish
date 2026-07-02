import { expect, test } from "bun:test";

import {
  createScheduler,
  evaluateCheck,
  evaluateQuest,
  type Check,
  type CheckResult,
  type EvaluationContext,
  type Probes,
  type LevelId,
  type Quest,
  type QuestId,
  type RunCommandOptions,
  type RunCommandResult,
  type SchedulerTimer,
  type SchedulerTrigger,
  type SkillValidity,
  type VerifierEvent,
} from "../../src/index";

type ProbeOverrides = Partial<{
  readonly existingFiles: readonly string[];
  readonly files: Readonly<Record<string, string>>;
  readonly commands: Readonly<Record<string, RunCommandResult>>;
  readonly handshakes: Readonly<Record<string, { readonly ok: boolean; readonly error?: string }>>;
  readonly skills: Readonly<Record<string, SkillValidity>>;
  readonly confirmations: Readonly<Record<string, boolean | undefined>>;
}>;


function fakeProbes(overrides: ProbeOverrides = {}): Probes {
  const existingFiles = new Set(overrides.existingFiles ?? []);
  const files = overrides.files ?? {};
  const commands = overrides.commands ?? {};
  const handshakes = overrides.handshakes ?? {};
  const skills = overrides.skills ?? {};
  const confirmations = overrides.confirmations ?? {};

  return {
    fileExists(path: string): boolean {
      return existingFiles.has(path);
    },
    readFile(path: string): string {
      const file = files[path];
      if (file === undefined) {
        throw new Error(`missing fixture file ${path}`);
      }
      return file;
    },
    runCommand(command: readonly string[] | string, options?: RunCommandOptions): RunCommandResult {
      const result = commands[commandKey(command, options)];
      if (result === undefined) {
        throw new Error(`unexpected command ${commandKey(command, options)}`);
      }
      return result;
    },
    mcpHandshake(server: string): { readonly ok: boolean; readonly error?: string } {
      const result = handshakes[server];
      if (result === undefined) {
        throw new Error(`unexpected MCP handshake ${server}`);
      }
      return result;
    },
    skillValid(path: string): SkillValidity {
      const result = skills[path];
      if (result === undefined) {
        throw new Error(`unexpected skill validation ${path}`);
      }
      return result;
    },
    confirm(id: string): boolean | undefined {
      if (!(id in confirmations)) {
        throw new Error(`unexpected confirmation ${id}`);
      }
      return confirmations[id];
    },
  };
}

function context(overrides: ProbeOverrides = {}, extra: Omit<EvaluationContext, "probes"> = {}): EvaluationContext {
  return { probes: fakeProbes(overrides), ...extra };
}

function commandKey(command: readonly string[] | string, options?: RunCommandOptions): string {
  const argv = typeof command === "string" ? command : command.join(" ");
  const cwd = options?.cwd ?? "";
  const timeout = options?.timeoutMs ?? "";
  return `${cwd}|${timeout}|${argv}`;
}

function event(name: string, seq: number, payload: Readonly<Record<string, unknown>> = {}, sessionId?: string): VerifierEvent {
  return { name, seq, payload, sessionId };
}

type MatrixCase = {
  readonly name: string;
  readonly check: Check;
  readonly ctx: EvaluationContext;
  readonly expected: {
    readonly status: CheckResult["status"];
    readonly kind: Check["type"];
    readonly message: string;
    readonly details: Readonly<Record<string, unknown>>;
  };
};

const matrixCases: readonly MatrixCase[] = [
  {
    name: "event passes when a matching event is present",
    check: { type: "event", match: { event: "agent_end", min_assistant_turns: 2 } },
    ctx: context({}, { events: [event("agent_end", 1, { assistant_turns: 3 })] }),
    expected: {
      status: "pass",
      kind: "event",
      message: "event matched",
      details: { matchedEvent: event("agent_end", 1, { assistant_turns: 3 }) },
    },
  },
  {
    name: "event fails when no matching event is present",
    check: { type: "event", match: { event: "agent_end", min_assistant_turns: 2 } },
    ctx: context({}, { events: [event("agent_end", 1, { assistant_turns: 1 })] }),
    expected: {
      status: "fail",
      kind: "event",
      message: "event not found",
      details: { matchedEvent: undefined },
    },
  },
  {
    name: "file_exists passes with resolved existing path",
    check: { type: "file_exists", path: "{sandbox}/done.txt" },
    ctx: context({ existingFiles: ["/tmp/garnish/done.txt"] }, { paths: { sandbox: "/tmp/garnish" } }),
    expected: {
      status: "pass",
      kind: "file_exists",
      message: "file exists",
      details: { path: "/tmp/garnish/done.txt", found: true },
    },
  },
  {
    name: "file_exists fails with resolved missing path",
    check: { type: "file_exists", path: "{sandbox}/missing.txt" },
    ctx: context({ existingFiles: ["/tmp/garnish/done.txt"] }, { paths: { sandbox: "/tmp/garnish" } }),
    expected: {
      status: "fail",
      kind: "file_exists",
      message: "file missing",
      details: { path: "/tmp/garnish/missing.txt", found: false },
    },
  },
  {
    name: "json_path passes when the selected value equals the assertion",
    check: { type: "json_path", file: "pack.json", path: "$.quests[0].id", assert: { equals: "install-engine" } },
    ctx: context({ files: { "pack.json": JSON.stringify({ quests: [{ id: "install-engine" }] }) } }),
    expected: {
      status: "pass",
      kind: "json_path",
      message: "path assertion matched",
      details: { file: "pack.json", path: "$.quests[0].id", found: true, value: "install-engine" },
    },
  },
  {
    name: "json_path fails when the selected value does not satisfy the assertion",
    check: { type: "json_path", file: "pack.json", path: "$.quests[0].id", assert: { equals: "connect-agent" } },
    ctx: context({ files: { "pack.json": JSON.stringify({ quests: [{ id: "install-engine" }] }) } }),
    expected: {
      status: "fail",
      kind: "json_path",
      message: "path assertion did not match",
      details: { file: "pack.json", path: "$.quests[0].id", found: true, value: "install-engine" },
    },
  },
  {
    name: "yaml_path passes when a sequence value is found",
    check: { type: "yaml_path", file: "pack.yml", path: "$.levels[0].id", assert: { equals: "tutorial-island" } },
    ctx: context({ files: { "pack.yml": "levels:\n  - id: tutorial-island\n" } }),
    expected: {
      status: "pass",
      kind: "yaml_path",
      message: "path assertion matched",
      details: { file: "pack.yml", path: "$.levels[0].id", found: true, value: "tutorial-island" },
    },
  },
  {
    name: "yaml_path fails when the selected path is missing",
    check: { type: "yaml_path", file: "pack.yml", path: "$.levels[1].id", assert: "exists" },
    ctx: context({ files: { "pack.yml": "levels:\n  - id: tutorial-island\n" } }),
    expected: {
      status: "fail",
      kind: "yaml_path",
      message: "path assertion did not match",
      details: { file: "pack.yml", path: "$.levels[1].id", found: false, value: undefined },
    },
  },
  {
    name: "command passes when exit code and streams match",
    check: { type: "command", command: ["verify", "quest"], exit_code: 0, stdout: { contains: "ok" }, stderr: "", timeout_ms: 5000 },
    ctx: context({ commands: { "|5000|verify quest": { exitCode: 0, stdout: "quest ok\n", stderr: "" } } }, { commandCwd: "", paths: {}, currentSessionId: undefined }),
    expected: {
      status: "pass",
      kind: "command",
      message: "command matched",
      details: { command: ["verify", "quest"], exitCode: 0, expectedExitCode: 0, stdoutMatches: true, stderrMatches: true },
    },
  },
  {
    name: "command fails when stdout does not match",
    check: { type: "command", command: ["verify", "quest"], exit_code: 0, stdout: { contains: "ok" } },
    ctx: context({ commands: { "||verify quest": { exitCode: 0, stdout: "quest failed\n", stderr: "" } } }),
    expected: {
      status: "fail",
      kind: "command",
      message: "command did not match",
      details: { command: ["verify", "quest"], exitCode: 0, expectedExitCode: 0, stdoutMatches: false, stderrMatches: true },
    },
  },
  {
    name: "git passes when the tree is clean",
    check: { type: "git", repo: "/repo", clean_tree: true },
    ctx: context({ commands: { "/repo||git status --porcelain": { exitCode: 0, stdout: "", stderr: "" } } }),
    expected: {
      status: "pass",
      kind: "git",
      message: "git predicates matched",
      details: { repo: "/repo", predicates: { cleanTree: { exitCode: 0, expected: true, dirty: false, matches: true } } },
    },
  },
  {
    name: "git fails when the tree is dirty but clean_tree is required",
    check: { type: "git", repo: "/repo", clean_tree: true },
    ctx: context({ commands: { "/repo||git status --porcelain": { exitCode: 0, stdout: " M src/index.ts\n", stderr: "" } } }),
    expected: {
      status: "fail",
      kind: "git",
      message: "git predicates did not match",
      details: { repo: "/repo", predicates: { cleanTree: { exitCode: 0, expected: true, dirty: true, matches: false } } },
    },
  },
  {
    name: "mcp_handshake passes for the matching configured server",
    check: { type: "mcp_handshake", server: { starts_with: "pi" }, timeout_ms: 250 },
    ctx: context({ handshakes: { "pi-local": { ok: true } } }, { mcpServers: ["pi-local", "filesystem"] }),
    expected: {
      status: "pass",
      kind: "mcp_handshake",
      message: "MCP handshake succeeded",
      details: { server: "pi-local", error: undefined },
    },
  },
  {
    name: "mcp_handshake fails when the selected server handshake fails",
    check: { type: "mcp_handshake", server: "pi-local", timeout_ms: 250 },
    ctx: context({ handshakes: { "pi-local": { ok: false, error: "connection refused" } } }),
    expected: {
      status: "fail",
      kind: "mcp_handshake",
      message: "MCP handshake failed",
      details: { server: "pi-local", error: "connection refused" },
    },
  },
  {
    name: "skill_valid passes for a valid discoverable skill",
    check: { type: "skill_valid", path: "/skills/verifier/SKILL.md", discovery: true },
    ctx: context({ skills: { "/skills/verifier/SKILL.md": { valid: true, discovery: true, name: "verifier" } } }),
    expected: {
      status: "pass",
      kind: "skill_valid",
      message: "skill is valid",
      details: { path: "/skills/verifier/SKILL.md", expectedDiscovery: true, discoveryMatches: true },
    },
  },
  {
    name: "skill_valid fails when discovery expectation does not match",
    check: { type: "skill_valid", path: "/skills/verifier/SKILL.md", discovery: true },
    ctx: context({ skills: { "/skills/verifier/SKILL.md": { valid: true, discovery: false, name: "verifier" } } }),
    expected: {
      status: "fail",
      kind: "skill_valid",
      message: "skill is invalid",
      details: { path: "/skills/verifier/SKILL.md", expectedDiscovery: true, discoveryMatches: false },
    },
  },
  {
    name: "confirm passes when the approval is accepted",
    check: { type: "confirm", id: "approveVerifier", prompt: "Approve verifier?", expected: true },
    ctx: context({ confirmations: { approveVerifier: true } }),
    expected: {
      status: "pass",
      kind: "confirm",
      message: "confirmation accepted",
      details: { id: "approveVerifier", prompt: "Approve verifier?", answer: true },
    },
  },
  {
    name: "confirm fails when the approval is declined",
    check: { type: "confirm", id: "approveVerifier", prompt: "Approve verifier?", expected: true },
    ctx: context({ confirmations: { approveVerifier: false } }),
    expected: {
      status: "fail",
      kind: "confirm",
      message: "confirmation declined",
      details: { id: "approveVerifier", prompt: "Approve verifier?", answer: false },
    },
  },
];

for (const { name, check, ctx, expected } of matrixCases) {
  test(`evaluateCheck fixture matrix: ${name}`, async () => {
    const result = await evaluateCheck(check, ctx);

    expect(result.status).toBe(expected.status);
    expect(result.evidence.kind).toBe(expected.kind);
    expect(result.evidence.message).toBe(expected.message);
    expect(result.evidence.details).toMatchObject(expected.details);
  });
}

test("command check resolves argv path templates before running the probe", async () => {
  const result = await evaluateCheck(
    {
      type: "command",
      command: ["node", "{workspace}/scripts/verify.js", "--pack", "{pack}/pack.yml"],
      exit_code: 0,
      stdout: { contains: "verified" },
    },
    context(
      {
        commands: {
          "||node /tmp/workspace/scripts/verify.js --pack /tmp/workspace/packs/core/pack.yml": {
            exitCode: 0,
            stdout: "pack verified\n",
            stderr: "",
          },
        },
      },
      {
        paths: {
          workspace: "/tmp/workspace",
          pack: "/tmp/workspace/packs/core",
        },
      },
    ),
  );

  expect(result.status).toBe("pass");
  expect(result.evidence.message).toBe("command matched");
  expect(result.evidence.details).toMatchObject({
    command: ["node", "/tmp/workspace/scripts/verify.js", "--pack", "/tmp/workspace/packs/core/pack.yml"],
    stdoutMatches: true,
  });
});

test("event count predicate counts only matching events in the current session", async () => {
  const check: Check = { type: "event", match: { event: "tool_result", success: true, count: { min: 2 } }, sameSession: true };

  const pass = await evaluateCheck(
    check,
    context(
      {},
      {
        currentSessionId: "session-current",
        events: [
          event("tool_result", 1, { success: true }, "session-old"),
          event("tool_result", 2, { success: true }, "session-current"),
          event("tool_result", 3, { success: false }, "session-current"),
          event("tool_result", 4, { success: true }, "session-current"),
        ],
      },
    ),
  );
  const fail = await evaluateCheck(
    check,
    context(
      {},
      {
        currentSessionId: "session-current",
        events: [
          event("tool_result", 1, { success: true }, "session-old"),
          event("tool_result", 2, { success: true }, "session-current"),
        ],
      },
    ),
  );

  expect(pass.status).toBe("pass");
  expect(pass.evidence.message).toBe("event count matched");
  expect(pass.evidence.details).toMatchObject({
    count: 2,
    matchedEvents: [
      event("tool_result", 2, { success: true }, "session-current"),
      event("tool_result", 4, { success: true }, "session-current"),
    ],
    sameSession: "session-current",
  });
  expect(fail.status).toBe("fail");
  expect(fail.evidence.message).toBe("event count did not match");
  expect(fail.evidence.details).toMatchObject({
    count: 1,
    matchedEvents: [event("tool_result", 2, { success: true }, "session-current")],
    sameSession: "session-current",
  });
});

test("event sameSession without an after boundary requires a current session anchor", async () => {
  const result = await evaluateCheck(
    { type: "event", match: { event: "tool_result", success: true }, sameSession: true },
    context(
      {},
      {
        events: [event("tool_result", 1, { success: true }, "session-old")],
      },
    ),
  );

  expect(result.status).toBe("fail");
  expect(result.evidence.message).toBe("sameSession requested but no session anchor was available");
  expect(result.evidence.details).toMatchObject({
    after: undefined,
    currentSessionId: undefined,
  });
});

test("git diff_contains plain string passes when the file is one of multiple changed files", async () => {
  const result = await evaluateCheck(
    { type: "git", repo: "/repo", diff_contains: "tests/verifier/index.test.ts" },
    context({
      commands: {
        "/repo||git diff --name-only": {
          exitCode: 0,
          stdout: "src/verifier/index.ts\ntests/verifier/index.test.ts\n",
          stderr: "",
        },
        "/repo||git diff --cached --name-only": {
          exitCode: 0,
          stdout: "README.md\n",
          stderr: "",
        },
      },
    }),
  );

  expect(result.status).toBe("pass");
  expect(result.evidence.message).toBe("git predicates matched");
  expect(result.evidence.details).toMatchObject({
    repo: "/repo",
    predicates: {
      diffContains: {
        diffNames: ["src/verifier/index.ts", "tests/verifier/index.test.ts", "README.md"],
        matches: true,
      },
    },
  });
});

test("event after quest boundary ignores matching events that happened before the boundary", async () => {
  const result = await evaluateCheck(
    { type: "event", match: { event: "tool_result", success: true }, after: "install-engine" as QuestId },
    context(
      {},
      {
        events: [
          event("tool_result", 1, { success: true }),
          event("quest_completed", 2, { quest_id: "install-engine", type: "quest_completed" }),
        ],
      },
    ),
  );

  expect(result.status).toBe("fail");
  expect(result.evidence.message).toBe("event not found");
  expect(result.evidence.details).toMatchObject({
    matchedEvent: undefined,
    boundary: event("quest_completed", 2, { quest_id: "install-engine", type: "quest_completed" }),
  });
});

test("event sameSession passes only with a matching event after the boundary in the boundary session", async () => {
  const boundary = event("tool_call", 1, { ref: "writeFile" }, "session-a");
  const result = await evaluateCheck(
    { type: "event", match: { event: "tool_result", success: true }, after: { ref: "writeFile" }, sameSession: true },
    context(
      {},
      {
        events: [
          boundary,
          event("tool_result", 2, { success: true }, "session-b"),
          event("tool_result", 3, { success: true }, "session-a"),
        ],
      },
    ),
  );

  expect(result.status).toBe("pass");
  expect(result.evidence.details).toMatchObject({
    sameSession: "session-a",
    matchedEvent: event("tool_result", 3, { success: true }, "session-a"),
    boundary,
  });
});

test("event sameSession fails when matching events after the boundary belong to another session", async () => {
  const boundary = event("tool_call", 1, { ref: "writeFile" }, "session-a");
  const result = await evaluateCheck(
    { type: "event", match: { event: "tool_result", success: true }, after: { ref: "writeFile" }, sameSession: true },
    context(
      {},
      {
        events: [boundary, event("tool_result", 2, { success: true }, "session-b")],
      },
    ),
  );

  expect(result.status).toBe("fail");
  expect(result.evidence.message).toBe("event not found");
  expect(result.evidence.details).toMatchObject({
    sameSession: "session-a",
    matchedEvent: undefined,
    boundary,
  });
});

test("evaluateQuest reports aggregate pass/fail/pending counts and fails when any check fails", async () => {
  const quest: Quest = {
    id: "verify-api" as QuestId,
    level: "intro" as LevelId,
    title: "Verify API",
    description: "Exercise verifier aggregation.",
    xp: 10,
    required: true,
    prereqs: [],
    unlocks: [],
    checks: [
      { type: "file_exists", path: "/workspace/done.txt" },
      { type: "confirm", id: "manualApproval", prompt: "Approve?", expected: true },
      { type: "event", match: { event: "agent_end" } },
    ],
  };

  const result = await evaluateQuest(
    quest,
    context({ existingFiles: ["/workspace/done.txt"], confirmations: { manualApproval: undefined } }, { events: [] }),
  );

  expect(result.status).toBe("fail");
  expect(result.questId).toBe("verify-api" as QuestId);
  expect(result.checks.map((entry) => entry.result.status)).toEqual(["pass", "pending", "fail"]);
  expect(result.evidence).toEqual({
    kind: "quest",
    message: "quest fail",
    details: { questId: "verify-api", passed: 1, failed: 1, pending: 1 },
  });
});

test("scheduler turnEnd debounce coalesces rapid calls into one delayed trigger", () => {
  const triggers: SchedulerTrigger[] = [];
  const timer = new FakeTimer();
  let now = 100;
  const scheduler = createScheduler({
    debounceMs: 25,
    now: () => now,
    onTrigger: (trigger) => triggers.push(trigger),
    timer,
  });

  scheduler.turnEnd();
  const firstHandle = timer.lastHandle;
  scheduler.turnEnd();
  const secondHandle = timer.lastHandle;
  now = 125;

  expect(firstHandle).not.toBe(secondHandle);
  expect(timer.activeCount).toBe(1);
  expect(triggers).toEqual([]);

  timer.fire(firstHandle);
  expect(triggers).toEqual([]);

  timer.fire(secondHandle);
  expect(triggers).toEqual([{ reason: "turn_end", at: 125 }]);
  expect(timer.activeCount).toBe(0);
});

test("scheduler questActivated emits immediately without scheduling a timer", () => {
  const triggers: SchedulerTrigger[] = [];
  const timer = new FakeTimer();
  let now = 150;
  const scheduler = createScheduler({
    debounceMs: 25,
    now: () => now,
    onTrigger: (trigger) => triggers.push(trigger),
    timer,
  });

  scheduler.questActivated();

  expect(triggers).toEqual([{ reason: "quest_activated", at: 150 }]);
  expect(timer.activeCount).toBe(0);

  now = 175;
  timer.fire(timer.lastHandle);
  expect(triggers).toEqual([{ reason: "quest_activated", at: 150 }]);
});

test("scheduler manualCheck clears a pending turnEnd debounce and emits immediately", () => {
  const triggers: SchedulerTrigger[] = [];
  const timer = new FakeTimer();
  let now = 200;
  const scheduler = createScheduler({
    debounceMs: 50,
    now: () => now,
    onTrigger: (trigger) => triggers.push(trigger),
    timer,
  });

  scheduler.turnEnd();
  const delayedTurnEnd = timer.lastHandle;
  now = 205;
  scheduler.manualCheck();

  expect(triggers).toEqual([{ reason: "manual_check", at: 205 }]);
  expect(timer.activeCount).toBe(0);

  now = 250;
  timer.fire(delayedTurnEnd);
  expect(triggers).toEqual([{ reason: "manual_check", at: 205 }]);
});

class FakeTimer implements SchedulerTimer {
  private nextHandle = 1;
  private readonly callbacks = new Map<number, () => void>();
  lastHandle = 0;

  get activeCount(): number {
    return this.callbacks.size;
  }

  setTimeout(callback: () => void, delayMs: number): number {
    expect(delayMs).toBeGreaterThan(0);
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.lastHandle = handle;
    this.callbacks.set(handle, callback);
    return handle;
  }

  clearTimeout(handle: unknown): void {
    this.callbacks.delete(Number(handle));
  }

  fire(handle: unknown): void {
    const numericHandle = Number(handle);
    const callback = this.callbacks.get(numericHandle);
    if (callback === undefined) {
      return;
    }
    this.callbacks.delete(numericHandle);
    callback();
  }
}
