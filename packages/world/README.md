# @orbrun/world

What stands where in a `@orbrun/scene` `Scene`, for every renderer that draws
the level in first person: render-3d in the browser, the glyph view in a
terminal. It answers what is in the world and leaves how to draw it
(projection, sampling, sprite facing, cells, anything for speed) to the
renderer, so the two cannot drift apart on the rules. Pure functions over
the scene, no GL, no DOM.

- `footprint.ts`: the inset walls (rendering-3d.md II.1). A wall's surface
  stands `WALL_INSET` back from the floor round it, the offset of the floor
  in Chebyshev distance: `bodyRect` (the body's rectangle and its corner
  cuts), `insetFootprint` (its outline and exposed faces), `insetOracle`
  (the literal definition, for checking), `sceneClassAt`, `asciiClassAt`,
  `inPoly`, pure functions over a `ClassAt` oracle.
- `cells.ts`: what a cell is to those rules. `cellClass` and
  `levelClassAt` (void, floor, wall; a door in its doorway is floor, open or
  closed, so the walls either side stand back from it); `floorLayers`
  (underlays, the feature where it lies painted on the floor, overlays less
  crawl's wall shadows and shorelines, which read as seams beside a wall
  standing back, and the cell's marks: travel arrows, exclusion on an unseen
  cell, badges, WebTiles' cursors); `faceTile` (the tile a wall's face
  toward a side wears); `insetStrips` and `stripAt` (what a wall's body leaves of its cell, and
  the open cell whose floor and lid reach each part, as polygons and at a
  point).
- `doors.ts`: `framedDoors` (the doors hanging in a doorway and the heading
  their run gives them), `occupiedFeatures` (upright features something
  stands on, which lie down instead), `featureStance` (whether a cell's
  feature stands, stands in its doorway, lies in its cell, or is painted on
  the floor), and `doorBoard` with `boardAlong` and `boardTexel`: a door in
  its doorway stretched to the walls standing back either side, its ends as
  they are, a block the run's thickness closed and a board in the run's
  face open, its art's left at the run's west end (south, running
  north–south) from either side.
- `hands.ts`: where the held weapon, off-hand and shield rest in their own
  lens (`VM_*` poses, `VM_SIZE`, `VM_FILL`), how a phone held upright shrinks
  them (`handsScale`, `scaledPose`), what of the view they cover
  (`handsFootprint`), and the swing (`liftEnvelope`, `VM_LIFT`,
  `VM_LIFT_S`).
- `motion.ts`: the monsters mid-step (`Movers`). WebTiles sends no move
  message, so a step is read as a monster's client id changing cell between
  two scenes; only a single step glides, and a blink, a teleport or a burst
  of turns snaps. Player and monster timing share `scene/motion.ts`:
  isolated steps take 100 ms; repeated steps adapt to arrival cadence
  within 100–140 ms, carrying speed and braking late. Only confirmed cells
  are followed, including corners; bursts are caught up to at most two
  steps behind and stalled replies always leave the sprite stopped at its
  last cell.
- `things.ts`: what stands, one list for every renderer (`Standing`):
  `crowd` (the monsters, items, missiles and clouds: their layers and
  badges, height, glide, alpha, lift, whether they lie, are shown through
  walls or cast a shadow, a monster's name, crawl's glyph and colour for
  the cell) and `fixtures` (the level's features by `featureStance`,
  `FIXTURE_H` tall, stairs `STAIR_H`). render-3d stands them as sprite
  instances, the glyph view as its `Thing`s.
- `marks.ts`: the cursor: WebTiles' icon for it where the tiles have it,
  else a ring, a diamond band `RING_INNER`..`RING_OUTER` round the cell's
  middle in its mode's colour (`cursorColour`), its coverage of a pixel as
  the shader works it (`ringCover`).

Depends on `@orbrun/scene`. Part of [Orbrun](https://github.com/Caeous/orbrun).
AGPL-3.0-or-later.
