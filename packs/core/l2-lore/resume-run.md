---
id: resume-run
level: lore
title: Load saved game
xp: 15
required: true
prereqs: [project-lore-file]
unlocks: []
checks:
  - type: event
    match: { event: session_start, resumed: true }
---
Resume a previous run so the agent starts from saved context instead of a blank slate.
The v1 DSL records the strongest deterministic signal: a `session_start` event marked
`resumed: true`.
