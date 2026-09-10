# Attribution and licensing

Orbrun is an independent, unofficial client for Dungeon Crawl Stone Soup
(DCSS). It speaks the WebTiles protocol to standard DCSS servers and renders
the dungeon in first person. It is not affiliated with or endorsed by the DCSS
development team.

Copyright (C) 2026 the Orbrun developer.

Licensed under the GNU Affero General Public License, version 3 or (at your
option) any later version (AGPL-3.0-or-later). See [LICENSE](LICENSE) for the
full text.

## Relationship to DCSS

Orbrun connects to standard DCSS WebTiles servers and speaks the same
WebSocket protocol as the official client. This repository contains none of
the DCSS game engine: gameplay runs entirely on the server. Nothing
version-specific is shipped either — tile ids, enums, flag masks and atlases
are loaded at runtime from the connected server's own `/gamedata/<version>/`
files, exactly as the official client loads them.

DCSS is Copyright 1997–2025 Linley Henzell, the dev team, and contributors,
licensed under the GNU General Public License, version 2 or (at your option)
any later version. Orbrun's AGPL-3.0-or-later license is compatible with this
through that "or later" option: the DCSS-derived material below is taken
forward to GPLv3 and combined into this AGPLv3 work as AGPLv3 section 13
permits.

## Interoperability constants

The items below carry numeric values that must match the DCSS server exactly,
or the client mis-sends keys and mis-renders cells. They are fixed by the DCSS
wire protocol and reproduced from the DCSS WebTiles client purely as a
protocol-interoperability requirement.

| File | Derived from (DCSS) | What |
|------|---------------------|------|
| `packages/webtiles/src/protocol.ts` | `key_conversion.js`, `cio.h` | Special keycodes sent to the server (arrows, F1–F19, keypad) |
| `packages/webtiles/src/protocol.ts` | `tileweb.h`, `map-feature.h`, `enums.js` | Mouse-mode and minimap feature-category values |
| `apps/orbrun/src/keys.ts` | `key_conversion.js` | Browser key → DCSS keycode tables, keyed by `which` |
| `packages/scene-webtiles/src/index.ts` | `enums.js` (`MF_*`, `HALO_*`, cell flag masks) | Fallback tables, cross-checked against the server's own `enums.js` at load and warned about on mismatch |
| `packages/webtiles/src/format.ts`, `packages/render-2d/src/index.ts` | The official WebTiles stylesheet | The 16-colour terminal palette (the standard IBM CGA/VGA set, not specific to DCSS) |
| `packages/render-2d/src/index.ts` | `minimap.js` — `init_options` | Default minimap colour palette, indexed by map-feature category |

## Tile art in the front room

The front end's room (`apps/orbrun/src/room/antechamber.des`) is drawn from
a handful of DCSS's own tiles, packed into `apps/orbrun/public/room/` by
`tools/build/pack-room.mjs` from one pinned gamedata version (named in that
tool; `atlas.json` records it and the source of every tile). This is the one
place Orbrun ships tile art of its own rather than loading the connected
server's: the room is a build asset the menus stand in before any server is
spoken to, and gameplay never draws from it. Orbrun's mark is the Orb of
Zot's tile of that same version, cut from its `main.png` into
`apps/orbrun/public/orb.png`: it stands beside the name on the title screen,
and `tools/build/brand.mjs` builds the favicon, the README's wordmark and the
Steam artwork from it. DCSS's tile art (`rltiles`) is released under CC0 by
the DCSS team and its artists.

The name beside it is set in Grenze Gotisch Bold by Omnibus-Type, under the
SIL Open Font License 1.1 (`assets/fonts/OFL.txt`): the title screen loads
`apps/orbrun/public/fonts/grenze-gotisch-700-latin.woff2`, and the brand tool
outlines the word from `assets/fonts/GrenzeGotisch-Bold.ttf` so the wordmark
and artwork need no font installed to render.

## Derived from the DCSS WebTiles client

These files port portions of the official WebTiles client to TypeScript,
following its structure, draw order, and key handling. The presentation
differs (first person, HUD, action bar); the behaviour being reproduced is the
official client's.

| File | Ported from (DCSS WebTiles) | What |
|------|-----------------------------|------|
| `packages/scene-webtiles/src/index.ts` | `cell_renderer.js` — `draw_background`, `draw_foreground`, `draw_dolls` | Cell composition, cursor order, status-icon order and `status_shift`, player-doll/mcache layer composition |
| `packages/scene-webtiles/src/index.ts` | `monster_list.js` — `monster_sort`, `is_excluded`, `group_monsters`, attitude/threat classes | Monster ordering, exclusion predicate, grouping, attitude and threat classification |
| `packages/scene/src/bars.ts` | `cell_renderer.js` — `draw_minibars`, `determine_colours` | Health/magic minibar geometry, colours, and the "don't draw when full" rule |
| `packages/scene/src/index.ts` | `monster_list.js`, `map-feature.h` | Attitude and wound class names carried by the scene model |
| `packages/render-2d/src/index.ts` | `cell_renderer.js` — `render_cell`; `minimap.js` — `update` | Top-down cell draw order; minimap feature → colour lookup |
| `apps/orbrun/src/overlays.ts` | `menu.js` — `update_more`, `handle_size_change`, `update_visible_indices`, `scroll_to_item`, `snap_in_page`, `update_server_scroll`, `set_hovered`, `title_prompt`; `input.js` | Server menu layout, paging, hover, scroll reporting, title prompts, and key routing |
| `apps/orbrun/src/menu-nav.ts` | `menu.js` — `menu_keydown_handler`, `menu_keypress_handler`, `item_selectable`, `next_hoverable_item`, `get_/set_relative_hover`, `line_up`, `line_down`, `snap_hover_in_page`, `raw_arrow_keys`, `menu_has_custom_dash`; `ui-layouts.js` — `scroller_handle_key` | Menu and popup key semantics |
| `apps/orbrun/src/grid/stats.ts` | `player.js` — `update_bar`, `update_bar_noise`, `update_stat`, `update_defense`, `percentage_color`, `stat_class`, `stat_boosters`, `wielded_weapon` | The stats pane: row order, captions, bar segments, and colour rules |
| `apps/orbrun/src/grid/console.ts` | `game.js` — `layout`, `handle_set_layout`, `toggle_full_window_dungeon_view`, `stat_width`, `show_diameter`; `messages.js` — `message_pane_height` | Console pane geometry and the level-map layout |
| `apps/orbrun/src/grid/messages.ts`, `apps/orbrun/src/overlays.ts` | `messages.js` | Message-pane scroll behaviour and the `--more--` prompt |
| `apps/orbrun/src/hud.ts` | `monster_list.js` — `update`; `cell_renderer.js` — `render_cell`, `draw_quantity`; `player.js`; `mouse_control.js` — `show_tooltip`; `game.js` | Monster list rows and limits, the player/monster cell portrait, item quantity marks, cell tooltips |
| `apps/orbrun/src/chat.ts` | `chat.js`, `client.html` — `receive_message`, `toggle`, `toggle_entire_chat`, `focus`, `chat_message_send`, history and linkify | The chat box: caption, history, send/close keys, link handling |
| `apps/orbrun/src/game.ts` | `game.js` — `set_ui_state`, `init_custom_text_colours`, `layout`; `mouse_control.js`; `dungeon_renderer.js` — `handle_mouse`; `ui.js`; `menu.js` | UI-state layers, rc colour overrides, `tile_web_mouse_control` semantics, tooltip and popup pointer rules |
| `apps/orbrun/src/runner.ts` | `mouse_control.js`; `tileweb.cc`; `travel.cc` — `_adjacent_cmd` | Cell-click message shape and button numbering; what a click-travel does not act on |
| `apps/orbrun/src/keys.ts` | `key_conversion.js`, `client.js` | Which keys the browser keeps (F11, F12) and which reach the server |

## Derived from the DCSS engine and server

| File | Derived from (DCSS) | What |
|------|---------------------|------|
| `packages/webtiles/src/state.ts` | `tileweb.cc` — `redraw`, `_send_cell`, `_send_item`, `push_ui_cutoff`; `messages.js`; `menu.js`; `game.js`; `ui.js`; `chat.js`; `travel.cc` | Reducer semantics: message ordering, the UI cutoff stack, item and cell field meanings, travel-trail rules |
| `packages/scene-webtiles/src/index.ts` | `tileweb.cc` — `_send_cell` | Which fields a cell carries and what a missing field means |
| `apps/orbrun/src/warnings.ts` | `tileweb.cc` — `_send_monster` (`monster_info::full_name`) | Monster naming for threat messages |
| `packages/gamedata/src/index.ts` | `tileweb.h`; the server's `enums.js`, `tileinfo-*.js` and `status-icon-sizes.js` | UI-state values; the runtime loader for the server's own gamedata |

## Independently implemented

The rest of the codebase is an independent implementation written against the
observed wire protocol and the behaviour of the official client: the WebSocket
connection layer, the tolerant reducer's own structure, the scene model
(`packages/scene`), the first-person renderer (`packages/render-3d`) and every
rendering decision in it, the HUD layout, the gamepad system and action bar,
the on-screen keyboard, the command menus, the server picker and lobby,
settings, the front room and the `.des` subset compiler it is written in
(`packages/vault`, an independent parser of a documented format), the build
tools, and the Steam Deck installer.

## Third-party assets and dependencies

- [three.js](https://threejs.org) (MIT): the 3D renderer, the one runtime
  dependency.
- Grenze Gotisch by Omnibus-Type (SIL Open Font License 1.1,
  `assets/fonts/OFL.txt`): the title face, as described above.
- Tile art and atlases for gameplay are **not** distributed here. They are
  fetched at runtime from the connected DCSS server, which serves its own
  copies. DCSS tiles are by the DCSS contributors under the licenses stated
  in the DCSS source tree (`crawl-ref/source/rltiles/`); the few packed into
  the front room's atlas are CC0, as described above.
- The hosted site loads Cloudflare Web Analytics' beacon script when a token
  is set at build time (`apps/orbrun/src/analytics.ts`); a local build loads
  nothing.
- Build and test tooling (TypeScript, Vite, Vitest, happy-dom, wrangler,
  opentype.js, ws) under their own licenses, none of it shipped to players.
