/** @jsxImportSource @opentui/react */
import { TextAttributes } from "@opentui/core";
import { useKeyboard, useTimeline } from "@opentui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ApprovalDecision, EventBus, GateView, Scorecard } from "../harness/types";
import { ApprovalModal, type ApprovalModalState, stepApprovalModal } from "./modal";
import { decayMoments, emptyStatus, momentFromEvent, reduceStatus, TUI_BG, TUI_DIM, TUI_ORANGE, TUI_PANEL, TUI_RED, TUI_TEXT, type GameMoment, type MissionStatus, type StatusModel } from "./juice";
import { activeAtlasQuest, buildAtlas, inferCompletedQuestIds, isAtlasBossQuest, unlockIdsFromTools } from "../game/atlas";
import { AtlasOverlay } from "./atlas";
import { PIXEL_SPRITES } from "./pixel-sprites";
import { PixelSpriteView } from "./pixel";
import { missionLevel, questHint, QuestLog, type QuestView } from "./questlog";
import { MASCOT_NAME } from "./sprites";
import { Transcript, emptyTranscript, reduceTranscript, type TranscriptModel } from "./transcript";

export interface TuiMeta {
  workspace: string;
  provider: string;
  model?: string;
}

export interface TuiAppOpts {
  bus: EventBus;
  send(text: string): void;
  abort(): void;
  gateViews(): GateView[];
  questView(): QuestView | null;
  scorecard(): Scorecard | null;
  progress?(): { xp: number; level: number };
  onExit(): void;
  approval: ApprovalController;
  meta?: TuiMeta;
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
  "tool.approval.resolved": true,
  "file.edited": true,
  "quest.completed": true,
  "unlock.applied": true,
  error: true,
};

const statusColors: Record<MissionStatus, string> = {
  "AWAITING INPUT": TUI_TEXT,
  STREAMING: TUI_ORANGE,
  "RUNNING TOOL": TUI_ORANGE,
  "AWAITING APPROVAL": TUI_ORANGE,
  ABORTED: TUI_RED,
  ERROR: TUI_RED,
};

export function tokenLabel(scorecard: Scorecard | null): string {
  const total = (scorecard?.tokens.input ?? 0) + (scorecard?.tokens.output ?? 0);
  return total >= 1000 ? `${Math.round(total / 100) / 10}k` : `${total}`;
}

export function workspaceLabel(path: string | undefined): string {
  if (!path) return "workspace pending";
  if (path.length <= 42) return path;
  return `…${path.slice(-41)}`;
}

function StatusInput({ status, input, setInput, focused, placeholder }: { status: StatusModel; input: string; setInput(value: string): void; focused: boolean; placeholder: string }) {
  return (
    <box style={{ border: true, height: 3, paddingLeft: 1, paddingRight: 1, flexDirection: "row", alignItems: "center", backgroundColor: TUI_PANEL }}>
      <text fg={statusColors[status.status]} attributes={TextAttributes.BOLD}>{status.pulse ? "●" : "○"} {status.status}  </text>
      <input focused={focused} placeholder={placeholder} value={input} onInput={setInput} style={{ flexGrow: 1 }} />
    </box>
  );
}

export function TuiApp(opts: TuiAppOpts) {
  const [input, setInput] = useState("");
  const [transcript, setTranscript] = useState<TranscriptModel>(() => emptyTranscript());
  const [quest, setQuest] = useState<QuestView | null>(() => opts.questView());
  const [gates, setGates] = useState<GateView[]>(() => opts.gateViews());
  const [scorecard, setScorecard] = useState<Scorecard | null>(() => opts.scorecard());
  const [modal, setModal] = useState<ApprovalModalState | null>(null);
  const [moments, setMoments] = useState<GameMoment[]>([]);
  const [status, setStatus] = useState<StatusModel>(() => emptyStatus());
  const [frame, setFrame] = useState(0);
  const [atlasOpen, setAtlasOpen] = useState(false);

  const timeline = useTimeline({
    duration: 1000,
    loop: true,
  });
  const timelineReady = useRef(false);
  const lastDecay = useRef(Date.now());
  if (!timelineReady.current) {
    timeline.add({}, {
      duration: 1000,
      loop: true,
      onUpdate: () => {
        setFrame((current) => current + 1);
        const now = Date.now();
        if (now - lastDecay.current >= 1000) {
          lastDecay.current = now;
          setMoments((current) => decayMoments(current));
        }
      },
    });
    timelineReady.current = true;
  }

  useEffect(() => opts.approval.subscribe(setModal), [opts.approval]);

  useEffect(() => {
    return opts.bus.subscribe((event) => {
      setTranscript((current) => reduceTranscript(current, event));
      setStatus((current) => reduceStatus(current, event));
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
    if (key.name === "tab") {
      setAtlasOpen((current) => !current);
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

  const flash = useMemo(() => moments.some((moment) => moment.ttl > 10), [moments, frame]);
  const level = opts.progress?.() ?? missionLevel(scorecard);
  const provider = opts.meta?.model ? `${opts.meta.provider}/${opts.meta.model}` : opts.meta?.provider ?? "provider pending";

  const activeHint = questHint(quest);
  const atlasLevels = useMemo(() => {
    const unlockedTools = new Set(gates.filter((gate) => gate.visibility === "unlocked").map((gate) => gate.tool));
    return buildAtlas({
      completedQuests: inferCompletedQuestIds(quest?.id ?? null),
      unlockedIds: unlockIdsFromTools(unlockedTools),
      activeQuestId: quest?.id ?? null,
    });
  }, [gates, quest]);
  const objectiveQuest = activeAtlasQuest(atlasLevels);
  const objectiveLabel = objectiveQuest && isAtlasBossQuest(objectiveQuest.id) ? "BOSS FIGHT" : "OBJECTIVE";
  const objectiveTitle = objectiveQuest?.title ?? quest?.title ?? "All current quests complete";
  const objectiveHint = objectiveQuest?.hint ?? activeHint;

  return (
    <box style={{ width: "100%", height: "100%", flexDirection: "column", backgroundColor: TUI_BG }}>
      <box style={{ height: 3, flexDirection: "row", justifyContent: "space-between", backgroundColor: TUI_BG }}>
        <box style={{ width: 18, flexDirection: "column" }}>
          <PixelSpriteView sprite={PIXEL_SPRITES.sprigIdle} />
        </box>
        <box style={{ flexGrow: 1, flexDirection: "column" }}>
          <text fg={TUI_ORANGE} attributes={TextAttributes.BOLD}>⁙ Garnish  {workspaceLabel(opts.meta?.workspace)} · {MASCOT_NAME} on expo</text>
          <text fg={TUI_DIM}>Tab Atlas · NEXT UP try: {activeHint}</text>
        </box>
        <box style={{ width: 38, flexDirection: "column", alignItems: "flex-end" }}>
          <text fg={TUI_DIM}>LVL {level.level} · XP {level.xp} · TOK {tokenLabel(scorecard)}</text>
          <text fg={TUI_DIM}>{provider}</text>
        </box>
      </box>
      <box style={{ height: 1, flexDirection: "row", backgroundColor: TUI_PANEL, paddingLeft: 1 }}>
        <text fg={TUI_ORANGE} attributes={TextAttributes.BOLD}>{objectiveLabel} ▸ </text>
        <text fg={TUI_ORANGE}>{objectiveTitle} — {objectiveHint}</text>
      </box>
      <box style={{ flexGrow: 1, flexDirection: "row" }}>
        <box style={{ width: "65%", flexDirection: "column" }}>
          <Transcript model={transcript} />
        </box>
        <QuestLog quest={quest} gates={gates} scorecard={scorecard} moments={moments} flash={flash} />
      </box>
      <StatusInput status={status} input={input} setInput={setInput} focused={modal === null && !atlasOpen} placeholder={`try: ${activeHint}`} />
      <box style={{ height: 1, flexDirection: "row", justifyContent: "center", backgroundColor: TUI_BG }}>
        <text fg={TUI_DIM}>Tab Atlas · Enter Send · Esc Abort · a/p/d/r Approvals · Ctrl+C Quit</text>
      </box>
      <AtlasOverlay open={atlasOpen} levels={atlasLevels} />
      <ApprovalModal state={modal} />
    </box>
  );
}
