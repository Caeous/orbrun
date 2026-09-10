# @orbrun/scene-webtiles

Turns a `@orbrun/webtiles` `GameState` plus the server's `@orbrun/gamedata`
into a `@orbrun/scene` `Scene`. This is where all of Orbrun's knowledge of
DCSS lives: which tile ranges are walls, floors, doors, stairs, water and
lava; how a cell's flags become cursors, halos and status icons; which
monsters the monster list shows, in what order, grouped how; what the player
is holding.

- `buildScene(state, gd, opts)`: the whole thing, incremental when given the
  previous scene.
- `classifyFeature`, `stanceFor`, `levelPresentation`, `itemTileName`,
  `isVegetation`, `isScenery`: the classification rules, exported so a
  renderer or HUD can ask the same questions.
- `isExcludedFromList`, `monsterSort`, `visibleMonsters`, `monsterGroups`:
  the official client's monster list rules.
- `viewmodelFor(state, gd)`: the wielded weapon, off-hand and shield.
- `missingTileNames(gd)`: which names this package expects that a server's
  tileinfo lacks, for a diagnostic at connect time.

The fallback enum tables (`MF_*`, `HALO_*`, cell flag masks) are
cross-checked against the connected server's own `enums.js` at load, and a
mismatch is reported rather than silently trusted.

Depends on `@orbrun/webtiles`, `@orbrun/gamedata`, `@orbrun/scene`. Tested
against a recorded cell dump and a checked-in copy of one gamedata version's
tileinfo modules. Part of [Orbrun](https://github.com/Caeous/orbrun).
AGPL-3.0-or-later; see the repository's ATTRIBUTION.md for what follows the
official client's `cell_renderer.js` and `monster_list.js`.
