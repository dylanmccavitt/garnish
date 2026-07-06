import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";

import type {
  ChatMessage,
  EventBus,
  EventSink,
  HarnessEvent,
  HarnessEventPayload,
  SessionLog,
} from "./types";

const DELTA_EVENT_TYPES: Partial<Record<HarnessEvent["type"], true>> = {
  "assistant.delta": true,
  "assistant.thinking.delta": true,
};

export function createBus(): EventBus {
  const subscribers = new Set<(event: HarnessEvent) => void>();

  return {
    publish(event) {
      for (const subscriber of subscribers) {
        try {
          subscriber(event);
        } catch {
          // Prototype rule: observers are peers, not governors. A broken TUI or
          // verifier must not stop the session event stream.
        }
      }
    },
    subscribe(fn) {
      subscribers.add(fn);
      return () => {
        subscribers.delete(fn);
      };
    },
  };
}

export function openSessionLog(path: string): SessionLog {
  mkdirSync(dirname(path), { recursive: true });

  return {
    path,
    append(event) {
      if (DELTA_EVENT_TYPES[event.type]) return;
      appendFileSync(path, `${JSON.stringify(event)}\n`, "utf8");
    },
    read() {
      let text = "";
      try {
        text = readFileSync(path, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }

      return text
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as HarnessEvent);
    },
  };
}

export function createEventSink(opts: {
  sessionId: string;
  logPath: string;
  bus?: EventBus;
}): EventSink {
  const bus = opts.bus ?? createBus();
  const log = openSessionLog(opts.logPath);
  const persistedEvents = log.read();
  let seq = persistedEvents.at(-1)?.seq ?? 0;
  let lastNonDeltaEventId = persistedEvents.at(-1)?.id ?? null;

  return {
    bus,
    log,
    sessionId: opts.sessionId,
    emit(payload: HarnessEventPayload, parentId?: string | null) {
      const event = {
        id: randomUUID(),
        parentId: parentId === undefined ? lastNonDeltaEventId : parentId,
        sessionId: opts.sessionId,
        seq: ++seq,
        ts: Date.now(),
        ...payload,
      } as HarnessEvent;

      log.append(event);
      bus.publish(event);

      if (!DELTA_EVENT_TYPES[event.type]) {
        lastNonDeltaEventId = event.id;
      }

      return event;
    },
  };
}

export function replaySession(events: HarnessEvent[]): {
  messages: ChatMessage[];
  lastSeq: number;
} {
  const messages: ChatMessage[] = [];
  let lastSeq = 0;

  for (const event of events) {
    lastSeq = event.seq;

    if (event.type === "message.user") {
      messages.push({ role: "user", text: event.text, source: event.source });
    } else if (event.type === "assistant.end") {
      messages.push(
        event.usage && event.message.usage === undefined
          ? { ...event.message, usage: event.usage }
          : event.message,
      );
    } else if (event.type === "tool.result") {
      messages.push({
        role: "tool",
        callId: event.callId,
        name: event.tool,
        output: event.output,
        isError: event.isError,
      });
    }
  }

  return { messages, lastSeq };
}
