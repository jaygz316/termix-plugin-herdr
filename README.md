# Herdr for Termix

A [Termix](https://github.com/Termix-SSH/Termix) plugin that makes [herdr](https://herdr.dev), the terminal workspace manager for coding agents, usable from Termix, and especially from a phone.

- **Touch as mouse.** Tap to click, two-finger tap or long press for herdr's right-click menus, long press and drag to select text or resize splits, swipe to scroll the pane under your finger. Touch becomes mouse input only while herdr asks for the mouse.
- **Key bar.** herdr's prefix key, Ctrl, Alt and Shift (they latch), Esc, Tab, Backspace, `/`, arrows, Enter, Ctrl+C, Ctrl+D, Ctrl+Z, Ctrl+L, Page Up and Down, plus one-tap herdr actions.
- **Navigator.** Switch between named herdr sessions, see every workspace, git worktree, tab and pane with agent states, preview and copy live pane output, approve blocked agents in one tap, launch coding agents (`claude`, `codex`, `gemini`, `opencode`, `copilot`, `cursor`, `pi`), and prompt or type from a normal text box where autocorrect and dictation work.
- **Notifications & palette.** Configurable toast alerts when agents need input or finish a task, plus host context menu and command palette entry points.
- herdr runs inside Termix's own SSH terminal, so host keys, jump hosts, TOTP and your terminal theme work as usual.

The Termix Android and iOS apps don't load third-party plugins. On a phone, open your Termix server in the browser instead.

## Install

Build it and install the `.tmxplug` from Plugins, Install from file, with Plugin developer mode on:

```bash
npm install
npm run build && npm run pack
```

Or install it straight onto a server while you develop:

```bash
npx termix-plugin dev --server https://your-termix --key tmx_...
```

See [docs/index.md](docs/index.md) for how to use it.

## Development

```bash
npm test             # unit and UI tests
npm run typecheck
npm run validate
HERDR_INTEGRATION=1 npm test   # also drives a real local herdr in a throwaway session
```

How it is put together, and why, is in [AGENTS.md](AGENTS.md).

## License

Apache-2.0
