/**
 * PROTOTYPE — THROWAWAY. Act II/III: interactive TUI entry.
 *
 *   bun proto/main.ts               scripted model (no key needed)
 *   bun proto/main.ts --live        real provider (env key; anthropic default)
 *   bun proto/main.ts --live --provider openai
 */
import { getStoredAuth } from "./auth";
import type { ApprovalDecision, ApprovalRequest, ProviderName, ScriptedTurn, StreamFn } from "./harness/types";
import { scriptedStream } from "./harness/scripted";
import { createProgression } from "./game";
import { runOnboarding, type ResumeStats } from "./onboarding";
import { anthropicStream, openaiStream, resolveAuth } from "./providers";
import { loadProfile, resetSave, resolveSaveRoot } from "./save";
import { startTui } from "./tui";
import { wireHarness } from "./wire";

const args = new Set(Bun.argv.slice(2));
const live = args.has("--live");
let provider: "anthropic" | "openai" = args.has("--provider=openai") || (Bun.argv.includes("--provider") && Bun.argv[Bun.argv.indexOf("--provider") + 1] === "openai") ? "openai" : "anthropic";
const saveRoot = resolveSaveRoot();
if (args.has("--reset")) resetSave(saveRoot);
const profile = loadProfile(saveRoot);
const resumeState = profile === null ? null : createProgression({ root: saveRoot, onUnlock() {} }).state();
const resume: ResumeStats | null = resumeState === null ? null : { quests: resumeState.completedQuests.length, xp: resumeState.xpTotal };

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
  { text: "First edit recorded. Next: fix the greeter bug and stamp the fix — the stamp is a mutating shell command, so you'll get an approval modal." },
  {
    toolCalls: [
      { name: "edit", input: { path: "src/greet.ts", oldString: "Goodbye, ${name}!", newString: "Hello, ${name}!" } },
      { name: "bash", input: { cmd: "printf 'greeter: fixed\\n' > PROOF.yml" } },
    ],
  },
  { text: "Fair call — same stamp again, your decision.", toolCalls: [{ name: "bash", input: { cmd: "printf 'greeter: fixed\\n' > PROOF.yml" } }] },
  { text: "Stamp handled. Read-only proof next — grep is safe-tier, so your tier policy auto-allows it.", toolCalls: [{ name: "bash", input: { cmd: "grep -n 'Hello,' src/greet.ts" } }] },
  { text: "That's the whole arc — quests, blocks, approvals, unlocks, celebrations. Keep chatting or Ctrl+C out." },
];

const onboarding = await runOnboarding({ profile, resume, saveRoot });
if (live && (onboarding.authProvider === "anthropic" || onboarding.authProvider === "openai") && getStoredAuth(onboarding.authProvider) !== null) {
  provider = onboarding.authProvider;
}

let streamFn: StreamFn;
let providerName: ProviderName = "scripted";
if (live) {
  const auth = resolveAuth(provider);
  if (auth === null) {
    console.error(`--live needs ${provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"} (or the auth file). Run without --live for the scripted model.`);
    process.exit(1);
  }
  streamFn = provider === "anthropic" ? anthropicStream({ apiKey: auth.apiKey }) : openaiStream({ apiKey: auth.apiKey });
  providerName = provider;
} else {
  // Resume-aware story: skip scripted segments for quests already completed in
  // the save, so the model picks up where the last session left off.
  const done = new Set((resumeState?.completedQuests ?? []).map(String));
  const scriptStart = done.has("fix-bug-prove-it") ? script.length - 1 : done.has("first-edit") ? 5 : done.has("look-around") ? 3 : 0;
  streamFn = scriptedStream(script.slice(scriptStart));
}

// TUI provides the prompter, but the harness needs one at wire time — proxy it.
let tuiPrompter: ((req: ApprovalRequest) => Promise<ApprovalDecision>) | null = null;
const prompter = (req: ApprovalRequest): Promise<ApprovalDecision> =>
  tuiPrompter ? tuiPrompter(req) : Promise.resolve({ approved: false, mode: "deny", reason: "UI not ready" });

const wired = await wireHarness({ streamFn, provider: providerName, prompter, saveRoot, auth: { provider: onboarding.authProvider, method: onboarding.method, account: onboarding.account } });

const tui = startTui({
  bus: wired.sink.bus,
  send: (text) => void wired.harness.send(text).then(() => wired.verifier.settled()),
  abort: () => wired.harness.abort(),
  gateViews: () => wired.gateViews(),
  questView: () => wired.questView(),
  scorecard: () => wired.scorecard(),
  progress: () => {
    const state = wired.progression.state();
    return { xp: state.xpTotal, level: state.completedLevels.length + 1 };
  },
  meta: { workspace: wired.workspace, provider: providerName, model: wired.harness.config.model },
  onExit: () => {
    tui.stop();
    wired.stop();
    console.log(`session log: ${wired.sessionLogPath}`);
    console.log(`save root: ${saveRoot}`);
    process.exit(0);
  },
});
tuiPrompter = tui.prompter;

console.log(`garnish prototype TUI — provider=${providerName} sandbox=${wired.sandbox.mode}`);
