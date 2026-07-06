import { describe, expect, test } from "bun:test";

// Pure seams take providers/env/lines as arguments, so no module mocks are
// needed — bun's mock.module leaks partial mocks process-wide across the full
// test run (it broke sibling suites), so this file must stay mock-free.
import * as onboarding from "./onboarding";

describe("onboarding wizard pure seams", () => {
  const providers = [
    { id: "openai", label: "OpenAI", kind: "oauth-pkce", ported: true },
    { id: "future", label: "Future Pantry", kind: "oauth-pkce", ported: false },
  ] as const;

  test("renders Demo Kitchen first and labels unavailable providers", () => {
    const menu = onboarding.renderProviderMenu(providers);
    expect(menu).toContain("1) Demo Kitchen");
    expect(menu).toContain("2) OpenAI");
    expect(menu).toContain("3) Future Pantry");
    expect(menu).toContain("coming soon");
  });

  test("maps number-keyed input to demo/provider/null", () => {
    expect(onboarding.choiceFromInput("1", providers)).toEqual({ type: "demo" });
    expect(onboarding.choiceFromInput("2", providers)).toEqual({ type: "provider", provider: providers[0] });
    expect(onboarding.choiceFromInput("99", providers)).toBeNull();
    expect(onboarding.choiceFromInput("stew", providers)).toBeNull();
  });

  test("renders resume menu and maps continue/new choices", () => {
    const menu = onboarding.renderResumeMenu({ provider: "demo-kitchen", method: "scripted", account: "chef@example.test", createdAt: 1 }, { quests: 3, xp: 20 });
    expect(menu).toContain("Continue as chef@example.test — 3 quests done · 20 XP");
    expect(menu).toContain("New game");
    expect(onboarding.resumeChoiceFromInput("1")).toBe("continue");
    expect(onboarding.resumeChoiceFromInput("2")).toBe("new");
    expect(onboarding.resumeChoiceFromInput("nope")).toBeNull();
  });

  test("skip policy is silent for disabled env or non-tty stdin", () => {
    expect(onboarding.shouldSkipOnboarding({ GARNISH_PROTO_ONBOARD: "0" }, { isTTY: true })).toBe(true);
    expect(onboarding.shouldSkipOnboarding({}, { isTTY: false })).toBe(true);
    expect(onboarding.shouldSkipOnboarding({}, { isTTY: true })).toBe(false);
  });

  test("cards frame the game and exact first prompt", () => {
    expect(onboarding.renderWelcomeCard(["chef"])).toContain("proto-kitchen");
    expect(onboarding.renderTipsCard()).toContain("What's my quest?");
    expect(onboarding.authResultToOnboarding({ provider: "openai", method: "oauth", account: "chef@example.test" })).toEqual({
      authProvider: "openai",
      method: "oauth",
      account: "chef@example.test",
    });
  });
});
