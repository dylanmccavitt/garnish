---
id: first-file
level: first-quest
title: First file
xp: 15
required: true
prereqs: [connect-agent]
unlocks: [tool:file]
checks:
  - type: file_exists
    path: "{sandbox}/first-file.txt"
---
Create the first file through the agent.
