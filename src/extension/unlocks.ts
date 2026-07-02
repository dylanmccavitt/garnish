import {
  enabledGateCapabilities,
  renderGateConfig,
  v1GateCatalog,
  writeGateConfig,
  type GateCapability,
  type GateCatalog,
  type GateConfigEffects,
  type RuntimePaths,
} from "../adapter";
import { unlockCommand, type CliDeps, type ProgressionStore, type UnlockOptions } from "../cli";
import { foldEvents, type ProgressionGraph } from "../progression";
import type { Quest } from "../core";
import type { PiEventHandler, PiExtensionContext, PiExtensionEvent } from "./index";

/** Structural slice of the Pi session-control surface (spike-verified shapes). */
export interface UnlockSessionControl {
  readonly getActiveTools: () => readonly string[];
  readonly setActiveTools: (tools: readonly string[]) => void;
  readonly reload: () => void | Promise<void>;
}

export interface UnlockExtensionContext extends PiExtensionContext {
  readonly session: UnlockSessionControl;
}

export type UnlockCommandHandler = (args: string, ctx: UnlockExtensionContext) => void | Promise<void>;

export interface UnlockPi {
  readonly on: (event: string, handler: PiEventHandler) => void;
  readonly registerCommand: (name: string, handler: UnlockCommandHandler) => void;
}

export interface LiveUnlockDeps {
  readonly graph: ProgressionGraph;
  readonly quests?: readonly Quest[];
  readonly store: ProgressionStore;
  readonly runtimePaths: RuntimePaths;
  readonly gateEffects: GateConfigEffects;
  readonly catalog?: GateCatalog;
  readonly now: () => string;
}

export interface LiveUnlockHandle {
  readonly applyUnlocks: () => Promise<void>;
  readonly appliedCapabilities: () => readonly GateCapability[];
  readonly reloadCount: () => number;
}

const UNLOCK_EVENTS = ["session_start", "turn_end", "agent_end"] as const;

export function registerLiveUnlocks(pi: UnlockPi, deps: LiveUnlockDeps): LiveUnlockHandle {
  const catalog = deps.catalog ?? v1GateCatalog;
  const applied = new Set<GateCapability>();
  let reloads = 0;
  let latestCtx: UnlockExtensionContext | undefined;
  let applying: Promise<void> = Promise.resolve();

  const applyUnlocksOnce = async (): Promise<void> => {
    const state = foldEvents(await deps.store.readEvents(), deps.graph);
    const rendered = renderGateConfig(state.unlockSet, catalog);
    const enabled = enabledGateCapabilities(rendered, catalog);
    const fresh = enabled.filter((capability) => !applied.has(capability));

    if (fresh.length === 0) {
      return;
    }

    // Monotonic by construction: capabilities are only ever added to `applied`.
    for (const capability of fresh) {
      applied.add(capability);
    }

    const liveTools = fresh
      .filter((capability) => capability.startsWith("tool:"))
      .map((capability) => capability.slice("tool:".length));
    const configBaked = fresh.filter((capability) => !capability.startsWith("tool:"));

    try {
      if (liveTools.length > 0 && latestCtx !== undefined) {
        const current = latestCtx.session.getActiveTools();
        const merged = [...new Set([...current, ...liveTools])].sort((a, b) => a.localeCompare(b));
        latestCtx.session.setActiveTools(merged);
        latestCtx.ui.notify(`Tools unlocked live: ${liveTools.join(", ")}`, "info");
      }

      if (configBaked.length > 0) {
        // Config-baked surfaces: write the generated gate config, then reload automatically.
        // State lives in the Garnish store (not session entries) so it survives reload —
        // the spike showed appendEntry immediately before reload() is not durable headless.
        await writeGateConfig(deps.runtimePaths, rendered, deps.gateEffects);
        if (latestCtx !== undefined) {
          latestCtx.ui.notify(
            `Unlocked ${configBaked.join(", ")} — reloading to apply. Your quest progress is saved.`,
            "info",
          );
          reloads += 1;
          await latestCtx.session.reload();
        }
      }
    } catch {
      // Gate application failures must never break chat; the next event retries nothing —
      // capabilities stay marked applied to preserve exactly-once semantics, and the CLI
      // path (garnish unlock / doctor) remains the recovery route.
    }
  };

  const scheduleApply = () => {
    applying = applying.then(applyUnlocksOnce);
  };

  for (const eventName of UNLOCK_EVENTS) {
    pi.on(eventName, (_event: PiExtensionEvent, ctx: PiExtensionContext) => {
      latestCtx = ctx as UnlockExtensionContext;
      scheduleApply();
    });
  }

  pi.registerCommand("unlock", async (args: string, ctx: UnlockExtensionContext) => {
    latestCtx = ctx;
    try {
      const options = parseUnlockArgs(args);
      const cliDeps: CliDeps = {
        graph: deps.graph,
        quests: deps.quests,
        store: deps.store,
        now: deps.now,
        catalog,
        runtimePaths: deps.runtimePaths,
        gateEffects: deps.gateEffects,
      };
      const outcome = await unlockCommand(cliDeps, options);
      ctx.ui.notify(outcome.text, outcome.exitCode === 0 ? "info" : "warning");
      if (outcome.exitCode === 0) {
        scheduleApply();
        await applying;
        const state = foldEvents(await deps.store.readEvents(), deps.graph);
        const levels = state.unlockSet.levels.map(String).join(", ") || "none";
        ctx.ui.notify(`Unlocked levels: ${levels} · features: ${state.unlockSet.features.length}`, "info");
      }
    } catch {
      ctx.ui.notify("Garnish /unlock failed; try `garnish unlock` from the CLI.", "warning");
    }
  });

  return {
    applyUnlocks: async () => {
      scheduleApply();
      await applying;
    },
    appliedCapabilities: () => [...applied].sort((a, b) => a.localeCompare(b)),
    reloadCount: () => reloads,
  };
}

function parseUnlockArgs(args: string): UnlockOptions {
  const parts = args.trim().split(/\s+/).filter((part) => part.length > 0);
  const options: { all?: boolean; level?: string } = {};
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index] === "--all" || parts[index] === "all") {
      options.all = true;
    } else if ((parts[index] === "--level" || parts[index] === "level") && parts[index + 1] !== undefined) {
      options.level = parts[index + 1];
      index += 1;
    }
  }
  return options;
}
