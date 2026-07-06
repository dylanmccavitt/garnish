---
id: first-edit
level: first-steps
title: First edit
xp: 10
required: true
prereqs: [look-around]
unlocks: []
checks:
  - type: yaml_path
    file: "{workspace}/quest-state.yml"
    path: "$.first_edit"
    assert: { equals: GARNISH_PROTO_FIRST_EDIT }
  - type: event
    match: { event: file.edited, path: { contains: quest-state.yml } }
---
Write or edit `{workspace}/quest-state.yml` so it contains `first_edit: GARNISH_PROTO_FIRST_EDIT`. The file check proves content and `file.edited` proves the harness surfaced the edit.
