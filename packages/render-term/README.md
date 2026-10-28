# @orbrun/render-term

A first-person renderer of a `@orbrun/scene` `Scene` for terminals, drawn as
render-3d draws it. It takes render-3d's own level geometry (`level-mesh.ts`)
and sprite instances (`sprites.ts`) and rasterizes them on the CPU into a
small RGB buffer, shaded as render-3d's shaders shade them: colour in linear
light, each cell lit by the shade field, the flash washed over, the lid
receding into the dark, then encoded, with what blends blending on the
encoded values. The passes run in render-3d's order: the level and its
fixtures, the ghosts of what they hide, the crowd and its shadows, the
cursor, the decals and what is translucent, the hands.

A terminal shows a cell as 2x2 quadrant blocks, each about twice as tall as
it is wide, so `render` takes the pixel's shape (`pixelAspect`, 2 there). A
full-screen frame is a few milliseconds.

What so few pixels cannot carry is made simpler: textures are averaged as
they recede (mipmaps) where render-3d samples the nearest texel; a sprite is
its front face, without the texel-deep block behind it, and keeps the art's
own ink; a way up stands whole rather than folded; the hands are flat icons
at rest.

- `RenderTerm`: `setTiles(tiles, pixels)` (a `TileSource` and its atlases'
  RGBA), `setScene`, `setCursor`, `setViewmodel`, `setOptions` (render-3d's
  `fov`, `eyeHeight`, `wallInset`, `chamfer`, `viewmodel`),
  `render(camera, width, height, out, pixelAspect)`.

`npm run term:compare -- <dir> <out.png>` sets it beside render-3d on the
comparison bed's poses, `<dir>` being a `node tools/build/render-compare.mjs
capture` run.

Depends on `@orbrun/scene` and `@orbrun/render-3d` (its three-free modules).
Part of [Orbrun](https://github.com/Caeous/orbrun). AGPL-3.0-or-later.
