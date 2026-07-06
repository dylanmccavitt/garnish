import type { HarnessEvent, Scorecard } from "./types";

export function deriveScorecard(events: HarnessEvent[]): Scorecard {
  let sessionId = events[0]?.sessionId ?? "";
  let sessionStartTs: number | null = null;
  let lastTs: number | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  let diffBytes = 0;
  let promptCount = 0;
  let approved = 0;
  let denied = 0;
  let auto = 0;
  let blocked = 0;

  for (const event of events) {
    sessionId = sessionId || event.sessionId;
    lastTs = event.ts;

    if (event.type === "session.start" && sessionStartTs === null) {
      sessionStartTs = event.ts;
    } else if (event.type === "assistant.end") {
      const usage = event.usage ?? event.message.usage;
      inputTokens += usage?.inputTokens ?? 0;
      outputTokens += usage?.outputTokens ?? 0;
    } else if (event.type === "file.edited") {
      const match = event.summary.match(/\+(\d+)\/-(\d+) bytes/);
      if (match) {
        diffBytes += Number(match[1]) + Number(match[2]);
      }
    } else if (event.type === "message.user" && event.source === "player") {
      promptCount += 1;
    } else if (event.type === "tool.approval.resolved") {
      if (event.mode === "auto") {
        auto += 1;
      } else if (event.approved) {
        approved += 1;
      } else {
        denied += 1;
      }
    } else if (event.type === "tool.blocked") {
      blocked += 1;
    }
  }

  return {
    sessionId,
    tokens: { input: inputTokens, output: outputTokens },
    wallTimeMs:
      sessionStartTs === null || lastTs === null ? 0 : Math.max(0, lastTs - sessionStartTs),
    diffBytes,
    promptCount,
    approvals: { approved, denied, auto },
    blocked,
  };
}
