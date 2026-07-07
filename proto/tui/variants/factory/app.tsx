/** @jsxImportSource @opentui/react */
import { TextAttributes } from "@opentui/core";
import { useKeyboard, useTimeline } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import type { ApprovalDecision, HarnessEvent } from "../../../harness/types";
import type { FactoryState } from "../../../factory/types";
import { ApprovalModal, stepApprovalModal, type ApprovalModalState } from "../../modal";
import type { StartTuiOpts } from "../../index";
import { PixelSpriteView } from "../../pixel";
import { PIXEL_SPRITES } from "../../pixel-sprites";
import { emptyStatus, reduceStatus, momentFromEvent, decayMoments, type GameMoment, type MissionStatus, type StatusModel } from "../../juice";
import { Transcript, emptyTranscript, reduceTranscript, type TranscriptModel } from "../../transcript";
import { theme } from "../../theme";
import {
  emptyFactoryHud,
  factoryFloor,
  hudFromFactoryState,
  nextActionHint,
  powerMeter,
  queueStripLine,
  stageFromState,
  touchSeriesLine,
  type FactoryHudState,
  type FactoryStage,
  type FloorNode,
} from "./model";

export interface ApprovalController {
  subscribe(fn: (state: ApprovalModalState | null) => void): () => void;
  resolve(decision: ApprovalDecision): void;
}

interface FactoryAppOpts extends StartTuiOpts {
  approval: ApprovalController;
  onCommand(line: string): boolean;
  factoryState(): FactoryState;
}

const statusColors: Record<MissionStatus, string> = {
  "AWAITING INPUT": theme.accent,
  STREAMING: theme.primary,
  "RUNNING TOOL": theme.amber,
  "AWAITING APPROVAL": theme.amber,
  ABORTED: theme.red,
  ERROR: theme.red,
};

const factoryEvents: Partial<Record<HarnessEvent["type"], true>> = {
  "item.enqueued": true,
  "item.started": true,
  "item.shipped": true,
  "touch.recorded": true,
  "machine.built": true,
  "research.completed": true,
  "shift.started": true,
  "shift.ended": true,
  "power.brownout": true,
  "assistant.end": true, // power draw accrues on usage while a shift runs
};

function workspaceLabel(path: string | undefined): string {
  if (!path) return "workspace pending";
  const leaf = path.split("/").filter(Boolean).at(-1) ?? path;
  return leaf.length > 24 ? `…${leaf.slice(-23)}` : leaf;
}

function stageLabel(stage: FactoryStage): string {
  if (stage === 2) return "STAGE 2 · mini-map online";
  if (stage === 1) return "STAGE 1 · queue strip online";
  return "STAGE 0 · bare chat";
}

function Header({ meta, stage, hud, flash }: { meta: StartTuiOpts["meta"]; stage: FactoryStage; hud: FactoryHudState; flash: boolean }) {
  const provider = meta?.model ? `${meta.provider}/${meta.model}` : meta?.provider ?? "provider pending";
  const shift = hud.power.shiftActive ? `SHIFT ${hud.power.shiftShipped} shipped` : "SHIFT idle";
  return (
    <box style={{ height: 3, flexDirection: "row", backgroundColor: theme.bg, paddingLeft: 1, paddingRight: 1 }}>
      <box style={{ flexGrow: 1, flexDirection: "column" }}>
        <text fg={flash ? theme.red : theme.primary} attributes={TextAttributes.BOLD}>GARNISH · FACTORY · {stageLabel(stage)}</text>
        <text fg={theme.dim}>{workspaceLabel(meta?.workspace)} · {provider}</text>
      </box>
      <box style={{ width: 30, flexDirection: "column", alignItems: "flex-end" }}>
        <text fg={hud.power.shiftActive ? theme.amber : theme.dim}>{shift}</text>
        <text fg={theme.dim}>{hud.items.filter((item) => item.status === "shipped").length} shipped · {hud.sciencePacks.red ?? 0} red science</text>
      </box>
    </box>
  );
}

function QueueBand({ hud }: { hud: FactoryHudState }) {
  return (
    <box style={{ height: 4, flexDirection: "row", border: true, borderColor: theme.border, backgroundColor: theme.panel, paddingLeft: 1, paddingRight: 1 }}>
      <box style={{ flexGrow: 1, flexDirection: "column" }}>
        <text fg={theme.primary} attributes={TextAttributes.BOLD}>{queueStripLine(hud)}</text>
        <text fg={theme.dim}>{touchSeriesLine(hud)}</text>
      </box>
      <box style={{ width: 24, flexDirection: "column", alignItems: "flex-end" }}>
        <text fg={theme.amber}>SCIENCE red × {hud.sciencePacks.red ?? 0}</text>
        <text fg={theme.dim}>CURRENT {hud.currentItemId ?? "none"}</text>
      </box>
    </box>
  );
}

const spriteByFloorNode: Record<FloorNode["id"], keyof typeof PIXEL_SPRITES> = {
  ore: "orePatch",
  miner: "minerDrill",
  belt: "routingBelt",
  assembler: "assembler",
  circuit: "circuitPole",
  ship: "powerBolt",
};

function beltLane(dot: { itemId: string; offset: number } | null, built: boolean): string {
  const cells: string[] = Array.from({ length: 12 }, () => built ? "═" : "░");
  if (built && dot) cells[Math.max(0, Math.min(cells.length - 1, dot.offset))] = "◆";
  return cells.join("");
}

function FloorNodeView({ node, dot, frame }: { node: FloorNode; dot: { itemId: string; offset: number } | null; frame: number }) {
  const activePulse = node.id === "miner" && node.active ? frame % 2 === 0 ? "▶" : "◆" : node.active ? "◆" : node.built ? "●" : "○";
  const color = node.active ? theme.amber : node.built ? theme.primary : theme.dim;
  return (
    <box style={{ flexDirection: "row", marginBottom: node.id === "ship" ? 0 : 1 }}>
      <PixelSpriteView sprite={PIXEL_SPRITES[spriteByFloorNode[node.id]]} dim={!node.built} />
      <box style={{ flexDirection: "column", paddingLeft: 1, flexGrow: 1 }}>
        <text fg={color} attributes={node.built ? TextAttributes.BOLD : TextAttributes.DIM}>{activePulse} {node.label}</text>
        <text fg={node.built ? theme.dim : theme.amber}>{node.detail}</text>
        {node.id === "belt" ? <text fg={node.built ? theme.amber : theme.dim}>│ {beltLane(dot, node.built)} │</text> : null}
      </box>
    </box>
  );
}

function FactoryFloorPane({ hud, status, frame }: { hud: FactoryHudState; status: StatusModel; frame: number }) {
  const floor = factoryFloor(hud, status.status, frame);
  const meterColor = hud.brownoutFlash ? theme.bg : hud.power.shiftActive ? theme.amber : theme.dim;
  return (
    <box title="FACTORY FLOOR" titleColor={hud.brownoutFlash ? theme.red : theme.accent} style={{ width: "34%", minWidth: 38, border: true, borderColor: hud.brownoutFlash ? theme.red : theme.border, flexDirection: "column", paddingLeft: 1, paddingRight: 1, backgroundColor: theme.panel }}>
      <box style={{ flexDirection: "column", flexGrow: 1 }}>
        {floor.nodes.map((node, index) => (
          <box key={node.id} style={{ flexDirection: "column" }}>
            <FloorNodeView node={node} dot={floor.beltDot} frame={frame} />
            {index < floor.nodes.length - 1 ? <text fg={node.built ? theme.dim : theme.amber}>  │</text> : null}
          </box>
        ))}
      </box>
      <box style={{ flexDirection: "row", minHeight: 3, backgroundColor: hud.brownoutFlash ? theme.red : undefined }}>
        <PixelSpriteView sprite={PIXEL_SPRITES.powerBolt} dim={!hud.power.shiftActive && !hud.brownoutFlash} />
        <box style={{ flexDirection: "column", paddingLeft: 1, justifyContent: "center" }}>
          <text fg={meterColor} attributes={hud.brownoutFlash ? TextAttributes.BOLD : undefined}>{powerMeter(hud, 14)}</text>
        </box>
      </box>
    </box>
  );
}

function HintRow({ hint }: { hint: string | null }) {
  return hint ? (
    <box style={{ height: 1, flexDirection: "row", justifyContent: "center", backgroundColor: theme.bg }}>
      <text fg={theme.amber} attributes={TextAttributes.DIM}>HINT {hint}</text>
    </box>
  ) : null;
}

function StatusInput({ status, input, setInput, focused, hint }: { status: StatusModel; input: string; setInput(value: string): void; focused: boolean; hint: string | null }) {
  return (
    <box style={{ flexDirection: "column" }}>
      <HintRow hint={hint} />
      <box style={{ border: true, borderColor: status.status === "AWAITING APPROVAL" ? theme.amber : theme.border, height: 3, paddingLeft: 1, paddingRight: 1, flexDirection: "row", alignItems: "center", backgroundColor: theme.panel }}>
        <text fg={statusColors[status.status]} attributes={TextAttributes.BOLD}>{status.pulse ? "●" : "○"} {status.status}  </text>
        <input focused={focused} placeholder="factory input · /help for commands" value={input} onInput={setInput} style={{ flexGrow: 1 }} />
      </box>
    </box>
  );
}

function BareChatInput({ input, setInput, focused, hint }: { input: string; setInput(value: string): void; focused: boolean; hint: string | null }) {
  return (
    <box style={{ flexDirection: "column" }}>
      <HintRow hint={hint} />
      <box style={{ border: true, borderColor: theme.border, height: 3, paddingLeft: 1, paddingRight: 1, flexDirection: "row", alignItems: "center", backgroundColor: theme.bg }}>
        <input focused={focused} placeholder="say what you want done" value={input} onInput={setInput} style={{ flexGrow: 1 }} />
      </box>
    </box>
  );
}

function startingHud(factoryState: () => FactoryState): FactoryHudState {
  try {
    return hudFromFactoryState(factoryState());
  } catch {
    return emptyFactoryHud();
  }
}

export function FactoryApp(opts: FactoryAppOpts) {
  const [input, setInput] = useState("");
  const [commandHint, setCommandHint] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptModel>(() => emptyTranscript());
  const [hud, setHud] = useState<FactoryHudState>(() => startingHud(opts.factoryState));
  const [status, setStatus] = useState<StatusModel>(() => emptyStatus());
  const [moments, setMoments] = useState<GameMoment[]>([]);
  const [modal, setModal] = useState<ApprovalModalState | null>(null);
  const [frame, setFrame] = useState(0);
  const timelineReady = useRef(false);
  const lastDecay = useRef(Date.now());
  const timeline = useTimeline({ duration: 1000, loop: true });

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
      // authoritative engine state, immune to pre-mount/ring-buffer event loss
      if (factoryEvents[event.type]) setHud(startingHud(opts.factoryState));
      const moment = momentFromEvent(event);
      if (moment) setMoments((current) => [...current.slice(-17), moment]);
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
          const step = stepApprovalModal(modal, { type: "reason", value: modal.reason.slice(0, -1) });
          setModal(step.state);
        } else if (!key.ctrl && !key.meta && key.raw.length === 1) {
          const step = stepApprovalModal(modal, { type: "reason", value: modal.reason + key.raw });
          setModal(step.state);
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
      const line = input.trim();
      if (line.startsWith("/")) {
        if (!opts.onCommand(line)) setCommandHint(`Unknown command: ${line}`);
        else setCommandHint(null);
      } else {
        opts.send(line);
        setCommandHint(null);
      }
      setInput("");
    }
  });

  const factoryState = opts.factoryState();
  const stage = stageFromState(factoryState);
  const renderHint = commandHint ?? nextActionHint(factoryState);
  const flash = hud.brownoutFlash || moments.some((moment) => moment.ttl > 10);

  if (stage === 0) {
    return (
      <box style={{ width: "100%", height: "100%", flexDirection: "column", backgroundColor: theme.bg }}>
        <Transcript model={transcript} />
        <BareChatInput input={input} setInput={setInput} focused={modal === null} hint={renderHint} />
        <ApprovalModal state={modal} />
      </box>
    );
  }

  return (
    <box style={{ width: "100%", height: "100%", flexDirection: "column", backgroundColor: theme.bg }}>
      <Header meta={opts.meta} stage={stage} hud={hud} flash={flash} />
      <QueueBand hud={hud} />
      {hud.brownoutFlash ? (
        <box style={{ height: 1, flexDirection: "row", justifyContent: "center", backgroundColor: theme.red }}>
          <text fg={theme.bg} attributes={TextAttributes.BOLD}>
            {`⚡ BROWNOUT — grid over budget (${hud.power.usedTokens}/${hud.power.budgetTokens} tokens) — /feed the grid to resume`}
          </text>
        </box>
      ) : null}
      <box style={{ flexGrow: 1, flexDirection: "row", backgroundColor: theme.bg }}>
        <box style={{ flexGrow: 1, flexDirection: "column", minWidth: 35 }}>
          <Transcript model={transcript} />
        </box>
        {stage === 2 ? <FactoryFloorPane hud={hud} status={status} frame={frame} /> : null}
      </box>
      <StatusInput status={status} input={input} setInput={setInput} focused={modal === null} hint={renderHint} />
      <box style={{ height: 1, flexDirection: "row", justifyContent: "center", backgroundColor: theme.bg }}>
        <text fg={theme.dim}>Enter send · /commands route to factory · a/p/d/r approvals · Esc abort · Ctrl+C quit</text>
      </box>
      <ApprovalModal state={modal} />
    </box>
  );
}
