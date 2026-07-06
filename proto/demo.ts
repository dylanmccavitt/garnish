/**
 * PROTOTYPE — THROWAWAY. Act I: headless scripted walkthrough.
 *
 * Runs the full L0→L1 arc with a scripted model — no API key, no TTY. Prints a
 * narrated event stream, then asserts the demo beats and exits non-zero if any
 * beat failed (CI-able).
 */
import type { ApprovalDecision, ApprovalRequest, HarnessEvent, ScriptedTurn } from "./harness/types";
import { replaySession } from "./harness";
import { scriptedStream } from "./harness/scripted";
import { wireHarness } from "./wire";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const color = (c: number, s: string) => `\x1b[3${c}m${s}\x1b[0m`;

// --- scripted model -----------------------------------------------------------

const script: ScriptedTurn[] = [
  // send 1: "What's my quest?"
  {
    text: "You're on Tutorial Island. The verifier wants a `tool.result` from the read tool — let me know when you want me to look around, and remember: only the verifier certifies completions.",
  },
  // send 2: "Look around."
  {
    thinking: "Read the README first; also try the shell to see if it's granted yet.",
    toolCalls: [
      { name: "read", input: { path: "README.md" } },
      { name: "bash", input: { cmd: "ls -la" } },
    ],
  },
  {
    text: "The README points at a greeter bug in src/greet.ts. The shell is still locked — the harness says it unlocks with the L1 quest, so I'll earn it instead of forcing it.",
  },
  // send 3: "Record the first edit."
  {
    toolCalls: [
      { name: "write", input: { path: "quest-state.yml", content: "first_edit: GARNISH_PROTO_FIRST_EDIT\n" } },
    ],
  },
  {
    text: "quest-state.yml written — the yaml check and the file.edited event should both satisfy First Edit.",
  },
  // send 4: "Fix the greeter bug, stamp it, and prove it."
  {
    thinking: "Fix Goodbye→Hello with an exact-string edit, then stamp the fix with a mutating shell command — that one should ask for approval.",
    toolCalls: [
      { name: "edit", input: { path: "src/greet.ts", oldString: "Goodbye, ${name}!", newString: "Hello, ${name}!" } },
      { name: "bash", input: { cmd: "printf 'greeter: fixed\\n' > PROOF.yml" } },
    ],
  },
  {
    text: "Fair — you want to see exactly what gets written before it lands. Same stamp, your call.",
    toolCalls: [{ name: "bash", input: { cmd: "printf 'greeter: fixed\\n' > PROOF.yml" } }],
  },
  {
    text: "Stamp approved and written. Now the read-only proof — grep is safe-tier, so your tier policy auto-allows it.",
    toolCalls: [{ name: "bash", input: { cmd: "grep -n 'Hello,' src/greet.ts" } }],
  },
  {
    text: "Greeter fixed and proven: the command check saw Hello on disk and the approval event closed out L1. That's the whole arc.",
  },
];

// --- scripted player (approval decisions) --------------------------------------

const decisions: ApprovalDecision[] = [
  { approved: false, mode: "deny-with-reason", reason: "Show me exactly what you'll write before I approve a redirect." },
  { approved: true, mode: "once" },
];
const prompter = async (_req: ApprovalRequest): Promise<ApprovalDecision> => {
  const decision = decisions.shift() ?? { approved: true, mode: "once" as const };
  console.log(dim(`      (player decides: ${decision.approved ? "approve" : "deny"}${decision.reason ? ` — "${decision.reason}"` : ""})`));
  return decision;
};

// --- narration ------------------------------------------------------------------

let assistantBuffer = "";
function narrate(event: HarnessEvent): void {
  switch (event.type) {
    case "session.start":
      console.log(dim(`▶ session ${event.sessionId.slice(0, 8)} · provider=${event.provider} · workspace=${event.workspace}`));
      break;
    case "message.user":
      if (event.source === "player") console.log(`\n${bold(color(6, `▸ YOU: ${event.text}`))}`);
      break;
    case "turn.start":
      console.log(dim(`  — turn ${event.turn} —`));
      break;
    case "assistant.thinking.delta":
      break;
    case "assistant.delta":
      assistantBuffer += event.text;
      break;
    case "assistant.end":
      console.log(color(5, `  🤖 ${event.message.text.trim()}`));
      assistantBuffer = "";
      break;
    case "tool.call":
      console.log(color(4, `  ⚙ ${event.tool} ${JSON.stringify(event.input)}`));
      break;
    case "tool.blocked":
      console.log(color(1, `  ⛔ BLOCKED [${event.reason}] ${event.teaching}`));
      break;
    case "tool.approval.requested":
      console.log(color(3, `  ❓ APPROVAL ${event.risk.toUpperCase()} → ${event.command}`));
      console.log(color(3, `     why: ${event.explanation}`));
      break;
    case "tool.approval.resolved":
      console.log(color(event.approved ? 2 : 1, `  ${event.approved ? "✔ approved" : "✖ denied"} (${event.mode}${event.reason ? `: ${event.reason}` : ""})`));
      break;
    case "tool.result":
      console.log(dim(`    → ${event.isError ? "error" : "ok"}: ${event.output.split("\n")[0]?.slice(0, 100) ?? ""}`));
      break;
    case "file.edited":
      console.log(color(2, `  ✎ ${event.kind} ${event.path.split("/").slice(-1)[0]} (${event.summary})`));
      break;
    case "quest.completed":
      console.log(bold(color(2, `  ★★★ QUEST COMPLETE: ${event.questId} +${event.xp} XP ★★★`)));
      break;
    case "unlock.applied":
      console.log(bold(color(6, `  🔓 UNLOCKED ${event.unlockId} → new verbs: ${event.tools.join(", ")}`)));
      break;
    case "error":
      console.log(color(1, `  ‼ ${event.message}`));
      break;
    default:
      break;
  }
}

// --- run ------------------------------------------------------------------------

console.log(bold("GARNISH STANDALONE PROTOTYPE — headless walkthrough (scripted model, no key needed)"));
const wired = await wireHarness({ streamFn: scriptedStream(script), provider: "scripted", prompter });
wired.sink.bus.subscribe(narrate);
console.log(`sandbox: ${wired.sandbox.mode} — ${wired.sandbox.reason}`);
console.log(dim("tutor context injected per turn (ephemeral, never persisted):"));
console.log(dim((wired.tutorBlock() ?? "(none)").split("\n").map((l) => `  │ ${l}`).join("\n")));

const sends = ["What's my quest?", "Look around.", "Record the first edit.", "Fix the greeter bug, stamp it, and prove it."];
for (const text of sends) {
  await wired.harness.send(text);
  await wired.verifier.settled();
}
wired.stop();

// --- beats ----------------------------------------------------------------------

const events = wired.sink.log.read();
const has = (fn: (e: HarnessEvent) => boolean) => events.some(fn);
const replayA = JSON.stringify(replaySession(events));
const replayB = JSON.stringify(replaySession(events));
const card = wired.scorecard();
const state = wired.progression.state();

const beats: Array<[string, boolean]> = [
  ["L0 look-around completed by first-party tool.result event", state.completedQuests.includes("look-around" as never)],
  ["locked bash produced an in-band teaching block", has((e) => e.type === "tool.blocked" && e.reason === "locked")],
  ["live unlock applied mid-session (l0-hands → write/edit)", has((e) => e.type === "unlock.applied" && e.unlockId === "l0-hands")],
  ["first-edit completed via yaml check + file.edited", state.completedQuests.includes("first-edit" as never)],
  ["bash earned via l1-shell and gate now open", wired.gates.isUnlocked("bash")],
  ["approval denial-with-reason fed back to the model", has((e) => e.type === "tool.approval.resolved" && !e.approved && e.reason !== undefined)],
  ["approved command satisfied the L1 approval event check", state.completedQuests.includes("fix-bug-prove-it" as never)],
  ["XP total is 35 across three quests", state.xpTotal === 35],
  ["replay is deterministic (fold twice, identical)", replayA === replayB],
  ["scorecard: 4 player prompts recorded", card.promptCount === 4],
  ["scorecard: at least 1 human approval and 1 denial", card.approvals.approved >= 1 && card.approvals.denied >= 1],
  ["tier policy graduation visible: safe command auto-approved", card.approvals.auto >= 1],
];

console.log(`\n${bold("SCORECARD")}  tokens in/out: ${card.tokens.input}/${card.tokens.output} · wall: ${card.wallTimeMs}ms · prompts: ${card.promptCount} · approvals: ${card.approvals.approved}✔/${card.approvals.denied}✖/${card.approvals.auto}auto · blocked: ${card.blocked} · diff bytes: ${card.diffBytes}`);
console.log(`${bold("PROGRESSION")} level: ${state.currentLevel ?? "COMPLETE"} · xp: ${state.xpTotal} · quests: ${state.completedQuests.join(", ")}`);
console.log(`${bold("SESSION LOG")} ${wired.sessionLogPath} (${events.length} events)`);

console.log(`\n${bold("DEMO BEATS")}`);
let failed = 0;
for (const [name, ok] of beats) {
  if (!ok) failed += 1;
  console.log(`  ${ok ? color(2, "PASS") : color(1, "FAIL")}  ${name}`);
}
console.log(failed === 0 ? bold(color(2, "\nAll beats passed — the prototype loop holds end to end.")) : bold(color(1, `\n${failed} beat(s) failed`)));
process.exit(failed === 0 ? 0 : 1);
