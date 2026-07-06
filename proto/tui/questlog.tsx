/** @jsxImportSource @opentui/react */
import { TextAttributes } from "@opentui/core";
import type { GateView, Scorecard } from "../harness/types";
import { buildAtlas, HINTS, inferCompletedQuestIds, isAtlasBossQuest, nextLockedUnlock, questHintById, unlockIdsFromTools, type AtlasLevel } from "../game/atlas";
import { TUI_DIM, TUI_ORANGE, TUI_PANEL, TUI_RED, TUI_TEXT, type GameMoment } from "./juice";

export { HINTS };

export function questHint(quest: QuestView | null): string {
  return questHintById(quest?.id);
}

export interface QuestView {
  id: string;
  title: string;
  checks: Array<{ line: string; done: boolean }>;
}

function GateRow({ gate }: { gate: GateView }) {
  if (gate.visibility === "hidden") return null;
  const unlocked = gate.visibility === "unlocked";
  return (
    <text fg={unlocked ? TUI_ORANGE : TUI_DIM} attributes={unlocked ? TextAttributes.BOLD : TextAttributes.DIM}>
      {unlocked ? "●" : "◌ 🔒"} {gate.tool}{gate.teaching && !unlocked ? ` — ${gate.teaching}` : ""}
    </text>
  );
}

export function missionLevel(scorecard: Scorecard | null): { level: number; xp: number } {
  const xp = scorecard ? scorecard.diffBytes + scorecard.tokens.output : 0;
  return { level: Math.max(1, Math.floor(xp / 500) + 1), xp };
}

function atlasForQuest(quest: QuestView | null, visibleGates: GateView[]): AtlasLevel[] {
  const unlockedTools = new Set(visibleGates.filter((gate) => gate.visibility === "unlocked").map((gate) => gate.tool));
  return buildAtlas({
    completedQuests: inferCompletedQuestIds(quest?.id ?? null),
    unlockedIds: unlockIdsFromTools(unlockedTools),
    activeQuestId: quest?.id ?? null,
  });
}

export function QuestLog({ quest, gates, scorecard, moments, flash }: { quest: QuestView | null; gates: GateView[]; scorecard: Scorecard | null; moments: GameMoment[]; flash: boolean }) {
  const checksDone = quest?.checks.filter((check) => check.done).length ?? 0;
  const checksTotal = quest?.checks.length ?? 0;
  const visibleGates = gates.filter((gate) => gate.visibility !== "hidden");
  const unlocked = visibleGates.filter((gate) => gate.visibility === "unlocked").length;
  const atlas = atlasForQuest(quest, visibleGates);
  const nextUnlock = nextLockedUnlock(atlas, new Set(visibleGates.filter((gate) => gate.visibility === "unlocked").map((gate) => gate.tool)));
  const newestMoment = moments.at(-1);

  return (
    <box style={{ width: "35%", minWidth: 34, flexDirection: "column" }}>
      <box title={`Quest ${checksDone}/${checksTotal}`} titleColor={flash ? TUI_ORANGE : TUI_DIM} style={{ border: true, paddingLeft: 1, paddingRight: 1, flexDirection: "column", minHeight: 8, backgroundColor: TUI_PANEL }}>
        {quest ? (
          <>
            <box style={{ flexDirection: "row", alignItems: "center" }}>
              {isAtlasBossQuest(quest.id) ? <text fg={TUI_ORANGE} attributes={TextAttributes.BOLD}>BOSS </text> : null}
              <text fg={TUI_ORANGE} attributes={TextAttributes.BOLD}>{quest.title}</text>
            </box>
            {quest.checks.map((check, index) => (
              <text key={`${check.line}:${index}`} fg={check.done ? TUI_ORANGE : TUI_TEXT}>
                {check.done ? "☑" : "☐"} {check.line}
              </text>
            ))}
            <text fg={TUI_DIM}>NEXT UP {questHint(quest)}</text>
          </>
        ) : (
          <text fg={TUI_DIM}>No active quest</text>
        )}
      </box>
      <box title={`Verbs ${unlocked}/${visibleGates.length}`} titleColor={flash ? TUI_ORANGE : TUI_DIM} style={{ border: true, paddingLeft: 1, paddingRight: 1, flexDirection: "column", minHeight: 7, backgroundColor: TUI_PANEL }}>
        {visibleGates.map((gate) => <GateRow key={gate.tool} gate={gate} />)}
      </box>
      <box title="UP NEXT" titleColor={flash ? TUI_ORANGE : TUI_DIM} style={{ border: true, paddingLeft: 1, paddingRight: 1, flexDirection: "column", minHeight: 3, backgroundColor: TUI_PANEL }}>
        {nextUnlock ? <text fg={TUI_DIM}>{nextUnlock.rewards.join(" · ")} from {nextUnlock.levelTitle}</text> : <text fg={TUI_DIM}>all current verbs unlocked</text>}
      </box>
      <box title="Progress Log" titleColor={flash ? TUI_ORANGE : TUI_DIM} style={{ border: true, paddingLeft: 1, paddingRight: 1, flexDirection: "column", flexGrow: 1, backgroundColor: TUI_PANEL }}>
        {moments.length === 0 ? <text fg={TUI_DIM}>Waiting for game moments…</text> : null}
        {moments.slice(-9).map((moment) => (
          <text key={moment.id} fg={moment.color}>{moment.glyph} {moment.line}</text>
        ))}
        {newestMoment && newestMoment.ttl > 10 ? <text fg={TUI_ORANGE}>● pulse · {newestMoment.line}</text> : null}
      </box>
      <box style={{ height: 1, flexDirection: "row", justifyContent: "space-between" }}>
        <text fg={TUI_DIM}>OK {scorecard?.approvals.approved ?? 0} · NO {scorecard?.approvals.denied ?? 0}</text>
        <text fg={(scorecard?.blocked ?? 0) > 0 ? TUI_RED : TUI_DIM}>blocks {scorecard?.blocked ?? 0}</text>
      </box>
    </box>
  );
}
