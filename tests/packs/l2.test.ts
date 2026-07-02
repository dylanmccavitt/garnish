import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

import {
  evaluateQuest,
  loadPack,
  type EvaluationContext,
  type Probes,
  type Quest,
  type QuestGraph,
  type RunCommandOptions,
  type RunCommandResult,
  type VerifierEvent,
} from "../../src/index";

const packDir = fileURLToPath(new URL("../../packs/core/l2-lore/", import.meta.url));
const SANDBOX = "/tmp/garnish-sandbox";

type FixtureOverrides = Partial<{
  readonly existingFiles: readonly string[];
  readonly commands: Readonly<Record<string, RunCommandResult>>;
  readonly confirmations: Readonly<Record<string, boolean | undefined>>;
  readonly events: readonly VerifierEvent[];
}>;

function fixtureContext(overrides: FixtureOverrides = {}): EvaluationContext {
  const existingFiles = new Set(overrides.existingFiles ?? []);
  const commands = overrides.commands ?? {};

  const probes: Probes = {
    fileExists: (path: string) => existingFiles.has(path),
    readFile: (path: string) => {
      throw new Error(`unexpected readFile ${path}`);
    },
    runCommand: (command: readonly string[] | string, options?: RunCommandOptions) => {
      const argv = typeof command === "string" ? command : command.join(" ");
      const key = `${options?.cwd ?? ""}|${argv}`;
      const result = commands[key];
      if (result === undefined) {
        throw new Error(`unexpected command ${key}`);
      }
      return result;
    },
    mcpHandshake: () => {
      throw new Error("unexpected MCP handshake");
    },
    skillValid: () => {
      throw new Error("unexpected skill validation");
    },
    confirm: (id: string) => {
      const confirmations = overrides.confirmations;
      if (confirmations === undefined || !(id in confirmations)) {
        throw new Error(`unexpected confirmation ${id}`);
      }
      return confirmations[id];
    },
  };

  return {
    probes,
    events: overrides.events ?? [],
    paths: { sandbox: SANDBOX },
  };
}

function event(name: string, seq: number, payload: Readonly<Record<string, unknown>> = {}): VerifierEvent {
  return { name, seq, payload, sessionId: "s1" };
}

const ok: RunCommandResult = { exitCode: 0, stdout: "", stderr: "" };
const failed: RunCommandResult = { exitCode: 1, stdout: "", stderr: "" };

const projectLoreCommand =
  `|sh -c test -f "$1" && grep -Eq "Project convention: every generated lore note starts with LORE:" "$1" sh ${SANDBOX}/AGENTS.md`;
const followRuleCommand = `|sh -c test -f "$1" && grep -Eq "^LORE: .+" "$1" sh ${SANDBOX}/lore-note.txt`;

let cachedGraph: QuestGraph | undefined;
async function l2Graph(): Promise<QuestGraph> {
  cachedGraph ??= await loadPack(packDir);
  return cachedGraph;
}

async function questById(id: string): Promise<Quest> {
  const graph = await l2Graph();
  const quest = graph.questNodes[id];
  if (quest === undefined) {
    throw new Error(`quest ${id} not found in L2 pack`);
  }
  return quest;
}

test("L2 pack loads with the lore level and four context quests", async () => {
  const graph = await l2Graph();

  expect(`${graph.pack.id}`).toBe("l2-lore");
  const levelEntry = graph.levels[0];
  expect(levelEntry && `${levelEntry.id}`).toBe("lore");
  expect(levelEntry?.order).toBe(2);
  expect(levelEntry?.unlocks.map(String)).toEqual(["skills"]);
  expect(levelEntry?.quests.map(String).sort()).toEqual([
    "context-diet",
    "follow-a-rule",
    "project-lore-file",
    "resume-run",
  ]);
  expect(graph.quests.map((quest) => `${quest.id}`).sort()).toEqual([
    "context-diet",
    "follow-a-rule",
    "project-lore-file",
    "resume-run",
  ]);

  const byId: Record<string, Quest> = Object.fromEntries(graph.quests.map((quest) => [`${quest.id}`, quest]));
  expect(byId["project-lore-file"]).toMatchObject({ required: true, xp: 20, prereqs: [] });
  expect(byId["follow-a-rule"]).toMatchObject({ required: true, xp: 20, prereqs: ["project-lore-file"] });
  expect(byId["resume-run"]).toMatchObject({ required: true, xp: 15, prereqs: ["project-lore-file"] });
  expect(byId["context-diet"]).toMatchObject({ required: false, xp: 10 });
});

test("project-lore-file passes with AGENTS.md and the required convention", async () => {
  const quest = await questById("project-lore-file");
  const ctx = fixtureContext({
    existingFiles: [`${SANDBOX}/AGENTS.md`],
    commands: { [projectLoreCommand]: ok },
  });

  expect((await evaluateQuest(quest, ctx)).status).toBe("pass");
});

test("project-lore-file fails when AGENTS.md is absent or lacks the convention", async () => {
  const quest = await questById("project-lore-file");

  const noFile = fixtureContext({ commands: { [projectLoreCommand]: failed } });
  expect((await evaluateQuest(quest, noFile)).status).toBe("fail");

  const wrongLore = fixtureContext({
    existingFiles: [`${SANDBOX}/AGENTS.md`],
    commands: { [projectLoreCommand]: failed },
  });
  expect((await evaluateQuest(quest, wrongLore)).status).toBe("fail");
});

test("follow-a-rule passes for a successful write or edit plus generated lore output", async () => {
  const quest = await questById("follow-a-rule");

  const writePass = fixtureContext({
    events: [event("tool_result", 1, { tool: "write", success: true })],
    commands: { [followRuleCommand]: ok },
  });
  expect((await evaluateQuest(quest, writePass)).status).toBe("pass");

  const editPass = fixtureContext({
    events: [event("tool_result", 2, { tool: "edit", success: true })],
    commands: { [followRuleCommand]: ok },
  });
  expect((await evaluateQuest(quest, editPass)).status).toBe("pass");
});

test("follow-a-rule fails without a matching tool result or matching generated output", async () => {
  const quest = await questById("follow-a-rule");

  const wrongTool = fixtureContext({
    events: [event("tool_result", 1, { tool: "bash", success: true })],
    commands: { [followRuleCommand]: ok },
  });
  expect((await evaluateQuest(quest, wrongTool)).status).toBe("fail");

  const wrongOutput = fixtureContext({
    events: [event("tool_result", 2, { tool: "edit", success: true })],
    commands: { [followRuleCommand]: failed },
  });
  expect((await evaluateQuest(quest, wrongOutput)).status).toBe("fail");
});

test("resume-run passes only for a resumed session_start", async () => {
  const quest = await questById("resume-run");

  const resumed = fixtureContext({ events: [event("session_start", 1, { resumed: true })] });
  expect((await evaluateQuest(quest, resumed)).status).toBe("pass");

  const freshSession = fixtureContext({ events: [event("session_start", 1, { resumed: false })] });
  expect((await evaluateQuest(quest, freshSession)).status).toBe("fail");

  const unrelatedFreshSession = fixtureContext({ events: [event("session_start", 1, {})] });
  expect((await evaluateQuest(quest, unrelatedFreshSession)).status).toBe("fail");
});

test("context-diet passes by confirmation and otherwise does not pass", async () => {
  const quest = await questById("context-diet");

  const confirmed = fixtureContext({ confirmations: { "context-diet": true } });
  expect((await evaluateQuest(quest, confirmed)).status).toBe("pass");

  const declined = fixtureContext({ confirmations: { "context-diet": false } });
  expect((await evaluateQuest(quest, declined)).status).toBe("fail");

  const unconfirmed = fixtureContext({ confirmations: { "context-diet": undefined } });
  expect((await evaluateQuest(quest, unconfirmed)).status).toBe("pending");
});
