# @orbrun/render-2d

A top-down Canvas 2D renderer of a `@orbrun/scene` `Scene`, drawing the
cells in the official client's layer order from any `TileSource`. `Render2d`
implements `MapRenderer`, so it is interchangeable with `@orbrun/render-3d`;
Orbrun also uses it for the minimap: `mode: 'minimap'` draws solid colour
blocks in the official client's minimap palette, and `'tiles'`, `'glyphs'`
and `'hybrid'` draw the level itself.

`horizontalFov(verticalDeg, aspect)` is here so a top-down view can draw the
same field-of-view wedge the first-person camera sees.

Depends on `@orbrun/scene`. Part of
[Orbrun](https://github.com/Caeous/orbrun). AGPL-3.0-or-later.
