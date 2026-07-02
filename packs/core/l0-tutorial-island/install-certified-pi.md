---
id: install-certified-pi
level: tutorial-island
title: Install the game engine
xp: 10
required: true
prereqs: []
unlocks: []
checks:
  - type: event
    match: { event: session_start }
  - type: json_path
    file: "{agent_dir}/garnish/state.json"
    path: "$.runtime.certifiedVersion"
    assert: non_empty
---
Garnish owns a certified Pi runtime; your global `omp` is ignored. Launch the harness
through Garnish so the certified engine boots and records its version.
