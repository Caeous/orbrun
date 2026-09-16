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
- `crowd.ts`: the baked crowd. Standing sprites are merged into a few meshes
  per 16-cell chunk of the level, with persistent buffers written in place,
  conservative bounding spheres for frustum culling, and blended batches
  ordered back to front by chunk each frame.
- `mesh.ts`: exact merging of one-colour texel faces (the hulls, the ghost
  rings, the hands' ink) into rectangles and runs; textured rim faces merge
  only where neighbouring texels hold the very same colour.
- `Render3d.stats`: work counters (sprites built and dropped, chunks baked
  and allocated, vertices written, selection and field updates) for the
  test bed and the regression tests.

The crowd is synced against each scene, not rebuilt: a billboard is keyed by
everything its meshes are built from, and one the next scene carries again is
left standing. Sprites take their light from the shade field, so a step that
relights the crowd repaints a small texture and no geometry. The cursor's
selected shell is a holder of its own beside the crowd, so moving the cursor
touches nothing else. `destroy()` releases everything the renderer made.

Depends on `@orbrun/scene`; `three` is a peer dependency. Part of
[Orbrun](https://github.com/Caeous/orbrun). AGPL-3.0-or-later.
