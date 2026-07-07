import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { join } from "node:path";

import { PIXEL_SPRITES } from "../tui/pixel-sprites";

export interface WorldSummary {
  name: string;
  shipped: number;
  science: { red: number };
  machines: string[];
  updatedAt: string;
}

export interface WorldSlot {
  slug: string;
  root: string;
  name: string;
  summary: WorldSummary | null;
}

export type WorldMenuChoice = { type: "select"; index: number } | { type: "new" } | { type: "quit" };

export function slugWorldName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length === 0 ? "world" : slug;
}

export function worldRoot(saveRoot: string, name: string): { root: string; name: string } {
  const displayName = name.trim().length === 0 ? "world" : name.trim();
  const root = join(saveRoot, "worlds", slugWorldName(displayName));
  mkdirSync(root, { recursive: true });
  return { root, name: displayName };
}

export function parseWorldMenuChoice(input: string, slotCount: number): WorldMenuChoice | null {
  const trimmed = input.trim().toLowerCase();
  if (trimmed === "q") return { type: "quit" };
  if (trimmed === "n") return { type: "new" };
  if (/^\d+$/.test(trimmed)) {
    const selected = Number(trimmed);
    if (selected >= 1 && selected <= slotCount) return { type: "select", index: selected - 1 };
  }
  return null;
}

export function listWorldSlots(saveRoot: string): WorldSlot[] {
  const worldsRoot = join(saveRoot, "worlds");
  mkdirSync(worldsRoot, { recursive: true });

  return readdirSync(worldsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
    .map((slug) => {
      const root = join(worldsRoot, slug);
      const summary = readWorldSummary(join(root, "world.json"));
      return { slug, root, name: summary?.name ?? slug, summary };
    });
}

export function formatRelativeTime(updatedAt: string, now = Date.now()): string {
  const updated = Date.parse(updatedAt);
  if (!Number.isFinite(updated)) return "now";
  const seconds = Math.max(0, Math.floor((now - updated) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function renderWorldSlot(slot: WorldSlot, index: number, now = Date.now()): string {
  if (slot.summary === null) return `${index + 1}) ${slot.name} — fresh world —`;
  const summary = slot.summary;
  return `${index + 1}) ${summary.name} — ${summary.shipped} shipped · red ×${summary.science.red} · ${summary.machines.length} machines · ${formatRelativeTime(summary.updatedAt, now)}`;
}

export function renderWorldMenu(slots: readonly WorldSlot[], now = Date.now()): string {
  return [
    "GARNISH · FACTORY",
    ...PIXEL_SPRITES.sprigIdle.ansi,
    "",
    "World slots",
    ...(slots.length === 0 ? ["— fresh world —"] : slots.map((slot, index) => renderWorldSlot(slot, index, now))),
    "n) new world",
    "q) quit",
  ].join("\n");
}

export async function runWorldMenu(opts: { saveRoot: string }): Promise<{ root: string; name: string } | null> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY === true });
  const lines = rl[Symbol.asyncIterator]();

  async function readLine(prompt: string): Promise<string | null> {
    process.stdout.write(prompt);
    const next = await lines.next();
    if (next.done === true) return null;
    return next.value;
  }

  try {
    for (;;) {
      const slots = listWorldSlots(opts.saveRoot);
      console.log(renderWorldMenu(slots));
      const answer = await readLine("Pick a world › ");
      if (answer === null) return null;
      const choice = parseWorldMenuChoice(answer, slots.length);
      if (choice === null) {
        console.log("That world is not on the belt. Pick a listed number, n, or q.");
        continue;
      }
      if (choice.type === "quit") return null;
      if (choice.type === "select") {
        const slot = slots[choice.index];
        if (slot === undefined) continue;
        return { root: slot.root, name: slot.name };
      }

      const defaultName = `world-${slots.length + 1}`;
      const nameAnswer = await readLine(`Name this world (${defaultName}) › `);
      if (nameAnswer === null) return null;
      return worldRoot(opts.saveRoot, nameAnswer.trim().length === 0 ? defaultName : nameAnswer);
    }
  } finally {
    rl.close();
  }
}

function readWorldSummary(path: string): WorldSummary | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<WorldSummary>;
    if (typeof parsed.name !== "string") return null;
    if (typeof parsed.shipped !== "number") return null;
    if (typeof parsed.updatedAt !== "string") return null;
    if (!Array.isArray(parsed.machines) || !parsed.machines.every((machine) => typeof machine === "string")) return null;
    if (typeof parsed.science !== "object" || parsed.science === null || typeof parsed.science.red !== "number") return null;
    return {
      name: parsed.name,
      shipped: parsed.shipped,
      science: { red: parsed.science.red },
      machines: [...parsed.machines],
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return null;
  }
}
