import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { ApprovalDecision, ApprovalRequest, ProviderName, ScriptedTurn, StreamFn } from "../harness/types";
import { scriptedStream } from "../harness/scripted";
import { startTui } from "../tui/variants/factory";
import { GREETER_BUG_FAMILY } from "./ore";
import type { HandFix, TaskItem } from "./types";
import { runWorldMenu, worldRoot } from "./menu";
import { wireFactory } from "./wire";

const script: ScriptedTurn[] = [
  { text: "Try `grep -n friend src/ore/item-2.ts`, paste the output, then apply the one-line greeting fix." },
  { text: "Replace `Hello, friend!` with `Hello, " + " + name + " + "!` in src/ore/item-2.ts." },
  { text: "Which item should I work?" },
  { text: "Reading item-3.", toolCalls: [{ name: "read", input: { path: "src/ore/item-3.ts" } }] },
  { text: "Fixing item-3.", toolCalls: [{ name: "edit", input: { path: "src/ore/item-3.ts", oldString: "Hello, friend!", newString: "\"Hello, \" + name + \"!\"" } }], stopReason: "end_turn" },
  { text: "Belt item-4 first spot.", toolCalls: [{ name: "edit", input: { path: "src/ore/item-4.ts", oldString: "Goodbye, ", newString: "Hello, " } }] },
  { text: "Belt item-4 second spot.", toolCalls: [{ name: "edit", input: { path: "src/ore/item-4.ts", oldString: ".", newString: "!" } }], stopReason: "end_turn" },
  { text: "Belt item-5.", toolCalls: [{ name: "edit", input: { path: "src/ore/item-5.ts", oldString: "Hello, friend!", newString: "\"Hello, \" + name + \"!\"" } }], stopReason: "end_turn" },
  { text: "Belt item-6 first spot.", toolCalls: [{ name: "edit", input: { path: "src/ore/item-6.ts", oldString: "Goodbye, ", newString: "Hello, " } }] },
  { text: "Belt item-6 second spot.", toolCalls: [{ name: "edit", input: { path: "src/ore/item-6.ts", oldString: ".", newString: "!" } }], stopReason: "end_turn" },
  { text: "Belt item-7.", toolCalls: [{ name: "edit", input: { path: "src/ore/item-7.ts", oldString: "Hello, friend!", newString: "\"Hello, \" + name + \"!\"" } }], stopReason: "end_turn" },
  { text: "Factory arc complete." },
];

const streamFn: StreamFn = scriptedStream(script);
const provider: ProviderName = "scripted";
let tuiPrompter: ((req: ApprovalRequest) => Promise<ApprovalDecision>) | null = null;
const prompter = (req: ApprovalRequest): Promise<ApprovalDecision> => {
  if (tuiPrompter !== null) return tuiPrompter(req);
  return Promise.resolve({ approved: false, mode: "deny", reason: `UI not ready for ${req.tool}` });
};

async function selectWorld(args: string[], root: string): Promise<{ root: string; name: string } | null> {
  const worldName = worldNameFromArgs(args);
  if (worldName !== null) return worldRoot(root, worldName);
  return runWorldMenu({ saveRoot: root });
}

function worldNameFromArgs(args: string[]): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--world") {
      const value = args[index + 1];
      if (value === undefined || value.trim().length === 0) throw new Error("--world requires a name");
      return value;
    }
    if (arg.startsWith("--world=")) {
      const value = arg.slice("--world=".length);
      if (value.trim().length === 0) throw new Error("--world requires a name");
      return value;
    }
  }
  return null;
}

const saveRoot = process.env.GARNISH_PROTO_HOME ?? join(homedir(), ".garnish-proto");
const selectedWorld = await selectWorld(process.argv.slice(2), saveRoot);
if (selectedWorld === null) {
  console.log("goodbye — factory sleeping");
  process.exit(0);
}

const wired = await wireFactory({ streamFn, provider, prompter, root: selectedWorld.root, worldName: selectedWorld.name });

function transcript(text: string): void {
  wired.sink.emit({ type: "message.user", source: "tutor", text });
}

function runCommand(work: () => Promise<void>): void {
  void work().catch((error) => transcript(`SYSTEM: ${error instanceof Error ? error.message : String(error)}`));
}

function currentItem(): TaskItem | null {
  const state = wired.engine.state();
  return state.items.find((item) => item.id === state.currentItemId) ?? null;
}

function nextHandFix(item: TaskItem): Promise<HandFix | null> {
  const variant = GREETER_BUG_FAMILY.variants.find((candidate) => candidate.id === item.variantId);
  if (variant === undefined) return Promise.resolve(null);
  return firstApplicableFix(variant.handFixes(item.id));
}

async function firstApplicableFix(fixes: HandFix[]): Promise<HandFix | null> {
  for (const fix of fixes) {
    const content = await readFile(join(wired.workspace, fix.path), "utf8");
    if (content.includes(fix.oldString)) return fix;
  }
  return null;
}

async function writeMachineStub(kind: "bare-agent" | "routing-belt"): Promise<string> {
  const artifact = `.garnish/machines/${kind}.md`;
  const absolute = join(wired.workspace, artifact);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, `# ${kind}\n\nFactory-authored ${kind} machine stub.\n`, "utf8");
  return artifact;
}

function onCommand(line: string): boolean {
  const [command, ...rest] = line.trim().split(/\s+/);
  const argText = rest.join(" ");
  if (command === "/mine") {
    const item = wired.engine.startNext("hand");
    transcript(item === null ? "SYSTEM: no queued ore ready for hand mining" : `SYSTEM: hand-mining ${item.id}`);
    return true;
  }
  if (command === "/cat") {
    runCommand(async () => {
      const result = await wired.hand.command(`cat ${argText}`);
      transcript(`SYSTEM: cat exited ${result.exitCode}\n${result.output}`);
    });
    return true;
  }
  if (command === "/grep") {
    runCommand(async () => {
      const result = await wired.hand.command(`grep ${argText}`);
      transcript(`SYSTEM: grep exited ${result.exitCode}\n${result.output}`);
    });
    return true;
  }
  if (command === "/run") {
    runCommand(async () => {
      const result = await wired.hand.command(argText);
      transcript(`SYSTEM: command exited ${result.exitCode}\n${result.output}`);
    });
    return true;
  }
  if (command === "/fix") {
    runCommand(async () => {
      const item = currentItem();
      if (item === null) throw new Error("no current item; use /mine or build the routing belt");
      const fix = await nextHandFix(item);
      if (fix === null) throw new Error(`no remaining canned hand fix for ${item.id}`);
      await wired.hand.edit(fix);
      await wired.verifier.settled();
      transcript(`SYSTEM: applied hand fix to ${fix.path}`);
    });
    return true;
  }
  if (command === "/paste") {
    runCommand(async () => {
      await wired.hand.pasteBack(argText);
      await wired.verifier.settled();
    });
    return true;
  }
  if (command === "/build") {
    runCommand(async () => {
      if (argText !== "bare-agent" && argText !== "routing-belt") throw new Error("usage: /build <bare-agent|routing-belt>");
      const artifact = await writeMachineStub(argText);
      wired.engine.buildMachine(argText, { label: argText, artifact });
      transcript(`SYSTEM: built ${argText}`);
    });
    return true;
  }
  if (command === "/forge") {
    runCommand(async () => {
      const name = argText || "greeter-fix";
      await wired.forgeSkill(name);
      transcript(`SYSTEM: forged skill ${name}`);
    });
    return true;
  }
  if (command === "/wire") {
    runCommand(async () => {
      if (argText.length === 0) throw new Error("usage: /wire <allow-pattern>");
      await wired.wireCircuit([argText]);
      transcript(`SYSTEM: wired circuit pattern ${argText}`);
    });
    return true;
  }
  if (command === "/power") {
    const budget = Number(argText || "0");
    wired.engine.startShift(budget);
    void wired.beltKick();
    transcript(`SYSTEM: shift started with budget ${budget}`);
    return true;
  }
  if (command === "/feed") {
    const tokens = Number(argText || "0");
    wired.engine.feedGrid(tokens);
    transcript(`SYSTEM: fed grid +${tokens}`);
    return true;
  }
  if (command === "/end") {
    wired.engine.endShift();
    transcript("SYSTEM: shift ended");
    return true;
  }
  return false;
}

let tui: { prompter: (req: ApprovalRequest) => Promise<ApprovalDecision>; stop(): void };
tui = startTui({
  bus: wired.sink.bus,
  send: (text) => void wired.harness.send(text).then(() => wired.verifier.settled()),
  abort: () => wired.harness.abort(),
  gateViews: () => [],
  questView: () => null,
  scorecard: () => null,
  factoryState: () => wired.engine.state(),
  onCommand,
  meta: { workspace: wired.workspace, provider, model: wired.harness.config.model },
  onExit: () => {
    tui.stop();
    wired.stop();
    console.log(`session log: ${wired.sessionLogPath}`);
    process.exit(0);
  },
});
tuiPrompter = tui.prompter;
// deferred: the OpenTUI renderer boots async; an immediate emit races the app's bus subscribe
setTimeout(() => {
  transcript("SPRIG: bare harness online — ore waits. Type /mine to hand-craft item-1 (hints live under the input).");
}, 800);

console.log(`garnish factory TUI — provider=${provider}`);
console.log("commands: /mine /cat /grep /run /fix /paste /build /forge /wire /power /feed /end");
