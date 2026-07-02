import { expect, test } from "bun:test";

import type { ProgressionStore } from "../../src/cli";
import type { FeatureId, LevelId, ProgressionEvent, Quest, QuestId } from "../../src/core";
import {
  registerTutorBridge,
  renderQuestPayload,
  writeTutorFraming,
  TUTOR_FRAMING,
  type PiEventHandler,
  type PiExtensionContext,
  type TutorInjection,
} from "../../src/extension";
import { foldEvents, type ProgressionGraph } from "../../src/progression";

const level = { l0: "tutorial-island" as LevelId } as const;
const quest = { connect: "connect-agent" as QuestId, second: "second-turn" as QuestId } as const;

const graph = {
  levels: [{ id: level.l0, order: 0, quests: [quest.connect, quest.second], unlocks: ["tool:file" as FeatureId] }],
  quests: [
    { id: quest.connect, level: level.l0, required: true, xp: 20 },
    { id: quest.second, level: level.l0, required: true, xp: 10 },
  ],
} satisfies ProgressionGraph;

const connectQuest: Quest = {
  id: quest.connect,
  level: level.l0,
  title: "Player 1 connected",
  description: "Set up a provider key and complete your first model round trip.",
  xp: 20,
  required: true,
  prereqs: [],
  unlocks: [],
  checks: [
    { type: "event", match: { event: "agent_end", min_assistant_turns: 1 } },
    { type: "yaml_path", file: "{agent_dir}/config.yml", path: "$.providers[*].apiKeyRef", assert: "non_empty" },
  ],
};

const secondQuest: Quest = {
  id: quest.second,
  level: level.l0,
  title: "Continue from save",
  description: "Send a second message in the same session.",
  xp: 10,
  required: true,
  prereqs: [quest.connect],
  unlocks: [],
  checks: [{ type: "event", match: { event: "turn_start", count: { min: 2 } }, sameSession: true }],
};

class MemoryStore implements ProgressionStore {
  private log: ProgressionEvent[] = [];

  readEvents(): readonly ProgressionEvent[] {
    return this.log;
  }

  appendEvents(events: readonly ProgressionEvent[]): void {
    this.log = [...this.log, ...events];
  }
}

class FakeContextPi {
  readonly handlers = new Map<string, PiEventHandler[]>();

  readonly ctx: PiExtensionContext = {
    hasUI: false,
    ui: { notify: () => undefined },
  };

  on(event: string, handler: PiEventHandler): void {
    const existing = this.handlers.get(event) ?? [];
    existing.push(handler);
    this.handlers.set(event, existing);
  }

  emitContext(messages: unknown[]): void {
    for (const handler of this.handlers.get("context") ?? []) {
      handler({ type: "context", messages }, this.ctx);
    }
  }
}

function completion(id: QuestId, xp: number): ProgressionEvent {
  return {
    at: "2026-07-02T00:00:00Z",
    type: "quest_completed",
    quest_id: id,
    level_id: level.l0,
    required: true,
    xp,
  };
}

function lastInjection(messages: unknown[]): TutorInjection {
  const entry = messages.at(-1);
  if (
    entry === null ||
    typeof entry !== "object" ||
    !("garnish" in entry) ||
    (entry as TutorInjection).garnish !== "tutor-context"
  ) {
    throw new Error("expected a tutor-context injection as the last message");
  }
  return entry as TutorInjection;
}

test("provision writes static tutor framing to APPEND_SYSTEM.md without touching other prompt files", async () => {
  const writes: Array<{ path: string; content: string }> = [];
  const path = await writeTutorFraming("/tmp/agent", {
    writeFile: (writePath, content) => {
      writes.push({ path: writePath, content });
    },
  });

  expect(path).toBe("/tmp/agent/APPEND_SYSTEM.md");
  expect(writes).toHaveLength(1);
  const framing = writes[0]?.content ?? "";
  expect(framing).toContain("Garnish is active");
  expect(framing).toContain("tutor");
  expect(framing).toContain("verified mechanically");
  expect(framing).toContain("Never mark quests complete yourself");
  expect(writes.every((write) => !write.path.endsWith("SYSTEM.md") || write.path.endsWith("APPEND_SYSTEM.md"))).toBe(
    true,
  );
  expect(TUTOR_FRAMING).not.toContain("SYSTEM.md replacement");
});

test("context injection appends the active quest's name, checks, and progress without replacing messages", () => {
  const pi = new FakeContextPi();
  const store = new MemoryStore();
  registerTutorBridge(pi, { graph, quests: [connectQuest, secondQuest], store });

  const messages: unknown[] = [{ role: "system", content: "pi default prompt" }, { role: "user", content: "what's my quest?" }];
  pi.emitContext(messages);

  expect(messages).toHaveLength(3);
  expect(messages[0]).toEqual({ role: "system", content: "pi default prompt" });
  const injected = lastInjection(messages);
  expect(injected.content).toContain("Player 1 connected");
  expect(injected.content).toContain("connect-agent");
  expect(injected.content).toContain("harness event agent_end");
  expect(injected.content).toContain("config value at $.providers[*].apiKeyRef");
  expect(injected.content).toContain("Progress: 0/2 required quests");
  expect(injected.content).toContain("Hint policy:");
  expect(injected.content).toContain("do not self-certify");
});

test("quest switching changes injected content per call without any disk rewrite", () => {
  const pi = new FakeContextPi();
  const store = new MemoryStore();
  registerTutorBridge(pi, { graph, quests: [connectQuest, secondQuest], store });

  const first: unknown[] = [];
  pi.emitContext(first);
  expect(lastInjection(first).content).toContain("Player 1 connected");

  store.appendEvents([completion(quest.connect, 20)]);

  const second: unknown[] = [];
  pi.emitContext(second);
  const injected = lastInjection(second).content;
  expect(injected).toContain("Continue from save");
  expect(injected).toContain("Progress: 1/2 required quests");
  expect(injected).not.toContain("Player 1 connected");
});

test("payload is bounded and keeps checks when the description is oversized", () => {
  const verbose: Quest = {
    ...connectQuest,
    description: "x".repeat(4000),
  };
  const state = foldEvents([], graph);

  const payload = renderQuestPayload(state, graph, [verbose, secondQuest]);

  expect(new TextEncoder().encode(payload).length).toBeLessThanOrEqual(1024);
  expect(payload).toContain("Acceptance checks:");
  expect(payload).toContain("harness event agent_end");
});

test("all required quests complete: payload reports completion instead of a quest", () => {
  const pi = new FakeContextPi();
  const store = new MemoryStore();
  store.appendEvents([completion(quest.connect, 20), completion(quest.second, 10)]);
  registerTutorBridge(pi, { graph, quests: [connectQuest, secondQuest], store });

  const messages: unknown[] = [];
  pi.emitContext(messages);

  expect(lastInjection(messages).content).toContain("No active quest");
});

test("live smoke stand-in: a grounded answer to 'what's my quest?' contains the real checks", () => {
  // The injected payload IS the grounding the model sees; assert it names the actual
  // acceptance checks rather than generic guidance (PRD AC-7 surface at the seam).
  const state = foldEvents([], graph);
  const payload = renderQuestPayload(state, graph, [connectQuest, secondQuest]);

  for (const grounding of ["Player 1 connected", "agent_end", "apiKeyRef"]) {
    expect(payload).toContain(grounding);
  }
});
