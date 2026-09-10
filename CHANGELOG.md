# What's new

Notable changes to Orbrun, newest first.

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
  bar that always shows what each button does in the current mode, command
  menus for travel, equipment, character and actions, an on-screen keyboard,
  and hints that teach the controls as you use them.
- Aiming on a controller: fire, examine, spells and wands open on the cell
  ahead, keep a compass heading while the d-pad walks the cursor, and repeat
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
- Steam Deck install: `curl -fsSL https://orbrun.app/deck | sh` in Desktop Mode
  sets up a kiosk browser with controller access and adds Orbrun to your Steam
  library with artwork.
- Hosted at orbrun.app: nothing to install, no Orbrun account, and tile data
  loads from whichever server you connect to.
- Anonymous page counts on the hosted site only — no cookies, nothing about
  your game — and nothing at all from local builds.
- Not yet: sound, the feel layer (sway, hit shake, vignettes), a desktop or
  Steam shell, offline play against a local engine. The third-person and
  top-down views exist but are not offered in this release.
