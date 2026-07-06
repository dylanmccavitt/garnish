import { createElement } from "react";
import { createCliRenderer, type CliRenderer } from "@opentui/core";
import { createRoot, type Root } from "@opentui/react";
import type { ApprovalDecision, ApprovalPrompter, ApprovalRequest, EventBus, GateView, Scorecard } from "../harness/types";
import { TuiApp, type ApprovalController, type TuiMeta } from "./app";
import type { ApprovalModalState } from "./modal";

export type { QuestView } from "./questlog";
export { reduceTranscript, emptyTranscript, type TranscriptModel, type TranscriptEntry } from "./transcript";
export { glyphLegend, momentFromEvent, glyphShower, decayMoments, reduceStatus, emptyStatus, type GameMoment, type MissionStatus, type StatusModel } from "./juice";
export { stepApprovalModal, riskColors, type ApprovalModalState } from "./modal";

export interface StartTuiOpts {
  bus: EventBus;
  send(text: string): void;
  abort(): void;
  gateViews(): GateView[];
  questView(): { id: string; title: string; checks: Array<{ line: string; done: boolean }> } | null;
  scorecard(): Scorecard | null;
  /** real progression state (save-backed); header falls back to a scorecard hack when absent */
  progress?(): { xp: number; level: number };
  onExit(): void;
  meta?: TuiMeta;
}

interface PendingApproval {
  state: ApprovalModalState;
  resolve(decision: ApprovalDecision): void;
}

export function startTui(opts: StartTuiOpts): { prompter: ApprovalPrompter; stop(): void } {
  let renderer: CliRenderer | null = null;
  let root: Root | null = null;
  let stopped = false;
  let pending: PendingApproval | null = null;
  const subscribers = new Set<(state: ApprovalModalState | null) => void>();

  const publishApprovalState = () => {
    for (const subscriber of subscribers) subscriber(pending?.state ?? null);
  };
  const unsubscribeApprovalEvents = opts.bus.subscribe((event) => {
    if (event.type !== "tool.approval.requested") return;
    const request: ApprovalRequest = {
      callId: event.callId,
      tool: event.tool,
      command: event.command ?? "(no command supplied)",
      risk: event.risk,
      explanation: event.explanation,
      suggestedPattern: pending?.state.request.callId === event.callId ? pending.state.request.suggestedPattern : undefined,
    };
    pending = {
      state: { request, reason: pending?.state.request.callId === event.callId ? pending.state.reason : "", mode: "menu" },
      resolve: pending?.state.request.callId === event.callId ? pending.resolve : () => undefined,
    };
    publishApprovalState();
  });

  const approval: ApprovalController = {
    subscribe(fn) {
      subscribers.add(fn);
      fn(pending?.state ?? null);
      return () => subscribers.delete(fn);
    },
    resolve(decision) {
      const active = pending;
      pending = null;
      publishApprovalState();
      active?.resolve(decision);
    },
  };

  const boot = async () => {
    renderer = await createCliRenderer({
      screenMode: "alternate-screen",
      exitOnCtrlC: false,
      clearOnShutdown: true,
      targetFps: 30,
      backgroundColor: "#121212",
    });
    if (stopped) {
      renderer.destroy();
      return;
    }
    root = createRoot(renderer);
    root.render(createElement(TuiApp, { ...opts, approval }));
  };

  void boot().catch((error) => {
    opts.onExit();
    console.error("TUI failed to start", error);
  });

  return {
    prompter(req: ApprovalRequest) {
      return new Promise<ApprovalDecision>((resolve) => {
        if (pending?.state.request.callId === req.callId) {
          pending = { state: { ...pending.state, request: req }, resolve };
        } else {
          pending = { state: { request: req, reason: "", mode: "menu" }, resolve };
        }
        publishApprovalState();
      });
    },
    stop() {
      stopped = true;
      pending?.resolve({ approved: false, mode: "deny", reason: "TUI stopped" });
      pending = null;
      publishApprovalState();
      root?.unmount();
      renderer?.destroy();
      subscribers.clear();
      unsubscribeApprovalEvents();
    },
  };
}
