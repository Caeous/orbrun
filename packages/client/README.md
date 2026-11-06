# @orbrun/client

The Orbrun game client with no page: what the browser app (`apps/orbrun`)
and the terminal (`apps/term`) both play by. Each draws the game its own
way; the rules for the eye and the keys, the settings and the text panes
are these, so the two cannot drift apart. No DOM: where a module asks the
browser something (`localStorage`, `WebSocket`, `fetch`, a window's size),
the terminal stands it in (apps/term `game/env.ts`).

Import each module by its path, as `@orbrun/client/session`.

- `session.ts`: one game, on a server or on this device (@orbrun/offline):
  its connection, gamedata and `Scene`. `engines.ts` keeps the offline
  engines it plays.
- `pilot.ts`, `runner.ts`, `camera.ts`, `fling.ts`: what turns input into
  play: the eye that follows the player and glides, the steps and turns, the
  clicks on cells.
- `keys.ts`, `pad.ts`, `bindings.ts`, `context.ts`: a key or a pad button as
  crawl's keycode, and what each button does in each mode crawl is in, for
  the action bar and the touch bar alike. `focus.ts`, `menu-nav.ts`,
  `text-entry.ts`, `pack-tabs.ts`, `action-tabs.ts`: menus, prompts and the
  cursor over a screen.
- `servers.ts`: the servers, accounts, tokens and saved settings, kept in
  `localStorage`. `settings-rows.ts`: the Settings screen's rows, their
  values and how each reads. `device.ts`: whether this is a phone.
- `grid/`: the console's layout (`console.ts`), and the stats and message
  panes as rows of text (`stats.ts`, `messages.ts`, `rows.ts`).
  `hud-sizes.ts`: how big the minimap and the status badges are drawn.
- `warnings.ts`, `splash.ts`, `touch-glyphs.ts`, `html.ts`: threat
  messages, the front screen's quotes, the touch bar's pixel glyphs, and
  escaping text for HTML.
- `data/`: the bundled server list and the action tiles
  (tools/build/action-tiles.mjs).
