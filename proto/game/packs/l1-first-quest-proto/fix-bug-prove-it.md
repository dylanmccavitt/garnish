---
id: fix-bug-prove-it
level: first-quest
title: The Goodbye Greeter
xp: 20
required: true
prereqs: []
unlocks: []
checks:
  - type: command
    command: "grep -q 'Hello,' {workspace}/src/greet.ts"
    exit_code: 0
  - type: event
    match: { event: tool.approval.resolved, approved: true }
---
The scaffolded `src/greet.ts` is guarded by the Goodbye Greeter: it says
Goodbye when it should say Hello. Fix the greeter with the edit tool, then
prove the boss is beaten with an approved shell command. The command check
verifies the fix on disk and the approval event proves you exercised approval
judgment.
