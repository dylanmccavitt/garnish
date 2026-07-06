/** @jsxImportSource @opentui/react */
import { TextAttributes } from "@opentui/core";
import type { HarnessEvent } from "../harness/types";

export type TranscriptEntryKind =
  | "user"
  | "assistant"
  | "thinking"
  | "tool"
  | "blocked"
  | "file"
  | "system";

export interface TranscriptEntry {
  id: string;
  kind: TranscriptEntryKind;
  title: string;
  body: string;
  tone?: "normal" | "dim" | "good" | "warn" | "bad";
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
        title: `You (${event.source})`,
        body: event.text,
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
          title: "thinking",
          body: preview(model.thinkingDraft, 120),
          tone: "dim",
        });
      }
      const body = model.assistantDraft.trim() || event.message.text || "(assistant turn ended)";
      next = pushEntry(next, {
        id: event.id,
        kind: "assistant",
        title: "Assistant",
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
          title: `tool ${event.tool}`,
          body: preview(compact(event.input), 140),
          tone: "dim",
        },
      );
    case "tool.approval.requested":
      return pushEntry(model, {
        id: event.id,
        kind: "tool",
        title: `approval ${event.tool}`,
        body: `${event.risk.toUpperCase()} ${event.command ?? ""}\n${event.explanation}`.trim(),
        tone: event.risk === "critical" || event.risk === "risky" ? "warn" : "normal",
      });
    case "tool.approval.resolved":
      return pushEntry(model, {
        id: event.id,
        kind: "tool",
        title: `approval ${event.approved ? "approved" : "denied"}`,
        body: event.reason ?? event.pattern ?? event.mode,
        tone: event.approved ? "good" : "bad",
      });
    case "tool.blocked":
      return pushEntry(model, {
        id: event.id,
        kind: "blocked",
        title: `blocked ${event.tool}`,
        body: event.teaching,
        tone: "bad",
      });
    case "tool.result":
      return pushEntry(model, {
        id: event.id,
        kind: "tool",
        title: `${event.isError ? "tool error" : "tool ok"} ${event.tool}`,
        body: preview(event.output, 220),
        tone: event.isError ? "bad" : "good",
      });
    case "file.edited":
      return pushEntry(model, {
        id: event.id,
        kind: "file",
        title: `${event.kind} ${event.path}`,
        body: `+ ${event.summary}`,
        tone: "good",
      });
    case "error":
      return pushEntry(model, { id: event.id, kind: "system", title: "error", body: event.message, tone: "bad" });
    case "session.start":
      return pushEntry(model, {
        id: event.id,
        kind: "system",
        title: "session",
        body: `${event.provider}${event.model ? `/${event.model}` : ""} in ${event.workspace}`,
        tone: "dim",
      });
    default:
      return model;
  }
}

const colors: Record<NonNullable<TranscriptEntry["tone"]>, string> = {
  normal: "#E5E7EB",
  dim: "#7C8497",
  good: "#7EE787",
  warn: "#F2CC60",
  bad: "#FF6B6B",
};

function renderBody(entry: TranscriptEntry): string {
  if (entry.kind === "thinking") return `▸ ${entry.body}`;
  if (entry.kind === "blocked") return `!! ${entry.body}`;
  if (entry.kind === "file") return entry.body;
  return entry.body;
}

export function Transcript({ model }: { model: TranscriptModel }) {
  const live: TranscriptEntry[] = [];
  if (model.thinkingDraft.trim()) {
    live.push({ id: "thinking-live", kind: "thinking", title: "thinking…", body: preview(model.thinkingDraft, 120), tone: "dim" });
  }
  if (model.assistantDraft) {
    live.push({ id: "assistant-live", kind: "assistant", title: "Assistant…", body: model.assistantDraft, tone: "normal" });
  }
  const rows = [...model.entries, ...live].slice(-30);

  return (
    <scrollbox title="Transcript" style={{ border: true, flexGrow: 1, paddingLeft: 1, paddingRight: 1 }}>
      {rows.map((entry) => (
        <box key={entry.id} style={{ flexDirection: "column", marginBottom: 1 }}>
          <text fg={colors[entry.tone ?? "normal"]} attributes={entry.kind === "thinking" ? TextAttributes.DIM : undefined}>
            {entry.kind === "tool" ? "◇ " : entry.kind === "file" ? "Δ " : entry.kind === "blocked" ? "⛔ " : ""}
            {entry.title}
          </text>
          <text fg={colors[entry.tone ?? "normal"]}>{renderBody(entry)}</text>
        </box>
      ))}
    </scrollbox>
  );
}
