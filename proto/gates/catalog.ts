import type { ApprovalPolicy, GateCatalogEntry, RiskTier } from "../harness/types";

export type TierPolicies = Record<number, Record<RiskTier, ApprovalPolicy>>;
export type PrototypeGateCatalogEntry = GateCatalogEntry & {
  tierPolicies: TierPolicies;
  teaching: string;
};

const askAll: Record<RiskTier, ApprovalPolicy> = {
  safe: "ask",
  moderate: "ask",
  risky: "ask",
  critical: "deny",
};

const safeAllowed: Record<RiskTier, ApprovalPolicy> = {
  safe: "allow",
  moderate: "ask",
  risky: "ask",
  critical: "deny",
};

const moderateAllowed: Record<RiskTier, ApprovalPolicy> = {
  safe: "allow",
  moderate: "allow",
  risky: "ask",
  critical: "deny",
};

export function tierPolicyFor(level: number, dangerZone = false): Record<RiskTier, ApprovalPolicy> {
  const base = level <= 0 ? askAll : level === 1 ? safeAllowed : moderateAllowed;
  return dangerZone ? { ...base, critical: "ask" } : base;
}

export function defaultCatalog(): GateCatalogEntry[] {
  // Prototype finding: graduation must LAG the tool's arrival. bash unlocks
  // after two level completions, so if row 2 already auto-allowed moderate,
  // the learner would never practice an approval. Keep row 2 at safe-only
  // auto-allow; moderate graduates one tier later.
  const policies: TierPolicies = {
    0: askAll,
    1: askAll,
    2: safeAllowed,
    3: moderateAllowed,
  };
  return [
    entry("read", null, "Read is available now: inspect the workspace before changing it.", policies),
    entry("write", "l0-hands", "Complete the L0 unlock to write new files.", policies),
    entry("edit", "l0-hands", "Complete the L0 unlock to make surgical edits.", policies),
    entry("bash", "l1-shell", "Complete the L1 shell quest to run commands.", policies),
    entry("search", "l2-search", "Search unlocks after shell basics so discovery has context.", policies),
    entry("subagent", "l3-subagent", "Subagents stay hidden until delegation is part of the curriculum.", policies),
    entry("danger-zone", "danger-zone", "Danger-zone changes turn critical commands from deny into ask.", policies),
  ];
}

function entry(tool: string, unlockId: string | null, teaching: string, tierPolicies: TierPolicies): PrototypeGateCatalogEntry {
  return {
    tool,
    unlockId,
    tierPolicy: tierPolicies[0],
    tierPolicies,
    teaching,
  };
}
