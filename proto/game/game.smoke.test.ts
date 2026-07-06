import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "bun:test";

import type { EventBus, EventSink, HarnessEvent, HarnessEventPayload, SessionLog } from "../harness/types";
import { createProgression, createTutorProvider, defaultQuestPackDir, loadProtoQuestGraphs, startVerifier } from "./index";

class MemoryBus implements EventBus {
  readonly subscribers = new Set<(e: HarnessEvent) => void>();

  publish(e: HarnessEvent): void {
    for (const subscriber of this.subscribers) {
      subscriber(e);
    }
  }

  subscribe(fn: (e: HarnessEvent) => void): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }
}

class MemoryLog implements SessionLog {
  readonly path = "memory://game-smoke";
  readonly events: HarnessEvent[] = [];

  append(e: HarnessEvent): void {
    this.events.push(e);
  }

  read(): HarnessEvent[] {
    return [...this.events];
  }
}

class MemorySink implements EventSink {
  readonly bus = new MemoryBus();
  readonly log = new MemoryLog();
  readonly sessionId = "game-smoke-session";
  #seq = 0;

  emit(payload: HarnessEventPayload, parentId: string | null = null): HarnessEvent {
    const event = {
      ...payload,
      id: `e-${++this.#seq}`,
      parentId,
      sessionId: this.sessionId,
      seq: this.#seq,
      ts: this.#seq,
    } as HarnessEvent;
    this.log.append(event);
    this.bus.publish(event);
    return event;
  }
}

test("proto/game packs load through the v1 loader and reject unknown ids", async () => {
  const graphs = await loadProtoQuestGraphs(defaultQuestPackDir());
  expect(graphs.map((graph) => `${graph.pack.id}`)).toEqual(["l0-tutorial-proto", "l1-first-quest-proto"]);
  expect(graphs[0]?.questNodes["look-around"]?.checks[0]).toMatchObject({ type: "event", match: { event: "tool.result" } });

  const badPack = mkdtempSync(join(tmpdir(), "garnish-bad-pack-"));
  writeFileSync(
    join(badPack, "pack.yml"),
    [
      "id: bad-pack",
      "title: Bad Pack",
      "version: 0.1.0",
      "levels:",
      "  - id: bad-level",
      "    title: Bad Level",
      "    order: 0",
      "    quests: [bad-quest]",
      "    unlocks: []",
    ].join("\n"),
  );
  writeFileSync(
    join(badPack, "bad.md"),
    [
      "---",
      "id: bad-quest",
      "level: missing-level",
      "title: Bad Quest",
      "xp: 1",
      "required: true",
      "prereqs: []",
      "unlocks: []",
      "checks:",
      "  - type: event",
      "    match: { event: tool.result }",
      "---",
      "bad",
    ].join("\n"),
  );

  await expect(loadProtoQuestGraphs(badPack)).rejects.toThrow(/unknown level/);
});

test("proto/game first-party events complete L0 once, fold progression, and feed tutor checks", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "garnish-game-workspace-"));
  mkdirSync(join(workspace, "src"), { recursive: true });
  writeFileSync(join(workspace, "src", "bug.txt"), "BROKEN\n");

  const sink = new MemorySink();
  const unlocks: Array<{ id: string; tools: string[] }> = [];
  const progression = createProgression({
    root: workspace,
    onUnlock(unlockId, tools) {
      unlocks.push({ id: unlockId, tools });
    },
  });
  const completions: string[] = [];
  const verifier = await startVerifier({
    bus: sink.bus,
    sink,
    questSource: defaultQuestPackDir(),
    workspace,
    onQuestComplete(quest, xp) {
      completions.push(quest.id);
      progression.grantQuest(quest.id, xp);
    },
  });
  await verifier.settled();

  expect(verifier.activeQuest()?.id).toBe("look-around");
  sink.emit({ type: "tool.result", callId: "read-1", tool: "read", output: "README", isError: false });
  sink.emit({ type: "turn.end", turn: 1, stopReason: "end_turn" });
  await verifier.settled();

  expect(completions).toEqual(["look-around"]);
  expect(verifier.activeQuest()?.id).toBe("first-edit");

  const tutor = createTutorProvider({ verifier });
  const tutorBlock = tutor();
  expect(tutorBlock).toContain("yaml {workspace}/quest-state.yml $.first_edit");
  expect(tutorBlock).toContain("event file.edited");
  expect(Buffer.byteLength(tutorBlock ?? "", "utf8")).toBeLessThanOrEqual(1200);

  writeFileSync(join(workspace, "quest-state.yml"), "first_edit: GARNISH_PROTO_FIRST_EDIT\n");
  sink.emit({ type: "file.edited", path: join(workspace, "quest-state.yml"), kind: "write", summary: "set first edit marker" });
  await verifier.settled();

  expect(completions).toEqual(["look-around", "first-edit"]);
  expect(progression.state().completedQuests).toEqual(["first-edit", "look-around"] as never);
  expect(progression.unlockedIds()).toEqual(new Set(["l0-hands", "l1-shell"]));
  expect(unlocks).toEqual([
    { id: "l0-hands", tools: ["write", "edit"] },
    { id: "l1-shell", tools: ["bash"] },
  ]);
  expect(verifier.activeQuest()?.id).toBe("fix-bug-prove-it");

  sink.emit({ type: "file.edited", path: join(workspace, "quest-state.yml"), kind: "write", summary: "replay duplicate marker" });
  await verifier.settled();
  expect(completions).toEqual(["look-around", "first-edit"]);
  expect(unlocks).toHaveLength(2);

  mkdirSync(join(workspace, "src"), { recursive: true });
  writeFileSync(join(workspace, "src", "greet.ts"), "export function greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n");
  sink.emit({ type: "tool.approval.resolved", callId: "bash-1", approved: true, mode: "once" });
  sink.emit({ type: "turn.end", turn: 2, stopReason: "end_turn" });
  await verifier.settled();

  expect(completions).toEqual(["look-around", "first-edit", "fix-bug-prove-it"]);
  expect(progression.state().xpTotal).toBe(35);
  verifier.stop();
});
