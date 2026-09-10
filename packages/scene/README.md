# @orbrun/scene

The renderer-facing model of a DCSS level, with no knowledge of where it came
from and no dependency on anything: a `Scene` of `SceneCell`s (kind, tiles,
feature, visibility, shade) and `Billboard`s (monsters, items, clouds, the
player), a `Camera`, a `Viewmodel` for what is held, and the contracts a
renderer and a tile provider have to meet (`MapRenderer`, `TileSource`).

Also here, because every consumer needs them:

- Directions: `Dir8`, `dirFromDelta`, `rotateDir`, `dirToYaw`, `yawToDir`,
  `normalizeYaw`, `yawDelta`.
- Cell keys: `cellKey`, `keyToXY`, `getCell`, `cellAhead`, `cellUnder`,
  `isWalkable`, `bearingTo`.
- Queries over billboards: `billboardsAt`, `monstersInView`, `isThreat`,
  `nearestHostile`, `blocksExplore`, `nearestBlocker`, `nearestOf`.
- Layout change detection for renderers that rebuild geometry only when the
  level changes: `cellLayoutEquals`, `sceneLayoutEquals`.
- Camera placement for a third-person or orbit shot: `orbitShot`,
  `cameraApproach`, `makeCamera`, `REST_PITCH`.
- `bars.ts`: the health and magic minibar rules ported from the official
  client's cell renderer (`woundLevel`, `minibarRects`, `fillRun`, colours).

`@orbrun/scene-webtiles` builds a `Scene` from a live game;
`@orbrun/vault` builds one from a `.des` file; `@orbrun/render-2d` and
`@orbrun/render-3d` draw one.

No dependencies. Part of [Orbrun](https://github.com/Caeous/orbrun).
AGPL-3.0-or-later; see the repository's ATTRIBUTION.md for `bars.ts`.
