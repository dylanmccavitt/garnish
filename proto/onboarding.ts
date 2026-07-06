import { createInterface } from "node:readline/promises";

import { listAuthProviders, startLogin, type AuthProviderInfo, type AuthResult } from "./auth";
import { resetSave, saveProfile, type Profile } from "./save";
import { mascot, MASCOT_NAME } from "./tui/sprites";
import { theme } from "./tui/theme";

export const DEMO_PROVIDER_ID = "demo-kitchen";

export interface OnboardingResult {
  authProvider: string;
  method: "oauth" | "api-key" | "scripted";
  account?: string;
}

export interface ResumeStats {
  quests: number;
  xp: number;
}

export interface RunOnboardingOptions {
  profile?: Profile | null;
  resume?: ResumeStats | null;
  saveRoot?: string;
}

export type ProviderChoice =
  | { type: "demo" }
  | { type: "provider"; provider: AuthProviderInfo };

const ANSI_RESET = "\x1b[0m";
const ANSI_BOLD = "\x1b[1m";
const ANSI_DIM = "\x1b[2m";

function hexToRgb(hex: string): [number, number, number] | null {
  const match = hex.match(/^#?([0-9a-f]{6})$/i);
  if (!match) return null;
  const value = Number.parseInt(match[1] ?? "", 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function ansiFg(hex: string): string {
  const rgb = hexToRgb(hex);
  return rgb ? `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m` : "";
}

function color(text: string, hex: string, style = ""): string {
  return `${style}${ansiFg(hex)}${text}${ANSI_RESET}`;
}

export function shouldSkipOnboarding(env: Record<string, string | undefined>, stdin: { isTTY?: boolean }): boolean {
  return env.GARNISH_PROTO_ONBOARD === "0" || stdin.isTTY !== true;
}

export function renderWelcomeCard(lines = mascot("idle")): string {
  const art = lines.map((line) => color(`  ${line}`, theme.primary)).join("\n");
  return [
    art,
    color(`Welcome to Garnish. ${MASCOT_NAME} has fired up the proto-kitchen.`, theme.primary, ANSI_BOLD),
    "Every quest is a recipe: ask, taste the tool result, then unlock the next verb.",
    "First we stock your station, then the TUI drops you on Tutorial Island.",
  ].join("\n");
}

export function renderProviderMenu(providers: readonly AuthProviderInfo[]): string {
  const authProviders = providers.filter((provider) => provider.id !== DEMO_PROVIDER_ID);
  const rows = [
    color("Choose your pantry pass:", theme.text, ANSI_BOLD),
    color(`1) Demo Kitchen — no account, scripted tasting menu`, theme.primary, ANSI_BOLD),
  ];
  authProviders.forEach((provider, index) => {
    const number = index + 2;
    const suffix = provider.ported ? provider.kind : "coming soon";
    rows.push(`${number}) ${provider.label} ${color(`(${suffix})`, provider.ported ? theme.dim : theme.amber)}`);
  });
  return rows.join("\n");
}

export function renderResumeMenu(profile: Profile, resume: ResumeStats): string {
  const account = profile.account ?? profile.provider;
  return [
    color("Found a saved station:", theme.text, ANSI_BOLD),
    color(`1) Continue as ${account} — ${resume.quests} quests done · ${resume.xp} XP`, theme.primary, ANSI_BOLD),
    `2) New game ${color("(wipes the save)", theme.amber)}`,
  ].join("\n");
}

export function resumeChoiceFromInput(input: string): "continue" | "new" | null {
  const selected = Number.parseInt(input.trim(), 10);
  if (selected === 1) return "continue";
  if (selected === 2) return "new";
  return null;
}

export function choiceFromInput(input: string, providers: readonly AuthProviderInfo[]): ProviderChoice | null {
  const authProviders = providers.filter((provider) => provider.id !== DEMO_PROVIDER_ID);
  const selected = Number.parseInt(input.trim(), 10);
  if (!Number.isInteger(selected) || selected < 1 || selected > authProviders.length + 1) return null;
  if (selected === 1) return { type: "demo" };
  return { type: "provider", provider: authProviders[selected - 2] as AuthProviderInfo };
}

export function renderTipsCard(): string {
  return [
    color("Station stocked.", theme.primary, ANSI_BOLD),
    `When the game opens, type exactly: ${color("What's my quest?", theme.accent, ANSI_BOLD)}`,
    color("Then follow NEXT UP — it tells you the next move without spoiling the recipe.", theme.dim),
  ].join("\n");
}

export function authResultToOnboarding(result: AuthResult): OnboardingResult {
  return { authProvider: result.provider, method: result.method, account: result.account };
}

async function promptLine(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

async function chooseResume(profile: Profile, resume: ResumeStats): Promise<"continue" | "new"> {
  for (;;) {
    console.log(renderResumeMenu(profile, resume));
    const answer = await promptLine(color("Pick a number › ", theme.primary));
    const choice = resumeChoiceFromInput(answer);
    if (choice !== null) return choice;
    console.log(color("That ticket is not on the rail. Pick 1 or 2.", theme.amber));
  }
}

async function chooseProvider(providers: readonly AuthProviderInfo[]): Promise<ProviderChoice> {
  for (;;) {
    console.log(renderProviderMenu(providers));
    const answer = await promptLine(color("Pick a number › ", theme.primary));
    const choice = choiceFromInput(answer, providers);
    if (choice === null) {
      console.log(color("That ticket is not on the rail. Pick a listed number.", theme.amber));
      continue;
    }
    if (choice.type === "provider" && !choice.provider.ported) {
      console.log(color(`${choice.provider.label} is coming to the pantry soon. Try Demo Kitchen or a stocked provider.`, theme.amber));
      continue;
    }
    return choice;
  }
}

async function runMockCeremony(provider: AuthProviderInfo): Promise<OnboardingResult> {
  const session = await startLogin(provider.id);
  console.log(color(session.instructions, theme.text));
  console.log(color(`Device code: ${session.userCode ?? "SOUP-42"}`, theme.accent, ANSI_BOLD));
  for (const dots of [".", "..", "..."]) {
    console.log(color(`Checking the prep station${dots}`, theme.dim));
    await Bun.sleep(120);
  }
  const result = await session.complete();
  console.log(color(`Signed in as ${result.account ?? "demo-chef"}. Apron tied.`, theme.primary, ANSI_BOLD));
  return authResultToOnboarding(result);
}

async function runRealCeremony(provider: AuthProviderInfo): Promise<OnboardingResult | null> {
  try {
    const session = await startLogin(provider.id);
    console.log(color(session.instructions, theme.text));
    if (session.url) console.log(color(`Open: ${session.url}`, theme.accent, ANSI_BOLD));
    if (session.userCode) console.log(color(`Code: ${session.userCode}`, theme.accent, ANSI_BOLD));
    await promptLine(color("Press Enter once the browser says the pantry is stocked › ", theme.primary));
    const result = await session.complete();
    console.log(color(`Signed in as ${result.account ?? provider.label}.`, theme.primary, ANSI_BOLD));
    return authResultToOnboarding(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(color(`OAuth could not finish from here (${message}).`, theme.amber));
    const fallback = await promptLine(color("Press Enter for Demo Kitchen, or type r to repick › ", theme.primary));
    return fallback.trim().toLowerCase() === "r" ? null : { authProvider: DEMO_PROVIDER_ID, method: "scripted" };
  }
}

export async function runOnboarding(opts: RunOnboardingOptions = {}): Promise<OnboardingResult> {
  const resumeProfile = opts.profile ?? null;
  const resume = opts.resume ?? null;
  if (shouldSkipOnboarding(process.env, process.stdin)) {
    if (resumeProfile !== null) {
      return { authProvider: resumeProfile.provider, method: resumeProfile.method, account: resumeProfile.account };
    }
    return { authProvider: DEMO_PROVIDER_ID, method: "scripted" };
  }

  console.log(renderWelcomeCard());
  if (resumeProfile !== null && resume !== null) {
    const resumeChoice = await chooseResume(resumeProfile, resume);
    if (resumeChoice === "continue") {
      return { authProvider: resumeProfile.provider, method: resumeProfile.method, account: resumeProfile.account };
    }
    if (opts.saveRoot !== undefined) resetSave(opts.saveRoot);
  }

  const providers = listAuthProviders();
  for (;;) {
    const choice = await chooseProvider(providers);
    if (choice.type === "demo") {
      console.log(color("Demo Kitchen selected. No account needed — chef's table is ready.", theme.primary, ANSI_BOLD));
      const result = await runMockCeremony({ id: DEMO_PROVIDER_ID, label: "Demo Kitchen", kind: "mock", ported: true });
      if (opts.saveRoot !== undefined) saveProfile(opts.saveRoot, { provider: result.authProvider, method: result.method, account: result.account, createdAt: Date.now() });
      console.log(renderTipsCard());
      return result;
    }

    const result = choice.provider.kind === "mock" ? await runMockCeremony(choice.provider) : await runRealCeremony(choice.provider);
    if (result !== null) {
      if (opts.saveRoot !== undefined) saveProfile(opts.saveRoot, { provider: result.authProvider, method: result.method, account: result.account, createdAt: Date.now() });
      console.log(renderTipsCard());
      return result;
    }
  }
}
