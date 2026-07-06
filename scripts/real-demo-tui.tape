# Garnish interactive TUI real demo — onboarding, atlas, boss fight, quit + RESUME.
# Sleeps are intentionally generous and may need tuning after layout or pacing changes.
Output demo/garnish-demo-tui.mp4
Set Shell bash
Set FontSize 15
Set Width 1400
Set Height 900
Set Padding 16
Set Theme { "name": "Garnish Monogrid", "black": "#0D0D0E", "red": "#C98181", "green": "#93B48B", "yellow": "#CDB878", "blue": "#8FA6B8", "magenta": "#B48CFF", "cyan": "#8FA6B8", "white": "#E6E7E4", "brightBlack": "#26282B", "brightRed": "#D9A0A0", "brightGreen": "#AECBA6", "brightYellow": "#E0CD96", "brightBlue": "#AABFCE", "brightMagenta": "#CBB2F2", "brightCyan": "#AABFCE", "brightWhite": "#FFFFFF", "background": "#0D0D0E", "foreground": "#E6E7E4", "selection": "#26282B", "cursor": "#E6E7E4" }

# isolated save for the recording
Type "export GARNISH_PROTO_HOME=$(mktemp -d)"
Enter
Sleep 500ms
Type "bun run proto"
Enter
# onboarding wizard: mascot welcome + pantry-pass menu (fresh save)
Sleep 4s
Type "1"
Enter
# Demo Kitchen sign-in ceremony + tips, then the TUI boots
Sleep 5s
Type "What's my quest?"
Enter
Sleep 4s
Type "Look around"
Enter
Sleep 5s
# ATLAS: levels, quests, rewards, boss rows, teaser levels
Tab
Sleep 5s
Tab
Sleep 1s
Type "Record the first edit"
Enter
Sleep 5s
# quit mid-run — progress persists on disk
Ctrl+C
Sleep 2s
# relaunch: wizard offers Continue with kept XP/quests
Type "bun run proto"
Enter
Sleep 4s
Type "1"
Enter
Sleep 4s
# atlas again: completed levels stayed done after resume
Tab
Sleep 4s
Tab
Sleep 1s
# BOSS FIGHT: The Goodbye Greeter (stamp asks for approval)
Type "Fix the greeter bug, stamp it, and prove it"
Enter
Sleep 4s
Type "r"
Sleep 1s
Type "show me the diff first"
Enter
Sleep 3s
Type "a"
Sleep 4s
Sleep 5s
Ctrl+C
