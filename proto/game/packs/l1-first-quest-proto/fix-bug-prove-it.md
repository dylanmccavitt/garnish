---
id: fix-bug-prove-it
level: first-quest
title: Fix the bug and prove it
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
The scaffolded `src/greet.ts` says Goodbye when it should say Hello. Fix the
greeter with the edit tool, then prove it with an approved shell command. The
command check verifies the fix on disk and the approval event proves you
exercised approval judgment.
