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

const packDir = fileURLToPath(new URL("../../packs/core/l0-tutorial-island/", import.meta.url));

const AGENT_DIR = "/tmp/garnish-agent";
const STATE_FILE = `${AGENT_DIR}/garnish/state.json`;
const CONFIG_FILE = `${AGENT_DIR}/config.yml`;

const certifiedState = JSON.stringify({ runtime: { certifiedVersion: "16.2.13" } });
const keyedConfig = ["providers:", "  anthropic:", "    apiKeyRef: ANTHROPIC_API_KEY"].join("\n");
const keylessConfig = "providers: {}";

type FixtureOverrides = Partial<{
  readonly files: Readonly<Record<string, string>>;
  readonly commands: Readonly<Record<string, RunCommandResult>>;
  readonly events: readonly VerifierEvent[];
  readonly currentSessionId: string;
}>;

function fixtureContext(overrides: FixtureOverrides = {}): EvaluationContext {
  const files = overrides.files ?? {};
  const commands = overrides.commands ?? {};

  const probes: Probes = {
    fileExists: (path: string) => path in files,
    readFile: (path: string) => {
      const content = files[path];
      if (content === undefined) {
        throw new Error(`missing fixture file ${path}`);
      }
      return content;
    },
    runCommand: (command: readonly string[] | string, _options?: RunCommandOptions) => {
      const argv = typeof command === "string" ? command : command.join(" ");
      const result = commands[argv];
      if (result === undefined) {
        throw new Error(`unexpected command ${argv}`);
      }
      return result;
    },
    mcpHandshake: () => {
      throw new Error("unexpected MCP handshake");
    },
    skillValid: () => {
      throw new Error("unexpected skill validation");
    },
    confirm: () => {
      throw new Error("unexpected confirmation");
    },
  };

  return {
    probes,
    events: overrides.events ?? [],
    currentSessionId: overrides.currentSessionId,
    paths: { agent_dir: AGENT_DIR },
  };
}

function event(
  name: string,
  seq: number,
  payload: Readonly<Record<string, unknown>> = {},
  sessionId = "s1",
): VerifierEvent {
  return { name, seq, payload, sessionId };
}

let cachedGraph: QuestGraph | undefined;
async function l0Graph(): Promise<QuestGraph> {
  cachedGraph ??= await loadPack(packDir);
  return cachedGraph;
}

async function questById(id: string): Promise<Quest> {
  const graph = await l0Graph();
  const quest = graph.questNodes[id];
  if (quest === undefined) {
    throw new Error(`quest ${id} not found in L0 pack`);
  }
  return quest;
}

test("L0 pack loads with the tutorial-island level active and all four quests", async () => {
  const graph = await l0Graph();

  expect(`${graph.pack.id}`).toBe("l0-tutorial-island");
  expect(graph.levels).toHaveLength(1);
  const level = graph.levels[0];
  expect(level && `${level.id}`).toBe("tutorial-island");
  expect(level?.order).toBe(0);
  expect(graph.quests.map((quest) => `${quest.id}`).sort()).toEqual([
    "connect-agent",
    "install-certified-pi",
    "second-turn",
    "status-screen",
  ]);
  expect(level?.unlocks.map(String).sort()).toEqual(["tool:file", "tool:shell"]);
  expect(graph.prereqEdges.map((edge) => `${edge.from}->${edge.to}`).sort()).toEqual([
    "connect-agent->second-turn",
    "connect-agent->status-screen",
    "install-certified-pi->connect-agent",
  ]);
});

test("required flags and XP match the quest inventory", async () => {
  const graph = await l0Graph();
  const byId = new Map(graph.quests.map((quest) => [`${quest.id}`, quest]));

  expect(byId.get("install-certified-pi")).toMatchObject({ required: true, xp: 10 });
  expect(byId.get("connect-agent")).toMatchObject({ required: true, xp: 20 });
  expect(byId.get("second-turn")).toMatchObject({ required: true, xp: 10 });
  expect(byId.get("status-screen")).toMatchObject({ required: false, xp: 10 });
});

test("install-certified-pi passes with session_start plus certified runtime state", async () => {
  const quest = await questById("install-certified-pi");
  const ctx = fixtureContext({
    files: { [STATE_FILE]: certifiedState },
    events: [event("session_start", 1)],
  });

  const result = await evaluateQuest(quest, ctx);

  expect(result.status).toBe("pass");
});

test("install-certified-pi fails without the session_start event", async () => {
  const quest = await questById("install-certified-pi");
  const ctx = fixtureContext({ files: { [STATE_FILE]: certifiedState } });

  const result = await evaluateQuest(quest, ctx);

  expect(result.status).toBe("fail");
});

test("install-certified-pi fails when the runtime version is absent", async () => {
  const quest = await questById("install-certified-pi");
  const ctx = fixtureContext({
    files: { [STATE_FILE]: JSON.stringify({ runtime: {} }) },
    events: [event("session_start", 1)],
  });

  const result = await evaluateQuest(quest, ctx);

  expect(result.status).toBe("fail");
});

test("connect-agent passes with a first assistant reply and a provider key reference", async () => {
  const quest = await questById("connect-agent");
  const ctx = fixtureContext({
    files: { [CONFIG_FILE]: keyedConfig },
    events: [event("agent_end", 2, { assistant_turns: 1 })],
  });

  const result = await evaluateQuest(quest, ctx);

  expect(result.status).toBe("pass");
});

test("connect-agent fails without an assistant reply", async () => {
  const quest = await questById("connect-agent");
  const ctx = fixtureContext({
    files: { [CONFIG_FILE]: keyedConfig },
    events: [event("agent_end", 2, { assistant_turns: 0 })],
  });

  const result = await evaluateQuest(quest, ctx);

  expect(result.status).toBe("fail");
});

test("connect-agent fails when no provider key reference is configured", async () => {
  const quest = await questById("connect-agent");
  const ctx = fixtureContext({
    files: { [CONFIG_FILE]: keylessConfig },
    events: [event("agent_end", 2, { assistant_turns: 1 })],
  });

  const result = await evaluateQuest(quest, ctx);

  expect(result.status).toBe("fail");
});

test("second-turn passes with two turn_start events in the current session", async () => {
  const quest = await questById("second-turn");
  const ctx = fixtureContext({
    events: [event("turn_start", 1), event("turn_start", 2)],
    currentSessionId: "s1",
  });

  const result = await evaluateQuest(quest, ctx);

  expect(result.status).toBe("pass");
});

test("second-turn fails when the second turn happens in another session", async () => {
  const quest = await questById("second-turn");
  const ctx = fixtureContext({
    events: [event("turn_start", 1, {}, "s1"), event("turn_start", 2, {}, "s2")],
    currentSessionId: "s1",
  });

  const result = await evaluateQuest(quest, ctx);

  expect(result.status).toBe("fail");
});

test("status-screen passes when garnish status exits zero", async () => {
  const quest = await questById("status-screen");
  const ctx = fixtureContext({
    commands: { "garnish status": { exitCode: 0, stdout: "Level 0", stderr: "" } },
  });

  const result = await evaluateQuest(quest, ctx);

  expect(result.status).toBe("pass");
});

test("status-screen fails when garnish status exits non-zero", async () => {
  const quest = await questById("status-screen");
  const ctx = fixtureContext({
    commands: { "garnish status": { exitCode: 1, stdout: "", stderr: "boom" } },
  });

  const result = await evaluateQuest(quest, ctx);

  expect(result.status).toBe("fail");
});
