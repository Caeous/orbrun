# @orbrun/render-3d

A first-person (and third-person) [three.js](https://threejs.org) renderer of
a `@orbrun/scene` `Scene`: walls as inset masonry, floors and ceilings,
standing features, doors, water and lava, monsters and items as billboards
that face the camera (each a shallow block with a shaded rim, like the hands),
memory dimming, a viewmodel for what is held, ghost
badges for what geometry hides, and a cursor. Geometry is rebuilt only when
the level's layout changes (`sceneLayoutEquals`), so a frame at rest costs
nothing.

- `Render3d` implements `MapRenderer`: `mount`, `setTiles`, `setScene`,
  `setCamera`, `setCursor`, `render`, `pick`, `resize`, `destroy`.
- `footprint.ts`: the inset-wall geometry (`insetFootprint`, `bodyRect`,
  `inPoly`, `WALL_INSET`), pure functions over a `ClassAt` oracle so they are
  testable without WebGL.
- `hands.ts`: where the viewmodel's weapon, off-hand and shield rest
  (`handsFootprint`).
- `gridWalk`: the cells a ray crosses, for picking and line of sight.

Depends on `@orbrun/scene`; `three` is a peer dependency. Part of
[Orbrun](https://github.com/Caeous/orbrun). AGPL-3.0-or-later.
