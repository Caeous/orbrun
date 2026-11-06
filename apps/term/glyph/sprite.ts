/**
 * A standing sprite's art, sampled as the view shrinks or grows it. Its
 * texels are 32 across a cell and may reach above it (a royal jelly's tile
 * is half again as tall): v runs 0..1 down the cell, below 0 above it.
 */
import type { Pixels } from '@orbrun/render-term'
import type { TileRect } from '@orbrun/scene'
import { oklab } from './encode'

const DECODE = new Float32Array(256).map((_, i) => {
  const v = i / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
})

export interface SpriteArt {
  px: Pixels
  rect: TileRect
  /** drawn turned about, left for right (render-3d's wielded weapon, turned half a circle) */
  mirror?: boolean
}

/** how much a spot darker than round it stands out, beside one lighter (1.6) */
export let DARK = 0.7
export const setDark = (v: number) => (DARK = v)
/** how much more a difference of colour counts than one of lightness, where salience is told in OKLab (0 for sRGB as it was) */
export let CHROMA = 0
export const setChroma = (v: number) => (CHROMA = v)

export class SpriteTex {
  /** texels across and down */
  readonly w = 32
  readonly h: number
  /** how far above the cell it reaches, in cells */
  readonly top: number
  /** straight colour in linear light, and coverage */
  readonly rgb: Float32Array
  readonly a: Float32Array
  /** straight colour encoded (0..1), for telling texels apart as an eye does */
  readonly srgb: Float32Array
  private up: number

  constructor(art: SpriteArt) {
    const { px, rect } = art
    this.up = Math.max(0, -rect.oy)
    this.h = 32 + this.up
    this.top = this.up / 32
    const n = this.w * this.h
    this.rgb = new Float32Array(n * 3)
    this.srgb = new Float32Array(n * 3)
    this.a = new Float32Array(n)
    for (let y = 0; y < rect.h; y++)
      for (let x = 0; x < rect.w; x++) {
        const tx = art.mirror ? this.w - 1 - (x + rect.ox) : x + rect.ox, ty = y + rect.oy + this.up
        if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) continue
        const i = ((rect.sy + y) * px.width + rect.sx + x) * 4
        const o = ty * this.w + tx
        this.a[o] = px.data[i + 3] / 255
        for (let k = 0; k < 3; k++) {
          this.rgb[o * 3 + k] = DECODE[px.data[i + k]]
          this.srgb[o * 3 + k] = px.data[i + k] / 255
        }
      }
  }

  /** the texel row of v */
  row(v: number) {
    return v * 32 + this.up
  }

  /**
   * The mean of the texels a pixel at u0, v0 (`du` x `dv`) covers, each by how
   * much of it the pixel covers: premultiplied rgb and coverage into out.
   */
  area(u0: number, v0: number, du: number, dv: number, out: Float32Array) {
    const x0 = u0 * 32, x1 = (u0 + du) * 32
    const y0 = this.row(v0), y1 = this.row(v0 + dv)
    let r = 0, g = 0, b = 0, al = 0
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(this.h, Math.ceil(y1)); y++) {
      const wy = Math.min(y + 1, y1) - Math.max(y, y0)
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(this.w, Math.ceil(x1)); x++) {
        const w = (Math.min(x + 1, x1) - Math.max(x, x0)) * wy
        const i = y * this.w + x
        const wa = w * this.a[i]
        r += wa * this.rgb[i * 3]
        g += wa * this.rgb[i * 3 + 1]
        b += wa * this.rgb[i * 3 + 2]
        al += wa
      }
    }
    const s = 1 / ((x1 - x0) * (y1 - y0))
    out[0] = r * s
    out[1] = g * s
    out[2] = b * s
    out[3] = al * s
  }

  private bounds: { x0: number; y0: number; x1: number; y1: number } | null | undefined
  /** the texels with anything of the art, first to last across and down; null for none */
  box() {
    if (this.bounds !== undefined) return this.bounds
    let x0 = this.w, y0 = this.h, x1 = -1, y1 = -1
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        if (this.a[y * this.w + x] > 0) {
          if (x < x0) x0 = x
          if (x > x1) x1 = x
          if (y < y0) y0 = y
          if (y > y1) y1 = y
        }
    return (this.bounds = x1 < 0 ? null : { x0, y0, x1, y1 })
  }

  private labs: Float32Array | null = null
  /** each texel's colour in OKLab */
  lab(): Float32Array {
    if (this.labs) return this.labs
    const lab = new Float32Array(this.w * this.h * 3)
    for (let i = 0; i < this.w * this.h; i++) oklab(this.rgb[i * 3], this.rgb[i * 3 + 1], this.rgb[i * 3 + 2], lab, i * 3)
    return (this.labs = lab)
  }

  private pal: { lab: Float32Array; at: Int32Array } | null = null
  /** the art's own colours, each once, by a texel that has it */
  palette() {
    if (this.pal) return this.pal
    const lab = this.lab()
    const seen = new Map<string, number>()
    for (let i = 0; i < this.w * this.h; i++) {
      if (this.a[i] < 0.5) continue
      const key = `${this.srgb[i * 3]},${this.srgb[i * 3 + 1]},${this.srgb[i * 3 + 2]}`
      if (!seen.has(key)) seen.set(key, i)
    }
    const at = Int32Array.from(seen.values())
    const pl = new Float32Array(at.length * 3)
    at.forEach((i, k) => pl.set(lab.subarray(i * 3, i * 3 + 3), k * 3))
    return (this.pal = { lab: pl, at })
  }

  private body: [number, number, number] | null = null
  /** the mean of its body's colours, its ink left out, in linear light: what it looks from far off */
  bodyColour(): [number, number, number] {
    if (this.body) return this.body
    const ink = this.ink()
    let r = 0, g = 0, b = 0, n = 0
    for (let i = 0; i < this.w * this.h; i++) {
      if (this.a[i] < 0.5 || ink[i]) continue
      r += this.rgb[i * 3]
      g += this.rgb[i * 3 + 1]
      b += this.rgb[i * 3 + 2]
      n++
    }
    return (this.body = n ? [r / n, g / n, b / n] : [0, 0, 0])
  }

  private inkMap: Uint8Array | null = null
  /** crawl's ink: the dark line round a sprite's edge, each texel of it 1 */
  ink(): Uint8Array {
    if (this.inkMap) return this.inkMap
    const { w, h, srgb: c } = this
    const ink = new Uint8Array(w * h)
    const a = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : this.a[y * w + x])
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (a(x, y) < 0.5) continue
        const l = 0.3 * c[i * 3] + 0.59 * c[i * 3 + 1] + 0.11 * c[i * 3 + 2]
        if (l < 0.16 && (a(x - 1, y) < 0.5 || a(x + 1, y) < 0.5 || a(x, y - 1) < 0.5 || a(x, y + 1) < 0.5)) ink[i] = 1
      }
    return (this.inkMap = ink)
  }

  private sal: Float32Array | null = null
  private salDark = -1
  private salChroma = -1
  /**
   * How much each texel stands out from those round it, 0 and up: a
   * goblin's eyes, a quokka's, a glint on a blade, brighter or another
   * colour than the face round them. Crawl's dark ink round a sprite's edge
   * stands out from everything and means nothing, so it counts for none.
   */
  salience(): Float32Array {
    if (this.sal && this.salDark === DARK && this.salChroma === CHROMA) return this.sal
    this.salDark = DARK
    this.salChroma = CHROMA
    const { w, h } = this
    // straight colour encoded, or OKLab with colour weighed CHROMA times lightness (and scaled to about the same range)
    const c = CHROMA ? this.lab().map((v, i) => (i % 3 ? v * CHROMA : v)) : this.srgb
    const lumOf = CHROMA ? (i: number) => c[i * 3] : null
    const sal = new Float32Array(w * h)
    const a = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : this.a[y * w + x])
    const lum = lumOf ?? ((i: number) => 0.3 * c[i * 3] + 0.59 * c[i * 3 + 1] + 0.11 * c[i * 3 + 2])
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (a(x, y) < 0.5) continue
        const l = lum(i)
        if (l < 0.12 && (a(x - 1, y) < 0.5 || a(x + 1, y) < 0.5 || a(x, y - 1) < 0.5 || a(x, y + 1) < 0.5)) continue
        let mr = 0, mg = 0, mb = 0, n = 0
        for (let j = -2; j <= 2; j++)
          for (let k = -2; k <= 2; k++) {
            if ((j || k) && a(x + k, y + j) >= 0.5) {
              const o = (y + j) * w + x + k
              mr += c[o * 3]
              mg += c[o * 3 + 1]
              mb += c[o * 3 + 2]
              n++
            }
          }
        if (!n) continue
        mr /= n
        mg /= n
        mb /= n
        const d = Math.hypot(c[i * 3] - mr, c[i * 3 + 1] - mg, c[i * 3 + 2] - mb)
        const brighter = CHROMA ? c[i * 3] - mr : l - (0.3 * mr + 0.59 * mg + 0.11 * mb)
        sal[i] = d * (brighter > 0 ? 1.6 : DARK)
      }
    return (this.sal = sal)
  }
}
