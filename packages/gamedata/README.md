# @orbrun/gamedata

Loads a DCSS WebTiles server's own version-specific data at runtime, the way
the official client does: `enums.js`, the `tileinfo-*.js` modules for every
atlas, `status-icon-sizes.js`, and the atlas images themselves. Nothing
version-specific is hardcoded, so stable and trunk both work and a new
release needs no update here.

- `loadGamedata({ base, version, io })` fetches and evaluates the modules
  and returns a `Gamedata`; `skipImages` leaves the atlases out for headless
  use, `onProgress` and `onDiagnostic` report along the way.
- `Gamedata` answers `tile(id, layer)` with the atlas and source rect of a
  tile, `atlas(name)` with its image, `tileCount(id)` with its variants, and
  `statusIconSize(id)` with how a status icon lays out. Its name indices
  (`dngn`, `main`, `player`, `icons`, `gui`) map `name(id)`, `id(name)` and
  `baseName(id)`; `ranges` gives each module's id span; `fg()` and `bg()`
  decode cell flag words with the server's own `prepare_fg_flags` and
  `prepare_bg_flags`; `enums` holds every enum table.
- `verifyEnums(gd, expected)` reports any enum value a client assumed that
  the server disagrees with, so fallback tables can be cross-checked at load.
- `browserIo()` is the default `GamedataFetch` for a browser; supply your own
  `fetchText` / `loadImage` pair in Node or behind a proxy.
- `TileId`, `TileRect` and `TileSource` are the tile-provider contract;
  `Gamedata` implements it, and `@orbrun/scene` declares the same shape
  without depending on this package.

Public servers serve gamedata without CORS headers, so a browser needs a
same-origin proxy in front of them; Orbrun's is `apps/orbrun/gamedata-proxy.ts`
in the repository.

No dependencies. Part of [Orbrun](https://github.com/Caeous/orbrun).
AGPL-3.0-or-later.
