import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

import type { FeatureId } from "../../src/core";
import {
  compareStockParityConfig,
  enabledGateCapabilities,
  findGateMonotonicityViolations,
  renderGateConfig,
  stockParityConfig,
  v1GateCatalog,
  writeGateConfig,
  type GateCatalog,
  type GateConfigEffects,
} from "../../src/adapter/gates";
import { runtimePaths } from "../../src/adapter/runtime";
import type { ProgressionUnlockSet } from "../../src/progression";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

test("renderGateConfig snapshots the v1 gate diff monotonically", () => {
  const orderedUnlocks = [
    { label: "l0-chat", features: [] },
    { label: "l1-file-tools", features: ["tool:file"] },
    { label: "l1-shell", features: ["tool:file", "tool:shell"] },
    { label: "l2-context", features: ["context", "tool:file", "tool:shell"] },
    { label: "l3-skills", features: ["context", "skills", "tool:file", "tool:shell"] },
    { label: "l4-loadout", features: ["context", "extensions", "mcp", "skills", "tool:file", "tool:shell"] },
    { label: "l5-party", features: ["context", "extensions", "mcp", "skills", "subagents", "tool:file", "tool:shell"] },
  ];
  const rendered = orderedUnlocks.map((step) => renderGateConfig(unlockSet(step.features)));
  const diffs = rendered.map((config, index) => {
    const current = enabledGateCapabilities(config);
    const previous = new Set(index === 0 ? [] : enabledGateCapabilities(rendered[index - 1]!));
    return {
      label: orderedUnlocks[index]!.label,
      added: current.filter((capability) => !previous.has(capability)),
    };
  });

  expect(diffs).toEqual([
    { label: "l0-chat", added: [] },
    {
      label: "l1-file-tools",
      added: ["tool:edit", "tool:glob", "tool:grep", "tool:read", "tool:write"],
    },
    { label: "l1-shell", added: ["tool:bash"] },
    {
      label: "l2-context",
      added: [
        "provider:agents-md",
        "provider:claude",
        "provider:codex",
        "provider:cursor",
        "provider:gemini",
        "provider:github",
        "provider:native",
        "provider:opencode",
      ],
    },
    { label: "l3-skills", added: ["skill:*"] },
    { label: "l4-loadout", added: ["extension:extension-module:garnish-demo", "mcp:garnish-demo"] },
    { label: "l5-party", added: ["tool:task"] },
  ]);
  expect(findGateMonotonicityViolations(rendered)).toEqual([]);
});

test("tool gates render per-tool toggles for file and shell surfaces", () => {
  const locked = renderGateConfig(unlockSet([]));
  const unlocked = renderGateConfig(unlockSet(["tool:file", "tool:shell"]));

  expect(locked.config).toMatchObject({
    bash: { enabled: false },
    edit: { enabled: false },
    glob: { enabled: false },
    grep: { enabled: false },
    read: { enabled: false },
    write: { enabled: false },
  });
  expect(unlocked.config).toMatchObject({
    bash: { enabled: true },
    edit: { enabled: true },
    glob: { enabled: true },
    grep: { enabled: true },
    read: { enabled: true },
    write: { enabled: true },
  });
});

test("skills gate renders skills.enabled and the includeSkills allowlist", () => {
  const locked = renderGateConfig(unlockSet([]));
  const unlocked = renderGateConfig(unlockSet(["skills"]));

  expect(locked.config).toMatchObject({ skills: { enabled: false, includeSkills: [] } });
  expect(unlocked.config).toMatchObject({ skills: { enabled: true, includeSkills: ["*"] } });
});

test("mcp gate renders project config gating and disabledServers", () => {
  const locked = renderGateConfig(unlockSet([]));
  const unlocked = renderGateConfig(unlockSet(["mcp"]));

  expect(locked.config).toMatchObject({ mcp: { enableProjectConfig: false } });
  expect(locked.mcp.disabledServers).toEqual(["garnish-demo"]);
  expect(unlocked.config).toMatchObject({ mcp: { enableProjectConfig: true } });
  expect(unlocked.mcp.disabledServers).toEqual([]);
});

test("extension and context gates render disabledExtensions and disabledProviders", () => {
  const locked = renderGateConfig(unlockSet([]));
  const unlocked = renderGateConfig(unlockSet(["context", "extensions"]));

  expect(locked.config).toMatchObject({
    disabledExtensions: ["extension-module:garnish-demo"],
    disabledProviders: [
      "agents-md",
      "claude",
      "codex",
      "cursor",
      "gemini",
      "github",
      "native",
      "opencode",
    ],
  });
  expect(unlocked.config).toMatchObject({
    disabledExtensions: [],
    disabledProviders: [],
  });
});

test("approvalMode renders only when a catalog gates approval policy", () => {
  const approvalCatalog = {
    "approval:write": [{ kind: "approvalMode", mode: "write" }],
    "approval:yolo": [{ kind: "approvalMode", mode: "yolo" }],
  } as const satisfies GateCatalog;

  const locked = renderGateConfig(unlockSet([]), approvalCatalog);
  const write = renderGateConfig(unlockSet(["approval:write"]), approvalCatalog);
  const yolo = renderGateConfig(unlockSet(["approval:write", "approval:yolo"]), approvalCatalog);

  expect(locked.config).toMatchObject({ tools: { approvalMode: "always-ask" } });
  expect(write.config).toMatchObject({ tools: { approvalMode: "write" } });
  expect(yolo.config).toMatchObject({ tools: { approvalMode: "yolo" } });
  expect(findGateMonotonicityViolations([locked, write, yolo], approvalCatalog)).toEqual([]);
});

test("stockParityConfig unlocks every v1 catalog surface with no locked residue", () => {
  const stock = stockParityConfig(v1GateCatalog);

  expect(compareStockParityConfig(stock, v1GateCatalog)).toEqual({ ok: true, issues: [] });
  expect(stock.mcp.disabledServers).toEqual([]);
  expect(stock.config).toMatchObject({
    disabledExtensions: [],
    disabledProviders: [],
    mcp: { enableProjectConfig: true },
    skills: { enabled: true, includeSkills: ["*"] },
  });
  expect(enabledGateCapabilities(stock, v1GateCatalog)).toEqual([
    "extension:extension-module:garnish-demo",
    "mcp:garnish-demo",
    "provider:agents-md",
    "provider:claude",
    "provider:codex",
    "provider:cursor",
    "provider:gemini",
    "provider:github",
    "provider:native",
    "provider:opencode",
    "skill:*",
    "tool:bash",
    "tool:edit",
    "tool:glob",
    "tool:grep",
    "tool:read",
    "tool:task",
    "tool:write",
  ]);
});

test("writeGateConfig writes only generated files under RuntimePaths.agentDir", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "garnish-gates-"));
  tempRoots.push(tempRoot);
  const paths = runtimePaths({ garnishRootDir: tempRoot });
  const rendered = renderGateConfig(unlockSet(["tool:file"]));
  const effects = new FakeGateEffects();

  await writeGateConfig(paths, rendered, effects);

  const agentDir = resolve(paths.agentDir);
  expect(effects.createdDirs).toEqual([agentDir]);
  expect(effects.writes.map((write) => write.path)).toEqual([
    join(agentDir, "config.yml"),
    join(agentDir, "mcp.json"),
  ]);
  for (const write of effects.writes) {
    const relativePath = relative(agentDir, write.path);
    expect(relativePath).not.toBe("");
    expect(relativePath.startsWith("..")).toBe(false);
    expect(isAbsolute(relativePath)).toBe(false);
    expect(write.path.startsWith(join(tempRoot, "global"))).toBe(false);
  }
  expect(effects.writes[0]?.content).toBe(rendered.configYml);
  expect(effects.writes[1]?.content).toBe(rendered.mcpJson);
  expect(effects.writes[0]?.content.startsWith("# Generated by Garnish.")).toBe(true);
  expect(effects.writes[1]?.content).toContain('"owner": "garnish"');
});

class FakeGateEffects implements GateConfigEffects {
  readonly createdDirs: string[] = [];
  readonly writes: { readonly path: string; readonly content: string }[] = [];

  mkdirp(path: string): void {
    this.createdDirs.push(path);
  }

  writeFile(path: string, content: string): void {
    this.writes.push({ path, content });
  }
}

function unlockSet(features: readonly string[]): ProgressionUnlockSet {
  return {
    features: features.map((feature) => feature as FeatureId),
    levels: [],
  };
}
