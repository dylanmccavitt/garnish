import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { scriptedStream } from "./harness/scripted";
import { loadProfile, resetSave, resolveSaveRoot, saveProfile } from "./save";
import { scaffoldWorkspace } from "./tools";
import { wireHarness } from "./wire";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

describe("stateful save helpers", () => {
  test("save root honors env override", () => {
    const root = tempRoot("garnish-save-root-");
    expect(resolveSaveRoot({ GARNISH_PROTO_HOME: root })).toBe(resolve(root));
  });

  test("profile round-trips through profile.json", () => {
    const root = tempRoot("garnish-profile-");
    const profile = { provider: "demo-kitchen", method: "scripted" as const, account: "chef@example.test", createdAt: 123 };

    expect(loadProfile(root)).toBeNull();
    saveProfile(root, profile);

    expect(loadProfile(root)).toEqual(profile);
    expect(readFileSync(join(root, "profile.json"), "utf8")).toContain("chef@example.test");
  });

  test("reset clears save contents and tolerates missing roots", () => {
    const root = join(tempRoot("garnish-reset-parent-"), "save");
    resetSave(root);
    writeFileSync(join(root, "stale.txt"), "stale\n");

    resetSave(root);

    expect(existsSync(root)).toBe(true);
    expect(existsSync(join(root, "stale.txt"))).toBe(false);
  });
});

describe("stateful workspace and wire resume", () => {
  test("scaffoldWorkspace reuses an existing git workspace without overwriting files", () => {
    const root = tempRoot("garnish-workspace-idempotent-");
    const first = scaffoldWorkspace({ root });
    const marker = join(first.workspace, "quest-state.yml");
    writeFileSync(marker, "first_edit: kept\n");

    const second = scaffoldWorkspace({ root });

    expect(second).toEqual(first);
    expect(readFileSync(marker, "utf8")).toBe("first_edit: kept\n");
  });

  test("wireHarness resumes progression unlocks from one save root", async () => {
    const saveRoot = tempRoot("garnish-wire-resume-");
    const first = await wireHarness({
      streamFn: scriptedStream([]),
      provider: "scripted",
      prompter: () => Promise.resolve({ approved: false, mode: "deny" as const }),
      saveRoot,
    });
    first.progression.grantQuest("mise-en-place", 5);
    first.progression.grantQuest("look-around", 5);
    expect(first.gates.isUnlocked("write")).toBe(true);
    first.stop();

    const second = await wireHarness({
      streamFn: scriptedStream([]),
      provider: "scripted",
      prompter: () => Promise.resolve({ approved: false, mode: "deny" as const }),
      saveRoot,
    });

    expect(second.gates.isUnlocked("write")).toBe(true);
    expect(second.gates.isUnlocked("edit")).toBe(true);
    expect(second.sessionLogPath.startsWith(join(saveRoot, "sessions"))).toBe(true);
    expect(second.sink.log.read().some((event) => event.type === "unlock.applied" && event.unlockId === "l0-hands")).toBe(true);
    second.stop();
  });
});
