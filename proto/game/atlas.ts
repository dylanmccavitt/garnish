export type AtlasQuestState = "done" | "active" | "locked";
export type AtlasLevelStatus = "done" | "active" | "locked" | "teaser";

export interface AtlasQuest {
  id: string;
  title: string;
  state: AtlasQuestState;
  boss: boolean;
  hint?: string;
}

export interface AtlasLevel {
  id: string;
  title: string;
  status: AtlasLevelStatus;
  rewards: string[];
  quests: AtlasQuest[];
}

export interface BuildAtlasOpts {
  completedQuests: Set<string>;
  unlockedIds: Set<string>;
  activeQuestId: string | null;
}

export const HINTS: Record<string, string> = {
  "mise-en-place": "What's my quest?",
  "look-around": "Look around",
  "first-edit": "Record the first edit",
  "fix-bug-prove-it": "Fix the greeter and prove it",
};

interface QuestFact {
  id: string;
  title: string;
  boss: boolean;
}

interface LevelFact {
  id: string;
  title: string;
  unlockId?: string;
  rewards: string[];
  quests: QuestFact[];
}

const playableLevels: LevelFact[] = [
  {
    id: "tutorial-island",
    title: "Tutorial Island",
    unlockId: "l0-hands",
    rewards: ["write", "edit"],
    quests: [
      { id: "mise-en-place", title: "Mise en place", boss: false },
      { id: "look-around", title: "Look around", boss: false },
    ],
  },
  {
    id: "first-steps",
    title: "First Steps",
    unlockId: "l1-shell",
    rewards: ["bash"],
    quests: [{ id: "first-edit", title: "First edit", boss: false }],
  },
  {
    id: "first-quest",
    title: "First Quest",
    rewards: [],
    quests: [{ id: "fix-bug-prove-it", title: "The Goodbye Greeter", boss: true }],
  },
];

const teaserLevels: AtlasLevel[] = [
  {
    id: "lore-library",
    title: "Lore Library",
    status: "teaser",
    rewards: ["search"],
    quests: [
      { id: "lore-library-1", title: "???", state: "locked", boss: false },
      { id: "lore-library-2", title: "???", state: "locked", boss: false },
      { id: "lore-library-boss", title: "???", state: "locked", boss: true },
    ],
  },
  {
    id: "skill-forge",
    title: "Skill Forge",
    status: "teaser",
    rewards: ["subagent"],
    quests: [
      { id: "skill-forge-1", title: "???", state: "locked", boss: false },
      { id: "skill-forge-2", title: "???", state: "locked", boss: false },
      { id: "skill-forge-boss", title: "???", state: "locked", boss: true },
    ],
  },
];

const questOrder = playableLevels.flatMap((level) => level.quests.map((quest) => quest.id));
const allPlayableQuestIds = new Set(questOrder);

function firstIncompleteLevelIndex(completedQuests: Set<string>): number {
  const index = playableLevels.findIndex((level) => level.quests.some((quest) => !completedQuests.has(quest.id)));
  return index === -1 ? playableLevels.length : index;
}

export function isAtlasBossQuest(questId: string): boolean {
  return questId === "fix-bug-prove-it";
}

export function questHintById(questId: string | null | undefined): string {
  return questId ? HINTS[questId] ?? HINTS["mise-en-place"]! : HINTS["mise-en-place"]!;
}

export function inferCompletedQuestIds(activeQuestId: string | null): Set<string> {
  if (activeQuestId === null) return new Set(questOrder);
  const activeIndex = questOrder.indexOf(activeQuestId);
  if (activeIndex <= 0) return new Set();
  return new Set(questOrder.slice(0, activeIndex));
}

export function unlockIdsFromTools(tools: Set<string>): Set<string> {
  const unlockIds = new Set<string>();
  if (tools.has("write") && tools.has("edit")) unlockIds.add("l0-hands");
  if (tools.has("bash")) unlockIds.add("l1-shell");
  return unlockIds;
}

export function buildAtlas(opts: BuildAtlasOpts): AtlasLevel[] {
  const activeLevelIndexFromQuest = opts.activeQuestId
    ? playableLevels.findIndex((level) => level.quests.some((quest) => quest.id === opts.activeQuestId))
    : -1;
  const fallbackActiveIndex = firstIncompleteLevelIndex(opts.completedQuests);
  const activeLevelIndex = activeLevelIndexFromQuest >= 0 ? activeLevelIndexFromQuest : fallbackActiveIndex;
  const fallbackActiveQuestId = questOrder.find((questId) => !opts.completedQuests.has(questId)) ?? null;
  const effectiveActiveQuestId = opts.activeQuestId ?? fallbackActiveQuestId;

  const levels = playableLevels.map((level, levelIndex): AtlasLevel => {
    const allDone = level.quests.every((quest) => opts.completedQuests.has(quest.id));
    const isActiveLevel = activeLevelIndex === levelIndex && !allDone;
    const status: AtlasLevelStatus = allDone ? "done" : isActiveLevel ? "active" : "locked";

    return {
      id: level.id,
      title: level.title,
      status,
      rewards: level.rewards,
      quests: level.quests.map((quest): AtlasQuest => {
        const done = opts.completedQuests.has(quest.id);
        const active = quest.id === effectiveActiveQuestId;
        const state: AtlasQuestState = done ? "done" : active ? "active" : "locked";
        return {
          id: quest.id,
          title: quest.title,
          state,
          boss: quest.boss,
          hint: HINTS[quest.id],
        };
      }),
    };
  });

  return [...levels, ...teaserLevels.map((level) => ({ ...level, quests: level.quests.map((quest) => ({ ...quest })) }))];
}

export function nextLockedUnlock(levels: AtlasLevel[], unlockedTools: ReadonlySet<string> = new Set()): { levelTitle: string; rewards: string[] } | null {
  for (const level of levels) {
    if (level.status === "teaser") continue;
    if (level.status === "done" || level.rewards.length === 0) continue;
    const pending = level.rewards.filter((tool) => !unlockedTools.has(tool));
    if (pending.length > 0) return { levelTitle: level.title, rewards: pending };
  }
  return null;
}

export function activeAtlasQuest(levels: AtlasLevel[]): AtlasQuest | null {
  for (const level of levels) {
    const quest = level.quests.find((candidate) => candidate.state === "active");
    if (quest && allPlayableQuestIds.has(quest.id)) return quest;
  }
  return null;
}
