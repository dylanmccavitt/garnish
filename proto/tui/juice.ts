import type { HarnessEvent, HarnessEventType } from "../harness/types";
import { theme } from "./theme";

export const TUI_BG = theme.bg;
export const TUI_PANEL = theme.panel;
export const TUI_BORDER = theme.border;
export const TUI_DIM = theme.dim;
export const TUI_TEXT = theme.text;
export const TUI_ORANGE = theme.primary;
export const TUI_RED = theme.red;

export interface GameMoment {
  id: string;
  glyph: string;
  color: string;
  line: string;
  ttl: number;
}

export type MissionStatus = "AWAITING INPUT" | "STREAMING" | "RUNNING TOOL" | "AWAITING APPROVAL" | "ABORTED" | "ERROR";

export interface StatusModel {
  status: MissionStatus;
  inTurn: boolean;
  runningTools: number;
  awaitingApprovals: number;
  pulse: boolean;
}

export const emptyStatus = (): StatusModel => ({
  status: "AWAITING INPUT",
  inTurn: false,
  runningTools: 0,
  awaitingApprovals: 0,
  pulse: false,
});

export const glyphLegend: Partial<Record<HarnessEventType, { glyph: string; color: string; label: string }>> = {
  "quest.completed": { glyph: "✓", color: theme.text, label: "Quest" },
  "unlock.applied": { glyph: "▸", color: theme.text, label: "Unlock" },
  "tool.blocked": { glyph: "!", color: theme.red, label: "Blocked" },
  "file.edited": { glyph: "Δ", color: theme.text, label: "File" },
  "tool.approval.resolved": { glyph: "◆", color: theme.accent, label: "Approval" },
  "auth.login": { glyph: "•", color: theme.dim, label: "Auth" },
  error: { glyph: "!", color: theme.red, label: "Error" },
};

function visibleStatus(model: Omit<StatusModel, "status">): MissionStatus {
  if (model.awaitingApprovals > 0) return "AWAITING APPROVAL";
  if (model.runningTools > 0) return "RUNNING TOOL";
  if (model.inTurn) return "STREAMING";
  return "AWAITING INPUT";
}

export function reduceStatus(model: StatusModel, event: HarnessEvent): StatusModel {
  if (event.type === "error") return { ...model, status: "ERROR", pulse: !model.pulse };
  if (event.type === "turn.end" && event.stopReason === "aborted") {
    return { ...model, status: "ABORTED", inTurn: false, runningTools: 0, awaitingApprovals: 0, pulse: !model.pulse };
  }

  const next = { ...model, pulse: !model.pulse };
  switch (event.type) {
    case "turn.start":
      next.inTurn = true;
      break;
    case "assistant.end":
      next.inTurn = false;
      break;
    case "tool.call":
      next.runningTools += 1;
      break;
    case "tool.result":
      next.runningTools = Math.max(0, next.runningTools - 1);
      break;
    case "tool.approval.requested":
      next.awaitingApprovals += 1;
      break;
    case "tool.approval.resolved":
      next.awaitingApprovals = Math.max(0, next.awaitingApprovals - 1);
      break;
  }
  next.status = visibleStatus(next);
  return next;
}

export function momentFromEvent(event: HarnessEvent): GameMoment | null {
  const legend = glyphLegend[event.type];
  if (!legend) return null;
  switch (event.type) {
    case "quest.completed":
      return { id: event.id, glyph: legend.glyph, color: legend.color, line: `quest complete · +${event.xp} XP · ${event.questId}`, ttl: 18 };
    case "unlock.applied":
      return { id: event.id, glyph: legend.glyph, color: legend.color, line: `verb unlocked · ${event.tools.join(", ")}`, ttl: 16 };
    case "auth.login":
      return { id: event.id, glyph: legend.glyph, color: legend.color, line: `signed in · ${event.provider}`, ttl: 10 };
    case "tool.blocked":
      return { id: event.id, glyph: legend.glyph, color: legend.color, line: `block taught · ${event.teaching}`, ttl: 10 };
    case "file.edited":
      return { id: event.id, glyph: legend.glyph, color: legend.color, line: `${event.kind} ${event.path}`, ttl: 8 };
    case "tool.approval.resolved":
      return {
        id: event.id,
        glyph: event.approved ? "✔" : "✖",
        color: event.approved ? theme.accent : theme.red,
        line: `${event.approved ? "approved" : "denied"} · ${event.mode}`,
        ttl: 8,
      };
    case "error":
      return { id: event.id, glyph: legend.glyph, color: legend.color, line: event.message, ttl: 8 };
    default:
      return null;
  }
}

export function decayMoments(moments: GameMoment[]): GameMoment[] {
  return moments.map((moment) => ({ ...moment, ttl: moment.ttl - 1 })).filter((moment) => moment.ttl > 0);
}

export function glyphShower(moment: GameMoment, frame: number): string {
  return moment.ttl > 10 && frame % 2 === 0 ? "●" : "○";
}
