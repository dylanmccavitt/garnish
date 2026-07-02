---
id: valid-quest
level: bad-level
title: Valid quest
xp: 5
required: true
prereqs: []
unlocks: []
checks:
  - type: event
    match: { event: session_start }
---
This quest is valid, but the pack must reject atomically because another quest is invalid.
