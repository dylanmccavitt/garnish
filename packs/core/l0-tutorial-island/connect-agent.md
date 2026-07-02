---
id: connect-agent
level: tutorial-island
title: Player 1 connected
xp: 20
required: true
prereqs: [install-certified-pi]
unlocks: []
checks:
  - type: event
    match: { event: agent_end, min_assistant_turns: 1 }
  - type: yaml_path
    file: "{agent_dir}/config.yml"
    path: "$.providers[*].apiKeyRef"
    assert: non_empty
---
Set up a provider key and complete your first model round trip. Any provider works —
the check only proves a key reference exists in your config, never the key itself.
