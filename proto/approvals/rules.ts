import { classifyCommand } from "./classify";

type RuleOutcome = "allow" | "ask" | "deny";

export interface RulesEngine {
  evaluate(cmd: string): { outcome: RuleOutcome; matchedRule?: string };
  addSessionAllow(pattern: string): void;
  suggestPattern(cmd: string): string;
}

const builtInAllow: Record<string, true> = {
  ls: true,
  pwd: true,
  cat: true,
  head: true,
  tail: true,
  wc: true,
  sort: true,
  uniq: true,
  grep: true,
  find: true,
  echo: true,
  printf: true,
  date: true,
  "git status": true,
  "git log": true,
  "git diff": true,
  "git show": true,
  "git branch": true,
  "git rev-parse": true,
};


export function createRulesEngine(opts: { sessionAllows?: string[] } = {}): RulesEngine {
  const sessionAllows = [...(opts.sessionAllows ?? [])];
  return {
    evaluate(cmd: string) {
      const normalized = normalize(cmd);
      const classified = classifyCommand(normalized);
      if (classified.tier === "critical") return { outcome: "deny", matchedRule: criticalRuleName(normalized) };
      const session = sessionAllows.find((pattern) => matchesPattern(normalized, pattern));
      if (session) return { outcome: "allow", matchedRule: `session:${session}` };

      const prefix = commandPrefix(normalized);
      if (builtInAllow[prefix] || builtInAllow[firstWord(normalized)]) {
        return { outcome: "allow", matchedRule: `builtin:${builtInAllow[prefix] ? prefix : firstWord(normalized)}` };
      }
      return { outcome: "ask", matchedRule: "default:ask" };
    },
    addSessionAllow(pattern: string) {
      sessionAllows.push(pattern.trim());
    },
    suggestPattern(cmd: string) {
      return `${commandPrefix(normalize(cmd)) || firstWord(normalize(cmd))}*`;
    },
  };
}

function criticalRuleName(cmd: string): string {
  if (/\bgit\s+push\b.*\s(--force|-f|--force-with-lease)\b/.test(cmd)) return "deny:force-push";
  if (/>\s*\/dev\//.test(cmd)) return "deny:dev-redirection";
  if (/\brm\b/.test(cmd)) return "deny:rm-rf-outside";
  return "deny:critical";
}

function matchesPattern(cmd: string, pattern: string): boolean {
  const normalizedPattern = normalize(pattern);
  if (normalizedPattern.endsWith("*")) return cmd.startsWith(normalizedPattern.slice(0, -1));
  return cmd === normalizedPattern;
}

function commandPrefix(cmd: string): string {
  const words = shellWords(cmd);
  if (words[0] === "git" && words[1]) return `${words[0]} ${words[1]}`;
  if ((words[0] === "bun" || words[0] === "npm" || words[0] === "pnpm" || words[0] === "yarn") && words[1]) return `${words[0]} ${words[1]}`;
  return words[0] ?? "";
}

function firstWord(cmd: string): string {
  return shellWords(cmd)[0] ?? "";
}

function normalize(cmd: string): string {
  return cmd.trim().replace(/\s+/g, " ");
}

function shellWords(input: string): string[] {
  const words: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
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
