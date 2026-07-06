import type { GarnishTool, GateCatalogEntry, GateEngine, GateView } from "../harness/types";
import type { PrototypeGateCatalogEntry } from "./catalog";

type PrototypeGateEngine = GateEngine & { hasUnlock(unlockId: string): boolean };

export function createGateEngine(opts: { catalog: GateCatalogEntry[]; unlocked: Set<string>; onChange?: () => void }): GateEngine {
  const unlocked = opts.unlocked;
  const catalog = opts.catalog as PrototypeGateCatalogEntry[];

  function lockedUnlockOrder(): string[] {
    const seen = new Set<string>();
    const order: string[] = [];
    for (const entry of catalog) {
      if (entry.unlockId === null || unlocked.has(entry.unlockId) || seen.has(entry.unlockId)) continue;
      seen.add(entry.unlockId);
      order.push(entry.unlockId);
    }
    return order;
  }

  function isUnlocked(tool: string): boolean {
    const entry = catalog.find((item) => item.tool === tool);
    return entry === undefined || entry.unlockId === null || unlocked.has(entry.unlockId);
  }

  function viewFor(tool: string): GateView {
    const entry = catalog.find((item) => item.tool === tool);
    if (entry === undefined) return { tool, visibility: "unlocked" };
    if (entry.unlockId === null || unlocked.has(entry.unlockId)) return { tool, visibility: "unlocked", teaching: entry.teaching };
    const nextLocked = lockedUnlockOrder()[0];
    return {
      tool,
      visibility: entry.unlockId === nextLocked ? "tease" : "hidden",
      teaching: entry.teaching,
    };
  }

  const engine: PrototypeGateEngine = {
    toolFilter(all: GarnishTool[]) {
      return all.filter((tool) => isUnlocked(tool.name));
    },
    views(all: GarnishTool[]) {
      const names = new Set(catalog.map((entry) => entry.tool));
      for (const tool of all) names.add(tool.name);
      return [...names].map(viewFor);
    },
    applyUnlock(unlockId: string) {
      const before = unlocked.size;
      unlocked.add(unlockId);
      if (unlocked.size !== before) opts.onChange?.();
    },
    isUnlocked,
    unlockAll() {
      const before = unlocked.size;
      for (const entry of catalog) if (entry.unlockId !== null) unlocked.add(entry.unlockId);
      if (unlocked.size !== before) opts.onChange?.();
    },
    hasUnlock(unlockId: string) {
      return unlocked.has(unlockId);
    },
  };

  return engine;
}
