---
id: project-lore-file
level: lore
title: Write the lore book
xp: 20
required: true
prereqs: []
unlocks: []
checks:
  - type: file_exists
    path: "{sandbox}/AGENTS.md"
  - type: command
    command:
      - sh
      - -c
      - 'test -f "$1" && grep -Eq "Project convention: every generated lore note starts with LORE:" "$1"'
      - sh
      - "{sandbox}/AGENTS.md"
    exit_code: 0
---
Create `{sandbox}/AGENTS.md` and put one durable convention in it:
`Project convention: every generated lore note starts with LORE:`.

That exact line is the lore book entry later quests can prove the agent discovered and followed.
