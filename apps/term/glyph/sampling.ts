/**
 * A standing sprite drawn into the view's pixels, its texels sampled as
 * `Sampling` says, layer over layer.
 */
import type { Sampling } from './render'
import type { SpriteTex } from './sprite'
import { oklab } from './encode'

const tmp = new Float32Array(3)

/** how far a texel must stand out from those round it to be drawn in place of the one under a pixel's middle */
let STANDS_OUT = 0.12
let MEAN: 'oklab' | 'linear' = 'oklab'

export type Put = (i: number, r: number, g: number, b: number, a: number, stand: number) => void

/** what of a sprite is the same for each band of rows it is drawn in: each column's u, whether it is drawn, and its texel in each layer */
export interface SpriteColumns {
  us?: Float64Array
  on?: Uint8Array
  xs?: Int32Array
}

/**
 * The grid a texture whose texels stand `texel` pixels on the screen is read
 * on, one way (render-term's `gridFor`): the coarsest of a cell's (`cell`
 * pixels), its half, and so on down to an octant's dot (2), that a texel
 * still fills, so a cell is one texel or two and a glyph draws it exactly.
 */
export function gridFor(texel: number, cell: number): number {
  let g = cell
  while (g > 2 && !(texel >= g)) g /= 2
  return Math.max(2, g)
}

/**
 * The sprite's pixels over the columns c0..c1 and rows r0..r1 its square of
 * `sideX` x `sideY` pixels at x0, y0 covers, each passed to `put` as straight linear
 * colour, its coverage, and how much it stands out. With a `grid` (pixels
 * across and down, `gridFor`), near enough to be drawn a texel a pixel, each
 * block of the grid from the sprite's corner takes the one texel under its
 * middle, so the texels' edges are the grid's.
 */
export function drawSprite(
  texs: SpriteTex[], sampling: Sampling, standsOut: number | undefined, mean: 'oklab' | 'linear' | undefined, feature: number | undefined, inkCover: number | undefined, snap: 'palette' | 'footprint' | undefined, x0: number, y0: number, sideX: number, sideY: number,
  c0: number, c1: number, r0: number, r1: number, depth: number, zbuf: Float32Array, W: number, put: Put, columns: SpriteColumns = {},
  grid?: [number, number],
) {
  STANDS_OUT = standsOut ?? 0.12
  MEAN = mean ?? 'oklab'
  FEATURE = feature ?? 0.25
  INK = inkCover ?? 1
  SNAP = snap ?? 'palette'
  const nc = c1 - c0 + 1, nr = r1 - r0 + 1
  if (nc <= 0 || nr <= 0) return
  const du = 1 / sideX
  const dv = 1 / sideY
  const boxes = texs.map((tx) => tx.box())
  const nearest = sampling === 'nearest' || (sampling !== 'area' && du * 32 <= 1.05 && dv * 32 <= 1.05)
  const L = texs.length
  // the columns and rows that are in front and fall on any layer's texels: the rest are never sampled. The columns once for every band (`columns`)
  if (!columns.us) {
    const us = (columns.us = new Float64Array(nc)), colOn = (columns.on = new Uint8Array(nc))
    for (let c = 0; c < nc; c++) {
      const col = c0 + c
      const u0 = (us[c] = (col - x0) / sideX)
      if (zbuf[col] < depth - 0.5 || u0 + du <= 0 || u0 >= 1) continue
      // on a grid, the u its block reads, so a block is drawn whole or not at all
      const ub = grid ? (grid[0] * Math.floor((col - x0) / grid[0]) + grid[0] / 2) / sideX - du / 2 : u0
      for (const b of boxes) if (b && (ub + du) * 32 > b.x0 && ub * 32 < b.x1 + 1) colOn[c] = 1
    }
    if (nearest) {
      const xs = (columns.xs = new Int32Array(nc * L))
      texs.forEach((tx, l) => {
        for (let c = 0; c < nc; c++) {
          // on a grid, the texel under the middle of the pixel's block of it, from the sprite's corner (x0, a whole pixel)
          const u = grid ? (grid[0] * Math.floor((c0 + c - x0) / grid[0]) + grid[0] / 2) / sideX : us[c] + du / 2
          const x = Math.floor(u * 32)
          xs[c * L + l] = x < 0 || x >= tx.w ? -1 : x
        }
      })
    }
  }
  const us = columns.us, colOn = columns.on!
  const vs = new Float64Array(nr), rowOn = new Uint8Array(nr)
  for (let r = 0; r < nr; r++) {
    const v0 = (vs[r] = (r0 + r - y0) / sideY)
    if (v0 >= 1) continue
    const vb = grid ? (grid[1] * Math.floor((r0 + r - y0) / grid[1]) + grid[1] / 2) / sideY - dv / 2 : v0
    texs.forEach((tx, l) => {
      const b = boxes[l]
      if (b && tx.row(vb + dv) > b.y0 && tx.row(vb) < b.y1 + 1) rowOn[r] = 1
    })
  }
  if (nearest) {
    // the one texel under each pixel's middle, crisp: the top layer's that is there, as layer over layer leaves it
    const xs = columns.xs!, ys = new Int32Array(nr * L)
    texs.forEach((tx, l) => {
      for (let r = 0; r < nr; r++) {
        const v = grid ? (grid[1] * Math.floor((r0 + r - y0) / grid[1]) + grid[1] / 2) / sideY : vs[r] + dv / 2
        const y = Math.floor(tx.row(v))
        ys[r * L + l] = y < 0 || y >= tx.h ? -1 : y * tx.w
      }
    })
    // what stands out still counts for more where the cell's colours are chosen
    const sals = texs.map((tx) => (sampling === 'nearest' ? null : tx.salience()))
    if (L === 1) {
      // one layer, a row at a time, as the memory lies
      const tx = texs[0], sal = sals[0], a = tx.a, rgb = tx.rgb
      for (let r = 0; r < nr; r++) {
        const y = ys[r]
        if (!rowOn[r] || y < 0) continue
        const at = (r0 + r) * W + c0
        for (let c = 0; c < nc; c++) {
          const x = xs[c]
          if (!colOn[c] || x < 0) continue
          const i = y + x
          if (a[i] < 0.5) continue
          put(at + c, rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2], 1, sal && sal[i] > STANDS_OUT ? sal[i] : 0)
        }
      }
      return
    }
    for (let r = 0; r < nr; r++) {
      if (!rowOn[r]) continue
      for (let c = 0; c < nc; c++) {
        if (!colOn[c]) continue
        for (let l = L - 1; l >= 0; l--) {
          const x = xs[c * L + l], y = ys[r * L + l]
          if (x < 0 || y < 0) continue
          const i = y + x
          const tx = texs[l]
          if (tx.a[i] < 0.5) continue
          const sal = sals[l]
          const stand = sal && sal[i] > STANDS_OUT ? sal[i] : 0
          put((r0 + r) * W + c0 + c, tx.rgb[i * 3], tx.rgb[i * 3 + 1], tx.rgb[i * 3 + 2], 1, stand)
          break
        }
      }
    }
    return
  }
  const s = new Float32Array(5)
  const acc = new Float32Array(5)
  for (let c = 0; c < nc; c++) {
    if (!colOn[c]) continue
    const u0 = us[c]
    for (let r = 0; r < nr; r++) {
      if (!rowOn[r]) continue
      const v0 = vs[r]
      acc.fill(0)
      for (const tx of texs) {
        sample(tx, sampling, u0, v0, du, dv, s)
        // premultiplied, layer over layer
        const a = s[3]
        if (a <= 0) continue
        acc[0] = acc[0] * (1 - a) + s[0] * a
        acc[1] = acc[1] * (1 - a) + s[1] * a
        acc[2] = acc[2] * (1 - a) + s[2] * a
        acc[3] = acc[3] * (1 - a) + a
        acc[4] = Math.max(acc[4] * (1 - a), s[4])
      }
      const a = acc[3]
      if (a <= 0.004) continue
      put((r0 + r) * W + c0 + c, acc[0] / a, acc[1] / a, acc[2] / a, a, acc[4])
    }
  }
}

/** a pixel of the sprite at u0, v0, `du` across and `dv` down: straight linear rgb, coverage, how much it stands out */
function sample(tx: SpriteTex, sampling: Sampling, u0: number, v0: number, du: number, dv: number, out: Float32Array) {
  out.fill(0)
  if (sampling === 'area') {
    tx.area(u0, v0, du, dv, out)
    if (out[3] > 0) for (let k = 0; k < 3; k++) out[k] /= out[3]
    return
  }
  if (sampling === 'palette') palette(tx, u0, v0, du, dv, out)
  else pick(tx, u0, v0, du, dv, out)
}

/**
 * The texels a pixel covers, as one: a texel of them whole, never their
 * mean, as pixel art shrinks cleanly. The one that stands out most where one
 * does, so what makes a sprite itself outlasts its shrinking; else the one
 * nearest their mean, which holds steady from one step to the next where
 * the texel under the middle would not. What is mostly there is all there.
 */
function pick(tx: SpriteTex, u0: number, v0: number, du: number, dv: number, out: Float32Array) {
  const sal = tx.salience()
  const { w, h, a, rgb } = tx
  // the texels whose middles fall in the pixel: each in one pixel only, so an eye is never drawn twice
  const x0 = Math.max(0, Math.round(u0 * 32)), x1 = Math.min(w, Math.max(x0 + 1, Math.round((u0 + du) * 32)))
  const y0 = Math.max(0, Math.round(tx.row(v0))), y1 = Math.min(h, Math.max(y0 + 1, Math.round(tx.row(v0 + dv))))
  let cover = 0, top = 0, star = -1, mr = 0, mg = 0, mb = 0, opaque = 0
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = y * w + x
      cover += a[i]
      if (a[i] < 0.5) continue
      mr += rgb[i * 3]
      mg += rgb[i * 3 + 1]
      mb += rgb[i * 3 + 2]
      opaque++
      if (sal[i] > top) (top = sal[i]), (star = i)
    }
  if (!opaque || cover / Math.max(1, (x1 - x0) * (y1 - y0)) < 0.45) return
  out[3] = 1
  out[4] = top > STANDS_OUT ? top : 0
  let at = star
  if (top <= STANDS_OUT) {
    mr /= opaque
    mg /= opaque
    mb /= opaque
    let bestD = Infinity
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = y * w + x
        if (a[i] < 0.5) continue
        const d = (rgb[i * 3] - mr) ** 2 + (rgb[i * 3 + 1] - mg) ** 2 + (rgb[i * 3 + 2] - mb) ** 2
        if (d < bestD) (bestD = d), (at = i)
      }
  }
  for (let k = 0; k < 3; k++) out[k] = rgb[at * 3 + k]
}

/** how much of a pixel what stands out must cover to be drawn as the whole of it */
let FEATURE = 0.25
/** how much the ink counts toward a pixel being there at all; 1 counts it as the body */
let INK = 1
/** where `palette` finds its colour: the art's whole palette, or the texels under the pixel */
let SNAP: 'palette' | 'footprint' = 'palette'

/**
 * The texels a pixel covers, averaged as an eye averages them (in OKLab,
 * the ink and the shading with the rest, each by how much of it the pixel
 * covers), then the art's own colour nearest that: so a shrinking sprite
 * keeps its tones and its colours both, darkening where its ink and shadows
 * are, never washing out to its brightest parts. A texel that stands out
 * (an eye) is drawn instead where the pixel holds enough of it. The pixel
 * is there where the art covers half of it.
 */
function palette(tx: SpriteTex, u0: number, v0: number, du: number, dv: number, out: Float32Array) {
  const sal = tx.salience()
  const ink = tx.ink()
  let inked = 0, ir = 0, ig = 0, ib = 0
  const lab = tx.lab()
  const { w, h, a, rgb } = tx
  const fx0 = u0 * 32, fx1 = (u0 + du) * 32
  const fy0 = tx.row(v0), fy1 = tx.row(v0 + dv)
  const area = (fx1 - fx0) * (fy1 - fy0)
  let cover = 0, L = 0, A = 0, B = 0, top = 0, star = -1, feature = 0
  const y0 = Math.max(0, Math.floor(fy0)), y1 = Math.min(h, Math.ceil(fy1))
  const x0 = Math.max(0, Math.floor(fx0)), x1 = Math.min(w, Math.ceil(fx1))
  for (let y = y0; y < y1; y++) {
    const wy = Math.min(y + 1, fy1) - Math.max(y, fy0)
    for (let x = x0; x < x1; x++) {
      const i = y * w + x
      if (a[i] < 0.5) continue
      const wt = (Math.min(x + 1, fx1) - Math.max(x, fx0)) * wy
      if (INK < 1 && ink[i]) {
        // the ink: an edge against the dark, not part of the body's colour
        inked += wt
        ir += wt * rgb[i * 3]
        ig += wt * rgb[i * 3 + 1]
        ib += wt * rgb[i * 3 + 2]
        continue
      }
      cover += wt
      if (MEAN === 'linear') {
        L += wt * rgb[i * 3]
        A += wt * rgb[i * 3 + 1]
        B += wt * rgb[i * 3 + 2]
      } else {
        L += wt * lab[i * 3]
        A += wt * lab[i * 3 + 1]
        B += wt * lab[i * 3 + 2]
      }
      if (sal[i] > STANDS_OUT) {
        feature += wt * sal[i]
        if (sal[i] > top) (top = sal[i]), (star = i)
      }
    }
  }
  if (cover + INK * inked < 0.5 * area) return
  out[3] = 1
  if (cover < 0.3 * area) {
    // mostly ink: the ink
    out[0] = ir / inked
    out[1] = ig / inked
    out[2] = ib / inked
    return
  }
  let at = star
  // what stands out, where it is enough of the pixel to show: never more than FEATURE's share swollen to the whole
  if (star >= 0 && feature >= FEATURE * Math.min(area, Math.max(1, cover))) out[4] = top
  else {
    L /= cover
    A /= cover
    B /= cover
    if (MEAN === 'linear') {
      oklab(L, A, B, tmp, 0)
      L = tmp[0]
      A = tmp[1]
      B = tmp[2]
    }
    let bestD = Infinity
    if (SNAP === 'footprint') {
      // the texel of the pixel's own nearest that
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = y * w + x
          if (a[i] < 0.5 || (INK < 1 && ink[i])) continue
          const d = (lab[i * 3] - L) ** 2 + (lab[i * 3 + 1] - A) ** 2 + (lab[i * 3 + 2] - B) ** 2
          if (d < bestD) (bestD = d), (at = i)
        }
    } else {
      const pal = tx.palette()
      for (let k = 0; k < pal.at.length; k++) {
        const d = (pal.lab[k * 3] - L) ** 2 + (pal.lab[k * 3 + 1] - A) ** 2 + (pal.lab[k * 3 + 2] - B) ** 2
        if (d < bestD) (bestD = d), (at = pal.at[k])
      }
    }
  }
  for (let k = 0; k < 3; k++) out[k] = rgb[at * 3 + k]
}
