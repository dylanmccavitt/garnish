import { expect, test } from "bun:test";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import { discoverPacks, loadPack, loadPacks, toGraphJSON, type QuestGraph } from "../../src/loader";

const fixturesDir = fileURLToPath(new URL("./fixtures/", import.meta.url));
const fixture = (name: string): string => join(fixturesDir, name);

test("discoverPacks finds configured pack directories deterministically", async () => {
  const discoveries = await discoverPacks([fixturesDir]);

  expect(discoveries.map((discovery) => basename(discovery.path))).toEqual([
    "cyclic-prereqs",
    "schema-invalid-quest",
    "unknown-feature",
    "valid-minimal",
  ]);
  expect(discoveries.find((discovery) => basename(discovery.path) === "valid-minimal")).toMatchObject({
    metadataPath: join(fixture("valid-minimal"), "pack.yml"),
    format: "yaml",
  });
});

test("valid minimal pack loads into deterministic graph JSON", async () => {
  const graph = await loadPack(fixture("valid-minimal"));
  const graphJson = toGraphJSON(graph);

  expect(`${graph.pack.id}`).toBe("valid-minimal");
  expect(graph.prereqEdges.map((edge) => ({ from: `${edge.from}`, to: `${edge.to}` }))).toEqual([
    { from: "connect-agent", to: "first-file" },
    { from: "install-engine", to: "connect-agent" },
  ]);
  expect(graph.unlockEdges.map((edge) => ({ quest: `${edge.quest}`, feature: `${edge.feature}` }))).toEqual([
    { quest: "first-file", feature: "tool:file" },
    { quest: "install-engine", feature: "feature:chat" },
  ]);
  expect(toGraphJSON(await loadPack(fixture("valid-minimal")))).toBe(graphJson);
  expect(JSON.parse(graphJson)).toEqual({
    edges: {
      prereqs: [
        { from: "connect-agent", to: "first-file" },
        { from: "install-engine", to: "connect-agent" },
      ],
      unlocks: [
        { feature: "tool:file", quest: "first-file" },
        { feature: "feature:chat", quest: "install-engine" },
      ],
    },
    knownFeatureIds: ["feature:chat", "tool:file"],
    levels: [
      {
        id: "tutorial-island",
        order: 0,
        quests: ["connect-agent", "install-engine"],
        title: "Tutorial Island",
        unlocks: ["feature:chat"],
      },
      {
        id: "first-quest",
        order: 1,
        quests: ["first-file"],
        title: "First Quest",
        unlocks: ["tool:file"],
      },
    ],
    pack: {
      id: "valid-minimal",
      levels: [
        {
          id: "tutorial-island",
          order: 0,
          quests: ["connect-agent", "install-engine"],
          title: "Tutorial Island",
          unlocks: ["feature:chat"],
        },
        {
          id: "first-quest",
          order: 1,
          quests: ["first-file"],
          title: "First Quest",
          unlocks: ["tool:file"],
        },
      ],
      requires: { adapters: ["pi"], features: [] },
      title: "Valid Minimal Pack",
      version: "0.1.0",
    },
    quests: [
      {
        checks: [{ match: { event: "agent_end", min_assistant_turns: 1 }, type: "event" }],
        description: "Connect a model and complete the first agent turn.",
        id: "connect-agent",
        level: "tutorial-island",
        prereqs: ["install-engine"],
        required: true,
        title: "Connect agent",
        unlocks: [],
        xp: 20,
      },
      {
        checks: [{ path: "{sandbox}/first-file.txt", type: "file_exists" }],
        description: "Create the first file through the agent.",
        id: "first-file",
        level: "first-quest",
        prereqs: ["connect-agent"],
        required: true,
        title: "First file",
        unlocks: ["tool:file"],
        xp: 15,
      },
      {
        checks: [{ match: { event: "session_start" }, type: "event" }],
        description: "Install the certified Garnish runtime.",
        id: "install-engine",
        level: "tutorial-island",
        prereqs: [],
        required: true,
        title: "Install engine",
        unlocks: ["feature:chat"],
        xp: 10,
      },
    ],
  });
});

test("schema-invalid quest rejects the whole pack and names the failing file", async () => {
  await expect(loadPack(fixture("schema-invalid-quest"))).rejects.toThrow(/schema-invalid-quest.*broken-quest\.md.*title/);
});

test("cyclic prereqs reject with the cycle path", async () => {
  await expect(loadPack(fixture("cyclic-prereqs"))).rejects.toThrow(
    /cyclic quest prereqs: cycle-a -> cycle-b -> cycle-a/,
  );
});

test("unknown quest unlock feature rejects with the bad id and quest", async () => {
  await expect(loadPack(fixture("unknown-feature"))).rejects.toThrow(
    /quest "unlock-shell" references unknown unlock feature "tool:shell"/,
  );
});

test("loadPacks rejects atomically without returning partial graphs", async () => {
  let loaded: QuestGraph[] | undefined;
  try {
    loaded = await loadPacks([fixture("valid-minimal"), fixture("schema-invalid-quest")]);
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/schema-invalid-quest.*broken-quest\.md/);
  }

  expect(loaded).toBeUndefined();
});
