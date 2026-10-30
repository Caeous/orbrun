# @orbrun/render-3d

A first-person [three.js](https://threejs.org) renderer of
a `@orbrun/scene` `Scene`: walls as inset masonry, floors and ceilings,
standing features, doors, water and lava, monsters and items as billboards
that face the camera (each a shallow block with a shaded rim, like the hands),
memory dimming, a viewmodel for what is held, ghost
badges for what geometry hides, and a cursor. Geometry is rebuilt only when
the level's layout changes (`sceneLayoutEquals`), so a frame at rest costs
nothing.

- `Render3d` implements `MapRenderer`: `mount`, `setTiles`, `setScene`,
  `setCamera`, `setCursor`, `render`, `pick`, `resize`, `destroy`.
- `setScene(scene, now)` observes movement at arrival; `render(now)` and
  `monsterPosition(billboard, now)` sample the same presentation clock (seconds).
  The app uses it to synchronise the camera's walk with the monsters;
  omitting the timestamps keeps the standalone renderer on `performance.now()`.
  `resetMotion()` drops old-level or parked-view movement without rebuilding
  the standing crowd.
- The rules of what stands where, which the glyph view shares, are
  `@orbrun/world`'s: the inset walls, the doors in their doorways, what a
  cell's floor shows, the hands' poses, and the monsters' glides
  (`Movers`). `grid.ts` (`LevelGrid`) reads a scene into a dense grid by
  them, `level-mesh.ts` and `sprites.ts` build from them.
- `gridWalk`: the cells a ray crosses, for picking and line of sight.
- `crowd.ts`: the baked crowd. Standing sprites are merged into a few meshes
  per 16-cell chunk of the level, with persistent buffers written in place,
  conservative bounding spheres for frustum culling, and blended batches
  ordered back to front by chunk each frame.
- The monsters mid-step (world's `Movers`): a sprite in flight stands out of
  the baked crowd for the length of its step and goes back into it on
  landing, so moving it every frame never rewrites a chunk's buffers.
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

Depends on `@orbrun/scene` and `@orbrun/world`; `three` is a peer dependency. Part of
[Orbrun](https://github.com/Caeous/orbrun). AGPL-3.0-or-later.
