import type { HarnessEvent, HarnessEventType } from "../harness/types";

export interface GameMoment {
  id: string;
  glyph: string;
  color: string;
  line: string;
  ttl: number;
}

export const glyphLegend: Partial<Record<HarnessEventType, { glyph: string; color: string; label: string }>> = {
  "quest.completed": { glyph: "✦", color: "#F2CC60", label: "Quest" },
  "unlock.applied": { glyph: "⚙", color: "#79C0FF", label: "Unlock" },
  "tool.blocked": { glyph: "⛔", color: "#FF6B6B", label: "Blocked" },
  "file.edited": { glyph: "Δ", color: "#7EE787", label: "File" },
  error: { glyph: "!", color: "#FF6B6B", label: "Error" },
};

export function momentFromEvent(event: HarnessEvent): GameMoment | null {
  const legend = glyphLegend[event.type];
  if (!legend) return null;
  switch (event.type) {
    case "quest.completed":
      return { id: event.id, glyph: legend.glyph, color: legend.color, line: `XP BURST +${event.xp} · quest ${event.questId} complete`, ttl: 18 };
    case "unlock.applied":
      return { id: event.id, glyph: legend.glyph, color: legend.color, line: `NEW VERB · ${event.tools.join(", ")}`, ttl: 16 };
    case "tool.blocked":
      return { id: event.id, glyph: legend.glyph, color: legend.color, line: `Gate taught: ${event.teaching}`, ttl: 10 };
    case "file.edited":
      return { id: event.id, glyph: legend.glyph, color: legend.color, line: `${event.kind} ${event.path}`, ttl: 8 };
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
  const count = Math.max(1, Math.min(10, Math.ceil(moment.ttl / 2)));
  return Array.from({ length: count }, (_, index) => (index + frame) % 3 === 0 ? moment.glyph : "·").join(" ");
}
