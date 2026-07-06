import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface Profile {
  provider: string;
  method: "oauth" | "api-key" | "scripted";
  account?: string;
  createdAt: number;
}

export function resolveSaveRoot(env: Record<string, string | undefined> = process.env): string {
  const configured = env.GARNISH_PROTO_HOME;
  return resolve(configured && configured.length > 0 ? configured : join(homedir(), ".garnish-proto"));
}

export function loadProfile(root: string): Profile | null {
  const path = join(root, "profile.json");
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return isProfile(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveProfile(root: string, profile: Profile): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "profile.json"), `${JSON.stringify(profile, null, 2)}\n`, "utf8");
}

export function resetSave(root: string): void {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
}

function isProfile(value: unknown): value is Profile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Record<string, unknown>;
  return (
    typeof profile.provider === "string" &&
    profile.provider.length > 0 &&
    (profile.method === "oauth" || profile.method === "api-key" || profile.method === "scripted") &&
    (profile.account === undefined || typeof profile.account === "string") &&
    typeof profile.createdAt === "number" &&
    Number.isFinite(profile.createdAt)
  );
}
