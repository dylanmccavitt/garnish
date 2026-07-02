---
id: second-turn
level: tutorial-island
title: Continue from save
xp: 10
required: true
prereqs: [connect-agent]
unlocks: []
checks:
  - type: event
    match: { event: turn_start, count: { min: 2 } }
    sameSession: true
---
Sessions preserve conversation context. Send a second message in the same session and
watch the agent pick up where you left off.
