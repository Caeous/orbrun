# About Orbrun

Orbrun is an unofficial [DCSS](https://crawl.develz.org) client that puts you
inside the dungeon. It plays on public
[WebTiles](https://crawl.develz.org/wordpress/howto) servers, or on your own
device with no server at all, and renders the game in first person, built to
be played with a gamepad on a handheld — the Steam Deck first.

If you play WebTiles, this is your game, your account, your rc file, and your
keys. Orbrun adds a 3D view and controller support on top; it does not ask you
to relearn anything.

## Getting started

Open [orbrun.app](https://orbrun.app), pick a server, and log in with your
existing WebTiles account — or register a new one, or spectate without an
account. Then start a game and play. There is nothing to install and no Orbrun
account: your browser talks to the DCSS server directly.

To play through Steam, on a Deck or a desktop, see [Add to Steam](STEAM.md)
for the five steps that put Orbrun in your library with artwork.

## Features

- **The real game on the real servers.** Orbrun is a WebTiles client, not a
  port: you log in to CDI, CDO or any other public server with your existing
  account. Your saves, rc file, macros, morgues and scoreboard entries are the
  server's, exactly as if you'd played in the official client. New versions
  and trunk work as soon as a server runs them.
- **First person.** The same level, drawn around you instead of from above.
  The map, the monster list, the stats and the message log are all still
  there.
- **Gamepad.** Autoexplore, autofight, rest, travel, your gear, casting,
  firing and examining are each one button away, and a bar shows what each
  button does in the current mode. An on-screen keyboard covers prompts,
  inscriptions and chat.
- **Keyboard unchanged, with one exception.** Direction keys are relative to
  the way you're facing: `k` steps forward, `h` and `l` turn. Every other key
  goes to the server untouched.
- **Offline.** Play with no server at all: the current release or trunk runs
  in your browser, and the saves stay on that device. These games don't
  reach a scoreboard.
- **Spectating**, in first person, from a link you can share.
- **Made for the Steam Deck, and runs great on it.** It stops drawing
  whenever nothing on screen is moving. Add Orbrun to Steam as a non-Steam
  game, or install it as an app.

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
the same results as WebTiles. Orbrun's own menu (character, settings, controls,
save and exit) is on the HUD; while spectating, Escape opens it.

### Gamepad (standard mapping)

- Left stick or d-pad: forward and back step, left and right turn, the
  diagonals strafe; hold to run. Right stick looks.
- **A** does what the situation calls for: takes the stairs underfoot, opens
  or closes the door ahead, attacks, picks up, steps.
- **B** cancels or backs out; in play it sends Escape.
- **X** waits a turn; hold to rest. In a menu, X describes the row under the cursor.
- **Y** opens the gear menu, your pack at the top of it.
- **LB** opens the Actions menu.
- **RB** fires your readied action; tap again to let it fly.
- **LT** autoexplores.
- **RT** autofights.
- **R3** or **L3** (either stick clicked in) examines; the d-pad walks the cursor and A describes what it is on.
- **Select** opens the travel commands; each menu comes back to the row you
  last chose.
- **Start** opens the Orbrun menu, on two tabs: Character (skills, spells,
  status, religion and the rest) and System (resume, repeat, the game menu,
  help, chat, gamepad, settings, save and exit).

The action bar at the bottom of the screen always shows what each button does
in the current mode, because the server, not a guess, says what mode you are
in.

## Add to Steam

Orbrun runs from your Steam library, on a Steam Deck, Windows, Linux or a Mac,
as a non-Steam game that opens a kiosk browser on orbrun.app. Five steps, no
script to run: see [STEAM.md](STEAM.md).

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

## How it was built

Most of the code was written with Claude Code. The design, product decisions,
testing, and review were mine. The contract every change is held to:
match WebTiles, work with a controller, and never break the keyboard.

Thanks to [PocketZot](https://pocketzot.app/about), the DCSS client for phones,
for inspiring parts of Orbrun and for feedback.

The source is at <https://github.com/Caeous/orbrun>, licensed under
[AGPL-3.0-or-later](LICENSE). See [ATTRIBUTION.md](ATTRIBUTION.md) for its
relationship to DCSS.

## Feedback

Comments, questions, and bug reports are welcome at
[GitHub issues](https://github.com/Caeous/orbrun/issues) or
<caeous@gmail.com>.
