import type { Check } from "../../src/core";
import type { CheckStateView, QuestView } from "./verifier-bridge";

export interface TutorVerifierView {
  activeQuest(): QuestView | null;
  checkStates(): CheckStateView | null;
}

export function tutorSystemPromptSection(): string {
  return [
    "You are Garnish's game master: playful, specific, and brief.",
    "Point the player at the active quest checks and unlocked abilities.",
    "Never claim, imply, or mark a quest complete yourself; only the verifier can certify completion.",
  ].join("\n");
}

export function createTutorProvider(opts: { readonly verifier: TutorVerifierView }): () => string | null {
  return () => {
    const quest = opts.verifier.activeQuest();
    if (quest === null) {
      return null;
    }

    const state = opts.verifier.checkStates();
    const lines = [
      "Tutor note (ephemeral; verifier is authoritative):",
      `Active quest: ${quest.title} (${quest.id})`,
      `Status: ${state?.questId === quest.id ? state.status : "not checked yet"}`,
      "Acceptance checks:",
      ...quest.checks.map((check, index) => `${index + 1}. ${renderCheck(check)}`),
      "The tutor never marks quests complete; wait for quest.completed from the verifier.",
    ];
    const block = lines.join("\n");
    return Buffer.byteLength(block, "utf8") <= 1200 ? block : `${block.slice(0, 1150)}\n…\nThe tutor never marks quests complete; wait for quest.completed from the verifier.`;
  };
}

export function renderCheck(check: Check): string {
  switch (check.type) {
    case "event":
      return `event ${check.match.event}${check.match.tool === undefined ? "" : ` tool=${JSON.stringify(check.match.tool)}`}${check.match.path === undefined ? "" : ` path=${JSON.stringify(check.match.path)}`}${check.match.approved === undefined ? "" : ` approved=${check.match.approved}`}${check.match.success === undefined ? "" : ` success=${check.match.success}`}`;
    case "file_exists":
      return `file exists ${check.path}`;
    case "json_path":
      return `json ${check.file} ${check.path} ${JSON.stringify(check.assert)}`;
    case "yaml_path":
      return `yaml ${check.file} ${check.path} ${JSON.stringify(check.assert)}`;
    case "command":
      return `command ${Array.isArray(check.command) ? check.command.join(" ") : check.command}${check.stdout === undefined ? "" : ` stdout=${JSON.stringify(check.stdout)}`}`;
    case "git":
      return `git ${check.repo ?? "."}`;
    case "mcp_handshake":
      return `mcp handshake ${JSON.stringify(check.server)}`;
    case "skill_valid":
      return `skill valid ${check.path}`;
    case "confirm":
      return `confirm ${check.prompt ?? check.id ?? "confirm"}`;
  }
}
