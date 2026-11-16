# herdr-mewboard

A Herdr mod (https://herdr.dev) that shows Mewboard tasks in a popup and hands a
task to the agent of the current space. Mewboard's local server listens on
http://127.0.0.1:4800 with its REST API under `/api` (the same API its MCP server
uses); another address and token come from `mewboard.local.json`.

## What is where

- `mods/mewboard/model.js` — pure logic (no Herdr imports): project matching,
  sorting, filters, agent text, REST client. Covered by `tests/test_model.mjs`.
- `mods/mewboard/main.js` — the popup View. Covered by `tests/test_main.mjs`
  (fake Herdr host and fake Mewboard API).
- `install.py` — copies the mod into `~/.config/herdr-app/mods/mewboard` and
  merges one key (keys.json on macOS, keys.windows.json elsewhere).
- Herdr's mod API: `~/.config/herdr-app/AGENTS.md`, `herdr.d.ts`, `gpui-kit.d.ts`.

## Rules

- Only Herdr's own APIs: `fetch`, `cx.read_from_clipboard` / `write_to_clipboard`,
  `cx.open_url`, `run`, `hc`. No `exec`, no Python, so it works on macOS and Windows.
- Do not import from other mods (Herdr forbids it); read ProdAdvice state only
  through `shared()` (`files.workspace-roots`, `files.agents`).
- Never store a Mewboard token in the repository; `mewboard.local.json` is the
  person's file in the installed mod and is git-ignored.
- LF line endings (`.gitattributes`); `verify.py` refuses CRLF.
- Never start Herdr from an agent's shell: its terminals would inherit the agent's
  environment. The person starts Herdr from the Start menu / Dock.

## Checks

- `py -B verify.py` (Node.js and Python).
- In Herdr: `py install.py --update --apply`, then `herdr-app check
  ~/.config/herdr-app/mods/mewboard`, then open with Ctrl+Shift+M.

## Owner

Talk in Russian. Show any text before it is sent to other people.
