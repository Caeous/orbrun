/**
 * Peeling crawl's ink off the art (`Render3d.atlasMask`). Its own module so
 * the worker that does it off the frame (peel.worker.ts) carries this and
 * nothing else: the renderer, and three with it, stays on the main thread.
 */

/**
 * The art's ink: an opaque texel this dark in every channel is the black line
 * crawl draws round a sprite and the shadow it paints at its feet, not the
 * body of the thing.
 */
const INK_LEVEL = 24
/**
 * The ink the eye can reach from outside a sprite is peeled off before the
 * atlas is drawn (`atlasMask`), up to this many texels deep. 2D needs that
 * line to tell a monster from the cell it stands on; in 3D the thing stands in
 * the world, lit and cast on the floor by its own shadow, and the line is a
 * black band round it that gains depth with the block, stands up where the art
 * painted a shadow at its feet, and fills the holes the art leaves. Peeling
 * eats only ink, so a body texel stops it: the eyes, the mouth and the lines
 * drawn inside a sprite are not reachable and stay. Deep enough for the
 * shadow crawl paints at a monster's feet, shallow enough that a sprite drawn
 * in ink all through keeps most of itself.
 */
const INK_PEEL = 4

/**
 * Peel the art's outline off `data` in place: the ink the eye can reach from
 * outside is cleared, `INK_PEEL` layers deep, and what is left comes back as
 * opacity, one byte per texel. Peeling eats only ink, so a body texel stops
 * it: the eyes, the mouth and the lines drawn inside a sprite are not
 * reachable and stay. `alphaMin` is the alpha at which a texel counts as
 * drawn at all.
 *
 * `sprites`, when given, is where the sprite art is (`TileSource.spriteRects`):
 * only ink inside those rects is peeled, and the edge of a rect reaches it as
 * the image's edge does. Crawl's atlases hold one kind each, so its sprite
 * atlases are peeled whole and its floor and wall atlases never asked; an
 * atlas that packs floors beside sprites would otherwise lose the dark edge
 * of a floor tile that touches a gap or the image's border, and show the
 * clear colour through the floor as a black line between cells.
 */
export function peelInk(data: Uint8ClampedArray, w: number, h: number, alphaMin: number, sprites?: ReadonlyArray<{ sx: number; sy: number; w: number; h: number }>): Uint8Array {
  // 0 clear, 1 body, 2 ink
  const mask = new Uint8Array(w * h)
  for (let i = 0; i < mask.length; i++) {
    if (data[i * 4 + 3] < alphaMin) mask[i] = 0
    else mask[i] = data[i * 4] < INK_LEVEL && data[i * 4 + 1] < INK_LEVEL && data[i * 4 + 2] < INK_LEVEL ? 2 : 1
  }
  // 1 where ink may be peeled: everywhere, or the sprite rects
  let art: Uint8Array | null = null
  if (sprites) {
    art = new Uint8Array(w * h)
    for (const r of sprites) for (let y = Math.max(0, r.sy); y < Math.min(h, r.sy + r.h); y++) art.fill(1, y * w + Math.max(0, r.sx), y * w + Math.min(w, r.sx + r.w))
  }
  for (let pass = 0; pass < INK_PEEL; pass++) {
    const peeled: number[] = []
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (mask[i] !== 2 || (art && !art[i])) continue
        const reached =
          x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
          mask[i - 1] === 0 || mask[i + 1] === 0 || mask[i - w] === 0 || mask[i + w] === 0 ||
          (art !== null && (!art[i - 1] || !art[i + 1] || !art[i - w] || !art[i + w]))
        if (reached) peeled.push(i)
      }
    }
    if (!peeled.length) break
    for (const i of peeled) {
      mask[i] = 0
      data[i * 4 + 3] = 0
    }
  }
  // what is left of the ink is inside the art — an eye, a mouth, a line between limbs — and is body like any other texel
  for (let i = 0; i < mask.length; i++) if (mask[i] === 2) mask[i] = 1
  return mask
}

/** `sameColours` bit: the texel holds the very same rgba as the one to its right. */
export const SAME_RIGHT = 1
/** `sameColours` bit: the texel holds the very same rgba as the one below it. */
export const SAME_DOWN = 2

/**
 * Where neighbouring texels hold the very same colour, one byte per texel
 * (`SAME_RIGHT`, `SAME_DOWN`), read off the peeled pixels. A rim's faces
 * along an edge whose texels are all one colour sample the same thing, so
 * `rimTemplate` builds them as one — and equality is transitive, so a run's
 * texels are all alike exactly when each is like its neighbour. Kept in place
 * of the pixels themselves: an atlas is megabytes of rgba, and reading rows
 * back off its canvas as each rim is built is the cost of a canvas readback
 * per row, which on entering a level was the level's whole fixtures pass
 * (docs/front-end-perf.md).
 */
export function sameColours(data: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const p = i * 4
      let bits = 0
      if (x + 1 < w && data[p] === data[p + 4] && data[p + 1] === data[p + 5] && data[p + 2] === data[p + 6] && data[p + 3] === data[p + 7]) bits |= SAME_RIGHT
      const q = p + w * 4
      if (y + 1 < h && data[p] === data[q] && data[p + 1] === data[q + 1] && data[p + 2] === data[q + 2] && data[p + 3] === data[q + 3]) bits |= SAME_DOWN
      out[i] = bits
    }
  }
  return out
}
