Herdr opens [herdr](https://herdr.dev), the terminal workspace manager for coding agents, on any SSH host in Termix and makes it work with touch. It supports both the new `herdr-core` (`hc`) and `herdr-app` runtime and legacy `herdr`. Taps become mouse clicks, a key bar adds the keys phone keyboards lack, and a navigator lists every workspace, git worktree, tab, pane and agent.

## Turn it on

1. Install `hc` (`herdr-core`) and `herdr-app` (or legacy `herdr`) on the host. Herdr looks for `hc`, `herdr-core` and `herdr` on `PATH` and in `~/.local/bin`, `~/.cargo/bin`, `~/bin`, `/usr/local/bin` and `/opt/homebrew/bin`.
2. Install Herdr from the Plugins tab. It needs the SSH Terminal plugin, which Termix ships with.
3. Press the robot button on a host, or choose Open in Herdr in the host's menu or the command palette.

Herdr is on for every SSH host. To hide it for a host, choose between `herdr-core` (`hc`) and legacy `herdr`, or set a custom binary path or named session, edit the host and open the Herdr section. On `hc` hosts, Herdr renders a `herdr-app` sidebar (Spaces and Agents, mouse-resizable width and vertical split, with an instant filter bar and collapsible 44px icon rail), top tab bar with a `+` menu to launch agents or tabs, pane header bar (with split-pane switcher pills, click-to-copy `cwd`, inline approval keys and an inline quick-prompt bar) and bottom status bar (with one-click jump to the next waiting agent) around the terminal.

## Touch as mouse

On a touch screen the terminal turns touch into mouse input for herdr:

| Gesture                     | herdr gets                                                           |
| --------------------------- | -------------------------------------------------------------------- |
| Tap                         | A left click: pick a workspace, tab or pane, press a button or link. |
| Two-finger tap / long press | A right click: herdr's menu for that pane or row.                    |
| Long press, then drag       | A left drag: select text, or drag a split border to resize panes.    |
| Swipe up or down            | The scroll wheel over the pane under your finger.                    |

The layer only turns touch into mouse input while herdr has asked for the mouse. At a plain shell prompt touch works as usual. The pointer button in the tab's header turns it off and on. With a real mouse, clicks pass through as themselves.

## Key bar

The bar under the terminal has Prefix (herdr's prefix key, Ctrl+B unless you changed it), Ctrl, Alt, Shift, Esc, Tab, Backspace, `/`, the arrows, Enter, Ctrl+C, Ctrl+D, Ctrl+Z, Ctrl+L, Page Up and Down, Home and End. Ctrl, Alt and Shift latch: press one, then a key on the bar, or type a character in the small box that appears.

The second row runs herdr actions: the workspace and go to pickers, previous and next tab, new tab, split right, split down, zoom and the sidebar. Tab, split and zoom go through herdr's API, so they work whatever your keybindings are. The keyboard button opens your phone's keyboard.

If you changed herdr's prefix in `config.toml`, set the same one in Settings, Herdr.

## Navigator

The list button in the header opens the navigator. On a phone it covers the terminal (tap a focused row or Show terminal to return to the terminal); on a wide screen it sits beside it.

- **Session** shows the active herdr session on the host and lets you switch to another running session or attach to a new named session on the fly.
- **Agents waiting** lists agents that are blocked on you or done. Tap one to jump to it, or use the one-tap approval keys (`Enter`, `y`, `n`, `Esc`, `1`, `2`, `3`, `↑`, `↓`, `^C`) right on a blocked agent's row.
- **Workspaces** lists every workspace, linked git worktrees and the tabs of the current workspace, with their agent state. Tap to switch. Create a workspace with an optional name and working directory, create or remove git worktree workspaces for branches, and rename or close workspaces and tabs from the row buttons.
- **Panes** is a map of the current tab. Tap a pane to focus it, or rename, split, resize, swap, zoom and close the focused pane. When a plain shell pane is focused, a quick picker launches an agent (`claude`, `codex`, `gemini`, `opencode`, `copilot`, `cursor` or `pi`) in one tap.
- **Output** previews recent unwrapped text from the focused pane with Copy and Refresh buttons, so you can read or copy an agent's question or command output on a narrow screen.
- **Send to** is a normal text box for the focused pane, so autocorrect, paste and dictation work. Prompt agent sends it to the agent as a prompt, Run types it and presses Enter, and Type without Enter only types it. When an agent is waiting for interactive approval, one-tap approval keys appear above the box.

## Notifications

By default Herdr shows a toast notification when an agent transitions to waiting for your input or finishes its work. Change this under Settings, Herdr, Agent notifications (`When waiting or done`, `Only when waiting for input` or `Off`).

## The Termix mobile app

The Termix Android and iOS apps have their own screens for the plugins that ship with Termix, and they don't load other plugins. To use Herdr on a phone, open your Termix server's web address in the phone's browser. Adding it to your home screen gives it a full-screen window.

## Good to know

- Herdr shows its single column phone layout when the terminal is 64 columns or fewer. Set `mobile_width_threshold` under `[ui]` in herdr's `config.toml` to change that.
- A phone and a computer can both be attached to the same herdr session. Switching workspaces from one switches the other too, since herdr keeps one focus per session.
- Focusing a pane by id uses herdr's socket API through `python3` on the host. Without `python3`, the navigator focuses the pane's agent, or its tab.
