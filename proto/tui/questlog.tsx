/** @jsxImportSource @opentui/react */
import { TextAttributes } from "@opentui/core";
import type { GateView, Scorecard } from "../harness/types";
import type { GameMoment } from "./juice";

export interface QuestView {
  title: string;
  checks: Array<{ line: string; done: boolean }>;
}

function GateRow({ gate }: { gate: GateView }) {
  if (gate.visibility === "hidden") return null;
  const unlocked = gate.visibility === "unlocked";
  return (
    <text fg={unlocked ? "#7EE787" : "#6B7280"} attributes={unlocked ? TextAttributes.BOLD : TextAttributes.DIM}>
      {unlocked ? "◆" : "🔒"} {gate.tool}{gate.teaching && !unlocked ? ` — ${gate.teaching}` : ""}
    </text>
  );
}

export function QuestLog({ quest, gates, scorecard, moments }: { quest: QuestView | null; gates: GateView[]; scorecard: Scorecard | null; moments: GameMoment[] }) {
  const level = scorecard ? Math.max(1, Math.floor((scorecard.diffBytes + scorecard.tokens.output) / 500) + 1) : 1;
  const xp = scorecard ? scorecard.diffBytes + scorecard.tokens.output : 0;
  return (
    <box style={{ width: 36, flexDirection: "column", gap: 1 }}>
      <box title="Quest" style={{ border: true, paddingLeft: 1, paddingRight: 1, flexDirection: "column", minHeight: 8 }}>
        {quest ? (
          <>
            <text fg="#F2CC60" attributes={TextAttributes.BOLD}>{quest.title}</text>
            {quest.checks.map((check, index) => (
              <text key={`${check.line}:${index}`} fg={check.done ? "#7EE787" : "#E5E7EB"}>
                {check.done ? "✓" : "·"} {check.line}
              </text>
            ))}
          </>
        ) : (
          <text fg="#6B7280">No active quest</text>
        )}
      </box>
      <box title="Skill tree" style={{ border: true, paddingLeft: 1, paddingRight: 1, flexDirection: "column", minHeight: 8 }}>
        {gates.filter((gate) => gate.visibility !== "hidden").map((gate) => <GateRow key={gate.tool} gate={gate} />)}
      </box>
      <box title="Level" style={{ border: true, paddingLeft: 1, paddingRight: 1, flexDirection: "column", height: 5 }}>
        <text fg="#79C0FF">LV {level} · XP {xp}</text>
        <text fg="#9CA3AF">approvals {scorecard?.approvals.approved ?? 0}/{scorecard?.approvals.denied ?? 0} · blocked {scorecard?.blocked ?? 0}</text>
      </box>
      <box title="Game log" style={{ border: true, paddingLeft: 1, paddingRight: 1, flexDirection: "column", flexGrow: 1 }}>
        {moments.slice(-7).map((moment) => (
          <text key={moment.id} fg={moment.color}>{moment.glyph} {moment.line}</text>
        ))}
      </box>
    </box>
  );
}
