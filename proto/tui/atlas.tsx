/** @jsxImportSource @opentui/react */
import { TextAttributes } from "@opentui/core";
import type { ReactNode } from "react";
import type { AtlasLevel, AtlasQuest } from "../game/atlas";
import { PIXEL_SPRITES } from "./pixel-sprites";
import { PixelSpriteView } from "./pixel";
import { TUI_BG, TUI_DIM, TUI_ORANGE, TUI_PANEL, TUI_TEXT } from "./juice";
import { theme } from "./theme";

const statusGlyph: Record<AtlasLevel["status"], string> = {
  done: "✓",
  active: "▸",
  locked: "·",
  teaser: "◇",
};

const questGlyph: Record<AtlasQuest["state"], string> = {
  done: "✓",
  active: "▸",
  locked: "·",
};

function RewardChips({ rewards, active, dim }: { rewards: string[]; active: boolean; dim: boolean }) {
  if (rewards.length === 0) return <text fg={TUI_DIM}>complete</text>;
  return (
    <box style={{ flexDirection: "row", alignItems: "center" }}>
      {active ? <PixelSpriteView sprite={PIXEL_SPRITES.emblemUnlock} dim={dim} /> : null}
      <text fg={dim ? TUI_DIM : TUI_ORANGE} attributes={active ? TextAttributes.BOLD : undefined}>unlocks: {rewards.join(" · ")}</text>
    </box>
  );
}

function BossQuestRow({ quest, dim }: { quest: AtlasQuest; dim: boolean }) {
  const activeBoss = quest.id === "fix-bug-prove-it";
  return (
    <box style={{ flexDirection: "row", alignItems: "center", marginTop: 1 }}>
      <PixelSpriteView sprite={activeBoss ? PIXEL_SPRITES.bossGoodbyeGreeter : PIXEL_SPRITES.emblemBoss} dim={dim || quest.state === "locked"} />
      <box style={{ flexDirection: "column", marginLeft: 1 }}>
        <text fg={dim ? TUI_DIM : theme.accent} attributes={TextAttributes.BOLD}>BOSS · {quest.title}</text>
        <text fg={quest.state === "active" ? TUI_ORANGE : TUI_DIM}>{questGlyph[quest.state]} {quest.hint ?? "???"}</text>
      </box>
    </box>
  );
}

function QuestRow({ quest, dim }: { quest: AtlasQuest; dim: boolean }) {
  if (quest.boss) return <BossQuestRow quest={quest} dim={dim} />;
  return (
    <text fg={quest.state === "active" ? TUI_ORANGE : quest.state === "done" ? TUI_TEXT : TUI_DIM} attributes={quest.state === "active" ? TextAttributes.BOLD : dim ? TextAttributes.DIM : undefined}>
      {questGlyph[quest.state]} {quest.title}{quest.hint ? ` — ${quest.hint}` : ""}
    </text>
  );
}

function LevelCard({ level }: { level: AtlasLevel }) {
  const dim = level.status === "locked" || level.status === "teaser";
  const active = level.status === "active";
  return (
    <box
      title={`${statusGlyph[level.status]} ${level.title}`}
      titleColor={active ? TUI_ORANGE : dim ? TUI_DIM : TUI_TEXT}
      style={{ border: true, paddingLeft: 1, paddingRight: 1, marginBottom: 1, flexDirection: "column", backgroundColor: TUI_PANEL }}
    >
      <RewardChips rewards={level.rewards} active={active} dim={dim} />
      {level.quests.map((quest) => <QuestRow key={quest.id} quest={quest} dim={dim} />)}
    </box>
  );
}

export function AtlasOverlay({ open, levels }: { open: boolean; levels: AtlasLevel[] }): ReactNode {
  if (!open) return null;
  return (
    <box
      title="ATLAS"
      titleColor={TUI_ORANGE}
      zIndex={19}
      style={{
        position: "absolute",
        left: 4,
        right: 4,
        top: 2,
        bottom: 2,
        border: true,
        borderStyle: "double",
        paddingLeft: 2,
        paddingRight: 2,
        flexDirection: "column",
        backgroundColor: TUI_BG,
      }}
    >
      <box style={{ height: 1, flexDirection: "row", justifyContent: "space-between" }}>
        <text fg={TUI_ORANGE} attributes={TextAttributes.BOLD}>ATLAS</text>
        <text fg={TUI_DIM}>quests · unlocks · bosses</text>
      </box>
      <scrollbox style={{ flexGrow: 1, flexDirection: "column" }}>
        {levels.map((level) => <LevelCard key={level.id} level={level} />)}
      </scrollbox>
      <box style={{ height: 1, flexDirection: "row", justifyContent: "center" }}>
        <text fg={TUI_DIM}>Tab close · arrows scroll (if needed)</text>
      </box>
    </box>
  );
}
