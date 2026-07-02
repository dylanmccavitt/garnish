---
id: cycle-a
level: cycle-level
title: Cycle A
xp: 5
required: true
prereqs: [cycle-b]
unlocks: []
checks:
  - type: event
    match: { event: session_start }
---
Cycle A depends on Cycle B.
