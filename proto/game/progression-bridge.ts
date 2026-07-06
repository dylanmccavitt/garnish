import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ProgressionEvent, QuestCompletedEvent } from "../../src/core";
import { deriveUnlocks, foldEvents, type ProgressionGraph, type ProgressionState } from "../../src/progression";

export interface ProgressionBridge {
  grantQuest(questId: string, xp: number): void;
  state(): ProgressionState;
  unlockedIds(): Set<string>;
}

export interface CreateProgressionOptions {
  readonly root: string;
  readonly onUnlock: (unlockId: string, tools: string[]) => void;
}

const PROTO_GRAPH: ProgressionGraph = {
  levels: [
    {
      id: "tutorial-island" as never,
      order: 0,
      quests: ["mise-en-place", "look-around"] as never,
      unlocks: ["l0-hands"] as never,
    },
    {
      id: "first-steps" as never,
      order: 1,
      quests: ["first-edit"] as never,
      unlocks: ["l1-shell"] as never,
    },
    {
      id: "first-quest" as never,
      order: 2,
      quests: ["fix-bug-prove-it"] as never,
      unlocks: [] as never,
    },
  ],
  quests: [
    { id: "mise-en-place" as never, level: "tutorial-island" as never, required: true, xp: 5 },
    { id: "look-around" as never, level: "tutorial-island" as never, required: true, xp: 5 },
    { id: "first-edit" as never, level: "first-steps" as never, required: true, xp: 10 },
    { id: "fix-bug-prove-it" as never, level: "first-quest" as never, required: true, xp: 20 },
  ],
};

const TOOLS_BY_UNLOCK: Record<string, string[]> = {
  "l0-hands": ["write", "edit"],
  "l1-shell": ["bash"],
};

export function createProgression(opts: CreateProgressionOptions): ProgressionBridge {
  const eventFile = join(opts.root, ".garnish-proto", "progression", "events.jsonl");
  let events = readExistingEvents(eventFile);
  let snapshot = foldEvents(events, PROTO_GRAPH);
  const notifiedUnlocks = new Set<string>();

  function persist(): void {
    const dir = join(opts.root, ".garnish-proto", "progression");
    mkdirSync(dir, { recursive: true });
    writeFileSync(eventFile, events.map((event) => JSON.stringify(event)).join("\n") + (events.length > 0 ? "\n" : ""));
  }

  function notifySnapshotUnlocks(): void {
    for (const feature of snapshot.unlockSet.features) {
      const unlockId = `${feature}`;
      if (notifiedUnlocks.has(unlockId)) {
        continue;
      }
      notifiedUnlocks.add(unlockId);
      opts.onUnlock(unlockId, TOOLS_BY_UNLOCK[unlockId] ?? []);
    }
  }

  function applyDerivedUnlocks(): void {
    const derived = deriveUnlocks(snapshot, PROTO_GRAPH);
    const additions = derived.filter((event) => event.target.type === "feature" && !snapshot.unlockSet.features.includes(event.target.id));
    if (additions.length === 0) {
      return;
    }
    events = [...events, ...additions];
    snapshot = foldEvents(events, PROTO_GRAPH);
    persist();
    notifySnapshotUnlocks();
  }

  applyDerivedUnlocks();
  notifySnapshotUnlocks();

  return {
    grantQuest(questId: string, xp: number): void {
      if (snapshot.completedQuests.includes(questId as never)) {
        return;
      }
      const level = PROTO_GRAPH.quests.find((quest) => `${quest.id}` === questId)?.level;
      if (level === undefined) {
        return;
      }
      const event: QuestCompletedEvent = {
        at: new Date().toISOString(),
        type: "quest_completed",
        quest_id: questId as never,
        level_id: level,
        required: true,
        xp,
      };
      events = [...events, event];
      snapshot = foldEvents(events, PROTO_GRAPH);
      persist();
      applyDerivedUnlocks();
    },
    state(): ProgressionState {
      return snapshot;
    },
    unlockedIds(): Set<string> {
      return new Set(snapshot.unlockSet.features.map((feature) => `${feature}`));
    },
  };
}

function readExistingEvents(path: string): ProgressionEvent[] {
  try {
    const text = readFileSync(path, "utf8");
    return text
      .split("\n")
      .map((line: string) => line.trim())
      .filter((line: string) => line.length > 0)
      .map((line: string) => JSON.parse(line) as ProgressionEvent);
  } catch {
    return [];
  }
}

export function protoProgressionGraph(): ProgressionGraph {
  return PROTO_GRAPH;
}
