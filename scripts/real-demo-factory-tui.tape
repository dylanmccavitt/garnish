# Garnish factory interactive TUI real demo — hand craft, automate, shift, brownout, map.
# Sleeps are intentionally generous so stage 0 → 1 → 2 is visible in the recording.
Output demo/garnish-demo-factory-tui.mp4
Set Shell bash
Set FontSize 15
Set Width 1400
Set Height 900
Set Padding 16
Set Theme { "name": "Garnish Factory TUI", "black": "#0D0D0E", "red": "#C98181", "green": "#93B48B", "yellow": "#CDB878", "blue": "#8FA6B8", "magenta": "#B48CFF", "cyan": "#8FA6B8", "white": "#E6E7E4", "brightBlack": "#26282B", "brightRed": "#D9A0A0", "brightGreen": "#AECBA6", "brightYellow": "#E0CD96", "brightBlue": "#AABFCE", "brightMagenta": "#CBB2F2", "brightCyan": "#AABFCE", "brightWhite": "#FFFFFF", "background": "#0D0D0E", "foreground": "#E6E7E4", "selection": "#26282B", "cursor": "#E6E7E4" }

# isolated factory save for the recording
Type "export GARNISH_PROTO_HOME=$(mktemp -d)"
Enter
Sleep 500ms
Type "bun proto/factory/main.ts"
Enter
# video-game startup: world-select menu (fresh save -> create a world)
Sleep 4s
Type "n"
Enter
Sleep 2s
Type "demo-kitchen"
Enter
Sleep 6s

# stage 0: bare chat + first hand-built ore item
Type "/mine"
Enter
Sleep 2s
Type "/cat src/ore/item-1.ts"
Enter
Sleep 2s
Type "/grep -n Goodbye src/ore/item-1.ts"
Enter
Sleep 2s
Type "/fix"
Enter
Sleep 2s
Type "/fix"
Enter
Sleep 5s

# pick up item-2 by hand before asking for help
Type "/mine"
Enter
Sleep 2s
# item-2: human-as-runtime with a prompt, PASTE, and one hand fix
Type "item-2 help: inspect the next greeter and tell me the safest fix."
Enter
Sleep 5s
Type "/paste grep -n 'friend' src/ore/item-2.ts"
Enter
Sleep 4s
Type "/fix"
Enter
Sleep 5s

# build the first machine; stage 1 queue pressure should be visible
Type "/build bare-agent"
Enter
Sleep 4s
Type "/mine"
Enter
Sleep 2s
Type "item-3 start: take this one with the bare agent."
Enter
Sleep 4s
Type "Yes — preserve the caller's name and use the exact ore recipe."
Enter
Sleep 3s
Type "a"
Enter
Sleep 2s
Type "a"
Enter
Sleep 6s

# stage 2: belt + skill + circuit network
Type "/forge greeter-fix"
Enter
Sleep 3s
Type "/wire read *"
Enter
Sleep 2s
Type "/wire bash grep *"
Enter
Sleep 2s
Type "/wire bash cat *"
Enter
Sleep 3s
Type "/build routing-belt"
Enter
Sleep 3s
Type "p"
Enter
Sleep 7s

# zero-touch shift, brownout, feed, and final mini-map view
Type "/power 800"
Enter
Sleep 10s
Type "/feed 50000"
Enter
Sleep 10s
Type "/end"
Enter
Sleep 6s
Ctrl+C
