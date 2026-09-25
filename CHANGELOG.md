# What's new

Notable changes to Orbrun, newest first.

## 0.2.0 — 2026-09-25

- Play on this device, with no server and no connection needed: under Add an account, pick This device, give your player a name, and play — the game runs in your browser.
- Everyone who shares the device can have a player of their own, each with their own game and saves.
- The game on your device keeps itself up to date: new versions download in the background and are ready the next time you press Play.
- Choosing a god at an altar works with the gamepad: Start joins, and the d-pad switches between the god's pages.
- Doors, statues and items no longer go missing on busy levels deeper in the game.
- Pressing up at the top of the title screen goes to your account; About & credits is one step right of it.
- Cleaner addresses you can share, like orbrun.app/watch/cdi/bob.

## 0.1.8 — 2026-09-23

- Menus now use the same font as the game, and it comes with Orbrun, so it looks the same on every device.
- Small text in the menus is bigger and easier to read, especially on a Steam Deck.
- If your connection drops mid-game, Orbrun puts you straight back into your game, with nothing to press. If the network stays down, you land on the menu with your game saved.
- A button pressed while the server closes your last session no longer stops your game from starting.
- The Watch list no longer skips players as you scroll through it.
- The gamepad controls sheet now lives under Settings > Controls, in two columns.

## 0.1.7 — 2026-09-22

- Smoke and the other clouds now drift over the monsters standing in them, instead of disappearing behind whoever is in the cell.
- Everything that stands — monsters, items, doors, statues, your own shadow — is now drawn straight from the art by the graphics card, one draw for a whole crowd, instead of being built as a little model each. Their thickness and dark outline are worked out as they draw, so nothing is built ahead of them either.
- Walls on a big level go up faster: cells whose surroundings look alike reuse the shape already worked out for them.

## 0.1.6 — 2026-09-21

- Arriving on a level no longer stalls on its statues, trees and stairs: their outlines were being read back off the art one row at a time. Nothing in the picture changed.
- The home screen offers Quit when Orbrun runs in its own window — a kiosk browser on a Steam Deck, or an installed app — where the browser gives you no way out. In a normal tab it stays hidden.

## 0.1.5 — 2026-09-20

- Monsters now walk between cells instead of jumping one to the next, gliding
  after their step the way your own view does.

## 0.1.4 — 2026-09-18

- Exploring no longer hitches: a step relights the level instead of rebuilding it, a newly seen cell rebuilds only what changed, and a crowd of sprites uploads only the sprites that moved. Nothing in the picture changed.
- A screen you leave stops everything it started: its timers, its fetches and a tile download the server left hanging.

## 0.1.3 — 2026-09-16

- Crowded levels no longer stutter: sprite updates cost 93–98 % less CPU and draw 46 % fewer triangles.

## 0.1.2 — 2026-09-16

- Crowded levels draw far faster: a hall full of monsters and items costs a dozen draw calls a frame instead of one per sprite, so the frame rate holds up on weak graphics.

## 0.1.1 — 2026-09-16

- Movement now glides between cells and comes to a clean stop, with consistent pacing on diagonals and across frame rates.
- Turning or looking during movement is no longer undone by a delayed movement reply.

## 0.1.0 — 2026-09-10 — first public release

Everything before this was pre-release development, so this entry is the whole
of what Orbrun does today.

- Play any public WebTiles server in first person: connect, log in or register,
  start a game or continue a saved one, or watch someone else's. Your account
  and your rc file stay the server's, honoured live, never cached or overridden.
- Everything the official client shows: menus, popups, prompts, `--more--`,
  the monster list, the stats pane, the message log, chat with spectators, the
  level map, the dungeon overview, and targeting.
- Full gamepad support: a contextual A button, tap-or-hold buttons, an action
  bar that always shows what each button does in the current mode, a menu per
  button (actions on LB, travel on Select, your gear on Y, your character and
  the game options on Start), an on-screen keyboard, and hints that teach the
  controls as you use them.
- Aiming on a controller: fire, examine, spells and wands open on the cell
  ahead, keep their heading while the d-pad walks the cursor, and repeat
  with repeated taps.
- Keyboard plays exactly as in the official client, with one exception:
  direction keys are relative to facing.
- A minimap, edge pips for monsters the camera does not frame (your own
  summons included), a wielded-weapon viewmodel, memory dimming, and threat
  and travel messages spelled the way crawl spells them.
- The front end stands in the Antechamber, a small hall built from the game's
  own tiles: main menu, accounts and servers, the Watch roster, settings, the
  changelog and about screens, and morgue files all read over it.
- Nothing version-specific is hardcoded. Enums, tile tables, and atlases come
  from the connected server at runtime, so stable and trunk both work.
- Multiple accounts across multiple servers, plus any server you add by URL.
  A dropped connection is reopened and logged back in on its own.
- Plays from your Steam library, on a Steam Deck, Windows, Linux or a Mac, as
  a non-Steam game that opens a kiosk browser on orbrun.app. The five steps,
  with artwork, are in STEAM.md and under About & credits.
- Hosted at orbrun.app: nothing to install, no Orbrun account, and tile data
  loads from whichever server you connect to.
- Anonymous page counts on the hosted site only — no cookies, nothing about
  your game — and nothing at all from local builds.
- Not yet: sound, the feel layer (sway, hit shake, vignettes), a desktop or
  Steam shell, offline play against a local engine. The top-down view
  exists but is not offered in this release.
