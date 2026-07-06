/** @jsxImportSource @opentui/react */
import { TextAttributes } from "@opentui/core";
import { useKeyboard, useTimeline } from "@opentui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ApprovalDecision, ApprovalRequest, EventBus, GateView, Scorecard } from "../harness/types";
import { ApprovalModal, type ApprovalModalState, stepApprovalModal } from "./modal";
import { decayMoments, glyphShower, momentFromEvent, type GameMoment } from "./juice";
import { QuestLog, type QuestView } from "./questlog";
import { Transcript, emptyTranscript, reduceTranscript, type TranscriptModel } from "./transcript";

export interface TuiAppOpts {
  bus: EventBus;
  send(text: string): void;
  abort(): void;
  gateViews(): GateView[];
  questView(): QuestView | null;
  scorecard(): Scorecard | null;
  onExit(): void;
  approval: ApprovalController;
}

export interface ApprovalController {
  subscribe(fn: (state: ApprovalModalState | null) => void): () => void;
  resolve(decision: ApprovalDecision): void;
}

const relevantViewEvents: Record<string, true> = {
  "session.start": true,
  "turn.end": true,
  "tool.blocked": true,
  "tool.result": true,
  "file.edited": true,
  "quest.completed": true,
  "unlock.applied": true,
  error: true,
};

export function TuiApp(opts: TuiAppOpts) {
  const [input, setInput] = useState("");
  const [transcript, setTranscript] = useState<TranscriptModel>(() => emptyTranscript());
  const [quest, setQuest] = useState<QuestView | null>(() => opts.questView());
  const [gates, setGates] = useState<GateView[]>(() => opts.gateViews());
  const [scorecard, setScorecard] = useState<Scorecard | null>(() => opts.scorecard());
  const [modal, setModal] = useState<ApprovalModalState | null>(null);
  const [moments, setMoments] = useState<GameMoment[]>([]);
  const [frame, setFrame] = useState(0);

  const timeline = useTimeline({
    duration: 1000,
    loop: true,
  });
  const timelineReady = useRef(false);
  if (!timelineReady.current) {
    timeline.add({}, {
      duration: 1000,
      loop: true,
      onUpdate: () => {
        setFrame((current) => current + 1);
        setMoments((current) => decayMoments(current));
      },
    });
    timelineReady.current = true;
  }

  useEffect(() => opts.approval.subscribe(setModal), [opts.approval]);

  useEffect(() => {
    return opts.bus.subscribe((event) => {
      setTranscript((current) => reduceTranscript(current, event));
      const moment = momentFromEvent(event);
      if (moment) setMoments((current) => [...current.slice(-11), moment]);
      if (relevantViewEvents[event.type]) {
        setQuest(opts.questView());
        setGates(opts.gateViews());
        setScorecard(opts.scorecard());
      }
    });
  }, [opts]);

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      opts.onExit();
      return;
    }
    if (modal) {
      if (modal.mode === "reason" && key.name !== "return" && key.name !== "escape") {
        if (key.name === "backspace") {
          setModal((current) => current ? { ...current, reason: current.reason.slice(0, -1) } : current);
        } else if (!key.ctrl && !key.meta && key.raw.length === 1) {
          setModal((current) => current ? { ...current, reason: current.reason + key.raw } : current);
        }
        return;
      }
      const modalKey = key.name === "return" ? "enter" : key.name === "escape" ? "escape" : key.name;
      if (["a", "p", "d", "r", "enter", "escape"].includes(modalKey)) {
        const step = stepApprovalModal(modal, { type: "key", key: modalKey as "a" | "p" | "d" | "r" | "enter" | "escape" });
        setModal(step.state);
        if (step.decision) opts.approval.resolve(step.decision);
      }
      return;
    }
    if (key.name === "escape") {
      opts.abort();
      return;
    }
    if (key.name === "return" && input.trim()) {
      opts.send(input.trim());
      setInput("");
    }
  });

  const shower = useMemo(() => moments.find((moment) => moment.ttl > 10), [moments]);

  return (
    <box style={{ width: "100%", height: "100%", flexDirection: "column", backgroundColor: "#0B1020" }}>
      <box style={{ height: 1, justifyContent: "space-between" }}>
        <text fg="#F2CC60" attributes={TextAttributes.BOLD}>Garnish Standalone Prototype</text>
        <text fg="#9CA3AF">Esc abort · Ctrl+C exit</text>
      </box>
      {shower ? (
        <box zIndex={10} style={{ height: 3, alignItems: "center", justifyContent: "center" }}>
          <text fg={shower.color} attributes={TextAttributes.BOLD}>{glyphShower(shower, frame)}  {shower.line}  {glyphShower(shower, frame + 1)}</text>
        </box>
      ) : null}
      <box style={{ flexGrow: 1, gap: 1 }}>
        <Transcript model={transcript} />
        <QuestLog quest={quest} gates={gates} scorecard={scorecard} moments={moments} />
      </box>
      <box title="Command" style={{ border: true, height: 3, paddingLeft: 1, paddingRight: 1 }}>
        <input focused placeholder="Tell the agent what to do…" value={input} onInput={setInput} />
      </box>
      <ApprovalModal state={modal} />
    </box>
  );
}
