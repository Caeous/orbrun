<p align="center"><img src="assets/logo.svg" alt="Orbrun" width="560"></p>

# Orbrun

**Dungeon Crawl Stone Soup in first person, built for controllers and handhelds.**

**[Play now: orbrun.app](https://orbrun.app)**

Orbrun is an unofficial client for [Dungeon Crawl Stone
Soup](https://crawl.develz.org/). It talks to the public DCSS servers over
[WebTiles](https://crawl.develz.org/wordpress/howto), the same protocol the
official client uses, but replaces everything you see and touch: the dungeon
is drawn in first-person 3D, the HUD is sized for a small screen, and the
controls are built around a gamepad, with the Steam Deck as the main target.
It runs in the browser. There is nothing to install and no Orbrun account.

If you already play on WebTiles, you keep your account, your rc file and your
keys. Menus, prompts and messages work the way you're used to.

<p align="center">
  <img src="https://orbrun.app/room/poster.jpg" alt="The Antechamber: a stone hall in DCSS's tiles with a down staircase between two statues" width="720">
</p>

## Status

Playable. Log in to a public server (or register, or just spectate), start a
game, and play it in first person with a keyboard or a gamepad. You can also
play offline, with no server, on the engine built into the browser.

Not yet: sound, and the feel layer (camera sway, hit shake).

## Features

- **First-person 3D dungeon.** Walls, doors, stairs, altars, shops, water and
  lava; items and monsters as billboards; remembered squares dimmed; a
  minimap.
- **Full gamepad support.** A contextual A button, tap-or-hold buttons,
  command menus, an on-screen keyboard, and an action bar that shows what
  every button does right now. The bar is never guessing: the server says
  which mode you're in.
- **The keyboard you know.** Every key does what it does in the official
  client, with one exception: direction keys are relative to the way you
  face.
- **Everything WebTiles shows.** Menus, popups, prompts, `--more--`, the
  monster list, the stats pane, the message log, chat, the level map and
  targeting.
- **Your rc file, live.** Orbrun reads your options from the server and never
  caches or overrides them.
- **Any DCSS version.** Enums, tile tables and atlases come from the connected
  server at runtime, so stable and trunk both work without an Orbrun update.
- **Offline play.** The current release or trunk, built for WebAssembly, runs
  in your browser with saves kept on your device.
- **Many accounts, many servers**, including any server you add by URL.
- **Steam.** Add it to your library on a Steam Deck, Windows, Linux or a Mac;
  see [Add to Steam](#add-to-steam).

[ABOUT.md](ABOUT.md) has the full tour, the controls, and the security and
privacy notes. [CHANGELOG.md](CHANGELOG.md) has what's new.

## Add to Steam

Orbrun goes into Steam as a non-Steam game that opens a browser in kiosk mode
on orbrun.app. It works on a Steam Deck, Windows, Linux and a Mac, takes five
steps, and needs no script. [STEAM.md](STEAM.md) walks through them.

## DCSS as a library

Orbrun is an npm workspace. The game lives in `apps/orbrun`. What it knows
about DCSS lives in small packages under `packages/`. Each does one job and
depends on neither the app nor the DOM, so a different client, a bot, a
recorder or a viewer can use it on its own. Each has a README.

| Package | What it does | Depends on |
|---------|--------------|------------|
| [`@orbrun/webtiles`](packages/webtiles) | The WebTiles protocol: keycodes and client messages, a WebSocket connection, a tolerant reducer from server messages to a `GameState`, and formatted-string rendering | nothing |
| [`@orbrun/gamedata`](packages/gamedata) | Loads a server's own `enums.js`, `tileinfo-*.js` and atlases at runtime; tile lookup, flag decoding, name indices | nothing |
| [`@orbrun/scene`](packages/scene) | The world model a renderer draws: cells, billboards, camera, directions, minibars, and the `MapRenderer` and `TileSource` contracts | nothing |
| [`@orbrun/scene-webtiles`](packages/scene-webtiles) | `GameState` + gamedata → `Scene`. All the DCSS knowledge: tile ranges, feature classification, monster list rules, the viewmodel | webtiles, gamedata, scene |
| [`@orbrun/render-2d`](packages/render-2d) | Top-down Canvas 2D renderer of a `Scene`; also draws the minimap | scene |
| [`@orbrun/render-3d`](packages/render-3d) | First-person three.js renderer of a `Scene` | scene, three |
| [`@orbrun/vault`](packages/vault) | A subset of DCSS's `.des` vault format, compiled to a `Scene` | scene, scene-webtiles |
| [`@orbrun/offline`](packages/offline) | Runs the WebAssembly engine in a Web Worker behind a WebTiles connection, and stands in for the server's lobby | webtiles |

`apps/orbrun` is the game itself: the server picker, lobby, login, HUD, menus
and popups, on-screen keyboard, gamepad layers, command menus, settings and
the front room. `engine/` builds upstream crawl for WebAssembly for offline
play.

## Run it

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # vitest
npm run typecheck  # tsc -b
npm run build      # apps/orbrun/dist
```

Public servers don't send CORS headers, so the dev and preview servers include
a small proxy that fetches gamedata (tile tables and atlases) from the
connected server. WebSockets connect directly.

[CONTRIBUTING.md](CONTRIBUTING.md) covers fixtures, the recorder and the build
tools.

## License

[AGPL-3.0-or-later](LICENSE). Copyright © 2026 the Orbrun developer. Orbrun is
an independent project, not affiliated with or endorsed by the DCSS
development team. [ATTRIBUTION.md](ATTRIBUTION.md) explains how it relates to
DCSS and what it takes from the official client. Thanks to
[PocketZot](https://pocketzot.app/about) for inspiring parts of the game and
for feedback.

## Feedback

Comments, questions and bug reports are welcome on
[GitHub issues](https://github.com/Caeous/orbrun/issues) or at
<caeous@gmail.com>.
