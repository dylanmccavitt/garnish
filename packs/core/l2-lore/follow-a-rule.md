---
id: follow-a-rule
level: lore
title: Canon becomes gameplay
xp: 20
required: true
prereqs: [project-lore-file]
unlocks: []
checks:
  - type: event
    match: { event: tool_result, tool: { regex: "^(write|edit)$" }, success: true }
  - type: command
    command:
      - sh
      - -c
      - 'test -f "$1" && grep -Eq "^LORE: .+" "$1"'
      - sh
      - "{sandbox}/lore-note.txt"
    exit_code: 0
---
Ask the agent to create or edit `{sandbox}/lore-note.txt` while following the convention
from `AGENTS.md`. The note must start with `LORE: ` so the rule is visible in the artifact.
