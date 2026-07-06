/**
 * PROTOTYPE — THROWAWAY. Act II/III: interactive TUI entry.
 *
 *   bun proto/main.ts               scripted model (no key needed)
 *   bun proto/main.ts --live        real provider (env key; anthropic default)
 *   bun proto/main.ts --live --provider openai
 */
import type { ApprovalDecision, ApprovalRequest, ScriptedTurn, StreamFn } from "./harness/types";
import { scriptedStream } from "./harness/scripted";
import { anthropicStream, openaiStream, resolveAuth } from "./providers";
import { startTui } from "./tui";
import { wireHarness } from "./wire";

const args = new Set(Bun.argv.slice(2));
const live = args.has("--live");
const provider = args.has("--provider=openai") || (Bun.argv.includes("--provider") && Bun.argv[Bun.argv.indexOf("--provider") + 1] === "openai") ? "openai" : "anthropic";

// The scripted model ignores what you type and advances the L0→L1 story one
// beat per message — good enough to feel the game surfaces without a key.
const script: ScriptedTurn[] = [
  { text: "Welcome to Tutorial Island. Ask me to look around and I'll satisfy the read check; the verifier — not me — marks quests complete." },
  {
    thinking: "Read the README, and poke the locked shell so the player sees a teaching block.",
    toolCalls: [
      { name: "read", input: { path: "README.md" } },
      { name: "bash", input: { cmd: "ls -la" } },
    ],
  },
  { text: "README read (quest check satisfied) — and the shell is still locked; the block named the unlock that grants it. Say the word and I'll record the first edit." },
  { toolCalls: [{ name: "write", input: { path: "quest-state.yml", content: "first_edit: GARNISH_PROTO_FIRST_EDIT\n" } }] },
  { text: "First edit recorded. Next: fix the greeter bug and prove it with an approved command — you'll get an approval modal." },
  {
    toolCalls: [
      { name: "edit", input: { path: "src/greet.ts", oldString: "Goodbye, ${name}!", newString: "Hello, ${name}!" } },
      { name: "bash", input: { cmd: "grep -n 'Hello,' src/greet.ts" } },
    ],
  },
  { text: "If you denied that one, send another message and I'll retry the proof.", toolCalls: [{ name: "bash", input: { cmd: "grep -n 'Hello,' src/greet.ts" } }] },
  { text: "That's the whole arc — quests, blocks, approvals, unlocks, celebrations. Keep chatting or Ctrl+C out." },
];

let streamFn: StreamFn;
let providerName: "anthropic" | "openai" | "scripted" = "scripted";
if (live) {
  const auth = resolveAuth(provider);
  if (auth === null) {
    console.error(`--live needs ${provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"} (or the auth file). Run without --live for the scripted model.`);
    process.exit(1);
  }
  streamFn = provider === "anthropic" ? anthropicStream({ apiKey: auth.apiKey }) : openaiStream({ apiKey: auth.apiKey });
  providerName = provider;
} else {
  streamFn = scriptedStream(script);
}

// TUI provides the prompter, but the harness needs one at wire time — proxy it.
let tuiPrompter: ((req: ApprovalRequest) => Promise<ApprovalDecision>) | null = null;
const prompter = (req: ApprovalRequest): Promise<ApprovalDecision> =>
  tuiPrompter ? tuiPrompter(req) : Promise.resolve({ approved: false, mode: "deny", reason: "UI not ready" });

const wired = await wireHarness({ streamFn, provider: providerName, prompter });

const tui = startTui({
  bus: wired.sink.bus,
  send: (text) => void wired.harness.send(text).then(() => wired.verifier.settled()),
  abort: () => wired.harness.abort(),
  gateViews: () => wired.gateViews(),
  questView: () => wired.questView(),
  scorecard: () => wired.scorecard(),
  onExit: () => {
    tui.stop();
    wired.stop();
    console.log(`session log: ${wired.sessionLogPath}`);
    process.exit(0);
  },
});
tuiPrompter = tui.prompter;

console.log(`garnish prototype TUI — provider=${providerName} sandbox=${wired.sandbox.mode}`);
