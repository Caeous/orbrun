# About Orbrun

Orbrun is an unofficial [DCSS](https://crawl.develz.org) client that puts you
inside the dungeon. It connects to public
[WebTiles](https://crawl.develz.org/wordpress/howto) servers, speaks the same
protocol as the official client, and renders the same game in first person,
built to be played with a gamepad on a handheld — the Steam Deck first.

If you play WebTiles, this is your game, your account, your rc file, and your
keys. Orbrun adds a 3D view and controller support on top; it does not ask you
to relearn anything.

## Getting started

Open [orbrun.app](https://orbrun.app), pick a server, and log in with your
existing WebTiles account — or register a new one, or spectate without an
account. Then start a game and play. There is nothing to install and no Orbrun
account: your browser talks to the DCSS server directly.

On a Steam Deck, see [Steam Deck](#steam-deck) below for the one-line
installer that puts Orbrun in your library with artwork.

## Features

- First-person 3D view of the live dungeon: walls, doors, stairs, altars,
  shops, water and lava, items and monsters as billboards, with memory dimming
  for what you have seen but cannot see now.
- Full gamepad support: a contextual A button, tap-or-hold buttons, an
  action bar that always shows what each button does right now, command
  menus, an on-screen keyboard for anything that needs text, and hints that
  teach the controls as you use them.
- Everything the official client shows: menus, popups, prompts, `--more--`,
  the monster list, the stats pane, the message log, chat with spectators,
  the level map, and targeting.
- Your rc file is honoured, read live from the server — colours, autopickup,
  `show_more`, `travel_delay`, mouse control, tile options, macros, and the
  rest. Orbrun never caches or overrides your options.
- Nothing version-specific is hardcoded: tile tables, enums and atlases come
  from the connected server at runtime, so new DCSS releases and daily trunk
  rebuilds work without an Orbrun update.
- Multiple accounts across multiple servers, plus any server you add by URL.
- Spectating, with the same view and HUD.
- Minimap, monster list, edge markers for monsters the camera does not
  frame, and a settings screen for camera angle, field of view, UI scale,
  look sensitivity, hints, and the minimap.
- The menus stand in the Antechamber, a small hall built from the game's own
  tiles, so the front end is a place rather than a form.

## Controls

### Keyboard

Everything works as in the official client, with one documented exception:
direction keys are relative to where you are facing.

| Key | Does |
|-----|------|
| `k` / `↑` | step forward |
| `h` `l` / `←` `→` | turn |
| `j` / `↓` and the diagonals | step back, strafe |
| Shift + direction | run |
| Ctrl + direction | attack |
| F12 | chat |

Every other physical key passes through to the server untouched. Menus,
prompts, targeting and text input take the same keys, in the same modes, with
the same results as WebTiles. Orbrun's own menu (settings, controls, save and
exit) is on the HUD; while spectating, Escape opens it.

### Gamepad (standard mapping)

- Left stick or d-pad: forward and back step, left and right turn, the
  diagonals strafe; hold to run. Right stick looks.
- **A** does what the situation calls for: takes the stairs underfoot, opens
  or closes the door ahead, attacks, picks up, steps.
- **B** cancels or backs out; in play it sends Escape.
- **X** autoexplores. In a menu, X describes the row under the cursor.
- **Y** opens the inventory.
- **LB** waits a turn; hold to rest.
- **R3** or **L3** (either stick clicked in) examines; the cursor opens on the cell ahead and the d-pad walks it.
- **RB** opens the Actions menu.
- **LT** fires your readied action; tap again to let it fly.
- **RT** autofights.
- **Select** opens the command menus (Travel, Equipment, Character); it comes
  back to the row you last chose.
- **Start** opens the Orbrun menu: resume, repeat, the game menu, help, chat,
  gamepad, settings, save and exit.

The action bar at the bottom of the screen always shows what each button does
in the current mode, because the server, not a guess, says what mode you are
in.

## Steam Deck

In Desktop Mode, open Konsole and run:

```sh
curl -fsSL https://orbrun.app/deck | sh
```

It installs a kiosk browser, grants it access to the controller, and adds
Orbrun to your Steam library with artwork. Nothing needs `sudo` and nothing
touches the read-only root filesystem; the script is safe to re-run. Once, in
Gaming Mode, set the controller layout template to **Gamepad with Joystick
Trackpad** so Steam passes the pad through instead of turning it into a mouse.

## Version support

Orbrun reads each server's own gamedata at connect time, so it follows current
stable and trunk without per-release work. A DCSS feature that arrives in a
new tile or enum renders as soon as the server publishes it; anything the
server does not publish draws nothing rather than guessing.

## Security and privacy

Orbrun has no accounts of its own. Your browser connects directly to the DCSS
server you choose over an encrypted WebSocket, exactly as the desktop WebTiles
client does. Your password goes only into the login message and is never
stored; a saved login keeps the server's login token, as the official client
keeps its cookie. Settings and tokens live in your browser's local storage and
go nowhere else.

Your rc options are read from the server, per account, per server, per game
version. Orbrun never caches or overrides them.

The hosted site at orbrun.app counts page views anonymously — no cookies, no
fingerprinting, nothing about your game — and relays the tile data your browser
needs from the server you picked. Your game traffic never passes through it.

## Not yet

Sound, the feel layer (sway, hit shake, vignettes), a desktop/Steam shell, and
offline play against a local engine.

## How it was built

Most of the code was written with Claude Code. The design, product decisions,
testing, and review were mine. The contract every change is held to:
match WebTiles, work with a controller, and never break the keyboard.

The source is at <https://github.com/Caeous/orbrun>, licensed under
[AGPL-3.0-or-later](LICENSE). See [ATTRIBUTION.md](ATTRIBUTION.md) for its
relationship to DCSS.

## Feedback

Comments, questions, and bug reports are welcome at
[GitHub issues](https://github.com/Caeous/orbrun/issues) or
<caeous@gmail.com>.
