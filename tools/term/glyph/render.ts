/**
 * The first-person view as terminal cells: each column of the screen is a
 * ray cast through crawl's grid, and each cell a glyph of the mosaic
 * (octants, 2x4 dots, or sextants, 2x3) in two colours. The walls, floors
 * and lids are crawl's own tiles mapped onto them, a texel at a time where
 * they are near and their averages (mips) as they recede, a dot at a time,
 * each cell its dots split in two means. What stands is its own sprite,
 * facing the eye, drawn finer, four pixels a cell across (sampling.ts: the
 * texels under each pixel as the eye sees them from far off, in the art's
 * own colours, its ink an edge rather than its body, an eye kept where it is
 * enough of the pixel), and each cell it is in the glyph of all there are
 * and the two of its colours that show it best (encode.ts `fit`). A sprite
 * too small to make out is named instead by crawl's glyph for it, on a cell
 * of the colour it is from far off, so a monster reads at any distance;
 * `letters` has everything that lives drawn that way, large in octants up
 * close. GLYPH_DEFAULTS is as the gym (glyph-gym.ts) found looks best.
 *
 * For the game, the walls stand back from the floor as render-3d stands
 * them (`wallInset`), so a corner can be seen round; the cursor is a ring on
 * its floor, a cell's flash is washed over all of it, and the hands are
 * drawn over all in a lens of their own (`Thing.hand`).
 */
import { keyToXY, type Camera, type CellKey, type Scene, type SceneCell, type SceneCursor, type TileId, type TileRect, type TileSource } from '@orbrun/scene'
import type { Pixels } from '@orbrun/render-term'
import { bigGlyph } from './font'
import { INVERSE, OCTANTS, inked } from './shapes'
import { setChroma, setDark, SpriteTex } from './sprite'
import { encoders, q, unpack, type Encoder, type EncoderName, type FitOptions } from './encode'
import { drawSprite, gridFor, type SpriteColumns } from './sampling'
import {
  CURSOR_ALPHA,
  VM_FILL,
  boardAlong,
  boardTexel,
  bodyRect,
  cursorColour,
  doorBoard,
  faceTile,
  featureStance,
  floorLayers,
  framedDoors,
  levelClassAt,
  occupiedFeatures,
  ringCover,
  stripAt,
  type BodyRect,
  type DoorBoard,
} from '@orbrun/world'

export type RGB = [number, number, number]

export interface Cell {
  ch: string
  fg: RGB
  bg: RGB
}

/** A tile's art: where it is in which atlas, and its offset in a 32-texel cell; `mirror`, turned left for right. */
export interface Art {
  px: Pixels
  rect: TileRect
  mirror?: boolean
}

export interface Thing {
  x: number
  y: number
  /** its sprite, bottom layer first; none for a thing drawn only as its glyph */
  art: Art[]
  glyph: string
  colour: RGB
  /** the size it stands, in cells */
  size: number
  name?: string
  /** a monster, as opposed to a feature or a plant: kept lit, labelled, and drawn as its letter in `letters` */
  alive?: boolean
  /** its light, over the level's tint, where it is known (the game's shade field); else as the view lights it */
  light?: number
  /** a colour washed over it and by how much (linear, 0..1), as the game washes its cell (paralysis, berserk) */
  flash?: [number, number, number, number]
  /** how much of it shows, 0..1: a cloud, or what is submerged or seen invisible */
  alpha?: number
  /** how far off the floor it stands, in cells: a missile in flight */
  lift?: number
  /**
   * one of the player's hands (render-3d hands.ts): not in the world but in a
   * lens of its own over the view, two units tall, its art a `size` square
   * whose bottom middle stands at (x, y) of it, x by the view's aspect; drawn
   * over everything, at its own light. `fit`: the square its art's opaque
   * box, its longer side VM_FILL of it, standing on the box's foot, as
   * render-3d sizes a hand; else the whole tile.
   */
  hand?: { x: number; y: number; size: number; fit?: boolean }
}


export interface GlyphViewOptions {
  fov: number
  eye: number
  /** A cell's height over its width, as the terminal draws it. */
  aspect: number
  /** what lives drawn as crawl's letters rather than its sprites */
  letters: boolean
  /** the glyphs a cell may be drawn in: octants (2x4) and all before them, or sextants (2x3) and all before them */
  mosaic: 'octant' | 'sextant'
  /** how a cell's glyph and colours are found (encode.ts) */
  encoder: EncoderName
  /** how a sprite's texels become pixels as it shrinks and grows */
  sampling: Sampling
  /** how far a texel must stand out from those round it to be drawn in place of the rest (sampling.ts STANDS_OUT) */
  standsOut?: number
  /** how much of a pixel what stands out must cover to be drawn as the whole of it */
  feature?: number
  /** how much a spot darker than round it stands out, beside one lighter (1.6) */
  dark?: number
  /** how much more a difference of colour counts than one of lightness in telling what stands out (OKLab); 0 for sRGB */
  chroma?: number
  /** how much crawl's ink round a sprite counts toward a pixel being there, for `palette`: 1 as the body, less to leave it out of the body's colour */
  ink?: number
  /** where `palette` sampling finds a pixel's colour: the art's whole palette, or the texels under the pixel */
  snap?: 'palette' | 'footprint'
  /** what `palette` sampling averages in: OKLab, or linear light as the eye sums it */
  mean?: 'oklab' | 'linear'
  /** how much a pixel that stands out (a goblin's eye) counts for, over one that does not */
  stand?: number
  /** a sprite fewer rows tall than this is named by its glyph instead (GLYPH_ROWS) */
  glyphRows?: number
  /** what lives too far to draw is its glyph on a cell of its own colour, not on what is behind it */
  farTint?: boolean
  /** names under what lives, near enough (on unless false) */
  labels?: boolean
  /** for the `fit` encoder */
  fit?: FitOptions
  /** how far walls stand back from the floor round them, in cells (render-3d's WALL_INSET); 0 or none, a wall is its whole cell */
  wallInset?: number
  /** the cell a look or an aim is on, as render-3d marks it (world marks.ts): WebTiles' icon for it laid on its floor, else a ring there in its mode's colour */
  cursor?: { x: number; y: number; mode?: SceneCursor['mode']; tile?: TileId } | null
  /**
   * what stands near enough that its texels fill a dot stood on the dots and
   * read on the coarsest of a cell's grids its texels fill (sampling.ts
   * `gridFor`), so its texels' edges fall on a cell's, a half's or a dot's
   */
  grid?: boolean
}

/** The view as the gym (glyph-gym.ts) found it looks best. */
export const GLYPH_DEFAULTS: GlyphViewOptions = {
  fov: 90,
  eye: 0.6,
  aspect: 2,
  letters: false,
  mosaic: 'octant',
  encoder: 'fit',
  sampling: 'palette',
  snap: 'footprint',
  mean: 'oklab',
  standsOut: 0.8,
  stand: 4,
  feature: 0.25,
  ink: 0.5,
  dark: 1.2,
  chroma: 3,
  farTint: true,
  fit: { SX: 4, wedges: 'none', medoid: true, slim: false, tries: 8, hybrid: true },
}

export type Sampling = 'nearest' | 'area' | 'pick' | 'palette'

export interface RasterOptions {
  sampling?: Sampling
  /** the walls, floors and lid drawn in blocks this many pixels a side (W and H its multiples) */
  coarse?: number
  /** draw every sprite however small, none named by its glyph instead */
  allSprites?: boolean
  /** only the pixel rows from the first up to the second (multiples of `coarse`), the raster's rows those */
  rows?: [number, number]
}

/** something named rather than drawn, or the name under what is drawn */
interface Mark {
  t: Thing
  depth: number
  /** in cells */
  sx: number
  floorY: number
  tall: number
  label?: boolean
}

/** what `GlyphView.look` saw of a frame; a column here is a block of `step` pixels */
export interface Look {
  W: number
  H: number
  SX: number
  SY: number
  step: number
  sampling: Sampling
  ex: number
  ey: number
  fx: number
  fy: number
  horizon: number
  zbuf: Float32Array
  /** each column's ray, where along the wall's face it struck (0..1), the wall's top and bottom row, its light, mip and texels at that mip */
  rx: Float64Array
  ry: Float64Array
  u: Float64Array
  top: Float64Array
  bot: Float64Array
  wallK: Float64Array
  wallLevel: Uint8Array
  /** each column's wall's cell, by the grid's index (-1 for none), for its flash */
  wallG: Int32Array
  /** the open doors each column passes before its wall (up to BOARDS, nearest first): how many, and each one's ray parameter, u, cell and art */
  boards: Uint8Array
  boardT: Float64Array
  boardU: Float64Array
  boardG: Int32Array
  boardTex: (Texture | null)[]
  wall: Float32Array[]
  sprites: { texs: SpriteTex[]; x0: number; y0: number; sideX: number; side: number; c0: number; c1: number; r0: number; r1: number; depth: number; k: number; alpha: number; flash?: [number, number, number, number]; grid?: [number, number]; columns: SpriteColumns }[]
  glyphs: Mark[]
}

/** a frame `prepare`d, for its bands */
export interface Prepared {
  enc: Encoder
  cols: number
  rows: number
  look: Look
}

export interface Raster {
  W: number
  /** its rows: the view's, or the band of them asked for */
  H: number
  SX: number
  SY: number
  /** linear rgb */
  pix: Float32Array
  /** how much each pixel counts: more where it stands out */
  weight: Float32Array
  /** how much of each pixel is something standing (a sprite), 0..1 */
  thing: Float32Array
  /** each cell (SX x SY pixels) 1 where half a pixel of it or more is something standing (else 0 or 2), if it is known */
  standing?: Uint8Array
  /** each pixel column's depth */
  zbuf: Float32Array
  glyphs: Mark[]
}

const FOG = 10
const TORCH = 3.2
const NEAR = 0.15
const LID = 0.32
/** the most open doors a column sees through */
const BOARDS = 3
/** a sprite fewer rows tall than this is named by its glyph */
const GLYPH_ROWS = 2

/** crawl's sixteen colours, bright enough to read on the dark. */
export const CRAWL: RGB[] = [
  [0, 0, 0], [52, 90, 230], [40, 170, 60], [40, 170, 170], [200, 40, 40], [170, 50, 170], [170, 110, 40], [190, 190, 190],
  [110, 110, 110], [100, 140, 255], [90, 235, 90], [90, 235, 235], [255, 90, 90], [255, 100, 255], [255, 240, 90], [255, 255, 255],
]

const DECODE = new Float32Array(256).map((_, i) => {
  const v = i / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
})
/** an sRGB colour (0xRRGGBB) in linear light */
const linear = (hex: number): RGB => [DECODE[hex >> 16], DECODE[(hex >> 8) & 255], DECODE[hex & 255]]
const enc = (v: number) => {
  const c = v <= 0 ? 0 : v >= 1 ? 1 : v
  return Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055))
}

/** A tile in linear light, premultiplied, with its mips: level k is (32 >> k) texels a side. */
class Texture {
  levels: { n: number; rgba: Float32Array }[] = []
  constructor(art: Art) {
    const { px, rect } = art
    // the tile set in its 32-texel cell, as crawl lays it out
    const n = 32
    const rgba = new Float32Array(n * n * 4)
    for (let y = 0; y < rect.h; y++)
      for (let x = 0; x < rect.w; x++) {
        const tx = x + rect.ox, ty = y + rect.oy
        if (tx < 0 || ty < 0 || tx >= n || ty >= n) continue
        const i = ((rect.sy + y) * px.width + rect.sx + x) * 4
        const a = px.data[i + 3] / 255
        const o = (ty * n + tx) * 4
        rgba[o] = DECODE[px.data[i]] * a
        rgba[o + 1] = DECODE[px.data[i + 1]] * a
        rgba[o + 2] = DECODE[px.data[i + 2]] * a
        rgba[o + 3] = a
      }
    this.levels.push({ n, rgba })
    for (let m = n >> 1; m >= 1; m >>= 1) {
      const up = this.levels[this.levels.length - 1]
      const down = new Float32Array(m * m * 4)
      for (let y = 0; y < m; y++)
        for (let x = 0; x < m; x++)
          for (let k = 0; k < 4; k++) {
            const at = (yy: number, xx: number) => up.rgba[(yy * up.n + xx) * 4 + k]
            down[(y * m + x) * 4 + k] = (at(2 * y, 2 * x) + at(2 * y, 2 * x + 1) + at(2 * y + 1, 2 * x) + at(2 * y + 1, 2 * x + 1)) / 4
          }
      this.levels.push({ n: m, rgba: down })
    }
  }
}

/**
 * Layers of tiles over a base colour, laid a texel at a time as they would
 * be a pixel at a time (premultiplied, each over what is under it), at each
 * mip: rgb, level k (32 >> k) texels a side. A pixel of a floor then reads
 * one texel, not its floor's every decal.
 */
type Flat = Float32Array[]
function flatten(base: number, layers: (Texture | null)[]): Flat {
  const out: Flat = []
  for (let level = 0; level < 6; level++) {
    const n = 32 >> level
    const rgb = new Float32Array(n * n * 3).fill(base)
    for (const t of layers) {
      if (!t) continue
      const src = t.levels[level].rgba
      for (let i = 0; i < n * n; i++) {
        const a = src[i * 4 + 3]
        if (a <= 0) continue
        rgb[i * 3] = rgb[i * 3] * (1 - a) + src[i * 4]
        rgb[i * 3 + 1] = rgb[i * 3 + 1] * (1 - a) + src[i * 4 + 1]
        rgb[i * 3 + 2] = rgb[i * 3 + 2] * (1 - a) + src[i * 4 + 2]
      }
    }
    out.push(rgb)
  }
  return out
}

/** the texel of `flat` under u, v (0..1 across the cell) at mip `level`, its index into the level's rgb */
const texel = (u: number, v: number, level: number) => {
  const n = 32 >> level
  const x = Math.min(n - 1, Math.max(0, Math.floor(u * n)))
  const y = Math.min(n - 1, Math.max(0, Math.floor(v * n)))
  return (y * n + x) * 3
}

/**
 * Where a ray from (ox, oz), in a cell's own coordinates (0..1 east and
 * south), along (rx, rz) first meets a wall's body (`bodyRect`): its
 * rectangle less the corners cut from it. The ray's parameter there and the
 * side it struck (0 a face toward east or west, 1 toward north or south);
 * null where it passes by.
 */
function strike(b: BodyRect, ox: number, oz: number, rx: number, rz: number): [number, number] | null {
  const slab = (lo: number, hi: number, o: number, r: number): [number, number] => {
    if (Math.abs(r) < 1e-12) return o >= lo && o <= hi ? [-Infinity, Infinity] : [Infinity, -Infinity]
    const a = (lo - o) / r, c = (hi - o) / r
    return a < c ? [a, c] : [c, a]
  }
  const [xa, xb] = slab(b.x0, b.x1, ox, rx), [za, zb] = slab(b.z0, b.z1, oz, rz)
  const t0 = Math.max(xa, za), t1 = Math.min(xb, zb)
  if (t1 < Math.max(t0, 0)) return null
  let t = t0, side = xa > za ? 0 : 1
  const px = ox + t * rx, pz = oz + t * rz
  const k = b.t, E = 1e-9
  // in a cut corner: on to where the ray leaves it through the body's side of it, or past the body
  const corners: [boolean, number, number, number, number][] = [
    [b.cut[0], 0, k, 0, k], [b.cut[1], 1 - k, 1, 0, k], [b.cut[2], 0, k, 1 - k, 1], [b.cut[3], 1 - k, 1, 1 - k, 1],
  ]
  for (const [cut, cx0, cx1, cz0, cz1] of corners) {
    if (!cut || px < cx0 - E || px > cx1 + E || pz < cz0 - E || pz > cz1 + E) continue
    const ex = rx > 0 ? cx1 : cx0, ez = rz > 0 ? cz1 : cz0
    const tx = Math.abs(rx) < 1e-12 ? Infinity : (ex - ox) / rx, tz = Math.abs(rz) < 1e-12 ? Infinity : (ez - oz) / rz
    t = Math.min(tx, tz)
    side = tx < tz ? 0 : 1
    // out through the cell's own edge, not into the body
    const edge = side === 0 ? ex : ez
    if (edge <= E || edge >= 1 - E || t > t1 + E) return null
    break
  }
  return [t, side]
}

/** a wall's faces, by the side of the cell the ray struck: west and east, north and south */
const FACES = ['w', 'e', 'n', 's'] as const
const light = (d: number) => 0.3 * Math.exp(-d / FOG) + 0.9 * Math.exp(-d / TORCH)

/** the mip a texture is sampled at where a pixel spans `texels` texels: each has the same six, 32 texels a side to 1 */
const mip = (texels: number) => Math.max(0, Math.min(5, Math.floor(Math.log2(Math.max(1, texels)))))

export class GlyphView {
  private textures = new Map<string, Texture | null>()
  private scene!: Scene
  private dimRemembered = false
  things: Thing[] = []

  constructor(
    private tiles: TileSource,
    private atlas: (name: string) => Pixels | undefined,
    public opts: GlyphViewOptions = { ...GLYPH_DEFAULTS },
  ) {}

  /** the scene's cells in rows, gx0, gy0 at the first, for looking up a pixel at a time */
  private grid: (SceneCell | undefined)[] = []
  private gx0 = 0
  private gy0 = 0
  private gw = 0
  private gh = 0
  /** each cell's floor and lid, flattened (by the grid's index) */
  private floors: (Flat | undefined)[] = []
  private lids: (Flat | undefined)[] = []
  /** how much each cell is dimmed, where it is remembered rather than seen */
  private dims = new Float64Array(0)
  /** each cell's four faces as walls, and last the wall where a ray meets none */
  private walls: (Flat | undefined)[] = []

  setScene(scene: Scene) {
    this.scene = scene
    let visible = 0
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const c of scene.cells.values()) {
      if (c.visibility === 'visible') visible++
      if (c.x < x0) x0 = c.x
      if (c.x > x1) x1 = c.x
      if (c.y < y0) y0 = c.y
      if (c.y > y1) y1 = c.y
    }
    this.dimRemembered = visible > 0
    this.gx0 = x0 === Infinity ? 0 : x0
    this.gy0 = y0 === Infinity ? 0 : y0
    this.gw = x0 === Infinity ? 0 : x1 - x0 + 1
    this.gh = y0 === Infinity ? 0 : y1 - y0 + 1
    this.grid = new Array(this.gw * this.gh)
    for (const c of scene.cells.values()) this.grid[(c.y - this.gy0) * this.gw + c.x - this.gx0] = c
    this.floors = new Array(this.gw * this.gh)
    this.lids = new Array(this.gw * this.gh)
    this.walls = new Array(this.gw * this.gh * 4 + 1)
    this.dims = new Float64Array(this.gw * this.gh).fill(1)
    for (let g = 0; g < this.grid.length; g++) this.dims[g] = this.dimmed(this.grid[g])
    this.bodiesInset = -1
    // each cell's flash (linear, and how thick), and what lies on its floor (a corpse, laid flat as render-3d lays it)
    this.flashes = new Float32Array(this.gw * this.gh * 4)
    for (let g = 0; g < this.grid.length; g++) {
      const f = this.grid[g]?.flash
      if (f && f.a > 0) this.flashes.set([f.r / 255, f.g / 255, f.b / 255, Math.min(1, f.a / 255)], g * 4)
    }
    this.lying = new Map()
    for (const b of scene.billboards ?? []) {
      if (!b.lying) continue
      const gx = b.x - this.gx0, gy = b.y - this.gy0
      if (gx < 0 || gy < 0 || gx >= this.gw || gy >= this.gh) continue
      const at = gy * this.gw + gx
      const list = this.lying.get(at) ?? []
      list.push(...(b.layers?.length ? b.layers.map((l) => l.tile) : [b.tile]))
      this.lying.set(at, list)
    }
    // how each cell's feature stands (world doors.ts `featureStance`): a door in its doorway, or what something stands on, lies
    this.framed = framedDoors(scene)
    this.occupied = scene.billboards ? occupiedFeatures(scene, this.framed) : new Set()
  }
  private framed: ReadonlyMap<CellKey, number> = new Map()
  private occupied: ReadonlySet<CellKey> = new Set()
  private flashes = new Float32Array(0)
  private lying = new Map<number, TileId[]>()
  /** each cell's wall body by the grid's index (`bodyRect`), null where the wall is the whole cell or there is none */
  private bodies: (BodyRect | null)[] = []
  /** the inset the bodies were worked out for */
  private bodiesInset = -1
  /** each door in its doorway by the grid's index, as it stands where walls stand back (world doors.ts `doorBoard`) */
  private doors = new Map<number, DoorBoard>()
  /** by the grid's index, the doors whose board reaches into the cell: its own, and a wall's beside a door, which the board is stretched to reach */
  private reach: (number[] | undefined)[] = []

  /** the grid's index of cell (x, y), -1 off it */
  private index(x: number, y: number): number {
    const gx = x - this.gx0, gy = y - this.gy0
    return gx < 0 || gy < 0 || gx >= this.gw || gy >= this.gh ? -1 : gy * this.gw + gx
  }

  /**
   * Where a floor or lid pixel falls in a wall's cell, outside its body, the
   * open cell whose floor and lid reach there (world cells.ts `stripAt`); -1
   * inside the body, or where the cell is no wall's.
   */
  private strip(g: number, lx: number, lz: number): number {
    const b = this.bodies[g]
    if (!b) return -1
    const d = stripAt(b, lx, lz)
    if (!d) return -1
    const c = this.grid[g]!
    return this.index(c.x + d[0], c.y + d[1])
  }

  /**
   * Each wall's body, where walls stand back from the floor (`wallInset`),
   * worked out again when the scene or the inset is new, and each door in its
   * doorway as render-3d stands it: the walls either side stand back from it
   * as from any opening (world cells.ts `cellClass`), and its board is
   * stretched to reach them, a block the run's thickness where closed, a
   * board in the run's face you see through where its art is clear where
   * open.
   */
  private shapeWalls() {
    const inset = this.opts.wallInset ?? 0
    if (inset === this.bodiesInset) return
    this.bodiesInset = inset
    this.bodies = new Array(this.gw * this.gh).fill(null)
    // the floors again: what they leave out goes with the inset (`floorOf`)
    this.floors = new Array(this.gw * this.gh)
    this.doors = new Map()
    this.reach = new Array(this.gw * this.gh)
    if (inset <= 0) return
    const at = levelClassAt(this.scene, this.framed)
    const reachInto = (g: number, door: number) => {
      if (g >= 0) (this.reach[g] ??= []).push(door)
    }
    for (const k of this.framed.keys()) {
      const { x, y } = keyToXY(k)
      const g = this.index(x, y)
      const d = g < 0 ? null : doorBoard(this.grid[g]!, this.framed, inset, (id) => this.tiles.tile(id))
      if (!d) continue
      this.doors.set(g, d)
      reachInto(g, g)
      // the art's left end is west, or south running north–south
      const [ax, az] = d.yaw === 0 ? [-1, 0] : [0, 1]
      if (d.left > 0) reachInto(this.index(x + ax, y + az), g)
      if (d.right > 0) reachInto(this.index(x - ax, y - az), g)
    }
    for (let g = 0; g < this.grid.length; g++) {
      const c = this.grid[g]
      if (c && !this.doors.has(g) && (c.occluder || c.kind === 'unknown')) this.bodies[g] = bodyRect(at, c.x, c.y, { inset })
    }
  }

  /**
   * Where door `d`'s board, in door cell `dg`, reaches into the cell (mx, my),
   * as a rectangle of that cell's own coordinates: a closed door's block, or
   * an open one's span along its run (its across the run's whole
   * thickness); null where it does not reach in.
   */
  private doorIn(dg: number, d: DoorBoard, mx: number, my: number): BodyRect | null {
    const dc = this.grid[dg]!
    const ox = dc.x - mx, oz = dc.y - my
    const t = this.bodiesInset, k = 1 / d.art.cell
    // along the run, the art's left end west (south, running north–south), and across it the run's thickness
    const [a0, a1] = d.yaw === 0 ? [-d.left * k, 1 + d.right * k] : [-d.right * k, 1 + d.left * k]
    const x0 = Math.max(0, ox + (d.yaw === 0 ? a0 : t)), x1 = Math.min(1, ox + (d.yaw === 0 ? a1 : 1 - t))
    const z0 = Math.max(0, oz + (d.yaw === 0 ? t : a0)), z1 = Math.min(1, oz + (d.yaw === 0 ? 1 - t : a1))
    return x1 - x0 > 1e-9 && z1 - z0 > 1e-9 ? { x0, x1, z0, z1, t: 0, cut: [false, false, false, false] } : null
  }

  private flats = new Map<string, Flat>()
  /** `layers` over `base`, flattened once for every cell that has them */
  private flat(base: number, layers: (TileId | undefined | null)[]): Flat {
    const key = `${base}:${layers.join(',')}`
    let f = this.flats.get(key)
    if (!f) this.flats.set(key, (f = flatten(base, layers.map((id) => this.tex(id)))))
    return f
  }

  /** the floor of the cell at grid index g as it lies: its tile, decals and what lies on it */
  private floorOf(g: number, fc: SceneCell): Flat {
    let f = this.floors[g]
    if (!f) {
      // as render-3d lays it (world cells.ts `floorLayers`), what lies in its cell laid flat on it, and its marks; the wall shadows
      // and shorelines kept only where walls are flush with the floor, as crawl draws them
      const stance = featureStance(fc, this.framed, this.occupied)
      const { under, feature, over, marks } = floorLayers(fc, stance, (this.opts.wallInset ?? 0) <= 0)
      const flat = feature ?? (stance === 'lying' ? fc.featureTile : undefined)
      this.floors[g] = f = this.flat(0, [fc.floorTile, ...under, ...(flat !== undefined ? [flat] : []), ...over, ...(this.lying.get(g) ?? []), ...marks])
    }
    return f
  }

  /** the scene's tile `id` as art */
  art(id: TileId | undefined | null): Art | null {
    if (id == null) return null
    const rect = this.tiles.tile(id)
    const px = rect && this.atlas(rect.atlas)
    return rect && px ? { px, rect } : null
  }

  private byId = new Map<TileId, Texture | null>()
  private tex(id: TileId | undefined | null): Texture | null {
    if (id == null) return null
    // looked up a pixel at a time: by the id itself, no key to build
    let t = this.byId.get(id)
    if (t === undefined) this.byId.set(id, (t = this.texOf(`s${id}`, () => this.art(id))))
    return t
  }

  private texOf(key: string, art: () => Art | null): Texture | null {
    let t = this.textures.get(key)
    if (t === undefined) {
      const a = art()
      t = a ? new Texture(a) : null
      this.textures.set(key, t)
    }
    return t
  }

  private sprites = new Map<string, SpriteTex>()
  private spriteTex(a: Art): SpriteTex {
    const key = `${a.rect.atlas}:${a.rect.sx},${a.rect.sy},${a.rect.w},${a.rect.h}:${a.rect.ox},${a.rect.oy}${a.mirror ? ':m' : ''}`
    let t = this.sprites.get(key)
    if (!t) this.sprites.set(key, (t = new SpriteTex(a)))
    return t
  }

  private cell(x: number, y: number): SceneCell | undefined {
    const gx = x - this.gx0, gy = y - this.gy0
    return gx < 0 || gy < 0 || gx >= this.gw || gy >= this.gh ? undefined : this.grid[gy * this.gw + gx]
  }

  /**
   * The view as `W` x `H` pixels in linear light, a cell `SX` x `SY` of
   * them, with each pixel's weight (how much it stands out) and the depth
   * of each column; and what is named rather than drawn.
   */
  raster(cam: Camera, W: number, H: number, SX: number, SY: number, ro: RasterOptions = {}): Raster {
    const [ya, yb] = ro.rows ?? [0, H]
    return this.draw(this.look(cam, W, H, SX, SY, ro), ya, yb)
  }

  /**
   * What the view from `cam` is drawn from, whichever rows of it are drawn:
   * each column's ray and the wall it meets, and what stands where on the
   * screen, the farthest first.
   */
  look(cam: Camera, W: number, H: number, SX: number, SY: number, ro: RasterOptions = {}): Look {
    this.shapeWalls()
    const { fov, eye, aspect } = this.opts
    const ex = cam.eyeX + 0.5
    const ey = cam.eyeY + 0.5
    const dx = Math.sin(cam.yaw)
    const dy = -Math.cos(cam.yaw)
    const half = Math.tan((fov * Math.PI) / 360)
    const px = -dy * half
    const py = dx * half
    // focal lengths in pixels: a pixel is 1/SX of a cell wide and 1/SY of it tall
    const fx = W / 2 / half
    const fy = (fx * SY) / (aspect * SX)
    const horizon = H / 2 + Math.tan(cam.pitch) * fy
    // the walls, floors and lid drawn a block of `step` x `step` pixels at a time: finer pixels are for what stands
    const step = ro.coarse ?? 1
    const n = Math.ceil(W / step)
    const L: Look = {
      W, H, SX, SY, step, sampling: ro.sampling ?? this.opts.sampling, ex, ey, fx, fy, horizon,
      zbuf: new Float32Array(W), rx: new Float64Array(n), ry: new Float64Array(n), u: new Float64Array(n),
      top: new Float64Array(n), bot: new Float64Array(n), wallK: new Float64Array(n), wallLevel: new Uint8Array(n), wallG: new Int32Array(n), wall: new Array(n),
      boards: new Uint8Array(n), boardT: new Float64Array(n * BOARDS), boardU: new Float64Array(n * BOARDS), boardG: new Int32Array(n * BOARDS), boardTex: new Array(n * BOARDS),
      sprites: [], glyphs: [],
    }
    const { zbuf } = L
    for (let col = 0, b = 0; col < W; col += step, b++) {
      const cx = (2 * (col + step / 2)) / W - 1
      const rx = (L.rx[b] = dx + px * cx)
      const ry = (L.ry[b] = dy + py * cx)
      // DDA through the grid
      let mx = Math.floor(ex)
      let my = Math.floor(ey)
      const ddx = Math.abs(1 / rx)
      const ddy = Math.abs(1 / ry)
      const sx = rx < 0 ? -1 : 1
      const sy = ry < 0 ? -1 : 1
      let sdx = (rx < 0 ? ex - mx : mx + 1 - ex) * ddx
      let sdy = (ry < 0 ? ey - my : my + 1 - ey) * ddy
      let side = 0
      let hit: SceneCell | undefined
      let g = -1
      let dist = 64
      let door: DoorBoard | undefined
      for (let i = 0; i < 96; i++) {
        if (sdx < sdy) {
          sdx += ddx
          mx += sx
          side = 0
        } else {
          sdy += ddy
          my += sy
          side = 1
        }
        const gx = mx - this.gx0, gy = my - this.gy0
        g = gx < 0 || gy < 0 || gx >= this.gw || gy >= this.gh ? -1 : gy * this.gw + gx
        const c = g < 0 ? undefined : this.grid[g]
        // the doors whose board reaches this cell, as render-3d stands them (world doors.ts `doorBoard`): an open one a
        // board in its run's face on the eye's side, struck where the ray crosses it; a closed one a block the run's
        // thickness, met as a wall's body is. Either reaches into the walls beside it, as far as they stand back
        const near = g < 0 ? undefined : this.reach[g]
        let blockT = Infinity, blockSide = 0, blockG = -1
        if (near)
          for (const dg of near) {
            const d = this.doors.get(dg)!
            const span = this.doorIn(dg, d, mx, my)
            if (!span) continue
            if (d.closed) {
              const struck = strike(span, ex - mx, ey - my, rx, ry)
              if (struck && struck[0] < blockT) [blockT, blockSide, blockG] = [struck[0], struck[1], dg]
              continue
            }
            if (L.boards[b] >= BOARDS) continue
            const dc = this.grid[dg]!
            const t = this.bodiesInset, ox = ex - dc.x, oz = ey - dc.y
            const across = d.yaw === 0
            const o = across ? oz : ox, r = across ? ry : rx
            const plane = o < 0.5 ? t : 1 - t
            const tp = Math.abs(r) < 1e-12 ? -1 : (plane - o) / r
            if (!(tp > 0)) continue
            // where along the run, in this cell and in the door's
            const lx = ex - mx + tp * rx, lz = ey - my + tp * ry
            if (across ? lx < span.x0 || lx >= span.x1 : lz < span.z0 || lz >= span.z1) continue
            const tx = boardTexel(d, boardAlong(d, ox + tp * rx, oz + tp * ry))
            if (Number.isNaN(tx)) continue
            // nearest first
            let k = b * BOARDS + L.boards[b]++
            for (; k > b * BOARDS && L.boardT[k - 1] > tp; k--) {
              L.boardT[k] = L.boardT[k - 1]
              L.boardU[k] = L.boardU[k - 1]
              L.boardG[k] = L.boardG[k - 1]
              L.boardTex[k] = L.boardTex[k - 1]
            }
            L.boardT[k] = tp
            L.boardU[k] = tx / d.art.cell
            L.boardG[k] = dg
            L.boardTex[k] = this.tex(d.tile)
          }
        if (!c || (c.occluder && !this.doors.has(g)) || c.kind === 'unknown') {
          // the wall's body as render-3d stands it (`bodyRect`): back from the floor round it, a corner cut where a
          // diagonal is open; a ray through what it leaves of the cell goes on to the next
          const body = g < 0 ? null : this.bodies[g]
          if (body) {
            const struck = strike(body, ex - mx, ey - my, rx, ry)
            if (struck && struck[0] <= blockT) {
              side = struck[1]
              hit = c
              dist = struck[0]
              break
            }
          } else if (blockG < 0) {
            hit = c
            dist = side === 0 ? sdx - ddx : sdy - ddy
            break
          }
        }
        if (blockG >= 0) {
          side = blockSide
          dist = blockT
          g = blockG
          hit = this.grid[g]
          door = this.doors.get(g)!
          break
        }
      }
      // an open door's board behind what the ray met is hidden by it
      while (L.boards[b] > 0 && L.boardT[b * BOARDS + L.boards[b] - 1] > dist) L.boards[b]--
      dist = Math.max(dist, NEAR)
      for (let m = 0; m < step; m++) zbuf[col + m] = dist
      // where along the face the ray struck, 0..1 left to right as the eye sees it, and which face
      let u = side === 0 ? ey + dist * ry : ex + dist * rx
      u -= Math.floor(u)
      const f = side === 0 ? (rx > 0 ? 0 : 1) : ry > 0 ? 2 : 3
      if (f === 1 || f === 2) u = 1 - u
      const top = (L.top[b] = horizon - ((1 - eye) * fy) / dist)
      const bot = (L.bot[b] = horizon + (eye * fy) / dist)
      const at = hit ? g * 4 + f : this.walls.length - 1
      let wall = this.walls[at]
      if (door) {
        // a closed door's block: its art along the run as its board's is, whichever face (`boardTexel`), its ends their edge columns
        const dc = hit!, k = 1 / door.art.cell
        const s = boardAlong(door, ex + dist * rx - dc.x, ey + dist * ry - dc.y)
        const tx = boardTexel(door, Math.min(1 + door.right * k - 1e-6, Math.max(-door.left * k, s)))
        u = Number.isNaN(tx) ? 0 : tx * k
        wall = this.flat(0.02, [door.tile])
      } else if (!wall) this.walls[at] = wall = this.flat(0.02, [faceTile(hit, FACES[f]) ?? hit?.featureTile, ...(hit?.wallOverlays ?? [])])
      L.wallK[b] = (f < 2 ? 0.8 : 1) * light(dist) * this.dimmed(hit)
      L.wallG[b] = hit ? g : -1
      // the mip for the texels a pixel of the wall spans
      const level = (L.wallLevel[b] = mip(32 / ((bot - top) || 1)))
      L.wall[b] = wall[level]
      L.u[b] = u
    }

    // what stands: sprites facing the eye, the farthest first
    const det = 1 / (px * dy - dx * py)
    this.stand(L, ro, (t) => {
      const rx = t.x + 0.5 - ex
      const ry = t.y + 0.5 - ey
      const across = det * (dy * rx - dx * ry)
      const depth = det * (-py * rx + px * ry)
      return { depth, sx: (W / 2) * (1 + across / depth), floorY: horizon + ((eye - (t.lift ?? 0)) * fy) / depth }
    })
    return L
  }

  /**
   * What stands, into `L`: each thing where `place` puts it on the screen
   * (its depth, the middle of its foot across, and the row of its foot), the
   * farthest first; a sprite where it is big enough to make out, else its
   * glyph.
   */
  private stand(L: Look, ro: RasterOptions, place: (t: Thing) => { depth: number; sx: number; floorY: number }) {
    const { W, H, SX, SY, fx, fy, glyphs } = L
    const seen = this.things
      .filter((t) => !t.hand)
      .map((t) => ({ t, ...place(t) }))
      .filter((v) => v.depth > 0.3)
      .sort((a, b) => b.depth - a.depth)
    for (const v of seen) {
      const { t, depth } = v
      let floorY = v.floorY
      // a cell's sprite: 32 texels, `size` cells tall and as wide
      const side = (t.size * fy) / depth
      const tall = side / SY // in rows
      const letter = t.alive && this.opts.letters
      const glyphRows = this.opts.glyphRows ?? GLYPH_ROWS
      if (!ro.allSprites && (letter || !t.art.length || tall < glyphRows)) {
        if (t.glyph && (t.alive || !t.art.length || tall >= 1)) glyphs.push({ t, depth, sx: v.sx / SX, floorY: floorY / SY, tall })
        if (letter || !t.art.length || (t.alive && tall < glyphRows)) continue
      }
      const texs = t.art.map((a) => this.spriteTex(a))
      // as wide as tall on the screen, whatever the shape of a pixel
      const sideX = (t.size * fx) / depth
      let x0 = v.sx - sideX / 2
      let y0 = floorY - side
      // near, on the dots (2 pixels a side), read on its grid
      let grid: [number, number] | undefined
      if (this.opts.grid && sideX >= 64 && side >= 64) {
        x0 = 2 * Math.round(x0 / 2)
        y0 = 2 * Math.round(y0 / 2)
        floorY = y0 + side
        grid = [gridFor(sideX / 32, SX), gridFor(side / 32, SY)]
      }
      const k = t.light ?? (t.alive ? 1.1 : light(depth)) * this.dimmed(this.cell(Math.round(t.x), Math.round(t.y)))
      const c0 = Math.max(0, Math.floor(x0)), c1 = Math.min(W - 1, Math.ceil(x0 + sideX))
      // a tile may reach above its cell (a royal jelly's is half again as tall)
      const reach = Math.max(1, ...texs.map((tx) => tx.top + 1))
      const r0 = Math.max(0, Math.floor(floorY - side * reach)), r1 = Math.min(H - 1, Math.ceil(floorY))
      if (c0 > c1 || r0 > r1) continue
      L.sprites.push({ texs, x0, y0, sideX, side, c0, c1, r0, r1, depth, k, alpha: t.alpha ?? 1, flash: t.flash, grid, columns: {} })
      if (t.alive && t.name && tall > 5 && this.opts.labels !== false) glyphs.push({ t, depth, sx: v.sx / SX, floorY: floorY / SY, tall, label: true })
    }
    // the hands last, over all: in their own lens, the view two units tall (render-3d hands.ts), as wide as tall on
    // the screen whatever the shape of a pixel, read on their grid where their texels fill a dot
    const pixelAspect = (this.opts.aspect * SX) / SY, unit = H / 2
    this.handCells = []
    for (const t of this.things) {
      const h = t.hand
      if (!h || !t.art.length) continue
      const texs = t.art.map((a) => this.spriteTex(a))
      // the tile's texels down and across, its middle and its foot, in the tile's own texels
      let span = 32, mid = 16, foot = 32
      const boxes = texs.map((tx) => tx.box()).filter((b) => !!b)
      if (h.fit && boxes.length) {
        const bx0 = Math.min(...boxes.map((b) => b!.x0)), bx1 = Math.max(...boxes.map((b) => b!.x1)) + 1
        const by0 = Math.min(...boxes.map((b) => b!.y0)), by1 = Math.max(...boxes.map((b) => b!.y1)) + 1
        span = Math.max(bx1 - bx0, by1 - by0) / VM_FILL
        mid = (bx0 + bx1) / 2
        foot = by1 - Math.max(...texs.map((tx) => tx.top * 32))
      }
      const side = ((h.size * unit) * 32) / span, sideX = side * pixelAspect
      const aspect = W / (H * pixelAspect)
      let x0 = W / 2 + h.x * aspect * unit * pixelAspect - (mid / 32) * sideX
      let y0 = H / 2 - h.y * unit - (foot / 32) * side
      let grid: [number, number] | undefined
      if (this.opts.grid && sideX >= 64 && side >= 64) {
        x0 = 2 * Math.round(x0 / 2)
        y0 = 2 * Math.round(y0 / 2)
        grid = [gridFor(sideX / 32, SX), gridFor(side / 32, SY)]
      }
      const c0 = Math.max(0, Math.floor(x0)), c1 = Math.min(W - 1, Math.ceil(x0 + sideX))
      const r0 = Math.max(0, Math.floor(y0)), r1 = Math.min(H - 1, Math.ceil(y0 + side))
      if (c0 > c1 || r0 > r1) continue
      L.sprites.push({ texs, x0, y0, sideX, side, c0, c1, r0, r1, depth: 0, k: t.light ?? 1, alpha: t.alpha ?? 1, flash: t.flash, grid, columns: {} })
      // its art's own box, in cells
      const bs = texs.map((tx) => tx.box()).filter((b) => !!b)
      if (bs.length) {
        const ax0 = x0 + (Math.min(...bs.map((b) => b!.x0)) / 32) * sideX, ax1 = x0 + ((Math.max(...bs.map((b) => b!.x1)) + 1) / 32) * sideX
        const ay0 = y0 + (Math.min(...bs.map((b) => b!.y0)) / 32) * side, ay1 = y0 + ((Math.max(...bs.map((b) => b!.y1)) + 1) / 32) * side
        this.handCells.push([Math.floor(ax0 / SX), Math.floor(ax1 / SX), Math.floor(ay0 / SY), Math.floor(ay1 / SY)])
      }
    }
  }

  private dimmed(c: SceneCell | undefined) {
    return this.dimRemembered && c && c.visibility !== 'visible' ? 0.45 : 1
  }

  /** memory a band is drawn in, kept from band to band (`band`), so drawing makes no garbage of pictures */
  private scratch = { pix: new Float32Array(0), weight: new Float32Array(0), thing: new Float32Array(0), standing: new Uint8Array(0) }

  /**
   * The pixel rows ya up to yb (multiples of the look's `step`) of what
   * `look` saw, the raster's rows those; in the view's own memory (`reuse`),
   * which the next band draws over.
   */
  draw(L: Look, ya: number, yb: number, reuse = false): Raster {
    const { W, H, SX, SY, step, ex, ey, fx, fy, horizon, zbuf } = L
    const BH = yb - ya
    const n = W * BH
    const sc = this.scratch
    if (reuse && sc.weight.length < n) this.scratch = { pix: new Float32Array(n * 3), weight: new Float32Array(n), thing: new Float32Array(n), standing: new Uint8Array(n) }
    // every pixel is drawn over by the walls, floors and lid, so the memory needs no clearing first
    const pix = reuse ? this.scratch.pix.subarray(0, n * 3) : new Float32Array(n * 3)
    // how much each pixel counts when a cell's dots are split in two
    const weight = reuse ? this.scratch.weight.subarray(0, n).fill(1) : new Float32Array(n).fill(1)
    const thing = reuse ? this.scratch.thing.subarray(0, n).fill(0) : new Float32Array(n)
    // the cells something stands in (below)
    const cw = W / SX
    const standing = reuse ? this.scratch.standing.subarray(0, (n / (SX * SY)) | 0).fill(0) : new Uint8Array((n / (SX * SY)) | 0)
    const standK = this.opts.stand ?? 40
    setDark(this.opts.dark ?? 0.7)
    setChroma(this.opts.chroma ?? 0)
    const { eye } = this.opts
    const tint = this.scene.level.tint
    const sky = this.scene.level.sky
    const lidId = this.scene.level.ceilingTile
    const tr = tint.r, tg = tint.g, tb = tint.b
    // a block's first pixel only, where the cells are drawn from this memory alone: the dots are read there, and the rest of a block only where something stands (`spread`, below)
    const once = reuse && step > 1
    const flashes = this.flashes
    /**
     * a pixel of the level, its colour lit by `k`, and washed with the flash of the cell `fg` (the grid's index; -1 for
     * none); then `over` laid on it, unlit, at its alpha (the cursor)
     */
    const put = (i: number, r: number, g: number, b: number, k: number, fg = -1, over?: RGB, oa = 0) => {
      let R = r * k * tr, G = g * k * tg, B = b * k * tb
      const fa = fg >= 0 ? flashes[fg * 4 + 3] : 0
      if (fa > 0) {
        R += (flashes[fg * 4] - R) * fa
        G += (flashes[fg * 4 + 1] - G) * fa
        B += (flashes[fg * 4 + 2] - B) * fa
      }
      if (over && oa > 0) {
        R += (over[0] - R) * oa
        G += (over[1] - G) * oa
        B += (over[2] - B) * oa
      }
      if (once) {
        pix[i * 3] = R
        pix[i * 3 + 1] = G
        pix[i * 3 + 2] = B
        return
      }
      for (let j = 0; j < step; j++)
        for (let m = 0; m < step; m++) {
          const o = (i + j * W + m) * 3
          pix[o] = R
          pix[o + 1] = G
          pix[o + 2] = B
        }
    }
    const lid = sky === 'open' || sky === 'dark' ? null : this.flat(0, [lidId])
    // what of a pixel of the floor or lid is the same along its row: how far it is, its mip and its light
    const rowD = new Float64Array(H), rowLevel = new Uint8Array(H), rowLight = new Float64Array(H)
    for (let row = ya; row < yb; row += step) {
      const yc = row + step / 2
      const above = yc < horizon
      const yo = Math.abs(yc - horizon) || 1e-3
      const d = ((above ? 1 - eye : eye) * fy) / yo
      rowD[row] = d
      // the footprint: across, a column's worth of the floor; down, a row's, which grows fast toward the horizon
      rowLevel[row] = mip(32 * Math.max(d / fx, (d * d) / ((above ? 1 - eye : eye) * fy)) * 0.7)
      rowLight[row] = light(d)
    }

    const dims = this.dims
    const cursor = this.opts.cursor
    // the cursor: its icon where the tiles have it (premultiplied, its mips), else the ring in its mode's colour
    const cursorTex = cursor?.tile !== undefined ? this.tex(cursor.tile) : null
    const ringRgb = linear(cursorColour({ mode: cursor?.mode ?? 'target' }))
    const mark: RGB = [0, 0, 0]
    for (let col = 0, b = 0; col < W; col += step, b++) {
      const rx = L.rx[b], ry = L.ry[b], u = L.u[b], top = L.top[b], bot = L.bot[b]
      const wallRgb = L.wall[b], wallLevel = L.wallLevel[b], wallK = L.wallK[b], wallG = L.wallG[b]
      const nBoards = L.boards[b]
      rows: for (let row = ya; row < yb; row += step) {
        const i = (row - ya) * W + col
        const yc = row + step / 2
        // an open door's art where it is opaque, the nearest first; where it is clear, what is beyond
        for (let k = b * BOARDS; k < b * BOARDS + nBoards; k++) {
          const tex = L.boardTex[k]
          const t = L.boardT[k]
          const bt = horizon - ((1 - eye) * fy) / t, bb = horizon + (eye * fy) / t
          if (!tex || yc < bt || yc >= bb) continue
          const lv = tex.levels[mip(32 / (bb - bt || 1))]
          const nn = lv.n
          const o = (Math.min(nn - 1, Math.floor(((yc - bt) / (bb - bt)) * nn)) * nn + Math.min(nn - 1, Math.max(0, Math.floor(L.boardU[k] * nn)))) * 4
          const a = lv.rgba[o + 3]
          if (a < 0.5) continue
          const bg = L.boardG[k]
          put(i, lv.rgba[o] / a, lv.rgba[o + 1] / a, lv.rgba[o + 2] / a, light(t) * dims[bg], bg)
          continue rows
        }
        if (yc >= top && yc < bot) {
          const o = texel(u, (yc - top) / (bot - top), wallLevel)
          put(i, wallRgb[o], wallRgb[o + 1], wallRgb[o + 2], wallK, wallG)
          continue
        }
        // floor or lid, cast through the pixel's middle
        const above = yc < top
        const d = rowD[row]
        const level = rowLevel[row]
        const wx = ex + d * rx
        const wy = ey + d * ry
        const cx = Math.floor(wx), cy = Math.floor(wy)
        let g = this.index(cx, cy)
        let fc = g < 0 ? undefined : this.grid[g]
        // in a wall's cell, beside its body: the floor and lid of the open cell beside it, its floor tile alone
        let bare = false
        if (fc && this.bodies[g]) {
          const n = this.strip(g, wx - cx, wy - cy)
          if (n >= 0 && this.grid[n]) {
            g = n
            fc = this.grid[n]
            bare = true
          }
        }
        if (above) {
          if (sky === 'open') {
            const yo = Math.abs(yc - horizon) || 1e-3
            const t = Math.min(1, yo / (H / 2))
            put(i, 0.02 + 0.12 * t, 0.05 + 0.2 * t, 0.12 + 0.4 * t, 1)
          } else if (sky === 'dark') put(i, 0.004, 0.002, 0.008, 1)
          else {
            let f = lid!
            if (fc?.ceilingTile != null) {
              f = this.lids[g]!
              if (!f) this.lids[g] = f = this.flat(0, [fc.ceilingTile])
            }
            const rgb = f[level]
            const o = texel(wx - cx, wy - cy, level)
            put(i, rgb[o], rgb[o + 1], rgb[o + 2], LID * rowLight[row] * (g < 0 ? 1 : dims[g]), g)
          }
          continue
        }
        if (!fc) {
          put(i, 0, 0, 0, rowLight[row])
          continue
        }
        const rgb = (bare ? this.flat(0, [fc.floorTile]) : this.floorOf(g, fc))[level]
        const o = texel(wx - cx, wy - cy, level)
        // the cursor on its cell's floor, unlit (world marks.ts): its icon, or a diamond band round the cell's middle,
        // as much of the pixel as it covers, the pixel's width on the floor taken from how far it is
        let oa = 0
        if (cursor && cx === cursor.x && cy === cursor.y) {
          if (cursorTex) {
            const lv = cursorTex.levels[level], n = lv.n
            const t = (Math.min(n - 1, Math.floor((wy - cy) * n)) * n + Math.min(n - 1, Math.floor((wx - cx) * n))) * 4
            oa = lv.rgba[t + 3]
            if (oa > 0) (mark[0] = lv.rgba[t] / oa), (mark[1] = lv.rgba[t + 1] / oa), (mark[2] = lv.rgba[t + 2] / oa)
          } else {
            oa = CURSOR_ALPHA * ringCover(wx - cx, wy - cy, (1.5 * d * step) / fx)
            ;(mark[0] = ringRgb[0]), (mark[1] = ringRgb[1]), (mark[2] = ringRgb[2])
          }
        }
        put(i, rgb[o], rgb[o + 1], rgb[o + 2], rowLight[row] * dims[g], g, mark, oa)
      }
    }

    // the blocks round what stands, every pixel of them, as the cells it is in are fitted to them
    if (once)
      for (const sp of L.sprites) {
        const y0 = Math.max(ya, Math.floor(sp.r0 / SY) * SY), y1 = Math.min(yb, Math.ceil((sp.r1 + 1) / SY) * SY)
        const x0 = Math.floor(sp.c0 / SX) * SX, x1 = Math.min(W, Math.ceil((sp.c1 + 1) / SX) * SX)
        for (let y = y0; y < y1; y += step)
          for (let x = x0; x < x1; x += step) {
            const i = ((y - ya) * W + x) * 3
            const R = pix[i], G = pix[i + 1], B = pix[i + 2]
            for (let j = 0; j < step; j++)
              for (let m = j ? 0 : 1; m < step; m++) {
                const o = i + (j * W + m) * 3
                pix[o] = R
                pix[o + 1] = G
                pix[o + 2] = B
              }
          }
      }
    for (const sp of L.sprites) {
      const r0 = Math.max(ya, sp.r0), r1 = Math.min(yb - 1, sp.r1)
      if (r0 > r1) continue
      const { k, flash } = sp
      const alpha = sp.alpha
      drawSprite(sp.texs, L.sampling, this.opts.standsOut, this.opts.mean, this.opts.feature, this.opts.ink, this.opts.snap, sp.x0, sp.y0, sp.sideX, sp.side, sp.c0, sp.c1, r0, r1, sp.depth, zbuf, W, (at, r, g, b, a, stand) => {
        a *= alpha
        if (flash) {
          r += (flash[0] - r) * flash[3]
          g += (flash[1] - g) * flash[3]
          b += (flash[2] - b) * flash[3]
        }
        const i = at - ya * W
        weight[i] = 1 + standK * stand * stand
        if (a === 1) {
          // all of the pixel: what is behind left out, as by coverage it would be
          pix[i * 3] = r * k * tr
          pix[i * 3 + 1] = g * k * tg
          pix[i * 3 + 2] = b * k * tb
          thing[i] = 1
          return
        }
        // straight colour over what is behind, by coverage
        pix[i * 3] = pix[i * 3] * (1 - a) + r * k * tint.r * a
        pix[i * 3 + 1] = pix[i * 3 + 1] * (1 - a) + g * k * tint.g * a
        pix[i * 3 + 2] = pix[i * 3 + 2] * (1 - a) + b * k * tint.b * a
        thing[i] = thing[i] * (1 - a) + a
      }, sp.columns, sp.grid)
    }
    // the cells something stands in: those where it covers half a pixel, looked for only where it is (2 for a cell looked at and not)
    for (const sp of L.sprites) {
      const y0 = Math.max(ya, Math.floor(sp.r0 / SY) * SY), y1 = Math.min(yb, Math.ceil((sp.r1 + 1) / SY) * SY)
      const x0 = Math.floor(sp.c0 / SX) * SX, x1 = Math.min(W, Math.ceil((sp.c1 + 1) / SX) * SX)
      for (let y = y0; y < y1; y += SY)
        for (let x = x0; x < x1; x += SX) {
          const c = ((y - ya) / SY) * cw + x / SX
          if (standing[c]) continue
          standing[c] = 2
          for (let j = 0; j < SY && standing[c] === 2; j++) {
            const o = (y - ya + j) * W + x
            for (let i = 0; i < SX; i++)
              if (thing[o + i] >= 0.5) {
                standing[c] = 1
                break
              }
          }
        }
    }
    return { W, H: BH, SX, SY, pix, weight, thing, standing, zbuf, glyphs: L.glyphs }
  }

  /** pixels a cell, across and down, as the options' encoder draws them */
  get cellPx(): { SX: number; SY: number } {
    const e = this.encoder()
    return { SX: e.SX, SY: e.SY }
  }

  private enc: { key: string; enc: Encoder } | null = null
  /** the encoder the options ask for, kept from frame to frame with what it has learned */
  private encoder(): Encoder {
    const key = `${this.opts.encoder}:${this.opts.mosaic}:${JSON.stringify(this.opts.fit ?? {})}`
    if (this.enc?.key !== key) this.enc = { key, enc: this.opts.encoder === 'fit' ? encoders.fit(this.opts.mosaic, this.opts.fit) : encoders.dots(this.opts.mosaic) }
    return this.enc.enc
  }

  render(cam: Camera, cols: number, rows: number): Cell[] {
    return this.band(this.prepare(cam, cols, rows), 0, rows)
  }

  /** What the view from `cam`, `cols` x `rows` cells, is drawn from, for each band of it (`band`). */
  prepare(cam: Camera, cols: number, rows: number): Prepared {
    const enc = this.encoder()
    return { enc, cols, rows, look: this.look(cam, cols * enc.SX, rows * enc.SY, enc.SX, enc.SY, { coarse: enc.coarse }) }
  }

  /** The rows ra up to rb of a view `prepare`d: each band the same cells as the whole has there. */
  band(p: Prepared, ra: number, rb: number): Cell[] {
    const out = new Int32Array((rb - ra) * p.cols * 3)
    this.bandInto(p, ra, rb, out)
    return unpack(out)
  }

  /** The same, packed (encode.ts `pack`) into `out`. */
  bandInto(p: Prepared, ra: number, rb: number, out: Int32Array) {
    const { enc, cols, rows } = p
    const r = this.draw(p.look, ra * enc.SY, rb * enc.SY, true)
    enc.encodeInto(r, cols, rb - ra, out)
    this.overlay(out, cols, rows, r, ra, rb)
  }

  /** then what is named rather than drawn, and the names of what is near: in `out`, the rows ra up to rb, each cell changed as a `Cell` (`cellOf`) */
  private overlay(cells: Int32Array, cols: number, rows: number, r: Raster, ra: number, rb: number) {
    const { glyphs, zbuf, SX } = r
    this.lastSY = r.SY
    const labels: { name: string; sx: number; row: number; depth: number }[] = []
    for (const g of glyphs) {
      const floorRow = g.floorY
      if (g.label) {
        labels.push({ name: g.t.name!, sx: g.sx, row: Math.floor(floorRow) + 1, depth: g.depth })
        continue
      }
      const fg = g.t.colour
      if (g.tall >= (this.opts.glyphRows ?? GLYPH_ROWS) && g.t.alive) {
        this.bigLetter(cells, cols, ra, rb, g.t.glyph, fg, g.sx, floorRow, g.tall * 0.92, g.depth, zbuf, SX)
        if (g.t.name && g.tall > 5) labels.push({ name: g.t.name, sx: g.sx, row: Math.floor(floorRow) + 1, depth: g.depth })
        continue
      }
      const row = Math.floor(floorRow - Math.max(0.5, g.tall / 2))
      const col = Math.floor(g.sx)
      if (row < ra || row >= rb || col < 0 || col >= cols || this.hidden(zbuf, col, row, SX, r.SY, cols, g.depth)) continue
      const at = (row - ra) * cols + col
      const o = cellOf(cells, at)
      o.ch = g.t.glyph
      if (this.opts.farTint && g.t.alive && g.t.art.length) {
        // the glyph on a cell of the colour the thing is from far off, in a colour that stands out from it
        const [r, gr, b] = this.spriteTex(g.t.art[g.t.art.length - 1]).bodyColour()
        const tint = this.scene.level.tint
        const bg = [q(r * 0.8 * tint.r), q(gr * 0.8 * tint.g), q(b * 0.8 * tint.b)] as RGB
        o.bg = bg
        const lum = (c: RGB) => (0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]) / 255
        o.fg = Math.abs(lum(fg) - lum(bg)) >= 0.3 ? fg : lum(bg) > 0.45 ? (bg.map((v) => Math.round(v * 0.2)) as RGB) : (fg.map((v) => Math.round(v + (255 - v) * 0.7)) as RGB)
        packCell(o, cells, at * 3)
        continue
      }
      // the glyph on what is behind it, evened out and darkened so it reads
      o.bg = seenColour(o).map((v) => Math.round(v * 0.4)) as RGB
      o.fg = fg
      packCell(o, cells, at * 3)
    }
    const placed: [number, number, number][] = []
    for (const l of labels.sort((a, b) => a.depth - b.depth)) {
      const c0 = Math.round(l.sx - l.name.length / 2)
      if (l.row >= rows || placed.some(([r, a, b]) => r === l.row && c0 <= b && c0 + l.name.length >= a)) continue
      placed.push([l.row, c0, c0 + l.name.length])
      if (l.row < ra || l.row >= rb) continue
      for (let i = 0; i < l.name.length; i++) {
        const col = c0 + i
        if (col < 0 || col >= cols || this.hidden(zbuf, col, l.row, SX, r.SY, cols, l.depth)) continue
        const at = (l.row - ra) * cols + col
        const o = cellOf(cells, at)
        o.bg = seenColour(o).map((v) => Math.round(v * 0.35)) as RGB
        o.ch = l.name[i]
        o.fg = [220, 215, 205]
        packCell(o, cells, at * 3)
      }
    }
  }

  private lastSY = 8
  /** whether the cell (col, row) shows something nearer than `depth`: its column's wall, or a hand */
  private hidden(zbuf: Float32Array, col: number, row: number, SX: number, _SY: number, _cols: number, depth: number): boolean {
    return zbuf[col * SX] < depth - 0.5 || this.handCells.some(([c0, c1, r0, r1]) => col >= c0 && col <= c1 && row >= r0 && row <= r1)
  }
  /** the cells each hand's square covers, as the last `look` placed them: what is named is not written over them */
  private handCells: [number, number, number, number][] = []

  /** crawl's letter drawn large in octants, standing on the floor */
  private bigLetter(cells: Int32Array, cols: number, ra: number, rb: number, glyph: string, fg: RGB, sx: number, floorRow: number, tall: number, depth: number, zbuf: Float32Array, DX: number) {
    const mask = bigGlyph(glyph, Math.round(tall * 4), this.opts.aspect)
    if (!mask) return
    const wCells = Math.ceil(mask.w / 2)
    const hCells = Math.ceil(mask.h / 4)
    const c0 = Math.round(sx - wCells / 2)
    const r0 = Math.round(floorRow - hCells)
    const edge = fg.map((c) => Math.round(c * 0.3)) as RGB
    for (let cy = 0; cy < hCells; cy++) {
      const row = r0 + cy
      if (row < ra || row >= rb) continue
      for (let cx = 0; cx < wCells; cx++) {
        const col = c0 + cx
        if (col < 0 || col >= cols || this.hidden(zbuf, col, row, DX, this.lastSY, cols, depth)) continue
        let bits = 0
        let near = 0
        for (let j = 0; j < 4; j++)
          for (let i = 0; i < 2; i++) {
            const mx = cx * 2 + i
            const my = cy * 4 + j
            if (mask.at(mx, my)) bits |= 1 << (j * 2 + i)
            else if (mask.at(mx - 1, my) || mask.at(mx + 1, my) || mask.at(mx, my - 1) || mask.at(mx, my + 1)) near |= 1 << (j * 2 + i)
          }
        const at = (row - ra) * cols + col
        const o = cellOf(cells, at)
        const lit = 1.12 - 0.3 * (cy / hCells)
        // a half-block cell under the letter: its two halves evened out, as the letter takes the cell's glyph
        const behind = seenColour(o).map((v) => Math.round(v)) as RGB
        if (bits) {
          o.ch = OCTANTS[bits]
          o.fg = fg.map((v) => Math.min(255, Math.round(v * lit))) as RGB
          o.bg = near ? edge : behind
        } else if (near) {
          o.ch = OCTANTS[near]
          o.fg = edge
          o.bg = behind
        }
        packCell(o, cells, at * 3)
      }
    }
  }
}

/** a cell's colour as the eye takes it from its two: its foreground over as much of it as its glyph inks (`inked`) */
const seenColour = (o: Cell): RGB => {
  const c = inked(o.ch.codePointAt(0)!)
  return [0, 1, 2].map((k) => o.bg[k] * (1 - c) + o.fg[k] * c) as RGB
}

/** whether two cells look the same: their glyph, background, and foreground where the glyph shows it */
const sameCell = (a: Cell, b: Cell) =>
  a.ch === b.ch && a.bg[0] === b.bg[0] && a.bg[1] === b.bg[1] && a.bg[2] === b.bg[2] &&
  (a.ch === ' ' || (a.fg[0] === b.fg[0] && a.fg[1] === b.fg[1] && a.fg[2] === b.fg[2]))

/** A cell packed as three numbers from `at`, for memory threads share: its glyph's code point, then fg and bg as 0xRRGGBB. */
export function packCell(o: Cell, into: Int32Array, at: number) {
  into[at] = o.ch.codePointAt(0)!
  into[at + 1] = (o.fg[0] << 16) | (o.fg[1] << 8) | o.fg[2]
  into[at + 2] = (o.bg[0] << 16) | (o.bg[1] << 8) | o.bg[2]
}

/**
 * The rows ra up to rb of a frame `prepare`d, packed into `cur`, and as
 * terminal output (`ansiInto`) against the frame shown before (`prev`; null
 * to draw them whole) into `buf` from `at`: a band of a frame on a thread,
 * threads.ts. Where the output ends in `buf`.
 */
export function bandOut(view: GlyphView, p: Prepared, ra: number, rb: number, top: number, prev: Int32Array | null, cur: Int32Array, buf: Uint8Array, at: number): number {
  const a = ra * p.cols * 3, b = rb * p.cols * 3
  view.bandInto(p, ra, rb, cur.subarray(a, b))
  return ansiInto(cur, a, p.cols, rb - ra, top + ra, prev && prev.subarray(a, b), buf, at)
}

/** The rows ra up to rb of a frame `prepare`d, packed into `cur`, with no terminal output: for a host that writes them itself, over and under its own. */
export function cellsOut(view: GlyphView, p: Prepared, ra: number, rb: number, cur: Int32Array): number {
  view.bandInto(p, ra, rb, cur.subarray(ra * p.cols * 3, rb * p.cols * 3))
  return 0
}

/** the most bytes `ansiInto` writes for a cell (a move, both colours, a glyph), and for the rest of each band */
export const ANSI_CELL = 56
export const ANSI_BAND = 16

const DIGITS = Array.from({ length: 256 }, (_, v) => Uint8Array.from(String(v), (c) => c.charCodeAt(0)))
const NUMS = (() => {
  const bytes = new Uint8Array(256 * 4)
  for (let v = 0; v < 256; v++) {
    bytes[v * 4] = DIGITS[v].length
    bytes.set(DIGITS[v], v * 4 + 1)
  }
  return bytes
})()

const FULL = 0x2588
/** whether every terminal draws the glyph one cell wide: what is not East Asian or an emoji, the punctuation, arrows, boxes and shapes, and the mosaics */
const narrow = (cp: number) => cp < 0x1100 || (cp >= 0x2000 && cp < 0x2800) || (cp >= 0x1cd00 && cp < 0x1ce00) || (cp >= 0x1fb00 && cp < 0x1fc00)
/** bytes of a glyph in UTF-8 */
const utf8 = (cp: number) => (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4)

/**
 * `toAnsi` for packed cells (`cells` from `from`, `prev` as many from 0),
 * written as UTF-8 into `buf` from `at`: where they end. Each cell the same
 * as `toAnsi` draws it, but a glyph may be drawn as its inverse in its
 * colours the other way round (`INVERSE`), where that has less to say of
 * the colours than the terminal has: a run of cells in the same two colours
 * either way round, as the mosaics' are, sets them once.
 */
export function ansiInto(cells: Int32Array, from: number, cols: number, rows: number, top: number, prev: Int32Array | null, buf: Uint8Array, at: number): number {
  const diff = !!prev && prev.length === cols * rows * 3
  const start = at
  const byte = (v: number) => (buf[at++] = v)
  const num = (v: number) => {
    if (v < 256) {
      const n = NUMS[v * 4]
      for (let i = 1; i <= n; i++) buf[at++] = NUMS[v * 4 + i]
    } else for (const c of String(v)) buf[at++] = c.charCodeAt(0)
  }
  const rgb = (v: number) => {
    num(v >> 16)
    byte(59)
    num((v >> 8) & 255)
    byte(59)
    num(v & 255)
  }
  const move = (r: number, c: number) => {
    byte(27), byte(91), num(r), byte(59), num(c), byte(72)
  }
  /** how many bytes a colour's numbers take */
  const len = (v: number) => NUMS[(v >> 16) * 4] + NUMS[((v >> 8) & 255) * 4] + NUMS[(v & 255) * 4] + 2
  /** the bytes of glyph `g` wanting the colours `nf` and `nb` (-2 for either): its colours where they change, and itself */
  const cost = (g: number, nf: number, nb: number) => {
    const b = nb !== -2 && nb !== bg, f = nf !== -2 && nf !== fg
    return (b || f ? 3 : 0) + (b ? 5 + len(nb) : 0) + (f ? 5 + len(nf) : 0) + (b && f ? 1 : 0) + utf8(g)
  }
  // the colours the terminal is in, -1 for not known
  let fg = -1, bg = -1
  for (let r = 0; r < rows; r++) {
    // the column the cursor is at, or -1 where it must be moved
    let col = -1
    if (!diff) {
      move(top + r, 1)
      col = 0
      fg = bg = -1
    }
    for (let c = 0; c < cols; c++) {
      const k = (r * cols + c) * 3
      const cp = cells[from + k], f0 = cells[from + k + 1], b = cells[from + k + 2]
      if (diff && cp === prev![k] && b === prev![k + 2] && (cp === 32 || f0 === prev![k + 1])) continue
      if (col !== c) move(top + r, c + 1)
      // the glyph and the colours it wants (-2 for either: a space shows no foreground, a full block no background), or its inverse's, whichever costs less
      let g = cp, nf = cp === 32 ? -2 : f0, nb = cp === FULL ? -2 : b
      const inv = INVERSE.get(cp)
      if (inv !== undefined) {
        const jf = inv === 32 ? -2 : b, jb = inv === FULL ? -2 : f0
        if (cost(inv, jf, jb) < cost(g, nf, nb)) (g = inv), (nf = jf), (nb = jb)
      }
      // the colours that change, in one sequence
      const sb = nb !== -2 && nb !== bg, sf = nf !== -2 && nf !== fg
      if (sb || sf) {
        byte(27), byte(91)
        if (sb) byte(52), byte(56), byte(59), byte(50), byte(59), rgb(nb)
        if (sb && sf) byte(59)
        if (sf) byte(51), byte(56), byte(59), byte(50), byte(59), rgb(nf)
        byte(109)
      }
      if (nb !== -2) bg = nb
      if (nf !== -2) fg = nf
      const cp2 = g
      // the glyph, as UTF-8 (a lone surrogate as U+FFFD, as a string would be)
      if (cp2 < 0x80) byte(cp2)
      else if (cp2 < 0x800) byte(0xc0 | (cp2 >> 6)), byte(0x80 | (cp2 & 63))
      else if (cp2 < 0x10000) {
        const v = cp2 >= 0xd800 && cp2 < 0xe000 ? 0xfffd : cp2
        byte(0xe0 | (v >> 12)), byte(0x80 | ((v >> 6) & 63)), byte(0x80 | (v & 63))
      } else byte(0xf0 | (cp2 >> 18)), byte(0x80 | ((cp2 >> 12) & 63)), byte(0x80 | ((cp2 >> 6) & 63)), byte(0x80 | (cp2 & 63))
      // after a glyph a terminal may draw two cells wide, the cursor is put where the next cell is rather than trusted
      col = narrow(cp2) ? c + 1 : -1
    }
  }
  if (diff && at === start) return at
  byte(27), byte(91), byte(48), byte(109)
  return at
}

/** the cell packed at `i` as a `Cell` */
function cellOf(cells: Int32Array, i: number): Cell {
  const f = cells[i * 3 + 1], b = cells[i * 3 + 2]
  return { ch: String.fromCodePoint(cells[i * 3]), fg: [f >> 16, (f >> 8) & 255, f & 255], bg: [b >> 16, (b >> 8) & 255, b & 255] }
}

/** whether a cell looks the same as one packed (`packCell`) at `at` */
const samePacked = (a: Cell, b: Int32Array, at: number) =>
  a.ch.codePointAt(0) === b[at] && ((a.bg[0] << 16) | (a.bg[1] << 8) | a.bg[2]) === b[at + 2] &&
  (a.ch === ' ' || ((a.fg[0] << 16) | (a.fg[1] << 8) | a.fg[2]) === b[at + 1])

/**
 * The cells as terminal output: truecolour, a colour change only where it
 * changes. Given the frame on the screen already (`prev`, as many cells, or
 * packed),
 * only the cells that differ from it, the cursor moved to each run of them:
 * a still view or a monster's step costs a few cells, not the screen.
 */
export function toAnsi(cells: Cell[], cols: number, rows: number, top = 1, prev?: Cell[] | Int32Array | null): string {
  const packed = prev instanceof Int32Array
  const diff = !!prev && prev.length === (packed ? 3 : 1) * cells.length
  let s = ''
  let fg = ''
  let bg = ''
  for (let r = 0; r < rows; r++) {
    // the column the cursor is at, or -1 where it must be moved
    let at = -1
    if (!diff) {
      s += `\x1b[${top + r};1H`
      at = 0
      fg = bg = ''
    }
    for (let c = 0; c < cols; c++) {
      const o = cells[r * cols + c]
      if (diff && (packed ? samePacked(o, prev, (r * cols + c) * 3) : sameCell(o, (prev as Cell[])[r * cols + c]))) continue
      if (at !== c) s += `\x1b[${top + r};${c + 1}H`
      // the colours that change, in one sequence
      const b = `${o.bg[0]};${o.bg[1]};${o.bg[2]}`
      const f = o.ch === ' ' ? fg : `${o.fg[0]};${o.fg[1]};${o.fg[2]}`
      if (b !== bg && f !== fg) s += `\x1b[48;2;${b};38;2;${f}m`
      else if (b !== bg) s += `\x1b[48;2;${b}m`
      else if (f !== fg) s += `\x1b[38;2;${f}m`
      bg = b
      fg = f
      s += o.ch
      at = c + 1
    }
  }
  return diff && !s ? '' : s + '\x1b[0m'
}
