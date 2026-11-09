# Changelog

## 1.1.0

### Added

- A session switcher in the navigator for listing and attaching to named herdr sessions (`GET /hosts/:hostId/sessions` and `?session=` overrides)
- Live focused-pane output preview (`pane read`) in the navigator with one-tap Copy and Refresh
- One-tap approval keys (`Enter`, `y`, `n`, `Esc`, `1`, `2`, `3`, `↑`, `↓`, `^C`) when an agent is blocked waiting for input, and toast notifications when agents need input or finish (`agentNotifications` setting)
- Workspace creation with an optional working directory (`--cwd`), git worktree creation and removal (`worktree.create`, `worktree.remove`), and group workspace close retry (`--group`)
- Pane rename (including `--clear`), resize (`pane.resize`), swap (`pane.swap`) and a quick picker to launch an agent (`claude`, `codex`, `gemini`, `opencode`, `copilot`, `cursor`, `pi`) in a plain shell pane
- Two-finger tap as an immediate right-click in the touch mouse layer, and cached terminal cell geometry so touch drags don't reflow the DOM on every move
- Latching `Shift`, `Backspace`, `/`, `Ctrl+Z` and `Ctrl+L` on the key bar
- Host-scoped command palette entry (`Open in Herdr`) and a mobile `Show terminal` button

## 1.0.0

### Added

- A Herdr tab that attaches to herdr on a host inside Termix's SSH terminal
- Touch as mouse: tap to click, long press to right click, long press and drag to drag, swipe to scroll
- A key bar with herdr's prefix, Ctrl, Alt, Esc, Tab, arrows and herdr actions
- A navigator with workspaces, tabs, agents waiting, a map of the current tab's panes and a text box that sends to the focused pane
- Open in Herdr on host rows and in the SSH terminal's toolbar
- Host settings for the herdr binary and session, and user settings for touch, long press, prefix key and the key bar
