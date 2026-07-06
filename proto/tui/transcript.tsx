/** @jsxImportSource @opentui/react */
import { TextAttributes } from "@opentui/core";
import type { HarnessEvent } from "../harness/types";
import { TUI_DIM, TUI_ORANGE, TUI_RED, TUI_TEXT } from "./juice";
import { MASCOT_NAME, unlockBanner, xpBurst } from "./sprites";
import { theme } from "./theme";

export type TranscriptEntryKind =
  | "user"
  | "assistant"
  | "thinking"
  | "tool"
  | "blocked"
  | "file"
  | "celebration"
  | "system";

export interface TranscriptEntry {
  id: string;
  kind: TranscriptEntryKind;
  title: string;
  body: string;
  tone?: "normal" | "dim" | "good" | "warn" | "bad" | "accent";
}

export interface TranscriptModel {
  entries: TranscriptEntry[];
  assistantDraft: string;
  thinkingDraft: string;
  toolInputs: Record<string, string>;
}

export const emptyTranscript = (): TranscriptModel => ({
  entries: [],
  assistantDraft: "",
  thinkingDraft: "",
  toolInputs: {},
});

const MAX_ENTRIES = 80;

function pushEntry(model: TranscriptModel, entry: TranscriptEntry): TranscriptModel {
  const entries = [...model.entries, entry].slice(-MAX_ENTRIES);
  return { ...model, entries };
}

function compact(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function preview(text: string, max = 180): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

export function reduceTranscript(model: TranscriptModel, event: HarnessEvent): TranscriptModel {
  switch (event.type) {
    case "message.user":
      return pushEntry(model, {
        id: event.id,
        kind: "user",
        title: `Player · ${event.source}`,
        body: event.text,
        tone: event.source === "player" ? "accent" : "normal",
      });
    case "assistant.delta":
      return { ...model, assistantDraft: model.assistantDraft + event.text };
    case "assistant.thinking.delta":
      return { ...model, thinkingDraft: model.thinkingDraft + event.text };
    case "assistant.end": {
      let next = model;
      if (model.thinkingDraft.trim()) {
        next = pushEntry(next, {
          id: `${event.id}:thinking`,
          kind: "thinking",
          title: "Thinking",
          body: preview(model.thinkingDraft, 120),
          tone: "dim",
        });
      }
      const body = model.assistantDraft.trim() || event.message.text || "(assistant turn ended)";
      next = pushEntry(next, {
        id: event.id,
        kind: "assistant",
        title: MASCOT_NAME,
        body,
      });
      return { ...next, assistantDraft: "", thinkingDraft: "" };
    }
    case "tool.call":
      return pushEntry(
        { ...model, toolInputs: { ...model.toolInputs, [event.callId]: compact(event.input) } },
        {
          id: event.id,
          kind: "tool",
          title: `Tool · ${event.tool}`,
          body: preview(compact(event.input), 140),
          tone: "dim",
        },
      );
    case "tool.approval.requested":
      return pushEntry(model, {
        id: event.id,
        kind: "tool",
        title: `Approval · ${event.tool}`,
        body: `${event.risk.toUpperCase()} · ${event.command ?? ""}\n${event.explanation}`.trim(),
        tone: event.risk === "critical" || event.risk === "risky" ? "warn" : "accent",
      });
    case "tool.approval.resolved":
      return pushEntry(model, {
        id: event.id,
        kind: "tool",
        title: `Approval · ${event.approved ? "approved" : "denied"}`,
        body: event.reason ?? event.pattern ?? event.mode,
        tone: event.approved ? "accent" : "bad",
      });
    case "tool.blocked":
      return pushEntry(model, {
        id: event.id,
        kind: "blocked",
        title: `Teaching block · ${event.tool}`,
        body: event.teaching,
        tone: "bad",
      });
    case "tool.result":
      return pushEntry(model, {
        id: event.id,
        kind: "tool",
        title: `${event.isError ? "Tool error" : "Tool output"} · ${event.tool}`,
        body: preview(event.output, 220),
        tone: event.isError ? "bad" : "normal",
      });
    case "file.edited":
      return pushEntry(model, {
        id: event.id,
        kind: "file",
        title: `File ${event.kind.toLowerCase()} · ${event.path}`,
        body: event.summary,
        tone: "accent",
      });
    case "quest.completed":
      return pushEntry(model, {
        id: event.id,
        kind: "celebration",
        title: `Quest complete ${xpBurst(1)}`,
        body: `${event.questId} · +${event.xp} XP`,
        tone: "accent",
      });
    case "unlock.applied":
      return pushEntry(model, {
        id: event.id,
        kind: "celebration",
        title: `New verb ${xpBurst(0)}`,
        body: unlockBanner(event.tools).join("\n"),
        tone: "accent",
      });
    case "error":
      return pushEntry(model, { id: event.id, kind: "system", title: "Error", body: event.message, tone: "bad" });
    case "session.start":
      return pushEntry(model, {
        id: event.id,
        kind: "system",
        title: "Session",
        body: `${event.provider}${event.model ? `/${event.model}` : ""} in ${event.workspace}`,
        tone: "dim",
      });
    case "auth.login":
      return pushEntry(model, {
        id: event.id,
        kind: "system",
        title: "Auth",
        body: `signed in · ${event.provider}${event.account ? ` · ${event.account}` : ""}`,
        tone: "accent",
      });
    default:
      return model;
  }
}

const colors: Record<NonNullable<TranscriptEntry["tone"]>, string> = {
  normal: TUI_TEXT,
  dim: TUI_DIM,
  good: TUI_ORANGE,
  warn: theme.amber,
  bad: TUI_RED,
  accent: theme.accent,
};

function prefix(entry: TranscriptEntry): string {
  if (entry.kind === "tool") return "tool";
  if (entry.kind === "file") return "file";
  if (entry.kind === "blocked") return "block";
  if (entry.kind === "celebration") return "game";
  if (entry.kind === "thinking") return "think";
  if (entry.kind === "user") return "you";
  return "sys";
}

function renderBody(entry: TranscriptEntry): string {
  if (entry.kind === "thinking") return `signal · ${entry.body}`;
  if (entry.kind === "blocked") return `lesson · ${entry.body}`;
  return entry.body;
}

export function Transcript({ model }: { model: TranscriptModel }) {
  const live: TranscriptEntry[] = [];
  if (model.thinkingDraft.trim()) {
    live.push({ id: "thinking-live", kind: "thinking", title: "Thinking…", body: preview(model.thinkingDraft, 120), tone: "dim" });
  }
  if (model.assistantDraft) {
    live.push({ id: "assistant-live", kind: "assistant", title: `${MASCOT_NAME} · streaming`, body: model.assistantDraft, tone: "normal" });
  }
  const rows = [...model.entries, ...live].slice(-30);

  return (
    <scrollbox title="Activity Feed" titleColor={TUI_DIM} stickyScroll stickyStart="bottom" style={{ border: true, flexGrow: 1, paddingLeft: 1, paddingRight: 1 }}>
      {rows.map((entry) => (
        <box key={entry.id} style={{ flexDirection: "column", marginBottom: 1 }}>
          <text fg={entry.tone === "accent" ? theme.accent : TUI_DIM} attributes={entry.kind === "thinking" ? TextAttributes.DIM : undefined}>
            {prefix(entry).padEnd(5, " ")} · {entry.title}
          </text>
          <text fg={entry.kind === "thinking" ? TUI_DIM : colors[entry.tone ?? "normal"]}>{renderBody(entry)}</text>
        </box>
      ))}
    </scrollbox>
  );
}
