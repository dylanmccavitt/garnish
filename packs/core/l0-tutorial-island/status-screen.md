---
id: status-screen
level: tutorial-island
title: Open the menu
xp: 10
required: false
prereqs: [connect-agent]
unlocks: []
checks:
  - type: command
    command: [garnish, status]
    exit_code: 0
---
Check your progress with `garnish status` (or `/quest` in-session). Optional — but the
menu is where your XP, level, and next quest live.
