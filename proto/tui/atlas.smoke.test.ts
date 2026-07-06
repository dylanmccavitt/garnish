import { describe, expect, test } from "bun:test";
import { buildAtlas, HINTS } from "../game/atlas";

function atlas(completed: string[], activeQuestId: string | null = null, unlocked: string[] = []) {
  return buildAtlas({
    completedQuests: new Set(completed),
    unlockedIds: new Set(unlocked),
    activeQuestId,
  });
}

describe("atlas progression model", () => {
  test("fresh save makes Tutorial Island active and shows upcoming locked levels", () => {
    const levels = atlas([]);

    expect(levels.map((level) => [level.id, level.status])).toEqual([
      ["tutorial-island", "active"],
      ["first-steps", "locked"],
      ["first-quest", "locked"],
      ["lore-library", "teaser"],
      ["skill-forge", "teaser"],
    ]);
    expect(levels[0]?.rewards).toEqual(["write", "edit"]);
    expect(levels[0]?.quests.map((quest) => [quest.id, quest.state])).toEqual([
      ["mise-en-place", "active"],
      ["look-around", "locked"],
    ]);
  });

  test("mid-L0 keeps the island active and passes through quest hints", () => {
    const levels = atlas(["mise-en-place"], "look-around");
    const island = levels[0]!;

    expect(island.status).toBe("active");
    expect(island.quests.map((quest) => [quest.id, quest.state, quest.hint])).toEqual([
      ["mise-en-place", "done", HINTS["mise-en-place"]],
      ["look-around", "active", HINTS["look-around"]],
    ]);
  });

  test("all current quests done leaves only teaser levels ahead", () => {
    const levels = atlas(["mise-en-place", "look-around", "first-edit", "fix-bug-prove-it"], null, ["l0-hands", "l1-shell"]);

    expect(levels.slice(0, 3).map((level) => level.status)).toEqual(["done", "done", "done"]);
    expect(levels.slice(3).map((level) => level.status)).toEqual(["teaser", "teaser"]);
  });

  test("only the L1 capstone is framed as a boss", () => {
    const levels = atlas(["mise-en-place", "look-around", "first-edit"], "fix-bug-prove-it", ["l0-hands", "l1-shell"]);
    const bossQuests = levels.flatMap((level) => level.quests.filter((quest) => quest.boss).map((quest) => quest.id));

    expect(bossQuests).toEqual(["fix-bug-prove-it", "lore-library-boss", "skill-forge-boss"]);
    expect(levels[2]?.quests[0]).toMatchObject({ id: "fix-bug-prove-it", title: "The Goodbye Greeter", boss: true, state: "active" });
  });

  test("teasers expose unknown quest silhouettes and future rewards", () => {
    const levels = atlas([]);
    const teasers = levels.slice(3);

    expect(teasers.map((level) => [level.id, level.title, level.rewards])).toEqual([
      ["lore-library", "Lore Library", ["search"]],
      ["skill-forge", "Skill Forge", ["subagent"]],
    ]);
    expect(teasers.every((level) => level.quests.length === 3)).toBe(true);
    expect(teasers.flatMap((level) => level.quests.map((quest) => quest.title))).toEqual(["???", "???", "???", "???", "???", "???"]);
  });
});
