import { createElement } from "react";
import { createCliRenderer, type CliRenderer } from "@opentui/core";
import { createRoot, type Root } from "@opentui/react";
import type { ApprovalDecision, ApprovalPrompter, ApprovalRequest } from "../../../harness/types";
import type { FactoryState } from "../../../factory/types";
import type { StartTuiOpts } from "../../index";
import { FactoryApp, type ApprovalController } from "./app";
import type { ApprovalModalState } from "../../modal";

export type FactoryTuiOpts = StartTuiOpts & {
  onCommand(line: string): boolean;
  factoryState(): FactoryState;
};

interface PendingApproval {
  state: ApprovalModalState;
  resolve(decision: ApprovalDecision): void;
}

export function startTui(opts: FactoryTuiOpts): { prompter: ApprovalPrompter; stop(): void } {
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
      backgroundColor: "#0D0D0E",
    });
    if (stopped) {
      renderer.destroy();
      return;
    }
    root = createRoot(renderer);
    root.render(createElement(FactoryApp, { ...opts, approval }));
  };

  void boot().catch((error) => {
    opts.onExit();
    console.error("Factory TUI failed to start", error);
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

export {
  deriveStage,
  emptyFactoryHud,
  factoryFloor,
  hudFromFactoryState,
  miniMapModel,
  nextActionHint,
  powerMeter,
  queueStripLine,
  reduceFactoryHud,
  touchSeriesLine,
} from "./model";
