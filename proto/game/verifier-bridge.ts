import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Check, Quest } from "../../src/core";
import { loadPacks, type QuestGraph } from "../../src/loader";
import { evaluateQuest, type CheckStatus, type QuestCheckResult, type VerifierEvent } from "../../src/verifier";
import type { EventBus, EventSink, HarnessEvent } from "../harness/types";

export type QuestSource = string | readonly string[] | QuestGraph | readonly QuestGraph[];

export interface QuestView {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly xp: number;
  readonly level: string;
  readonly checks: readonly Check[];
}

export interface CheckStateView {
  readonly questId: string;
  readonly status: CheckStatus;
  readonly checks: readonly QuestCheckResult[];
}

export interface VerifierBridge {
  stop(): void;
  activeQuest(): QuestView | null;
  checkStates(): CheckStateView | null;
  settled(): Promise<void>;
}

export interface StartVerifierOptions {
  readonly bus: EventBus;
  readonly sink: EventSink;
  readonly questSource: QuestSource;
  readonly workspace: string;
  readonly onQuestComplete: (quest: QuestView, xp: number) => void;
}

const QUEST_PACK_DIR = new URL("./packs/", import.meta.url).pathname;

export async function loadProtoQuestGraphs(questSource: QuestSource = QUEST_PACK_DIR): Promise<QuestGraph[]> {
  if (isQuestSourceArray(questSource)) {
    if (questSource.length === 0) {
      return [];
    }
    if (isStringQuestSourceArray(questSource)) {
      return loadPacks(questSource);
    }
    return [...questSource];
  }

  if (typeof questSource === "string") {
    return loadPacks([questSource]);
  }

  return [questSource];
}

function isQuestSourceArray(source: QuestSource): source is readonly string[] | readonly QuestGraph[] {
  return Array.isArray(source);
}

function isStringQuestSourceArray(source: readonly string[] | readonly QuestGraph[]): source is readonly string[] {
  return typeof source[0] === "string";
}

export async function startVerifier(opts: StartVerifierOptions): Promise<VerifierBridge> {
  const graphs = await loadProtoQuestGraphs(opts.questSource);
  const quests = graphs.flatMap((graph) => graph.levels.flatMap((level) => level.quests.map((id) => graph.questNodes[id]))).filter(Boolean);
  const completed = new Set<string>();
  const events: VerifierEvent[] = [];
  let stopped = false;
  let lastState: CheckStateView | null = null;
  let active = chooseActiveQuest();
  let queue = Promise.resolve();

  function chooseActiveQuest(): Quest | null {
    return quests.find((quest) => !completed.has(`${quest.id}`) && quest.prereqs.every((id) => completed.has(`${id}`))) ?? null;
  }

  function toQuestView(quest: Quest): QuestView {
    return {
      id: `${quest.id}`,
      title: quest.title,
      description: quest.description,
      xp: quest.xp,
      level: `${quest.level}`,
      checks: quest.checks,
    };
  }

  async function evaluateActive(): Promise<void> {
    if (stopped || active === null) {
      return;
    }

    const quest = active;
    const result = await evaluateQuest(quest, {
      probes: createProbes(opts.workspace),
      events,
      currentSessionId: opts.sink.sessionId,
      paths: {
        workspace: opts.workspace,
        sandbox: opts.workspace,
      },
      commandCwd: opts.workspace,
    });

    lastState = { questId: `${quest.id}`, status: result.status, checks: result.checks };
    if (result.status !== "pass" || completed.has(`${quest.id}`)) {
      return;
    }

    completed.add(`${quest.id}`);
    const view = toQuestView(quest);
    opts.onQuestComplete(view, quest.xp);
    opts.sink.emit({ type: "quest.completed", questId: `${quest.id}`, xp: quest.xp });
    active = chooseActiveQuest();
    if (active !== null) {
      queue = queue.then(evaluateActive, evaluateActive);
    }
  }

  function scheduleEvaluate(): void {
    queue = queue.then(evaluateActive, evaluateActive);
  }

  const unsubscribe = opts.bus.subscribe((event) => {
    if (stopped) {
      return;
    }
    events.push(toVerifierEvent(event));
    if (event.type === "turn.end" || event.type === "file.edited") {
      scheduleEvaluate();
    }
  });

  scheduleEvaluate();

  return {
    stop(): void {
      stopped = true;
      unsubscribe();
    },
    activeQuest(): QuestView | null {
      return active === null ? null : toQuestView(active);
    },
    checkStates(): CheckStateView | null {
      return lastState;
    },
    settled(): Promise<void> {
      return queue;
    },
  };
}

function toVerifierEvent(event: HarnessEvent): VerifierEvent {
  const { type, id, parentId, sessionId, seq, ts, ...payload } = event;
  return {
    name: type,
    sessionId,
    seq,
    payload: {
      ...payload,
      id,
      parentId,
      sessionId,
      seq,
      ts,
    },
  };
}

function createProbes(workspace: string) {
  return {
    async fileExists(path: string): Promise<boolean> {
      try {
        await access(path);
        return true;
      } catch {
        return false;
      }
    },
    readFile(path: string): Promise<string> {
      return readFile(path, "utf8");
    },
    async runCommand(command: readonly string[] | string, options?: { readonly cwd?: string; readonly timeoutMs?: number }) {
      const args = typeof command === "string" ? ["sh", "-c", command] : [...command];
      const proc = Bun.spawn(args, {
        cwd: options?.cwd ?? workspace,
        stdout: "pipe",
        stderr: "pipe",
      });
      const timeout = options?.timeoutMs === undefined ? undefined : setTimeout(() => proc.kill(), options.timeoutMs);
      try {
        const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
        return { exitCode, stdout, stderr };
      } finally {
        if (timeout !== undefined) {
          clearTimeout(timeout);
        }
      }
    },
    mcpHandshake() {
      return { ok: false, error: "mcp checks are not wired in the proto game bridge" };
    },
    skillValid() {
      return { valid: false, errors: ["skill checks are not wired in the proto game bridge"] };
    },
    confirm() {
      return undefined;
    },
  };
}

export function defaultQuestPackDir(): string {
  return join(QUEST_PACK_DIR);
}
