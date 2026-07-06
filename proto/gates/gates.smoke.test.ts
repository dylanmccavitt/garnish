import { describe, expect, test } from "bun:test";
import { z } from "zod";

import type { GarnishTool, GateVisibility } from "../harness/types";
import { createGateEngine, defaultCatalog } from "./index";

describe("gate engine", () => {
  test("shows the default catalog as a progressive visibility map", () => {
    const catalog = defaultCatalog();
    const tools: GarnishTool[] = catalog.map((entry) => ({
      name: entry.tool,
      description: `${entry.tool} test double`,
      params: z.object({}),
      async execute() {
        throw new Error("gate tests only inspect visibility");
      },
    }));
    const changes: string[] = [];
    const engine = createGateEngine({ catalog, unlocked: new Set<string>(), onChange: () => changes.push("changed") });

    const initialVisibility: Record<string, GateVisibility> = Object.fromEntries(
      engine.views(tools).map((view) => [view.tool, view.visibility]),
    );
    expect(initialVisibility).toEqual({
      read: "unlocked",
      write: "tease",
      edit: "tease",
      bash: "hidden",
      search: "hidden",
      subagent: "hidden",
      "danger-zone": "hidden",
    });
    expect(engine.toolFilter(tools).map((tool) => tool.name)).toEqual(["read"]);

    engine.applyUnlock("l0-hands");
    const afterL0Visibility: Record<string, GateVisibility> = Object.fromEntries(
      engine.views(tools).map((view) => [view.tool, view.visibility]),
    );
    expect(afterL0Visibility).toEqual({
      read: "unlocked",
      write: "unlocked",
      edit: "unlocked",
      bash: "tease",
      search: "hidden",
      subagent: "hidden",
      "danger-zone": "hidden",
    });
    expect(engine.toolFilter(tools).map((tool) => tool.name)).toEqual(["read", "write", "edit"]);

    engine.unlockAll();
    const fullyUnlockedVisibility: Record<string, GateVisibility> = Object.fromEntries(
      engine.views(tools).map((view) => [view.tool, view.visibility]),
    );
    expect(fullyUnlockedVisibility).toEqual({
      read: "unlocked",
      write: "unlocked",
      edit: "unlocked",
      bash: "unlocked",
      search: "unlocked",
      subagent: "unlocked",
      "danger-zone": "unlocked",
    });
    expect(engine.toolFilter(tools).map((tool) => tool.name)).toEqual([
      "read",
      "write",
      "edit",
      "bash",
      "search",
      "subagent",
      "danger-zone",
    ]);
    expect(changes).toEqual(["changed", "changed"]);
  });
});
