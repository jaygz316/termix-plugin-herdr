# Herdr for Termix

A [Termix](https://github.com/Termix-SSH/Termix) plugin that makes [herdr](https://herdr.dev), the terminal workspace manager for coding agents, usable from Termix, and especially from a phone.

- **Touch as mouse.** Tap to click, long press for herdr's right-click menus, long press and drag to select text or resize splits, swipe to scroll the pane under your finger. Touch becomes mouse input only while herdr asks for the mouse.
- **Key bar.** herdr's prefix key, Ctrl and Alt (they latch), Esc, Tab, arrows, Enter, Ctrl+C, Page Up and Down, plus one-tap herdr actions.
- **Navigator.** Every workspace, tab and pane with agent states, agents waiting on you, a tappable map of the current tab, and a normal text box that prompts an agent or types into a pane. Autocorrect and dictation work in it.
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
