<p align="center"><img src="assets/logo.svg" alt="Orbrun" width="560"></p>

# Orbrun

**Dungeon Crawl Stone Soup in first person, built for controllers and handhelds.**

**[Play now: orbrun.app](https://orbrun.app)**

Orbrun is an unofficial client for [Dungeon Crawl Stone
Soup](https://crawl.develz.org/). It speaks the
[WebTiles](https://crawl.develz.org/wordpress/howto) protocol to public DCSS
servers, the same WebSocket protocol as the official client, but replaces the
view and the input entirely: a first-person 3D dungeon, a HUD built for a
small screen, and a gamepad model with the Steam Deck as the primary target.
It runs in the browser; there is nothing to install and no Orbrun account.

A WebTiles player should feel at home immediately. Your account, your rc file,
and your muscle memory for keys, menus, prompts, and messages all carry over
unchanged.

<p align="center">
  <img src="https://orbrun.app/room/poster.jpg" alt="The Antechamber: a stone hall in DCSS's tiles with a down staircase between two statues" width="720">
</p>

## Status

Playable online. Connect to a public WebTiles server, log in or register,
start a game, and play it in first person with a keyboard or a gamepad.
Spectating works too.

Not yet: sound, the feel layer (sway, hit shake, vignettes), a desktop or
Steam shell, and offline play against a local engine.

## Features

- First-person 3D dungeon: walls, doors, stairs, altars, shops, water and
  lava, items and monsters as billboards, memory dimming for what you have
  seen but cannot see now, and a minimap.
- Full gamepad support: a contextual A button, tap-or-hold buttons, command
  menus, an on-screen keyboard, and an action bar that shows what every
  button does in the current mode, because the server says what mode you are
  in.
- Keyboard plays exactly as in the official client, with one exception:
  direction keys are relative to facing.
- Everything WebTiles shows: menus, popups, prompts, `--more--`, monster
  list, stats pane, message log, chat, level map, targeting.
- Your server-side rc file is honoured live; nothing is cached or overridden.
- Nothing version-specific is hardcoded: enums, tile tables and atlases are
  loaded from the connected server at runtime, so stable and trunk both work.
- Multiple accounts across multiple servers, plus any server you add by URL.
- One-line Steam Deck installer that adds Orbrun to your Steam library.

See [ABOUT.md](ABOUT.md) for the full tour, including the controls and the
security and privacy notes, and [CHANGELOG.md](CHANGELOG.md) for what's new.

## Steam Deck

In Desktop Mode, open Konsole and run:

```sh
curl -fsSL https://orbrun.app/deck | sh
```

It installs a kiosk browser, lets it see the controller, and adds Orbrun to
your Steam library with artwork. Read [the script](apps/orbrun/public/deck.sh)
first if you like; it needs no `sudo` and is safe to re-run.

## DCSS as a library

Orbrun is an npm workspace. The game lives in `apps/orbrun`; everything it
knows about DCSS lives in small packages under `packages/`, each doing one
thing, with no dependency on the app or on the DOM, so another client, a
bot, a recorder or a viewer can use them on their own. Each has a README.

| Package | Does one thing | Depends on |
|---------|----------------|------------|
| [`@orbrun/webtiles`](packages/webtiles) | The WebTiles protocol: keycodes and client messages, a WebSocket connection, a tolerant reducer from server messages to a `GameState`, and formatted-string rendering | nothing |
| [`@orbrun/gamedata`](packages/gamedata) | Loads a server's own `enums.js`, `tileinfo-*.js` and atlases at runtime; tile lookup, flag decoding, name indices | nothing |
| [`@orbrun/scene`](packages/scene) | The renderer-facing world model: cells, billboards, camera, directions, minibars, and the `MapRenderer` and `TileSource` contracts | nothing |
| [`@orbrun/scene-webtiles`](packages/scene-webtiles) | `GameState` + gamedata → `Scene`. All the DCSS knowledge: tile ranges, feature classification, monster list rules, the viewmodel | webtiles, gamedata, scene |
| [`@orbrun/render-2d`](packages/render-2d) | Top-down Canvas 2D renderer of a `Scene`; also the minimap | scene |
| [`@orbrun/render-3d`](packages/render-3d) | First-person three.js renderer of a `Scene` | scene, three |
| [`@orbrun/vault`](packages/vault) | A supported subset of DCSS's `.des` vault format, compiled to a `Scene` | scene, scene-webtiles |

`apps/orbrun` is the game: server picker, lobby, login, HUD, menus and
popups, on-screen keyboard, gamepad layers, command menus, settings, the
front room, and the Steam Deck installer.

## Run it

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # vitest
npm run typecheck  # tsc -b
npm run build      # apps/orbrun/dist
```

The dev and preview servers include a small proxy that fetches gamedata (tile
tables and atlases) from the connected server with CORS headers, since public
servers do not send them. WebSockets connect directly.

See [CONTRIBUTING.md](CONTRIBUTING.md) for fixtures, the recorder, and the
build tools.

## License

[AGPL-3.0-or-later](LICENSE). Copyright © 2026 the Orbrun developer. Orbrun is
an independent project, not affiliated with or endorsed by the DCSS
development team. See [ATTRIBUTION.md](ATTRIBUTION.md) for the relationship to
DCSS and what is derived from the official client.

## Feedback

Comments, questions, and bug reports are welcome at
[GitHub issues](https://github.com/Caeous/orbrun/issues) or
<caeous@gmail.com>.
