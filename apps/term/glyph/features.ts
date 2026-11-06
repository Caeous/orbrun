/**
 * A sprite too far for its texels to fill a dot, drawn a dot at a time with
 * what makes it itself kept: a quokka's eyes, a goblin's, a glint on a
 * blade. Shrunk as the truth shrinks it (each dot the mean of the texels it
 * covers), an eye two texels across is a quarter of a dot, averaged into
 * the fur round it and gone; drawn finer than the dots, as it was, the
 * cells' two colours can't show it either. So each of the art's features
 * (`features`: a small spot of texels unlike the body round them) is found
 * once, and at each size the dot its middle falls in is drawn in its colour
 * wherever shrinking lost it, and counts for more where the cells' glyphs
 * and colours are chosen.
 */
import type { SpriteTex } from './sprite'

/** a spot of the art that stands out from what is round it */
export interface Feature {
  /** its middle, in the tile's texels across and down (the tile's own rows, `SpriteTex.row`) */
  x: number
  y: number
  /** a texel of it, its colour the feature's (the one nearest its mean) */
  at: number
  /** its colour in OKLab */
  L: number
  A: number
  B: number
  /** how far it is from what is round it (OKLab, colour counted CHROMA times) */
  contrast: number
  /** texels */
  size: number
}

/** how much more a difference of colour counts than one of lightness, telling a feature from its ground */
const CHROMA = 2
/** how far a texel must be from the mean round it to be part of a feature (OKLab) */
const SPOT = 0.12
/** how far a feature must be from its ground to be kept (OKLab) */
const STANDS = 0.16
/** the most texels a feature is: past that it is big enough to be seen as it shrinks, or no spot at all */
const MOST = 12
/** how much of what is round a feature must be the art: an eye is in a face, not on its edge */
const INSIDE = 0.6
/** how near a feature's colour a texel round it must be to be more of it (OKLab) */
const ALIKE = 0.2
/** how much of what is round a feature may be like it, or the ink: an eye is alone in its face, where a line's end (crawl draws the gap between an arm and a body in black) runs on into more */
const ALONE = 0.12

const cache = new WeakMap<SpriteTex, Feature[]>()

const dist = (L: number, A: number, B: number, l: number, a: number, b: number) => Math.hypot(L - l, CHROMA * (A - a), CHROMA * (B - b))

/** the art's features, most standing out first */
export function features(tx: SpriteTex): Feature[] {
  const got = cache.get(tx)
  if (got) return got
  const { w, h, a } = tx
  const lab = tx.lab(), ink = tx.ink()
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && a[y * w + x] >= 0.5
  // each texel's distance from the mean of the art round it (5x5)
  const spot = new Uint8Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!solid(x, y) || ink[i]) continue
      let L = 0, A = 0, B = 0, n = 0
      for (let j = -2; j <= 2; j++)
        for (let k = -2; k <= 2; k++) {
          if ((!j && !k) || !solid(x + k, y + j)) continue
          const o = ((y + j) * w + x + k) * 3
          L += lab[o]
          A += lab[o + 1]
          B += lab[o + 2]
          n++
        }
      if (n >= 8 && dist(lab[i * 3], lab[i * 3 + 1], lab[i * 3 + 2], L / n, A / n, B / n) > SPOT) spot[i] = 1
    }
  // spots of such texels alike
  const label = new Int32Array(w * h).fill(-1)
  const comps: number[][] = []
  const stack: number[] = []
  for (let s = 0; s < w * h; s++) {
    if (!spot[s] || label[s] >= 0) continue
    const comp: number[] = []
    label[s] = comps.length
    stack.push(s)
    while (stack.length) {
      const i = stack.pop()!
      comp.push(i)
      const x = i % w, y = (i / w) | 0
      for (let j = -1; j <= 1; j++)
        for (let k = -1; k <= 1; k++) {
          const nx = x + k, ny = y + j
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const o = ny * w + nx
          if (label[o] >= 0 || !spot[o]) continue
          if (dist(lab[i * 3], lab[i * 3 + 1], lab[i * 3 + 2], lab[o * 3], lab[o * 3 + 1], lab[o * 3 + 2]) > SPOT) continue
          label[o] = comps.length
          stack.push(o)
        }
    }
    comps.push(comp)
  }
  const groups = comps.map((_, i) => [i])
  const out: Feature[] = []
  const texels: number[][] = []
  for (const members of groups) {
    const comp = members.flatMap((m) => comps[m])
    if (comp.length > MOST) continue
    // its colour the biggest spot's
    const main = comps[members.reduce((b, m) => (comps[m].length > comps[b].length ? m : b), members[0])]
    let L = 0, A = 0, B = 0, cx = 0, cy = 0
    for (const i of main) {
      L += lab[i * 3]
      A += lab[i * 3 + 1]
      B += lab[i * 3 + 2]
    }
    L /= main.length, A /= main.length, B /= main.length
    for (const i of comp) {
      cx += (i % w) + 0.5
      cy += ((i / w) | 0) + 0.5
    }
    const n = comp.length
    cx /= n, cy /= n
    const inComp = new Set(comp)
    // its ground: the texels within two of it, not of it
    let gL = 0, gA = 0, gB = 0, gn = 0, round = 0, alike = 0
    const ring = new Set<number>()
    for (const i of comp) {
      const x = i % w, y = (i / w) | 0
      for (let j = -2; j <= 2; j++)
        for (let k = -2; k <= 2; k++) {
          const nx = x + k, ny = y + j, o = ny * w + nx
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || inComp.has(o) || ring.has(o)) continue
          ring.add(o)
          if (!solid(nx, ny)) continue
          round++
          // the ink round the art, or more of its own colour: the end of a line, not a spot
          if (ink[o] || dist(L, A, B, lab[o * 3], lab[o * 3 + 1], lab[o * 3 + 2]) < ALIKE) alike++
          if (ink[o]) continue
          gL += lab[o * 3]
          gA += lab[o * 3 + 1]
          gB += lab[o * 3 + 2]
          gn++
        }
    }
    if (!gn || round < INSIDE * ring.size || alike > ALONE * round) continue
    const contrast = dist(L, A, B, gL / gn, gA / gn, gB / gn)
    if (contrast < STANDS) continue
    // its colour the art's own: the texel of the biggest spot nearest its mean
    let at = main[0], best = Infinity
    for (const i of main) {
      const d = dist(L, A, B, lab[i * 3], lab[i * 3 + 1], lab[i * 3 + 2])
      if (d < best) (best = d), (at = i)
    }
    out.push({ x: cx, y: cy, at, L: lab[at * 3], A: lab[at * 3 + 1], B: lab[at * 3 + 2], contrast, size: n })
    texels.push(comp)
  }
  // of two that touch, as an eye and the glint in it, the darker: from far off, the eye
  const touch = (p: number[], q: number[]) => p.some((i) => q.some((o) => Math.abs((i % w) - (o % w)) <= 1 && Math.abs(((i / w) | 0) - ((o / w) | 0)) <= 1))
  const kept = out.filter((f, i) => !out.some((g, j) => j !== i && (g.L < f.L || (g.L === f.L && j < i)) && touch(texels[i], texels[j])))
  out.length = 0
  out.push(...kept)
  out.sort((p, q) => q.contrast - p.contrast)
  cache.set(tx, out)
  return out
}

