import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type Provider = "anthropic" | "openai";

const envByProvider: Record<Provider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

const fileKeyByProvider: Record<Provider, string> = {
  anthropic: "anthropic",
  openai: "openai",
};

export function resolveAuth(provider: Provider): { apiKey: string } | null {
  const envKey = process.env[envByProvider[provider]];
  if (envKey) return { apiKey: envKey };

  const path = process.env.GARNISH_PROTO_AUTH_FILE ?? join(homedir(), ".config", "garnish", "auth.json");
  let stat: { mode: number; isFile(): boolean };
  try {
    stat = statSync(path);
  } catch {
    return null;
  }
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) return null;

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const root = parsed as Record<string, unknown>;
    const nested = root[fileKeyByProvider[provider]];
    if (nested && typeof nested === "object") {
      const apiKey = (nested as Record<string, unknown>).apiKey;
      return typeof apiKey === "string" && apiKey ? { apiKey } : null;
    }
    const flatKey = `${provider}ApiKey`;
    const apiKey = root[flatKey];
    return typeof apiKey === "string" && apiKey ? { apiKey } : null;
  } catch {
    return null;
  }
}
