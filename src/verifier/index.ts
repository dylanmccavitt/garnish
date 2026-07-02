import { parse as parseYaml } from "yaml";

import type {
  Assertion,
  Check,
  EventAfter,
  EventCheck,
  EventMatch,
  GitCheck,
  IntPredicate,
  Quest,
  StringPredicate,
} from "../core";

export type MaybePromise<T> = T | Promise<T>;
export type CheckStatus = "pass" | "fail" | "pending";

export interface RunCommandOptions {
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly env?: Readonly<Record<string, string>>;
}

export interface RunCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface McpHandshakeResult {
  readonly ok: boolean;
  readonly error?: string;
}

export interface SkillValidity {
  readonly valid: boolean;
  readonly discovery?: boolean;
  readonly name?: string;
  readonly description?: string;
  readonly errors?: readonly string[];
}

export interface Probes {
  readonly fileExists: (path: string) => MaybePromise<boolean>;
  readonly readFile: (path: string) => MaybePromise<string>;
  readonly runCommand: (command: readonly string[] | string, options?: RunCommandOptions) => MaybePromise<RunCommandResult>;
  readonly mcpHandshake: (server: string, options?: { readonly timeoutMs?: number }) => MaybePromise<McpHandshakeResult>;
  readonly skillValid: (path: string) => MaybePromise<SkillValidity>;
  readonly confirm: (id: string) => MaybePromise<boolean | undefined>;
}

export interface VerifierEvent {
  readonly name: string;
  readonly sessionId?: string;
  readonly seq: number;
  readonly payload?: Readonly<Record<string, unknown>>;
}

export interface CheckEvidence {
  readonly kind: Check["type"] | "quest";
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface CheckResult {
  readonly status: CheckStatus;
  readonly evidence: CheckEvidence;
}

export interface QuestCheckResult {
  readonly check: Check;
  readonly result: CheckResult;
}

export interface QuestResult {
  readonly status: CheckStatus;
  readonly questId: Quest["id"];
  readonly checks: readonly QuestCheckResult[];
  readonly evidence: CheckEvidence;
}

export interface EvaluationContext {
  readonly probes: Probes;
  readonly events?: readonly VerifierEvent[];
  readonly currentSessionId?: string;
  readonly paths?: Readonly<Record<string, string>>;
  readonly eventRefs?: Readonly<Record<string, VerifierEvent>>;
  readonly mcpServers?: readonly string[];
  readonly commandCwd?: string;
}

export type SchedulerTriggerReason = "quest_activated" | "turn_end" | "manual_check";

export interface SchedulerTrigger {
  readonly reason: SchedulerTriggerReason;
  readonly at: number;
}

export interface SchedulerTimer {
  readonly setTimeout: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
}

export interface SchedulerOptions {
  readonly debounceMs: number;
  readonly now: () => number;
  readonly onTrigger: (trigger: SchedulerTrigger) => void;
  readonly timer?: SchedulerTimer;
}

export interface VerifierScheduler {
  readonly questActivated: () => void;
  readonly turnEnd: () => void;
  readonly manualCheck: () => void;
  readonly dispose: () => void;
}

export async function evaluateQuest(quest: Quest, ctx: EvaluationContext): Promise<QuestResult> {
  const checks: QuestCheckResult[] = [];

  for (const check of quest.checks) {
    checks.push({ check, result: await evaluateCheck(check, ctx) });
  }

  let status: CheckStatus = "pass";
  for (const { result } of checks) {
    if (result.status === "fail") {
      status = "fail";
      break;
    }
    if (result.status === "pending") {
      status = "pending";
    }
  }

  const passed = checks.filter((entry) => entry.result.status === "pass").length;
  const failed = checks.filter((entry) => entry.result.status === "fail").length;
  const pending = checks.filter((entry) => entry.result.status === "pending").length;

  return {
    status,
    questId: quest.id,
    checks,
    evidence: {
      kind: "quest",
      message: `quest ${status}`,
      details: { questId: quest.id, passed, failed, pending },
    },
  };
}

export async function evaluateCheck(check: Check, ctx: EvaluationContext): Promise<CheckResult> {
  switch (check.type) {
    case "event":
      return evaluateEventCheck(check, ctx);
    case "file_exists": {
      const path = resolveTemplate(check.path, ctx);
      const found = await ctx.probes.fileExists(path);
      return {
        status: found ? "pass" : "fail",
        evidence: {
          kind: "file_exists",
          message: found ? "file exists" : "file missing",
          details: { path, expected: true, found },
        },
      };
    }
    case "json_path":
      return evaluateStructuredPathCheck("json_path", check.file, check.path, check.assert, ctx);
    case "yaml_path":
      return evaluateStructuredPathCheck("yaml_path", check.file, check.path, check.assert, ctx);
    case "command": {
      const command =
        typeof check.command === "string"
          ? resolveTemplate(check.command, ctx)
          : check.command.map((argument) => resolveTemplate(argument, ctx));
      const result = await ctx.probes.runCommand(command, {
        cwd: ctx.commandCwd,
        timeoutMs: check.timeout_ms,
      });
      const expectedExitCode = check.exit_code ?? 0;
      const exitMatches = result.exitCode === expectedExitCode;
      const stdoutMatches = check.stdout === undefined || matchesStringPredicate(check.stdout, result.stdout);
      const stderrMatches = check.stderr === undefined || matchesStringPredicate(check.stderr, result.stderr);
      const passed = exitMatches && stdoutMatches && stderrMatches;

      return {
        status: passed ? "pass" : "fail",
        evidence: {
          kind: "command",
          message: passed ? "command matched" : "command did not match",
          details: {
            command,
            exitCode: result.exitCode,
            expectedExitCode,
            stdoutExcerpt: excerpt(result.stdout),
            stderrExcerpt: excerpt(result.stderr),
            stdoutMatches,
            stderrMatches,
          },
        },
      };
    }
    case "git":
      return evaluateGitCheck(check, ctx);
    case "mcp_handshake": {
      const server = resolveMcpServer(check.server, ctx);
      if (server === undefined) {
        return {
          status: "fail",
          evidence: {
            kind: "mcp_handshake",
            message: "no MCP server matched",
            details: { predicate: check.server, configuredServers: ctx.mcpServers ?? [] },
          },
        };
      }

      const result = await ctx.probes.mcpHandshake(server, { timeoutMs: check.timeout_ms });
      return {
        status: result.ok ? "pass" : "fail",
        evidence: {
          kind: "mcp_handshake",
          message: result.ok ? "MCP handshake succeeded" : "MCP handshake failed",
          details: { server, error: result.error },
        },
      };
    }
    case "skill_valid": {
      const path = resolveTemplate(check.path, ctx);
      const result = await ctx.probes.skillValid(path);
      const discoveryMatches = check.discovery === undefined || result.discovery === check.discovery;
      const passed = result.valid && discoveryMatches;

      return {
        status: passed ? "pass" : "fail",
        evidence: {
          kind: "skill_valid",
          message: passed ? "skill is valid" : "skill is invalid",
          details: { path, validity: result, expectedDiscovery: check.discovery, discoveryMatches },
        },
      };
    }
    case "confirm": {
      const id = check.id ?? check.prompt ?? "confirm";
      const answer = await ctx.probes.confirm(id);
      if (answer === undefined) {
        return {
          status: "pending",
          evidence: {
            kind: "confirm",
            message: "confirmation pending",
            details: { id, prompt: check.prompt },
          },
        };
      }

      return {
        status: answer ? "pass" : "fail",
        evidence: {
          kind: "confirm",
          message: answer ? "confirmation accepted" : "confirmation declined",
          details: { id, prompt: check.prompt, answer },
        },
      };
    }
  }
}

export function createScheduler(options: SchedulerOptions): VerifierScheduler {
  const timer = options.timer ?? {
    setTimeout(callback: () => void, delayMs: number): unknown {
      return globalThis.setTimeout(callback, delayMs);
    },
    clearTimeout(handle: unknown): void {
      globalThis.clearTimeout(handle as Parameters<typeof globalThis.clearTimeout>[0]);
    },
  };
  let pendingTurnEnd: unknown;

  function clearPendingTurnEnd(): void {
    if (pendingTurnEnd !== undefined) {
      timer.clearTimeout(pendingTurnEnd);
      pendingTurnEnd = undefined;
    }
  }

  function emit(reason: SchedulerTriggerReason): void {
    options.onTrigger({ reason, at: options.now() });
  }

  return {
    questActivated(): void {
      emit("quest_activated");
    },
    turnEnd(): void {
      clearPendingTurnEnd();
      pendingTurnEnd = timer.setTimeout(() => {
        pendingTurnEnd = undefined;
        emit("turn_end");
      }, options.debounceMs);
    },
    manualCheck(): void {
      clearPendingTurnEnd();
      emit("manual_check");
    },
    dispose(): void {
      clearPendingTurnEnd();
    },
  };
}

async function evaluateStructuredPathCheck(
  kind: "json_path" | "yaml_path",
  fileTemplate: string,
  pathExpression: string,
  assertion: Assertion,
  ctx: EvaluationContext,
): Promise<CheckResult> {
  const file = resolveTemplate(fileTemplate, ctx);
  let parsed: unknown;

  try {
    const raw = await ctx.probes.readFile(file);
    parsed = kind === "json_path" ? JSON.parse(raw) : parseYaml(raw);
  } catch (error) {
    return {
      status: "fail",
      evidence: {
        kind,
        message: "structured file could not be read or parsed",
        details: { file, error: errorMessage(error) },
      },
    };
  }

  const pathResult = readJsonPath(parsed, pathExpression);
  const passed = pathResult.wildcard
    ? pathResult.values.some((value) => assertionMatches(assertion, value, true)) ||
      (assertion === "missing" && pathResult.values.length === 0)
    : assertionMatches(assertion, pathResult.value, pathResult.found);

  return {
    status: passed ? "pass" : "fail",
    evidence: {
      kind,
      message: passed ? "path assertion matched" : "path assertion did not match",
      details: {
        file,
        path: pathExpression,
        found: pathResult.found,
        value: pathResult.wildcard ? pathResult.values : pathResult.value,
        assertion,
      },
    },
  };
}

function evaluateEventCheck(check: EventCheck, ctx: EvaluationContext): CheckResult {
  const events = ctx.events ?? [];
  const boundary = resolveEventBoundary(check.after, events, ctx);

  if (check.after !== undefined && boundary === undefined) {
    return {
      status: "fail",
      evidence: {
        kind: "event",
        message: "event boundary not found",
        details: { after: check.after, eventCount: events.length },
      },
    };
  }

  const startIndex = boundary === undefined ? 0 : boundary.index + 1;
  let requiredSessionId: string | undefined;
  if (check.sameSession === true) {
    requiredSessionId = boundary === undefined ? ctx.currentSessionId : sessionIdForEvent(boundary.event);
    if (requiredSessionId === undefined) {
      return {
        status: "fail",
        evidence: {
          kind: "event",
          message: "sameSession requested but no session anchor was available",
          details: { after: check.after, currentSessionId: ctx.currentSessionId },
        },
      };
    }
  }

  const matchedEvents: VerifierEvent[] = [];
  for (let index = startIndex; index < events.length; index += 1) {
    const event = events[index];
    if (event === undefined) {
      continue;
    }
    if (requiredSessionId !== undefined && sessionIdForEvent(event) !== requiredSessionId) {
      continue;
    }
    if (eventMatches(check.match, event)) {
      matchedEvents.push(event);
    }
  }

  if (check.match.count !== undefined) {
    const passed = matchesIntPredicate(check.match.count, matchedEvents.length);
    return {
      status: passed ? "pass" : "fail",
      evidence: {
        kind: "event",
        message: passed ? "event count matched" : "event count did not match",
        details: {
          match: check.match,
          count: matchedEvents.length,
          matchedEvents,
          boundary: boundary?.event,
          sameSession: requiredSessionId,
        },
      },
    };
  }

  const matchedEvent = matchedEvents[0];
  return {
    status: matchedEvent === undefined ? "fail" : "pass",
    evidence: {
      kind: "event",
      message: matchedEvent === undefined ? "event not found" : "event matched",
      details: {
        match: check.match,
        matchedEvent,
        boundary: boundary?.event,
        sameSession: requiredSessionId,
      },
    },
  };
}

async function evaluateGitCheck(check: GitCheck, ctx: EvaluationContext): Promise<CheckResult> {
  const repo = resolveTemplate(check.repo ?? ".", ctx);
  const predicateEvidence: Record<string, unknown> = {};
  let passed = true;

  if (check.commit_count !== undefined) {
    const command = await ctx.probes.runCommand(["git", "rev-list", "--count", "HEAD"], { cwd: repo });
    const count = Number.parseInt(command.stdout.trim(), 10);
    const matches = command.exitCode === 0 && Number.isFinite(count) && matchesIntPredicate(check.commit_count, count);
    predicateEvidence.commitCount = { exitCode: command.exitCode, count, stderr: excerpt(command.stderr), matches };
    passed = passed && matches;
  }

  if (check.clean_tree !== undefined || check.dirty !== undefined) {
    const command = await ctx.probes.runCommand(["git", "status", "--porcelain"], { cwd: repo });
    const dirty = command.stdout.trim().length > 0;
    if (check.clean_tree !== undefined) {
      const matches = command.exitCode === 0 && dirty !== check.clean_tree;
      predicateEvidence.cleanTree = { exitCode: command.exitCode, expected: check.clean_tree, dirty, matches };
      passed = passed && matches;
    }
    if (check.dirty !== undefined) {
      const matches = command.exitCode === 0 && dirty === check.dirty;
      predicateEvidence.dirty = { exitCode: command.exitCode, expected: check.dirty, dirty, matches };
      passed = passed && matches;
    }
  }

  if (check.branch_exists !== undefined) {
    const branchPredicate = check.branch_exists;
    const command = await ctx.probes.runCommand(["git", "branch", "--list", "--format=%(refname:short)"], { cwd: repo });
    const branches = command.stdout
      .split(/\r?\n/)
      .map((branch) => branch.trim())
      .filter((branch) => branch.length > 0);
    const matches = command.exitCode === 0 && branches.some((branch) => matchesStringPredicate(branchPredicate, branch));
    predicateEvidence.branchExists = { exitCode: command.exitCode, branches, matches };
    passed = passed && matches;
  }

  if (check.diff_contains !== undefined) {
    const diffPredicate = check.diff_contains;
    const unstaged = await ctx.probes.runCommand(["git", "diff", "--name-only"], { cwd: repo });
    const staged = await ctx.probes.runCommand(["git", "diff", "--cached", "--name-only"], { cwd: repo });
    const diffNames = `${unstaged.stdout}\n${staged.stdout}`
      .split(/\r?\n/)
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
    const matches =
      unstaged.exitCode === 0 && staged.exitCode === 0 && diffNames.some((name) => matchesStringPredicate(diffPredicate, name));
    predicateEvidence.diffContains = { diffNames, matches };
    passed = passed && matches;
  }

  if (check.file_restored !== undefined) {
    const file = resolveTemplate(check.file_restored, ctx);
    const command = await ctx.probes.runCommand(["git", "status", "--porcelain", "--", file], { cwd: repo });
    const restored = command.exitCode === 0 && command.stdout.trim().length === 0;
    predicateEvidence.fileRestored = { file, restored, statusExcerpt: excerpt(command.stdout) };
    passed = passed && restored;
  }

  return {
    status: passed ? "pass" : "fail",
    evidence: {
      kind: "git",
      message: passed ? "git predicates matched" : "git predicates did not match",
      details: { repo, predicates: predicateEvidence },
    },
  };
}

function resolveEventBoundary(
  after: EventAfter | undefined,
  events: readonly VerifierEvent[],
  ctx: EvaluationContext,
): { readonly event: VerifierEvent; readonly index: number } | undefined {
  if (after === undefined) {
    return undefined;
  }

  if (typeof after === "string") {
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      if (event === undefined) {
        continue;
      }
      const questId = payloadValue(event, ["quest_id", "questId"]);
      const type = payloadValue(event, ["type"]);
      if ((event.name === "quest_completed" || type === "quest_completed") && questId === after) {
        return { event, index };
      }
    }
    return undefined;
  }

  const referenced = ctx.eventRefs?.[after.ref];
  if (referenced !== undefined && (after.event === undefined || referenced.name === after.event)) {
    const referencedIndex = events.findIndex((event) => event.seq === referenced.seq && event.name === referenced.name);
    if (referencedIndex >= 0) {
      return { event: referenced, index: referencedIndex };
    }
  }

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event === undefined) {
      continue;
    }
    if (after.event !== undefined && event.name !== after.event) {
      continue;
    }
    const ref = payloadValue(event, ["ref", "id", "name"]);
    if (ref === after.ref) {
      return { event, index };
    }
  }

  return undefined;
}

function eventMatches(match: EventMatch, event: VerifierEvent): boolean {
  if (event.name !== match.event) {
    return false;
  }
  if (match.tool !== undefined && !eventStringFieldMatches(event, ["tool"], match.tool)) {
    return false;
  }
  if (match.source !== undefined && !eventStringFieldMatches(event, ["source"], match.source)) {
    return false;
  }
  if (match.server !== undefined && !eventStringFieldMatches(event, ["server"], match.server)) {
    return false;
  }
  if (match.name !== undefined && !eventStringFieldMatches(event, ["name"], match.name)) {
    return false;
  }
  if (match.path !== undefined && !eventStringFieldMatches(event, ["path"], match.path)) {
    return false;
  }
  if (match.success !== undefined && payloadValue(event, ["success"]) !== match.success) {
    return false;
  }
  if (match.exit_code !== undefined) {
    const exitCode = payloadValue(event, ["exit_code", "exitCode"]);
    if (typeof exitCode !== "number" || !matchesIntPredicate(match.exit_code, exitCode)) {
      return false;
    }
  }
  if (match.min_assistant_turns !== undefined) {
    const turns = payloadValue(event, ["min_assistant_turns", "minAssistantTurns", "assistant_turns", "assistantTurns"]);
    if (typeof turns !== "number" || turns < match.min_assistant_turns) {
      return false;
    }
  }
  if (match.resumed !== undefined && payloadValue(event, ["resumed"]) !== match.resumed) {
    return false;
  }
  if (match.extension_loaded !== undefined) {
    const loaded = payloadValue(event, ["extension_loaded", "extensionLoaded"]);
    if (loaded !== match.extension_loaded) {
      return false;
    }
  }
  if (match.size_reduced !== undefined) {
    const reduced = payloadValue(event, ["size_reduced", "sizeReduced"]);
    if (reduced !== match.size_reduced) {
      return false;
    }
  }
  if (match.reason !== undefined && !eventStringFieldMatches(event, ["reason"], match.reason)) {
    return false;
  }
  if (match.headless !== undefined && payloadValue(event, ["headless"]) !== match.headless) {
    return false;
  }
  if (match.tasks?.length !== undefined) {
    const tasks = payloadValue(event, ["tasks"]);
    let taskLength: number | undefined;
    if (Array.isArray(tasks)) {
      taskLength = tasks.length;
    } else if (isRecord(tasks) && typeof tasks.length === "number") {
      taskLength = tasks.length;
    }
    if (taskLength === undefined || !matchesIntPredicate(match.tasks.length, taskLength)) {
      return false;
    }
  }

  return true;
}

function matchesStringPredicate(predicate: StringPredicate, value: unknown): boolean {
  const text = typeof value === "string" ? value : `${value}`;

  if (typeof predicate === "string") {
    return text === predicate;
  }

  if (predicate.equals !== undefined && text !== predicate.equals) {
    return false;
  }
  if (predicate.contains !== undefined && !text.includes(predicate.contains)) {
    return false;
  }
  if (predicate.starts_with !== undefined && !text.startsWith(predicate.starts_with)) {
    return false;
  }
  if (predicate.ends_with !== undefined && !text.endsWith(predicate.ends_with)) {
    return false;
  }
  if (predicate.regex !== undefined) {
    try {
      if (!new RegExp(predicate.regex).test(text)) {
        return false;
      }
    } catch {
      return false;
    }
  }
  if (predicate.one_of !== undefined && !predicate.one_of.includes(text)) {
    return false;
  }

  return true;
}

function matchesIntPredicate(predicate: IntPredicate, value: number): boolean {
  if (typeof predicate === "number") {
    return value === predicate;
  }
  if (predicate.equals !== undefined && value !== predicate.equals) {
    return false;
  }
  if (predicate.min !== undefined && value < predicate.min) {
    return false;
  }
  if (predicate.max !== undefined && value > predicate.max) {
    return false;
  }

  return true;
}

function assertionMatches(assertion: Assertion, value: unknown, found: boolean): boolean {
  if (assertion === "exists") {
    return found;
  }
  if (assertion === "missing") {
    return !found;
  }
  if (assertion === "non_empty") {
    if (!found || value === null) {
      return false;
    }
    if (typeof value === "string" || Array.isArray(value)) {
      return value.length > 0;
    }
    if (isRecord(value)) {
      return Object.keys(value).length > 0;
    }
    return true;
  }
  if ("equals" in assertion) {
    return deepEqual(value, assertion.equals);
  }
  if ("contains" in assertion) {
    if (typeof value === "string") {
      return value.includes(`${assertion.contains}`);
    }
    if (Array.isArray(value)) {
      return value.some((entry) => deepEqual(entry, assertion.contains));
    }
    if (isRecord(value)) {
      return Object.values(value).some((entry) => deepEqual(entry, assertion.contains));
    }
    return false;
  }
  if ("matches" in assertion) {
    if (typeof value !== "string") {
      return false;
    }
    try {
      return new RegExp(assertion.matches).test(value);
    } catch {
      return false;
    }
  }

  return false;
}

const WILDCARD = Symbol("jsonpath-wildcard");
type JsonPathToken = string | number | typeof WILDCARD;

interface JsonPathResult {
  readonly found: boolean;
  readonly value: unknown;
  readonly wildcard: boolean;
  readonly values: readonly unknown[];
}

function readJsonPath(root: unknown, path: string): JsonPathResult {
  const tokens = parseJsonPath(path);
  if (tokens === undefined) {
    return { found: false, value: undefined, wildcard: false, values: [] };
  }

  const wildcard = tokens.includes(WILDCARD);
  let candidates: unknown[] = [root];

  for (const token of tokens) {
    const next: unknown[] = [];
    for (const candidate of candidates) {
      if (token === WILDCARD) {
        if (Array.isArray(candidate)) {
          next.push(...candidate);
        } else if (isRecord(candidate)) {
          next.push(...Object.values(candidate));
        }
        continue;
      }
      if (typeof token === "number") {
        if (Array.isArray(candidate) && token >= 0 && token < candidate.length) {
          next.push(candidate[token]);
        }
        continue;
      }
      if (isRecord(candidate) && token in candidate) {
        next.push(candidate[token]);
      }
    }
    candidates = next;
    if (candidates.length === 0) {
      break;
    }
  }

  return {
    found: candidates.length > 0,
    value: candidates[0],
    wildcard,
    values: candidates,
  };
}

function parseJsonPath(path: string): JsonPathToken[] | undefined {
  if (!path.startsWith("$")) {
    return undefined;
  }

  const tokens: JsonPathToken[] = [];
  let index = 1;

  while (index < path.length) {
    if (path[index] === ".") {
      const start = index + 1;
      index = start;
      while (index < path.length && path[index] !== "." && path[index] !== "[") {
        index += 1;
      }
      if (index === start) {
        return undefined;
      }
      tokens.push(path.slice(start, index));
      continue;
    }

    if (path[index] === "[") {
      const end = path.indexOf("]", index);
      if (end < 0) {
        return undefined;
      }
      const raw = path.slice(index + 1, end).trim();
      if (raw === "*") {
        tokens.push(WILDCARD);
      } else if (/^\d+$/.test(raw)) {
        tokens.push(Number.parseInt(raw, 10));
      } else if ((raw.startsWith("\"") && raw.endsWith("\"")) || (raw.startsWith("'") && raw.endsWith("'"))) {
        tokens.push(raw.slice(1, -1));
      } else {
        return undefined;
      }
      index = end + 1;
      continue;
    }

    return undefined;
  }

  return tokens;
}

function resolveTemplate(template: string, ctx: EvaluationContext): string {
  let resolved = template;
  for (const [name, value] of Object.entries(ctx.paths ?? {})) {
    resolved = resolved.replaceAll(`{${name}}`, value);
  }

  return resolved;
}

function resolveMcpServer(predicate: StringPredicate, ctx: EvaluationContext): string | undefined {
  if (typeof predicate === "string") {
    return predicate;
  }

  for (const server of ctx.mcpServers ?? []) {
    if (matchesStringPredicate(predicate, server)) {
      return server;
    }
  }

  return undefined;
}


function sessionIdForEvent(event: VerifierEvent): string | undefined {
  if (event.sessionId !== undefined) {
    return event.sessionId;
  }

  const payloadSessionId = payloadValue(event, ["session_id", "sessionId"]);
  if (typeof payloadSessionId === "string" && payloadSessionId.length > 0) {
    return payloadSessionId;
  }

  return undefined;
}

function eventStringFieldMatches(event: VerifierEvent, aliases: readonly string[], predicate: StringPredicate): boolean {
  const value = payloadValue(event, aliases);
  if (value === undefined || value === null) {
    return false;
  }

  return matchesStringPredicate(predicate, value);
}

function payloadValue(event: VerifierEvent, aliases: readonly string[]): unknown {
  const payload = event.payload ?? {};
  for (const alias of aliases) {
    if (alias in payload) {
      return payload[alias];
    }
  }

  const eventRecord = event as unknown as Readonly<Record<string, unknown>>;
  for (const alias of aliases) {
    if (alias !== "name" && alias in eventRecord) {
      return eventRecord[alias];
    }
  }

  return undefined;
}

function excerpt(value: string, maxLength = 240): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}…`;
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return `${error}`;
}
