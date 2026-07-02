import { expect, test } from "bun:test";

import { runtimePaths, type GateConfigEffects } from "../../src/adapter";
import { unlockCommand, type ProgressionStore } from "../../src/cli";
import type { FeatureId, LevelId, ProgressionEvent, QuestId, UnlockEvent } from "../../src/core";
import {
  registerLiveUnlocks,
  type LiveUnlockDeps,
  type UnlockCommandHandler,
  type UnlockExtensionContext,
  type UnlockPi,
} from "../../src/extension";
import type { PiEventHandler, PiExtensionEvent } from "../../src/extension";
import { foldEvents, type ProgressionGraph } from "../../src/progression";

const level = { l0: "tutorial-island" as LevelId, l1: "first-quest" as LevelId } as const;
const quest = { connect: "connect-agent" as QuestId } as const;
const feature = {
  file: "tool:file" as FeatureId,
  shell: "tool:shell" as FeatureId,
  skills: "skills" as FeatureId,
} as const;

const graph = {
  levels: [
    { id: level.l0, order: 0, quests: [quest.connect], unlocks: [feature.file] },
    { id: level.l1, order: 1, quests: [], unlocks: [feature.skills] },
  ],
  quests: [{ id: quest.connect, level: level.l0, required: true, xp: 20 }],
} satisfies ProgressionGraph;

class MemoryStore implements ProgressionStore {
  private log: ProgressionEvent[] = [];

  readEvents(): readonly ProgressionEvent[] {
    return this.log;
  }

  appendEvents(events: readonly ProgressionEvent[]): void {
    this.log = [...this.log, ...events];
  }
}

function featureUnlock(id: FeatureId): UnlockEvent {
  return {
    at: "2026-07-02T00:00:00Z",
    type: "unlock",
    target: { type: "feature", id },
    reason: "quest_completed",
  };
}

class FakeUnlockPi implements UnlockPi {
  readonly handlers = new Map<string, PiEventHandler[]>();
  readonly commands = new Map<string, UnlockCommandHandler>();
  readonly notifications: string[] = [];
  readonly setActiveToolsCalls: Array<readonly string[]> = [];
  reloadCalls = 0;
  activeTools: readonly string[] = ["read"];

  readonly ctx: UnlockExtensionContext = {
    hasUI: true,
    ui: {
      notify: (message: string) => {
        this.notifications.push(message);
      },
    },
    session: {
      getActiveTools: () => this.activeTools,
      setActiveTools: (tools: readonly string[]) => {
        this.setActiveToolsCalls.push(tools);
        this.activeTools = tools;
      },
      reload: () => {
        this.reloadCalls += 1;
      },
    },
  };

  on(event: string, handler: PiEventHandler): void {
    const existing = this.handlers.get(event) ?? [];
    existing.push(handler);
    this.handlers.set(event, existing);
  }

  registerCommand(name: string, handler: UnlockCommandHandler): void {
    this.commands.set(name, handler);
  }

  emit(event: PiExtensionEvent): void {
    for (const handler of this.handlers.get(event.type) ?? []) {
      handler(event, this.ctx);
    }
  }

  async runCommand(name: string, args: string): Promise<void> {
    const handler = this.commands.get(name);
    if (handler === undefined) {
      throw new Error(`command ${name} not registered`);
    }
    await handler(args, this.ctx);
  }
}

interface Harness {
  readonly pi: FakeUnlockPi;
  readonly store: MemoryStore;
  readonly written: string[];
  readonly deps: LiveUnlockDeps;
}

function makeHarness(): Harness {
  const pi = new FakeUnlockPi();
  const store = new MemoryStore();
  const written: string[] = [];
  const gateEffects: GateConfigEffects = {
    mkdirp: () => undefined,
    writeFile: (path: string) => {
      written.push(path);
    },
  };

  return {
    pi,
    store,
    written,
    deps: {
      graph,
      store,
      runtimePaths: runtimePaths({ garnishRootDir: "/tmp/garnish-root" }),
      gateEffects,
      now: () => "2026-07-02T00:00:00Z",
    },
  };
}

test("runtime tool unlocks call setActiveTools live without reload", async () => {
  const { pi, store, deps } = makeHarness();
  const handle = registerLiveUnlocks(pi, deps);

  store.appendEvents([featureUnlock(feature.file)]);
  pi.emit({ type: "turn_end", sessionId: "s1" });
  await handle.applyUnlocks();

  expect(pi.setActiveToolsCalls.length).toBe(1);
  const applied = pi.setActiveToolsCalls[0] ?? [];
  for (const tool of ["edit", "glob", "grep", "read", "write"]) {
    expect(applied).toContain(tool);
  }
  expect(pi.reloadCalls).toBe(0);
  expect(pi.notifications.some((message) => message.includes("Tools unlocked live"))).toBe(true);
});

test("config-baked unlocks write gate config and reload automatically", async () => {
  const { pi, store, written, deps } = makeHarness();
  const handle = registerLiveUnlocks(pi, deps);

  store.appendEvents([featureUnlock(feature.skills)]);
  pi.emit({ type: "turn_end", sessionId: "s1" });
  await handle.applyUnlocks();

  expect(written.some((path) => path.endsWith("config.yml"))).toBe(true);
  expect(pi.reloadCalls).toBe(1);
  const reloadNote = pi.notifications.find((message) => message.includes("reloading to apply"));
  expect(reloadNote).toBeDefined();
  expect(reloadNote).toContain("progress is saved");
  expect(reloadNote).not.toMatch(/edit.*config|config.*manually/i);
});

test("unlock application is exactly-once and monotonic across repeated events", async () => {
  const { pi, store, deps } = makeHarness();
  const handle = registerLiveUnlocks(pi, deps);

  store.appendEvents([featureUnlock(feature.file)]);
  pi.emit({ type: "turn_end", sessionId: "s1" });
  await handle.applyUnlocks();
  pi.emit({ type: "turn_end", sessionId: "s1" });
  pi.emit({ type: "agent_end", sessionId: "s1" });
  await handle.applyUnlocks();

  expect(pi.setActiveToolsCalls.length).toBe(1);

  const before = handle.appliedCapabilities();
  store.appendEvents([featureUnlock(feature.shell)]);
  pi.emit({ type: "turn_end", sessionId: "s1" });
  await handle.applyUnlocks();
  const after = handle.appliedCapabilities();

  for (const capability of before) {
    expect(after).toContain(capability);
  }
  expect(after.length).toBeGreaterThan(before.length);
});

test("/unlock reaches the same core path as CLI unlock and reports resulting state", async () => {
  const first = makeHarness();
  registerLiveUnlocks(first.pi, first.deps);
  await first.pi.runCommand("unlock", "--level 1");

  const cliStore = new MemoryStore();
  await unlockCommand(
    { graph, store: cliStore, now: () => "2026-07-02T00:00:00Z" },
    { level: "1" },
  );

  const viaSlash = foldEvents(first.store.readEvents(), graph);
  const viaCli = foldEvents(cliStore.readEvents(), graph);
  expect(viaSlash.unlockSet).toEqual(viaCli.unlockSet);
  expect(viaSlash.xpTotal).toBe(0);
  expect(first.pi.notifications.some((message) => message.includes("Unlocked levels"))).toBe(true);
});

test("/unlock rejects unknown levels with the CLI error text", async () => {
  const { pi, deps } = makeHarness();
  registerLiveUnlocks(pi, deps);

  await pi.runCommand("unlock", "--level nope");

  expect(pi.notifications.some((message) => message.includes('unknown level "nope"'))).toBe(true);
});

test("skills reload path: store-backed state survives while session entries do not", async () => {
  const { pi, store, deps } = makeHarness();
  const handle = registerLiveUnlocks(pi, deps);

  store.appendEvents([
    {
      at: "2026-07-02T00:00:00Z",
      type: "quest_completed",
      quest_id: quest.connect,
      level_id: level.l0,
      required: true,
      xp: 20,
    },
    featureUnlock(feature.skills),
  ]);
  pi.emit({ type: "turn_end", sessionId: "s1" });
  await handle.applyUnlocks();
  expect(pi.reloadCalls).toBe(1);

  // Post-reload: a fresh fold of the durable store reproduces the same progression state,
  // per the spike finding that session entries are NOT durable across headless reload.
  const rehydrated = foldEvents(store.readEvents(), graph);
  expect(rehydrated.completedQuests.map(String)).toEqual(["connect-agent"]);
  expect(rehydrated.xpTotal).toBe(20);
  expect(rehydrated.unlockSet.features.map(String)).toContain("skills");
});
