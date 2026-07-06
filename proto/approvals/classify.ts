import type { RiskTier } from "../harness/types";

const rank: Record<RiskTier, number> = { safe: 0, moderate: 1, risky: 2, critical: 3 };

const readOnlyCommands: Record<string, true> = {
  ls: true, pwd: true, cat: true, head: true, tail: true, less: true, more: true, wc: true, sort: true, uniq: true,
  grep: true, egrep: true, fgrep: true, find: true, echo: true, printf: true, date: true, whoami: true, id: true,
  "git status": true, "git log": true, "git diff": true, "git show": true, "git branch": true, "git rev-parse": true, "git ls-files": true,
};

const moderateCommands: Record<string, true> = {
  touch: true, mkdir: true, cp: true, mv: true, write: true, tee: true, "bun test": true, "bun run": true, "npm test": true,
  "git add": true, "git commit": true, "git checkout": true, "git switch": true, "git restore": true, "git reset": true, "git merge": true, "git rebase": true,
};

const installWords = /\b(bun\s+add|bun\s+install|npm\s+install|npm\s+i|pnpm\s+add|pnpm\s+install|yarn\s+add|pip\s+install|cargo\s+install)\b/;
const publishWords = /\b(npm\s+publish|pnpm\s+publish|yarn\s+npm\s+publish|cargo\s+publish|bun\s+publish)\b/;
const networkWords = /\b(curl|wget|nc|netcat|ssh|scp|rsync|telnet|ftp)\b/;
const credentialPath = /(^|[\s'"=:/])(\.env(\.|\s|$)|id_rsa|id_ed25519|\.ssh\/|credentials|credential|token|secret|secrets|api[_-]?key|npmrc|netrc)([\s'"/]|$)/i;

export function classifyCommand(cmd: string): { tier: RiskTier; explanation: string } {
  const parts = splitCompound(cmd);
  if (parts.length > 1) {
    const classified = parts.map((part) => classifySingle(stripWrapper(part)));
    const max = classified.reduce((best, item) => rank[item.tier] > rank[best.tier] ? item : best, classified[0]);
    return { tier: max.tier, explanation: `compound command takes highest risk: ${max.explanation}` };
  }
  return classifySingle(stripWrapper(cmd));
}

export function splitCompound(cmd: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < cmd.length; i += 1) {
    const ch = cmd[i];
    const next = cmd[i + 1];
    if (ch === "\\") {
      current += ch;
      if (next) current += next, i += 1;
      continue;
    }
    if ((ch === "'" || ch === '"') && quote === null) quote = ch;
    else if (ch === quote) quote = null;
    if (!quote) {
      const two = ch + (next ?? "");
      if (two === "&&" || two === "||") {
        pushPart(parts, current);
        current = "";
        i += 1;
        continue;
      }
      if (ch === ";" || ch === "|") {
        pushPart(parts, current);
        current = "";
        continue;
      }
    }
    current += ch;
  }
  pushPart(parts, current);
  return parts;
}

function pushPart(parts: string[], value: string): void {
  const trimmed = value.trim();
  if (trimmed) parts.push(trimmed);
}

export function stripWrapper(cmd: string): string {
  const tokens = shellWords(cmd);
  if (tokens.length === 0) return cmd.trim();
  const [first] = tokens;
  if (first === "env") {
    const rest = tokens.slice(1);
    while (rest[0]?.includes("=") || rest[0]?.startsWith("-")) rest.shift();
    return rest.join(" ") || cmd.trim();
  }
  if (first === "nice" || first === "time" || first === "command") {
    const rest = tokens.slice(1);
    if (first === "nice" && rest[0] === "-n") rest.splice(0, 2);
    else while (rest[0]?.startsWith("-")) rest.shift();
    return rest.join(" ") || cmd.trim();
  }
  if (first === "xargs") {
    const commandIndex = tokens.findIndex((token, index) => index > 0 && !token.startsWith("-"));
    return commandIndex >= 0 ? tokens.slice(commandIndex).join(" ") : cmd.trim();
  }
  if ((first === "bash" || first === "sh" || first === "zsh") && tokens.includes("-c")) {
    const index = tokens.indexOf("-c");
    return tokens[index + 1] ?? cmd.trim();
  }
  return cmd.trim();
}

function classifySingle(cmd: string): { tier: RiskTier; explanation: string } {
  const normalized = cmd.trim().replace(/\s+/g, " ");
  const words = shellWords(normalized);
  const first = words[0] ?? "";
  const prefix2 = words.slice(0, 2).join(" ");
  const prefix3 = words.slice(0, 3).join(" ");

  if (!normalized) return { tier: "safe", explanation: "empty command has no effect" };
  if (/\b>\s*\/dev\//.test(normalized)) return { tier: "critical", explanation: "redirects output into /dev" };
  if (credentialPath.test(normalized)) return { tier: "critical", explanation: "touches likely credential or secret paths" };
  if (/\bgit\s+push\b.*\s(--force|-f|--force-with-lease)\b/.test(normalized)) return { tier: "critical", explanation: "force-push can rewrite shared history" };
  if (isDangerousRm(words)) return { tier: "critical", explanation: "recursive forced removal targets outside the workspace" };

  if (publishWords.test(normalized)) return { tier: "risky", explanation: "publishes packages outside the workspace" };
  if (/\bsudo\b/.test(normalized)) return { tier: "risky", explanation: "uses sudo privileges" };
  if (/\bchmod\b.*\s(-R|777|a\+w|ugo\+w)\b/.test(normalized)) return { tier: "risky", explanation: "broad chmod can weaken permissions" };
  if (networkWords.test(normalized)) return { tier: "risky", explanation: "uses network access" };
  if (/\b(curl|wget)\b.*\|\s*(sh|bash|zsh|python|ruby|perl)\b/.test(normalized)) return { tier: "risky", explanation: "pipes network content into an interpreter" };

  if (installWords.test(normalized)) return { tier: "moderate", explanation: "installs or changes dependencies" };
  if (/\b(rm|rmdir)\b/.test(normalized)) return { tier: "moderate", explanation: "removes files" };
  if (/[>]{1,2}\s*[^&\s]/.test(normalized)) return { tier: "moderate", explanation: "redirects output to a file" };
  if ([prefix3, prefix2, first].some((prefix) => moderateCommands[prefix])) return { tier: "moderate", explanation: "changes workspace or git state" };

  if ([prefix3, prefix2, first].some((prefix) => readOnlyCommands[prefix])) return { tier: "safe", explanation: "matches a read-only command prefix" };
  return { tier: "moderate", explanation: "unknown command may change local state" };
}

function isDangerousRm(words: string[]): boolean {
  if (words[0] !== "rm") return false;
  const flags = words.filter((word) => word.startsWith("-"));
  const recursive = flags.some((flag) => flag.includes("r") || flag.includes("R"));
  const force = flags.some((flag) => flag.includes("f"));
  if (!recursive || !force) return false;
  return words.slice(1).some((word) => !word.startsWith("-") && (word.startsWith("/") || word === ".." || word.startsWith("../") || word.includes("/../")));
}

function shellWords(input: string): string[] {
  const words: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    const next = input[i + 1];
    if (ch === "\\") {
      if (next) current += next, i += 1;
      continue;
    }
    if ((ch === "'" || ch === '"') && quote === null) {
      quote = ch;
      continue;
    }
    if (ch === quote) {
      quote = null;
      continue;
    }
    if (!quote && /\s/.test(ch)) {
      if (current) words.push(current), current = "";
      continue;
    }
    current += ch;
  }
  if (current) words.push(current);
  return words;
}
