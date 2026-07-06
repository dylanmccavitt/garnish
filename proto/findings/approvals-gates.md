# Approvals + Gates Prototype Findings

## Verdict
The slice is viable as a prototype seam. A small deterministic classifier plus a catalog-backed gate engine was enough to exercise ADR-18 approvals and ADR-16 hide-then-tease without involving an LLM, sandbox, or TUI modal. The main design pressure is not implementation complexity; it is making the catalog carry enough curriculum ordering and policy data that the hook does not invent progression rules off to the side.

## What worked
- `deny > ask > allow` is easy to model if critical deny rules are checked before session-scoped allow patterns. The prototype intentionally denies critical commands even when a broad session pattern such as `git push*` exists.
- Session allow patterns are useful when they stay prefix-shaped. The `suggestPattern()` shape (`git status*`, `bun test*`, first command plus subcommand when available) is simple enough for the TUI to explain and avoids turning one approval into a free-form shell glob lesson.
- Compound command max-risk classification made the hook behavior predictable. Splitting `ls && curl example.com` into pieces and taking the highest tier is conservative and easy to teach.
- One-level wrapper stripping (`env`, `nice`, `time`, `xargs`, `bash -c`) covers the cases most likely to appear in model-generated commands without building a shell parser.
- Doom-loop detection belongs in the approval hook, not in the model loop. Tracking consecutive identical `(tool,input)` blocks/denials lets the teaching escalate on the third repeat without changing tool execution or provider streaming.
- Hide-then-tease can be derived from catalog order for this prototype: the next locked unique `unlockId` becomes the teased group, all later locked groups stay hidden. Shared unlock IDs (`write` and `edit` behind `l0-tools`) naturally tease together.
- `unlockAll()` parity is straightforward when the engine owns a monotonic `Set` of unlock IDs and applies every non-null catalog unlock.

## What did not work cleanly
- LOO-173 should not rely on incidental array order long term. "One unlock away" was cleanly derivable only because the prototype catalog is tiny and linear. Real curriculum branches, optional quests, remediation paths, or multiple simultaneous arcs need explicit ordering/graph data such as `teaseAfter`, `dependsOn`, or a curriculum-provided current quest pointer. Catalog order is fine for the throwaway demo but too implicit for production.
- The frozen `GateCatalogEntry.tierPolicy: Record<RiskTier, ApprovalPolicy>` is not enough to express ADR-18's tier arc. The prototype had to attach an extra `tierPolicies` table per entry and have the hook read it structurally. LOO-164 should graduate a first-class per-progression-tier policy shape, or move tier policy out of individual tool entries into a separate approval policy table keyed by player tier/tool/risk.
- The `danger-zone` unlock is awkward with the current contract. The hook needs to know when critical commands flip from deny to ask, but `GateEngine` exposes only `isUnlocked(tool)`. The prototype added a structural `hasUnlock()` method on the returned object; production should either add an unlock-query contract or pass a policy resolver into the hook.
- The exact requested command `bun test proto/approvals proto/gates` does not run in this repo because `bunfig.toml` sets `[test] root = "./tests"`; Bun treats those args as filters under `tests` and fails before loading proto tests. `bun test ./proto/approvals ./proto/gates` does run the slice tests. The workflow spec should either include the leading `./` or change the root strategy.

## Classifier sore spots
- False positives: network commands are always `risky`, even harmless `curl -I` documentation checks. `chmod -R` is always risky even under scratch paths. Any credential-looking path (`secret`, `token`, `.env`) becomes critical even if the command is only `cat` for an exercise fixture.
- False negatives: shell parsing is intentionally shallow. Command substitution, process substitution, aliases, nested `bash -c`, here-docs, and quoted scripts can hide effects. `python -c`, `node -e`, and `perl -e` are currently treated as unknown/moderate unless paired with network/sudo/redirect patterns, but they can perform arbitrary writes or network calls.
- Path analysis has no workspace root, so `rm -rf build` is moderate while `rm -rf /tmp/foo` is critical because it is absolute. That is conservative for outside-cwd detection but cannot distinguish allowed scratch state under `.garnish-proto/` from dangerous absolute paths under the user's home.
- Pipe-to-shell detection is mostly covered by the network side becoming risky, but because compound splitting breaks on `|`, the explanation may say "uses network access" instead of "pipes network content into an interpreter." If the teaching copy matters, pipe detection should happen before splitting or retain operators in the split result.

## Tier-policy verdict (LOO-164)
The table shape holds conceptually: tier 0 asks, tier 1 auto-allows safe, tier 2 auto-allows safe+moderate, risky always asks, and critical denies until a danger-zone unlock flips it to ask. The contract shape does not hold mechanically because it has only one `tierPolicy` per catalog entry. Production should make tier policy an explicit resolver, for example:

- `approvalPolicies: Record<number, Record<RiskTier, ApprovalPolicy>>` for global policy, plus optional per-tool overrides; or
- `policyByTier` on `GateCatalogEntry` if policy truly travels with a tool.

The global-table version is cleaner for ADR-18 because the risk arc is mostly player-tier policy, not tool identity.

## Spec changes recommended
- LOO-173: add explicit tease/progression ordering data instead of deriving tease from catalog array position once the curriculum stops being linear.
- LOO-164: replace single `tierPolicy` with a tier-aware policy resolver/table and include the `danger-zone` transition in the contract.
- ADR-18: specify whether built-in read-only allowlist bypasses early-tier asks. The prototype uses it as a rules-engine match, but still lets tier 0 ask unless a session allow exists; this preserves the "early tiers ask everything" teaching arc.
- ADR-18: define the model-facing denial copy as part of the approval contract. The prototype returns exact command, tier/explanation, and player denial reason in `ToolResult.output`.
- Test workflow: document `bun test ./proto/approvals ./proto/gates` for proto slices while `bunfig.toml` roots tests under `./tests`.
