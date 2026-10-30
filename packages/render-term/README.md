# @orbrun/render-term

A first-person renderer of a `@orbrun/scene` `Scene` for terminals, drawn as
render-3d draws it. It takes render-3d's own level geometry (`level-mesh.ts`)
and sprite instances (`sprites.ts`) and rasterizes them on the CPU into an
RGB buffer, which the terminal shows as a kitty graphics image, shaded as
render-3d's shaders shade them: colour in linear light, each cell lit by the
shade field, the flash washed over, the lid receding into the dark, then
encoded, with what blends blending on the encoded values. The passes run in
render-3d's order: the level and its fixtures, the ghosts of what they hide,
the crowd and its shadows, the cursor, the decals and what is translucent,
the hands.

`render` takes the pixel's shape (`pixelAspect`), for a picture stretched to
cells it does not exactly fit. It can draw a band of the frame's rows alone,
for several renderers on threads each to draw one, and take its atlases
already in linear light (`linearAtlas`), in memory they share.

What render-3d does on the GPU is done the same way here: textures sampled
at the nearest texel; each standing sprite a block a texel deep, the view
ray marched through its texel grid (SPRITE_FRAG), with crawl's ink peeled
off the art (render-3d's `peel`) and put back as the hull round the block,
the wider shell round the one the cursor is on, a ring round a ghost; a way
up folded where its steps meet its side; the hands blocks in their own
lens, posed as render-3d poses them, the weapon lifting for a swing; the
monsters gliding between cells (render-3d's `Movers`, kept by the host and
handed to `render` each frame as `Motion`).

- `RenderTerm`: `setTiles(tiles, pixels, linear?)` (a `TileSource`, its
  atlases' RGBA, and those atlases in linear light where they are made
  already, as the level draws them or peeled as the sprites do),
  `setScene`, `setCursor`, `setViewmodel`, `setOptions` (render-3d's `fov`,
  `eyeHeight`, `wallInset`, `chamfer`, `viewmodel`), `render(camera, width,
  height, out, pixelAspect, rows?, motion?)`.
- `linearAtlas(pixels)`: an atlas in linear light; `spriteAtlas(pixels,
  spriteRects?)`: the same with its ink peeled and its distance field.

`npm run term:compare -- <dir> <out.png>` sets it beside render-3d on the
comparison bed's poses, `<dir>` being a `node tools/build/render-compare.mjs
capture` run.

Depends on `@orbrun/scene`, `@orbrun/world` and `@orbrun/render-3d` (its
three-free modules).
Part of [Orbrun](https://github.com/Caeous/orbrun). AGPL-3.0-or-later.
