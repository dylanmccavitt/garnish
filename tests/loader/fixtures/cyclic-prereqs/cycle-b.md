---
id: cycle-b
level: cycle-level
title: Cycle B
xp: 5
required: true
prereqs: [cycle-a]
unlocks: []
checks:
  - type: event
    match: { event: agent_end }
---
Cycle B depends on Cycle A.
