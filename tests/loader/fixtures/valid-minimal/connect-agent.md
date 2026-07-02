---
id: connect-agent
level: tutorial-island
title: Connect agent
xp: 20
required: true
prereqs: [install-engine]
unlocks: []
checks:
  - type: event
    match: { event: agent_end, min_assistant_turns: 1 }
---
Connect a model and complete the first agent turn.
