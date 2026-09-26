# About Orbrun

Orbrun is an unofficial [DCSS](https://crawl.develz.org) client that puts you
inside the dungeon. It plays on the public
[WebTiles](https://crawl.develz.org/wordpress/howto) servers, or on your own
device with no server at all. It draws the game in first person and is built
to be played with a gamepad on a handheld, the Steam Deck first.

If you play on WebTiles, you keep your game, your account, your rc file and
your keys. Orbrun adds a 3D view and controller support on top, and asks you
to relearn nothing.

## Getting started

Open [orbrun.app](https://orbrun.app) and pick a server. Log in with your
WebTiles account, register a new one, or spectate without one. Then start a
game. There is nothing to install and no Orbrun account: your browser talks
to the DCSS server directly.

To play from Steam, on a Deck or a desktop, [Add to Steam](STEAM.md) has the
five steps that put Orbrun in your library, artwork included.

## Features

- **The real game on the real servers.** Orbrun is a WebTiles client, not a
  port. You log in to CDI, CDO or any other public server with the account
  you already have. Your saves, rc file, macros, morgues and scoreboard
  entries live on the server, just as they do in the official client. New
  releases and trunk work as soon as a server runs them.
- **First person.** The same level, drawn around you instead of from above.
  The map, the monster list, the stats and the message log are all still
  there.
- **Gamepad.** Autoexplore, autofight, rest, travel, your gear, casting,
  firing and examining are each one button away, and a bar shows what each
  button does right now. An on-screen keyboard covers prompts, inscriptions
  and chat.
- **The keyboard you know, with one change.** Direction keys are relative to
  the way you face: `k` steps forward, `h` and `l` turn. Every other key goes
  to the server untouched.
- **Offline.** Play with no server at all. The current release or trunk runs
  in your browser, and your saves stay on your device. Offline games don't
  reach a scoreboard.
- **Spectating**, in first person, from a link you can share.
- **Made for the Steam Deck.** Orbrun stops drawing whenever nothing on screen
  moves. Add it to Steam as a non-Steam game, or install it as an app from the
  browser.

## Controls

### Keyboard

Every key works as it does in the official client, except that direction
keys are relative to where you are facing.

| Key | Does |
|-----|------|
| `k` / `↑` | step forward |
| `h` `l` / `←` `→` | turn |
| `j` / `↓` and the diagonals | step back, strafe |
| Shift + direction | run |
| Ctrl + direction | attack |
| F12 | chat |

All other keys go straight to the server. Menus, prompts, targeting and text
input take the same keys, in the same modes, with the same results as on
WebTiles. Orbrun's own menu (character, settings, controls, save and exit) is
on the HUD; while spectating, Escape opens it.

### Gamepad (standard mapping)

- Left stick or d-pad: forward and back step, left and right turn, the
  diagonals strafe; hold to run. The right stick looks around.
- **A** does what the situation calls for: takes the stairs you're standing
  on, opens or closes the door ahead, attacks, picks up, or steps.
- **B** cancels or backs out; in play it sends Escape.
- **X** waits a turn; hold it to rest. In a menu, X describes the row under
  the cursor.
- **Y** opens the gear menu, with your pack at the top.
- **LB** opens the Actions menu.
- **RB** aims your quivered action; press it again to fire.
- **LT** autoexplores.
- **RT** autofights.
- **R3** or **L3** (click either stick) examines: the d-pad moves the cursor
  and A describes what's under it.
- **Select** opens the travel commands. Every menu reopens on the row you
  last chose.
- **Start** opens the Orbrun menu, which has two tabs: Character (skills,
  spells, status, religion and the rest) and System (resume, repeat, the game
  menu, help, chat, gamepad, settings, save and exit).

The action bar at the bottom of the screen always shows what each button does
in the current mode. It never guesses the mode: the server reports it.

## Add to Steam

Orbrun goes into your Steam library, on a Steam Deck, Windows, Linux or a
Mac, as a non-Steam game that opens a browser in kiosk mode on orbrun.app. It
takes five steps and no script: see [STEAM.md](STEAM.md).

## Version support

Orbrun reads each server's own game data when it connects, so it keeps up
with stable and trunk without any work per release. A new tile or enum shows
up as soon as the server publishes it. Anything the server doesn't publish is
left undrawn rather than guessed at.

## Security and privacy

Orbrun has no accounts of its own. Your browser connects straight to the DCSS
server you choose, over an encrypted WebSocket, just as the official WebTiles
client does. Your password is sent only in the login message and is never
stored. Saving a login keeps the server's login token, the same way the
official client keeps a cookie. Settings and tokens stay in your browser's
local storage and go nowhere else.

Your rc options are read from the server for each account, server and game
version. Orbrun never caches or overrides them.

The hosted site at orbrun.app counts page views anonymously (no cookies, no
fingerprinting, nothing about your game) and relays the tile data your
browser needs from the server you picked. Your game traffic never passes
through it.

## How it was built

Most of the code was written with Claude Code. The design, product decisions,
testing and review were mine. Every change is held to the same three rules:
match WebTiles, work with a controller, and never break the keyboard.

Thanks to [PocketZot](https://pocketzot.app/about), the DCSS client for
phones, for inspiring parts of Orbrun and for feedback.

The source is at <https://github.com/Caeous/orbrun>, licensed under
[AGPL-3.0-or-later](LICENSE). [ATTRIBUTION.md](ATTRIBUTION.md) explains how
it relates to DCSS.

## Feedback

Comments, questions and bug reports are welcome on
[GitHub issues](https://github.com/Caeous/orbrun/issues) or at
<caeous@gmail.com>.
