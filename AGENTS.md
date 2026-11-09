# AGENTS.md

This repo is a [Termix](https://github.com/Termix-SSH/Termix) plugin. These notes are for AI coding tools.

## Read first

Before changing anything, read `node_modules/@termix-ssh/plugin-sdk/PLUGIN-GUIDE.md`. It covers the
manifest, backend, database, frontend, UI, testing, releasing and submitting to the community registry,
and it matches the SDK version installed here. If it is missing, run `npm install`. If it is still missing,
the SDK is older than 1.0.6: run `npm install -D @termix-ssh/plugin-sdk@latest` or read
https://docs.termix.site/develop instead.

If the guide and the SDK's TypeScript types disagree, the types are right.

## Commands

```bash
npm run build        # bundle into dist/
npm test             # run the tests
npm run typecheck    # type check
npm run validate     # check manifest.json, migrations, changelog and docs
npm run migrations   # write migrations after changing src/backend/tables.ts
npm run pack         # write <id>-<version>.tmxplug
npm run format       # format with Prettier
```

`npx termix-plugin dev --server <url> --key <tmx_...>` installs the plugin on a Termix server with
developer mode on and reinstalls it on every save. Don't start it unless the user asks.

## Layouts and themes

A plugin can also be a layout (`contributes.layouts`, capability `ui:layout`, `app.registerLayout` in the
frontend, shell state from `useShell()`) or add themes (`contributes.themes`, capability `ui:theme`, one CSS
file per theme scoped under `.<id>`). A theme only plugin has no `src/`: just `manifest.json`, `themes/*.css`,
`locales/` and a test that runs `validateThemeCss()`. The guide's "Layouts and themes" section has the rules.

## Done means

- `npm test`, `npm run typecheck`, `npm run validate`, `npm run build` and `npm run format:check` pass
- `npx termix-plugin migrations --check` passes
- New UI text is in `locales/en.json`, new routes have an `@openapi` block and a test
- `docs/` and the section below still match what the plugin does
- User facing changes are in `CHANGELOG.md` under the version they ship in

## About this plugin

Keep this section current when the plugin changes: what it does, how it is put together, decisions that
aren't obvious from the code, and anything that has bitten you before.

- What it does: makes herdr (https://herdr.dev, a terminal workspace manager for coding agents) usable
  from Termix, especially on phones: touch as mouse, a key bar and a navigator over herdr's API.
- The terminal is not ours. `HerdrTab` embeds the SSH Terminal plugin's `terminal.view` component with
  `executeCommand` set to `herdr [--session X]`, so host keys, TOTP, jump hosts and themes all work. Its
  handle gives `sendInput` and `subscribeOutput`; nothing else of xterm is exposed.
- Touch as mouse (`TouchMouseLayer`) sits over the terminal and writes SGR (1006) mouse reports with
  `sendInput` (including two-finger tap as immediate right-click). It only shows while `MouseModeTracker`
  has seen herdr turn on modes 1000/1002/1003 in the output, so a plain shell never gets mouse bytes. Cell
  geometry comes from xterm 6's DOM renderer (`readTerminalGrid`): one `.xterm-rows` child per row, and the
  cell width measured with a run of "W" inside `.xterm-rows` and cached in a `WeakMap` until the row count
  or `.xterm-screen` dimensions change. If SSH Terminal ever switches to the WebGL renderer, this has to change.
- The backend never builds shell strings from input. `actions.ts` whitelists actions into argv (workspaces,
  git worktrees, tabs, panes and agents), `remote.ts` quotes every argument and sends a POSIX script on stdin
  to `sh -s`, so the login shell (fish included) never parses it. The script adds `~/.local/bin` and friends
  to PATH, because non-interactive SSH skips profiles and herdr installs to `~/.local/bin`.
- herdr's CLI cannot focus a pane by id; the socket API can (`pane.focus`). `buildSocketScript` sends one
  JSON line to the socket through `python3`, and the route falls back to `agent focus` or `tab focus`.
- When an agent is `blocked` (waiting for tool permission or an interactive question), herdr's CLI refuses
  `agent prompt` with `agent_blocked`. The navigator surfaces one-tap approval keys (`pane.sendKeys`) and
  highlights `Run` (`pane.run`) alongside a live `pane read` output preview so the user can see and answer
  the prompt without zooming the terminal.
- Closing a workspace that has open linked git worktree workspaces fails with
  `workspace_group_close_required`; `HerdrTab` catches that code, asks for confirmation and retries with
  `workspace.close` (`group: true`, which passes `--group`).
- herdr prints JSON for most commands (`session list --json` requires `--json`), nothing for `send-text`,
  `send-keys` and `run`, and plain text for `pane read`. `parseHerdrResult` treats empty success output as `{}`.
- Every failure is a 4xx or `{ available: false }`, never a 5xx: an unreachable host on a phone polling
  every few seconds would otherwise use up the plugin's error budget and get it turned off.
- The Termix mobile app does not load third-party plugins; this plugin is for the web UI, including a
  phone's browser.
- herdr's phone-layout switcher has a "+ new tab" row that does nothing when clicked, from any terminal.
  It is herdr's, not ours; the key bar and navigator create tabs through the API.
