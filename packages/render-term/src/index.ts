import { flashOf, getCell, keyToXY, shadeOf, type CellKey, type Camera, type HandItem, type Scene, type SceneCursor, type TileRect, type TileSource, type Viewmodel } from '@orbrun/scene'
import { LevelGrid } from '@orbrun/render-3d/grid'
import { CURSOR_ALPHA, RING_OUTER, VM_FILL, cursorColour, ringCover, VM_LIFT, VM_OFFWEAPON_REST, VM_SHIELD_REST, VM_SIZE, VM_WEAPON_REST, WALL_INSET, type HandPose } from '@orbrun/world'
import { LEVEL_CHUNK, LevelMesher, MARK_MARGIN, uvFor, type ChunkGeometry, type MeshContext, type TileDraw } from '@orbrun/render-3d/level-mesh'
import { INK_LEVEL, distanceField, peelInk } from '@orbrun/render-3d/peel'
import {
  BLOCK_SHADE,
  MODE_BILLBOARD,
  MODE_FACE_EYE,
  MODE_FLASH_OVERRIDE,
  MODE_HULL_FRONT,
  MODE_LIE,
  MODE_RING,
  MODE_SHADE_MAP,
  MODE_THICK,
  crowdInstances,
  fixtureInstances,
  type SpriteInstance,
} from '@orbrun/render-3d/sprites'

/**
 * A first-person renderer of a `@orbrun/scene` `Scene` for terminals, drawn
 * as render-3d draws it: render-3d's own level geometry (level-mesh.ts) and
 * sprite instances (sprites.ts), rasterized on the CPU into an RGB buffer
 * (shown as a kitty graphics image) with render-3d's shading (shaders.ts)
 * worked the same way: colour in linear light, each cell lit by the shade
 * field, the flash washed over, the lid receding into the dark, then
 * encoded, and what blends blending on the encoded values.
 *
 * Nothing is simplified for the terminal: textures are sampled at the
 * nearest texel, sprites are render-3d's blocks with their hulls, marched
 * texel by texel as SPRITE_FRAG marches them, the hands are posed and lift
 * as render-3d's do, and the monsters glide as its `Movers` glide them.
 */

/** An atlas's pixels, RGBA, sRGB. */
export interface Pixels {
  width: number
  height: number
  data: Uint8Array | Uint8ClampedArray
}

/** render-3d's options, as far as they reach a terminal. */
export interface RenderTermOptions {
  /** Vertical field of view, degrees. */
  fov?: number
  /** How high the eye stands, in cells. */
  eyeHeight?: number
  /** How far walls stand back from the floor, in cells (render-3d's WALL_INSET). */
  wallInset?: number
  /** The cut off convex corners, in cells. */
  chamfer?: number
  /** The hands. */
  viewmodel?: boolean
}

// render-3d's numbers (index.ts, shaders.ts), kept in step by hand; those of the world's rules are @orbrun/world's
const EYE = 0.6
const EYE_MIN = 0.25
const EYE_MAX = 0.9
const CHAMFER = 1 / 32
const NEAR = 0.05
const LID_LIGHT = 0.7
const LID_FADE = 5
const WALL_TOP = 0.75
const WALL_SHADOW = 0.3
/** the alpha a texel must have to count as drawn (render-3d's OPAQUE_ALPHA, in bytes) */
const OPAQUE_ALPHA = 26
const GHOST_GAP = 0.06
const GHOST_FADE_START = 5
const GHOST_FADE = 14
const GHOST_FADE_VISIBLE_START = 8
const GHOST_FADE_VISIBLE = 30
const RING_REACH = RING_OUTER + MARK_MARGIN
/** the selected sprite's shell (HULL_SEL_COLOUR), in linear light as three hands it to the shader */
const SHELL_LINEAR: RGB = [0xff, 0xdd, 0x33].map((v) => srgbToLinear(v / 255)) as RGB
const BLACK: RGB = [0, 0, 0]
const SHADOW_RADIUS = 0.22
const SHADOW_ALPHA = 0.35
/** the hands (render-3d's VM_*): their depth in texels, how much of VM_SIZE their art fills, the lens they are seen through, and the lift of a swing */
const VM_DEPTH = 2
const VM_FOV = 40
/** how far a texel stands from the body that no hull reaches (peel.ts `FAR`) */
const FAR = 255
type RGB = [number, number, number]

/**
 * An atlas in linear light, RGBA floats (`linearAtlas`); a sprite atlas
 * with its ink peeled and how far each texel stands from the body
 * (`spriteAtlas`).
 */
export interface Atlas {
  w: number
  h: number
  data: Float32Array
  dist: Uint8Array | null
}

/** What moves this frame (render-3d's `Movers` and the swing), worked out by the host: each monster's glide off its cell, by its mover id, and the hands' lift, 0..1. */
export interface Motion {
  offsets: Map<number, { x: number; y: number }>
  lift: number
}

/** How far the eye steps before a mesh's triangles are sorted again, nearest first, in cells. */
const RESORT = 0.25

/** A mesh as the view sees it (`RenderTerm.geometry`), kept from one band and one frame to the next. */
interface Viewed {
  /** the view its camera space and rows were worked for */
  view: number
  /** the vertices in camera space */
  cam: Float64Array
  /** its triangles, nearest first, as sorted from (sortedX, sortedZ) */
  order: Uint32Array
  sortedX: number
  sortedZ: number
  /** the rows each triangle can reach */
  lo: Int32Array
  hi: Int32Array
  /** the fields its triangles' light and flags were read from */
  field: object | null
  /** each triangle's cell's light */
  shade: Float32Array
  /** each triangle: 1 a wall's face, 2 the flash may reach it, 4 it wants the point in the world */
  flags: Uint8Array
}

/** A sprite as stood for a view and its glide (`RenderTerm.sprite`). */
interface Placed {
  view: number
  ox: number
  oz: number
  toWorld: Float64Array
  toCam: Float64Array
  shift: boolean
  /** the rows it can reach */
  lo: number
  hi: number
}

/**
 * A sprite's box in its own frame (SPRITE_VERT's): its quad across and up,
 * and its depth, a block's where it is thick, moved to its other face where
 * `shift`; as x0, x1, y0, y1, z0, z1.
 */
function spriteBox(s: SpriteInstance, shift: boolean): [number, number, number, number, number, number] {
  const thick = ((s.misc[0] | 0) & MODE_THICK) !== 0
  const [qx, qy, qw, qh] = s.quad
  let z1 = s.z[0], z0 = thick ? s.z[0] - s.z[1] : s.z[0]
  if (shift) {
    const by = -(z0 + z1)
    z0 += by
    z1 += by
  }
  return [qx - qw, qx + qw, qy - qh, qy + qh, z0, z1]
}

/** What a polygon's pixel is drawn with: the pixel, its depth, and the attributes there. */
type Frag = (o: number, depth: number, a: Float64Array) => void

/**
 * A box's faces (SPRITE_VERT's cube), corners as (x, y, z) picks of the box's
 * low (0) and high (1) bounds, each wound counter-clockwise from outside.
 */
const BOX_FACES = [
  [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
  [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]],
  [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]],
  [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
  [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
  [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
]

export class RenderTerm {
  private tiles: TileSource | null = null
  private pixels: (atlas: string) => Pixels | undefined = () => undefined
  private linear: ((atlas: string, sprite: boolean) => Atlas | null | undefined) | undefined
  private atlases = new Map<string, Atlas | null>()
  private stairArt = new Map<string, { top: number[]; side: number[]; open: number[] } | null>()
  private scene: Scene | null = null
  private opts: Required<RenderTermOptions>
  private cursor: SceneCursor | null = null
  private viewmodel: Viewmodel | null = null
  private hands = new Map<string, Hand | null>()

  // the level, as render-3d keeps it
  private mesher = new LevelMesher()
  private grid: LevelGrid | null = null
  private builtRevision = -1
  private builtLayout = -1
  private builtTint = ''
  private fixtures: SpriteInstance[] = []
  private crowd: SpriteInstance[] = []
  private shadows: { x: number; y: number; r: number; moverId?: number }[] = []
  private crowdRevision = -1
  private crowdSelection = ''
  // the fields: each cell's light and the flash over it
  private field = { ox: 0, oz: 0, w: 1, h: 1, shade: new Uint8Array(1), flash: new Uint8Array(4), near: new Uint8Array(1) }

  // what a mesh's drawing works in, kept from one to the next
  private scratches = new Map<string, Float64Array>()
  /** each mesh in camera space, its triangles in order and the rows each can reach, for the view they were worked for */
  private viewed = new WeakMap<ChunkGeometry, Viewed>()
  /** each sprite as stood for the view (`sprite`) */
  private placed = new WeakMap<SpriteInstance, Placed>()
  private keys = new Uint32Array(0)
  /** which view this is: the same eye, lens and frame as the last keep the number */
  private view = 0
  private viewKey = ''
  // a polygon's drawing: its vertices clipped, where the near plane cuts it, on the screen, and the attributes at a pixel
  private polyQ: Float64Array[] = []
  private polyCut = Array.from({ length: 4 }, () => new Float64Array(8))
  private polySx = new Float64Array(32)
  private polySy = new Float64Array(32)
  private attrs = new Float64Array(8)
  /** a sprite box's face's corners, each face's in turn */
  private boxQ = Array.from({ length: 4 }, () => new Float64Array(6))
  // the frame
  private width = 0
  private height = 0
  /** the rows drawn this frame, y0 up to y1 */
  private y0 = 0
  private y1 = 0
  private colour = new Float32Array(0)
  private zbuf = new Float32Array(0)
  private sceneDepth = new Float32Array(0)
  // the camera, for this frame
  private ex = 0
  private ey = 0
  private ez = 0
  private ax: RGB = [1, 0, 0]
  private ay: RGB = [0, 1, 0]
  private af: RGB = [0, 0, -1]
  /** pixels a unit across at unit depth, and down: a pixel `pixelAspect` times as tall as it is wide is fewer of them down */
  private f = 1
  private fy = 1
  private pixelAspect = 1
  private standYaw = 0
  private motion: Motion = { offsets: new Map(), lift: 0 }

  constructor(opts: RenderTermOptions = {}) {
    this.opts = { fov: 85, eyeHeight: EYE, wallInset: WALL_INSET, chamfer: CHAMFER, viewmodel: true, ...opts }
  }

  setOptions(opts: RenderTermOptions): void {
    const before = this.opts
    this.opts = { ...this.opts, ...opts }
    if (before.wallInset !== this.opts.wallInset || before.chamfer !== this.opts.chamfer) this.relevel()
  }

  /**
   * The tiles, and the pixels of their atlases; `linear`, where given, has
   * each atlas already in linear light, as the level draws it
   * (`linearAtlas`) and as the sprites do (`spriteAtlas`, `sprite` true), so
   * renderers sharing one memory need not each make their own.
   */
  setTiles(tiles: TileSource, pixels: (atlas: string) => Pixels | undefined, linear?: (atlas: string, sprite: boolean) => Atlas | null | undefined): void {
    this.tiles = tiles
    this.pixels = pixels
    this.linear = linear
    this.atlases.clear()
    this.stairArt.clear()
    this.hands.clear()
    this.relevel()
  }

  setScene(scene: Scene): void {
    if (scene !== this.scene) this.relevel()
    this.scene = scene
  }

  /** The cell a look or an aim is on: its ring, or its tile. */
  setCursor(cursor: SceneCursor | null): void {
    this.cursor = cursor
  }

  /** What the player holds, in the lower corners. */
  setViewmodel(vm: Viewmodel | null): void {
    this.viewmodel = vm
  }

  /**
   * Draw the view from `cam` into `out`, `width` x `height` RGB, each pixel
   * `pixelAspect` times as tall as it is wide, with what moves (`motion`) as
   * it stands this frame. `rows`, where given, draws only those rows of the
   * frame, [from, to), as one of several renderers each drawing a band of it.
   */
  render(cam: Camera, width: number, height: number, out: Uint8Array, pixelAspect = 1, rows?: [number, number], motion?: Motion): void {
    this.pixelAspect = pixelAspect
    if (motion) this.motion = motion
    const scene = this.scene
    const y0 = rows ? Math.max(0, rows[0]) : 0
    const y1 = rows ? Math.min(height, rows[1]) : height
    if (!scene || !this.tiles) {
      out.fill(0, y0 * width * 3, y1 * width * 3)
      return
    }
    this.size(width, height)
    this.y0 = y0
    this.y1 = y1
    this.update(scene)
    this.place(cam)
    const viewKey = `${cam.eyeX},${cam.eyeY},${cam.yaw},${cam.pitch},${this.ey},${this.opts.fov},${width},${height},${pixelAspect},${this.builtRevision},${this.builtLayout}`
    if (viewKey !== this.viewKey) {
      this.viewKey = viewKey
      this.view++
    }
    const bg = scene.level.sky === 'open' ? 0x0b1220 : scene.level.sky === 'dark' ? 0x120818 : 0
    const c = this.colour
    const r = ((bg >> 16) & 255) / 255, g = ((bg >> 8) & 255) / 255, b = (bg & 255) / 255
    if (bg === 0) c.fill(0, y0 * width * 3, y1 * width * 3)
    else
      for (let i = y0 * width * 3, e = y1 * width * 3; i < e; i += 3) {
        c[i] = r
        c[i + 1] = g
        c[i + 2] = b
      }
    this.zbuf.fill(Infinity, y0 * width, y1 * width)
    // the level and its fixtures, then what the ghosts show through
    this.level(['level', 'void'])
    for (const s of this.fixtures) this.sprite(s, 'solid')
    this.sceneDepth.set(this.zbuf.subarray(y0 * width, y1 * width), y0 * width)
    // the transparent passes, in render-3d's render order
    for (const s of this.crowd) if (s.pass === 'ghostVisible') this.sprite(s, 'ghost')
    for (const s of this.crowd) if (s.pass === 'ghostRemembered') this.sprite(s, 'ghost')
    for (const s of this.crowd) if (s.pass === 'opaque') this.sprite(s, 'solid')
    for (const s of this.shadows) this.shadow(s)
    this.drawCursor()
    this.level(['decal'])
    const eye = { x: cam.eyeX + 0.5, y: cam.eyeY + 0.5 }
    const far = (s: SpriteInstance) => {
      const o = s.moverId === undefined ? undefined : this.motion.offsets.get(s.moverId)
      return (s.anchor[0] + (o?.x ?? 0) - eye.x) ** 2 + (s.anchor[2] + (o?.y ?? 0) - eye.y) ** 2
    }
    for (const s of this.crowd.filter((s) => s.pass === 'blend').sort((p, q) => far(q) - far(p))) this.sprite(s, 'blend')
    this.level(['marks'])
    this.drawHands(scene)
    // every value is in 0..1: encoded, or blended between encoded values
    for (let i = y0 * width * 3; i < y1 * width * 3; i++) out[i] = (c[i] * 255 + 0.5) | 0
  }

  // ------------------------------------------------------------ the level

  private relevel() {
    this.mesher.clear()
    this.grid = null
    this.builtRevision = -1
    this.crowdRevision = -1
  }

  /** render-3d's per-frame bookkeeping: the level's chunks, the fields, the fixtures and the crowd. */
  private update(scene: Scene) {
    if (scene.revision !== this.builtRevision) {
      this.builtRevision = scene.revision
      const grid = new LevelGrid(scene)
      const t = scene.level.tint
      const tintKey = `${t.r},${t.g},${t.b}`
      if (scene.layoutRevision !== this.builtLayout || tintKey !== this.builtTint || !this.grid || this.mesher.occupiedChanged(grid)) {
        this.builtLayout = scene.layoutRevision
        this.builtTint = tintKey
        this.grid = grid
        this.mesher.update(grid, this.meshContext())
        this.fixtures = fixtureInstances(scene, (id) => this.tiles!.tile(id), grid.framed, grid.occupied, (r) => this.stairColumns(r), this.opts.wallInset)
      }
      this.fields(scene)
    }
    const selKey = this.cursor ? `${this.cursor.x},${this.cursor.y}` : ''
    if (scene.revision !== this.crowdRevision || selKey !== this.crowdSelection) {
      this.crowdRevision = scene.revision
      this.crowdSelection = selKey
      const { sprites, shadows } = crowdInstances(scene, (id) => this.tiles!.tile(id), this.cursor)
      this.crowd = sprites
      this.shadows = shadows
    }
  }

  private meshContext(): MeshContext {
    const cache = new Map<number, TileDraw | null>()
    return {
      tileOf: (id) => {
        let t = cache.get(id)
        if (t !== undefined) return t
        const r = this.tiles!.tile(id)
        const px = r && this.pixels(r.atlas)
        t = r && px ? { r, atlas: r.atlas, uv: uvFor(r, px.width, px.height) } : null
        cache.set(id, t)
        return t
      },
      fo: { inset: this.opts.wallInset },
      chamfer: this.opts.chamfer,
    }
  }

  /**
   * A way up's art by column (render-3d's `stairColumns`, sprites.ts
   * `StairColumns`): the first body row, ink and clear texels left out as
   * the peel leaves them, and the row under the biggest fall in brightness
   * from one body texel to the next below it, where the lit step gives way
   * to the stairs' shadowed side, and the first row under that the art
   * leaves open. Read from the art as drawn, in sRGB, as render-3d reads it.
   */
  private stairColumns(r: TileRect): { top: readonly number[]; side: readonly number[]; open: readonly number[] } | undefined {
    const key = `${r.atlas}:${r.sx}:${r.sy}:${r.w}:${r.h}`
    let art = this.stairArt.get(key)
    if (art === undefined) {
      art = null
      const a = this.atlas(r.atlas)
      if (a) {
        const at = (x: number, y: number, ch: number) => a.data[((r.sy + y) * a.w + r.sx + x) * 4 + ch]
        const byte = (x: number, y: number, ch: number) => encode(at(x, y, ch)) * 255
        const lum = (x: number, y: number) => 0.3 * byte(x, y, 0) + 0.59 * byte(x, y, 1) + 0.11 * byte(x, y, 2)
        const body = (x: number, y: number) => at(x, y, 3) * 255 >= OPAQUE_ALPHA && !(byte(x, y, 0) < INK_LEVEL && byte(x, y, 1) < INK_LEVEL && byte(x, y, 2) < INK_LEVEL)
        art = { top: [], side: [], open: [] }
        for (let x = 0; x < r.w; x++) {
          let top = -1
          for (let y = 0; y < r.h && top < 0; y++) if (body(x, y)) top = y
          // body to body: the clear row under the tile and the ink between are no edge
          let side = r.h
          let fall = 0
          let last = top >= 0 ? lum(x, top) : 0
          for (let y = top + 1; top >= 0 && y < r.h; y++) {
            if (!body(x, y)) continue
            const l = lum(x, y)
            if (last - l > fall) {
              fall = last - l
              side = y
            }
            last = l
          }
          let open = side
          while (open < r.h && body(x, open)) open++
          art.top.push(top)
          art.side.push(side)
          art.open.push(open)
        }
      }
      this.stairArt.set(key, art)
    }
    return art ?? undefined
  }

  private fields(scene: Scene) {
    const b = scene.bounds
    const ox = b.left - 1, oz = b.top - 1
    const w = Math.max(1, b.right - b.left + 3)
    const h = Math.max(1, b.bottom - b.top + 3)
    const shade = new Uint8Array(w * h).fill(255)
    const flash = new Uint8Array(w * h * 4)
    let hue = [0, 0, 0]
    for (const cell of scene.cells.values())
      if (cell.flash && cell.flash.a > 0) {
        hue = [cell.flash.r, cell.flash.g, cell.flash.b]
        break
      }
    for (let i = 0; i < w * h; i++) flash.set(hue, i * 4)
    for (const cell of scene.cells.values()) {
      const x = cell.x - ox, z = cell.y - oz
      if (x < 0 || x >= w || z < 0 || z >= h) continue
      const i = z * w + x
      shade[i] = Math.round(shadeOf(cell, scene) * 255)
      const f = cell.flash
      if (f?.a) flash.set([f.r, f.g, f.b, Math.min(255, f.a)], i * 4)
    }
    // where the filtered flash can reach: the 2x2 of cell middles round a point, any of them flashed
    const near = new Uint8Array(w * h)
    for (let z = 0; z < h; z++)
      for (let x = 0; x < w; x++)
        for (let j = 0; j < 2; j++)
          for (let i = 0; i < 2; i++) if (flash[(Math.min(h - 1, z + j) * w + Math.min(w - 1, x + i)) * 4 + 3]) near[z * w + x] = 1
    this.field = { ox, oz, w, h, shade, flash, near }
  }

  /** The shade field at a cell, as the shader reads it. */
  private shadeAt(x: number, z: number): number {
    const F = this.field
    const i = Math.min(F.w - 1, Math.max(0, Math.round(x) - F.ox)) + Math.min(F.h - 1, Math.max(0, Math.round(z) - F.oz)) * F.w
    return F.shade[i] / 255
  }

  /** Whether the flash can reach anywhere on the cell (x, z) or round its edges (`flashed`'s early way out, a cell further each way). */
  private flashNear(x: number, z: number): boolean {
    const F = this.field
    const cx = Math.round(x) - F.ox, cz = Math.round(z) - F.oz
    if (cx < 2 || cz < 2 || cx >= F.w - 1 || cz >= F.h - 1) return true
    for (let j = cz - 2; j <= cz + 1; j++) for (let i = cx - 2; i <= cx + 1; i++) if (F.near[j * F.w + i]) return true
    return false
  }

  /** The flash field at a world point, filtered between cell middles as the GPU filters it, washed over `c` (linear). */
  private flashed(c: RGB, wx: number, wz: number) {
    const F = this.field
    const sx = wx - F.ox - 0.5, sz = wz - F.oz - 0.5
    const x0 = Math.floor(sx), z0 = Math.floor(sz)
    if (x0 >= 0 && z0 >= 0 && x0 < F.w && z0 < F.h && !F.near[z0 * F.w + x0]) return
    const fx = sx - x0, fz = sz - z0
    let r = 0, g = 0, b = 0, a = 0
    for (let j = 0; j < 2; j++)
      for (let i = 0; i < 2; i++) {
        const k = (i ? fx : 1 - fx) * (j ? fz : 1 - fz)
        if (k === 0) continue
        const x = Math.min(F.w - 1, Math.max(0, x0 + i)), z = Math.min(F.h - 1, Math.max(0, z0 + j))
        const o = (z * F.w + x) * 4
        r += F.flash[o] * k
        g += F.flash[o + 1] * k
        b += F.flash[o + 2] * k
        a += F.flash[o + 3] * k
      }
    a /= 255
    if (a <= 0) return
    c[0] += (r / 255 - c[0]) * a
    c[1] += (g / 255 - c[1]) * a
    c[2] += (b / 255 - c[2]) * a
  }

  /** A buffer of `n` sort keys to work in, kept for the next that asks. */
  private sortKeys(n: number): Uint32Array {
    if (this.keys.length < n) this.keys = new Uint32Array(n * 2)
    return this.keys.subarray(0, n)
  }

  /** A buffer of at least `n` to work in, the one named, kept for the next that asks. */
  private scratch(name: string, n: number): Float64Array {
    let b = this.scratches.get(name)
    if (!b || b.length < n) this.scratches.set(name, (b = new Float64Array(n * 2)))
    return b
  }

  /** The level's chunks of the given kinds, those in sight. */
  private level(kinds: ChunkGeometry['kind'][]) {
    const lidded = this.scene!.level.sky === 'none'
    const near: { d: number; geos: ChunkGeometry[] }[] = []
    for (const [ck, geos] of this.mesher.chunks) {
      const { x: cx, y: cz } = keyToXY(ck as CellKey)
      if (!this.boxInView(cx * LEVEL_CHUNK - 1, cz * LEVEL_CHUNK - 1, (cx + 1) * LEVEL_CHUNK + 1, (cz + 1) * LEVEL_CHUNK + 1)) continue
      const mx = (cx + 0.5) * LEVEL_CHUNK - this.ex, mz = (cz + 0.5) * LEVEL_CHUNK - this.ez
      near.push({ d: mx * mx + mz * mz, geos })
    }
    near.sort((a, b) => a.d - b.d)
    for (const { geos } of near) for (const g of geos) if (kinds.includes(g.kind)) this.geometry(g, lidded)
  }

  /** Whether any of the box x0..x1, 0..1, z0..z1 can be in sight: in front of the eye and not wholly past one side of the rows drawn. */
  private boxInView(x0: number, z0: number, x1: number, z1: number): boolean {
    const halfX = this.width / 2 / this.f
    // the rows drawn, as slopes up from the eye's axis: the frame's top row is the highest
    const top = (this.height / 2 - this.y0) / this.fy, bottom = (this.height / 2 - this.y1) / this.fy
    let front = false, left = true, right = true, below = true, above = true
    for (let i = 0; i < 8; i++) {
      const dx = (i & 1 ? x1 : x0) - this.ex, dy = (i & 2 ? 1 : 0) - this.ey, dz = (i & 4 ? z1 : z0) - this.ez
      const px = dx * this.ax[0] + dy * this.ax[1] + dz * this.ax[2]
      const py = dx * this.ay[0] + dy * this.ay[1] + dz * this.ay[2]
      const pz = dx * this.af[0] + dy * this.af[1] + dz * this.af[2]
      if (pz > NEAR) front = true
      if (px > -halfX * pz) left = false
      if (px < halfX * pz) right = false
      if (py > bottom * pz) below = false
      if (py < top * pz) above = false
    }
    return front && !left && !right && !below && !above
  }

  /** One mesh of a chunk, as LEVEL_FRAG (or VOID_FRAG) draws it. */
  private geometry(g: ChunkGeometry, lidded: boolean) {
    const atlas = g.kind === 'void' ? null : this.drawn(g.atlas)
    if (g.kind !== 'void' && !atlas) return
    const pos = g.position, uv = g.uv, idx = g.index
    const n = pos.length / 3
    // the vertices into camera space, and the triangles nearest first: once a view, however many bands of it are drawn
    let seen = this.viewed.get(g)
    const again = seen?.view === this.view
    const tris = idx.length / 3
    if (!seen || seen.cam.length !== n * 3) {
      seen = { view: -1, cam: new Float64Array(n * 3), order: new Uint32Array(tris), lo: new Int32Array(tris), hi: new Int32Array(tris), sortedX: NaN, sortedZ: NaN, field: null, shade: new Float32Array(tris), flags: new Uint8Array(tris) }
      for (let t = 0; t < tris; t++) seen.order[t] = t
      this.viewed.set(g, seen)
    }
    seen.view = this.view
    const { cam, lo, hi } = seen
    if (!again) {
      const [ax0, ax1, ax2] = this.ax, [ay0, ay1, ay2] = this.ay, [af0, af1, af2] = this.af
      for (let i = 0; i < n; i++) {
        const dx = pos[i * 3] - this.ex, dy = pos[i * 3 + 1] - this.ey, dz = pos[i * 3 + 2] - this.ez
        cam[i * 3] = dx * ax0 + dy * ax1 + dz * ax2
        cam[i * 3 + 1] = dx * ay0 + dy * ay1 + dz * ay2
        cam[i * 3 + 2] = dx * af0 + dy * af1 + dz * af2
      }
      // the rows each triangle can reach, as `poly` finds them, so a band passes over those that miss it at once:
      // none where it is behind the eye or off the sides, all where the near plane cuts it
      const W = this.width, H = this.height, f = this.f, fy = this.fy
      for (let t = 0; t < tris; t++) {
        const i0 = idx[t * 3] * 3, i1 = idx[t * 3 + 1] * 3, i2 = idx[t * 3 + 2] * 3
        const z0 = cam[i0 + 2], z1 = cam[i1 + 2], z2 = cam[i2 + 2]
        if (z0 < NEAR || z1 < NEAR || z2 < NEAR) {
          lo[t] = z0 < NEAR && z1 < NEAR && z2 < NEAR ? H : 0
          hi[t] = H
          continue
        }
        const x0 = W / 2 + (cam[i0] / z0) * f, x1 = W / 2 + (cam[i1] / z1) * f, x2 = W / 2 + (cam[i2] / z2) * f
        const y0 = H / 2 - (cam[i0 + 1] / z0) * fy, y1 = H / 2 - (cam[i1 + 1] / z1) * fy, y2 = H / 2 - (cam[i2 + 1] / z2) * fy
        if (Math.ceil(Math.max(x0, x1, x2)) < 0 || Math.floor(Math.min(x0, x1, x2)) > W - 1) {
          lo[t] = H
          hi[t] = H
          continue
        }
        lo[t] = Math.floor(Math.min(y0, y1, y2))
        hi[t] = Math.ceil(Math.max(y0, y1, y2))
      }
    }
    const alphaTest = g.kind === 'level' ? 0.5 : g.kind === 'decal' ? 0.02 : 0.01
    const blend = g.kind === 'decal' || g.kind === 'marks'
    const enc: RGB = [0, 0, 0]
    const tex = [0, 0, 0, 0]
    const c: RGB = [0, 0, 0]
    let col0 = 0, col1 = 0, col2 = 0, shade = 1, cut = false, flashy = false, world = false
    // a mark's tile rect, and how its uv moves a pixel across and a pixel down (the shader's dFdx, dFdy)
    const marks = g.kind === 'marks'
    const rect = [0, 0, 0, 0]
    const grad = [0, 0, 0, 0]
    const zb = this.zbuf, colour = this.colour
    const ad = atlas ? atlas.data : null, aw = atlas ? atlas.w : 0, ah = atlas ? atlas.h : 0
    const ex = this.ex, ey = this.ey, ez = this.ez
    const frag: Frag = (o, depth, a) => {
      if (depth >= zb[o]) return
      const o3 = o * 3
      if (!ad) {
        // never-seen space: black, however lit
        zb[o] = depth
        colour[o3] = colour[o3 + 1] = colour[o3 + 2] = 0
        return
      }
      let t0: number, t1: number, t2: number, t3: number
      if (marks) {
        footprint(atlas!, a[0], a[1], grad, rect, tex)
        t0 = tex[0]
        t1 = tex[1]
        t2 = tex[2]
        t3 = tex[3]
      } else {
        // the nearest texel (`sample`)
        const x = Math.min(aw - 1, Math.max(0, Math.floor(a[0] * aw)))
        const y = Math.min(ah - 1, Math.max(0, Math.floor(a[1] * ah)))
        const i = (y * aw + x) * 4
        t3 = ad[i + 3]
        if (t3 < alphaTest) return
        t0 = ad[i]
        t1 = ad[i + 1]
        t2 = ad[i + 2]
      }
      if (t3 < alphaTest) return
      // the lid recedes, and a wall darkens toward it (LID); where neither nor a flash reaches, the point itself is not wanted
      let over = 1
      if (world) {
        c[0] = t0 * col0 * shade
        c[1] = t1 * col1 * shade
        c[2] = t2 * col2 * shade
        const wx = a[2], wy = a[3], wz = a[4]
        if (flashy) this.flashed(c, wx, wz)
        if (cut) over = 1 + ((lidded ? WALL_TOP : 1) - 1) * smoothstep(1 - WALL_SHADOW, 1, wy)
        else if (wy > 0.999) {
          const dx = wx - ex, dy = wy - ey, dz = wz - ez
          over = LID_LIGHT * lidFade(Math.sqrt(dx * dx + dy * dy + dz * dz))
        }
        t0 = c[0] * over
        t1 = c[1] * over
        t2 = c[2] * over
      } else {
        t0 = t0 * col0 * shade
        t1 = t1 * col1 * shade
        t2 = t2 * col2 * shade
      }
      if (blend) {
        enc[0] = encode(t0)
        enc[1] = encode(t1)
        enc[2] = encode(t2)
        this.blend(o, enc, t3)
      } else {
        zb[o] = depth
        colour[o3] = encode(t0)
        colour[o3 + 1] = encode(t1)
        colour[o3 + 2] = encode(t2)
      }
    }
    const P = [0, 0, 0].map(() => new Float64Array(8))
    const order = seen.order
    // what is flat across a triangle that the view does not change: its cell's light, whether the flash may reach it,
    // whether it wants the point in the world; worked out again only when the fields are
    const { shade: shades, flags } = seen
    if (seen.field !== this.field) {
      seen.field = this.field
      for (let t = 0; t < tris; t++) {
        const i0 = idx[t * 3], cx = g.cell[i0 * 2], cz = g.cell[i0 * 2 + 1]
        shades[t] = this.shadeAt(cx, cz)
        const cut = g.cut[i0] > 0.5, flashy = this.flashNear(cx, cz)
        const top = pos[i0 * 3 + 1] > 0.999 || pos[idx[t * 3 + 1] * 3 + 1] > 0.999 || pos[idx[t * 3 + 2] * 3 + 1] > 0.999
        flags[t] = (cut ? 1 : 0) | (flashy ? 2 : 0) | (cut || flashy || top ? 4 : 0)
      }
    }
    if (!blend && (Math.abs(this.ex - seen.sortedX) > RESORT || Math.abs(this.ez - seen.sortedZ) > RESORT || Number.isNaN(seen.sortedX))) {
      // nearest first, by the nearest corner's distance from the eye, which turning leaves as it is: sorted again only
      // once the eye has stepped. The order is only to save drawing what is hidden; the depth test decides what shows.
      // Each key and its triangle in one integer, for the typed array's own sort.
      seen.sortedX = this.ex
      seen.sortedZ = this.ez
      const key = this.sortKeys(tris)
      for (let t = 0; t < tris; t++) {
        let d = Infinity
        for (let k = 0; k < 3; k++) {
          const i = idx[t * 3 + k] * 3
          const dx = pos[i] - this.ex, dy = pos[i + 1] - this.ey, dz = pos[i + 2] - this.ez
          d = Math.min(d, dx * dx + dy * dy + dz * dz)
        }
        key[t] = ((Math.min(4095, Math.sqrt(d) * 64) << 20) | t) >>> 0
      }
      key.sort()
      for (let t = 0; t < tris; t++) order[t] = key[t] & 0xfffff
    }
    const y0 = this.y0, y1 = this.y1
    for (let n = 0; n < tris; n++) {
      const tri = order[n]
      if (hi[tri] < y0 || lo[tri] > y1 - 1) continue
      const t = tri * 3
      const i0 = idx[t], i1 = idx[t + 1], i2 = idx[t + 2]
      if (cam[i0 * 3 + 2] < NEAR && cam[i1 * 3 + 2] < NEAR && cam[i2 * 3 + 2] < NEAR) continue
      for (let k = 0; k < 3; k++) {
        const i = k === 0 ? i0 : k === 1 ? i1 : i2, p = P[k]
        p[0] = cam[i * 3]
        p[1] = cam[i * 3 + 1]
        p[2] = cam[i * 3 + 2]
        p[3] = uv[i * 2]
        p[4] = uv[i * 2 + 1]
        p[5] = pos[i * 3]
        p[6] = pos[i * 3 + 1]
        p[7] = pos[i * 3 + 2]
      }
      // what is flat across a quad: its tint and face shade, its cell's light, whether it is a wall's face
      col0 = g.color[i0 * 3]
      col1 = g.color[i0 * 3 + 1]
      col2 = g.color[i0 * 3 + 2]
      shade = shades[tri]
      const fl = flags[tri]
      cut = (fl & 1) !== 0
      flashy = (fl & 2) !== 0
      world = (fl & 4) !== 0
      if (marks && g.rect) {
        for (let j = 0; j < 4; j++) rect[j] = g.rect[i0 * 4 + j]
        this.uvGradient(P, grad)
      }
      // the point in the world only where it is wanted: interpolated, it is the most of a pixel's work
      this.poly(P, world || marks ? 5 : 2, cut, frag, true)
    }
  }

  /**
   * How a triangle's uv (attributes 3 and 4) moves a pixel across and a
   * pixel down the screen, into `grad` (du/dx, dv/dx, du/dy, dv/dy): taken
   * flat over the triangle, which a mark's, a cell's worth at most, is near
   * enough.
   */
  private uvGradient(P: Float64Array[], grad: number[]) {
    const sx: number[] = [], sy: number[] = []
    for (const p of P) {
      const z = Math.max(NEAR, p[2])
      sx.push((p[0] / z) * this.f)
      sy.push(-(p[1] / z) * this.fy)
    }
    const x1 = sx[1] - sx[0], y1 = sy[1] - sy[0], x2 = sx[2] - sx[0], y2 = sy[2] - sy[0]
    const det = x1 * y2 - x2 * y1
    if (Math.abs(det) < 1e-9) {
      grad.fill(0)
      return
    }
    for (let k = 0; k < 2; k++) {
      const d1 = P[1][3 + k] - P[0][3 + k], d2 = P[2][3 + k] - P[0][3 + k]
      grad[k] = (d1 * y2 - d2 * y1) / det
      grad[2 + k] = (x1 * d2 - x2 * d1) / det
    }
  }

  // ------------------------------------------------------------ the sprites

  /**
   * One standing instance (SPRITE_VERT, SPRITE_FRAG): its box turned to the
   * eye or stood at its heading, lying or standing, its glide this frame
   * added; `solid` depth-tested and written (the fixtures, the crowd),
   * `blend` tested and blended, `ghost` drawn only where the level and its
   * fixtures hide it, fading with how far behind.
   */
  private sprite(s: SpriteInstance, how: 'solid' | 'blend' | 'ghost') {
    const atlas = this.atlas(s.atlas, true)
    if (!atlas) return
    // where it stands for this view and its glide: worked out once, however many bands are drawn
    const o = s.moverId === undefined ? undefined : this.motion.offsets.get(s.moverId)
    const ox = o?.x ?? 0, oz = o?.y ?? 0
    let p = this.placed.get(s)
    if (!p || p.view !== this.view || p.ox !== ox || p.oz !== oz) this.placed.set(s, (p = this.place_(s, ox, oz)))
    if (p.hi < this.y0 || p.lo > this.y1 - 1) return
    this.box(atlas, s, p.toWorld, p.toCam, how, p.shift)
  }

  /** A sprite stood for the view, glided by (ox, oz): its frame into the world and into camera space, and the rows it can reach. */
  private place_(s: SpriteInstance, ox: number, oz: number): Placed {
    const [mode, , , miscW] = s.misc
    const ax = s.anchor[0] + ox, ay = s.anchor[1], az = s.anchor[2] + oz
    // the eye from the sprite's origin, and the heading it stands at
    const ex = this.ex - ax, ez = this.ez - az
    let yaw = mode & MODE_BILLBOARD ? this.standYaw : miscW
    if (mode & MODE_FACE_EYE) {
      // from facing the eye, misc.w of the way on to turning with the camera, the short way round
      const toEye = Math.atan2(ex, ez)
      let turn = this.standYaw - toEye
      turn -= 2 * Math.PI * Math.floor((turn + Math.PI) / (2 * Math.PI))
      yaw = toEye + miscW * turn
    }
    const c = Math.cos(yaw), sn = Math.sin(yaw)
    const lie = (mode & MODE_LIE) !== 0
    // the sprite's frame into the world: turned by yaw about its origin, and lying, its y along the floor and its z up
    const toWorld = new Float64Array(12)
    const cols = lie ? [[1, 0, 0], [0, 0, -1], [0, 1, 0]] : [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
    for (let j = 0; j < 3; j++) {
      const [ux, uy, uz] = cols[j]
      toWorld[j] = c * ux + sn * uz
      toWorld[4 + j] = uy
      toWorld[8 + j] = c * uz - sn * ux
    }
    toWorld[3] = ax
    toWorld[7] = ay
    toWorld[11] = az
    // a ringed board stands as far in front of its origin as it stands, toward an eye behind it
    const shift = (mode & MODE_RING) !== 0 && c * ez + sn * ex < 0
    const toCam = this.cameraFrom(toWorld)
    const [lo, hi] = this.boxRows(toCam, ...spriteBox(s, shift))
    return { view: this.view, ox, oz, toWorld, toCam, shift, lo, hi }
  }

  /** The world into camera space, after `m` (a frame into the world, 3x4), as one 3x4. */
  private cameraFrom(m: Float64Array): Float64Array {
    const out = new Float64Array(12)
    const rows = [this.ax, this.ay, this.af]
    const e = [this.ex, this.ey, this.ez]
    for (let i = 0; i < 3; i++) {
      const r = rows[i]
      for (let j = 0; j < 3; j++) out[i * 4 + j] = r[0] * m[j] + r[1] * m[4 + j] + r[2] * m[8 + j]
      out[i * 4 + 3] = r[0] * (m[3] - e[0]) + r[1] * (m[7] - e[1]) + r[2] * (m[11] - e[2])
    }
    return out
  }

  /**
   * An instance of the sprite box, as SPRITE_FRAG draws it: each face of the
   * box the eye sees, and at each of its pixels the view ray marched through
   * the texel grid of the block. The first body texel it crosses is the hit,
   * coloured by that texel and the face it came in by; leaving the hull's
   * texels for air, or passing out the back of the block inside them, is the
   * black line round the sprite (crawl's ink put back at the block's depth),
   * or the wider shell round the one the cursor is on. `toWorld` and `toCam`
   * take the sprite's frame into the world and into camera space; `shift`
   * moves a ringed board to its other face; `flash`, where given, is washed
   * over in place of the flash field (the hands').
   */
  private box(atlas: Atlas, s: SpriteInstance, toWorld: Float64Array | null, toCam: Float64Array, how: 'solid' | 'blend' | 'ghost', shift = false, flash?: { r: number; g: number; b: number; a: number }) {
    const dist = atlas.dist
    if (!dist) return
    const [modeF, miscY, k] = s.misc
    const mode = modeF | 0
    const thick = (mode & MODE_THICK) !== 0
    const hullFront = (mode & MODE_HULL_FRONT) !== 0
    const ring = (mode & MODE_RING) !== 0
    const grow = ring ? 0 : miscY
    const [qx, , qw] = s.quad
    const [x0, x1, y0, y1, z0, z1] = spriteBox(s, shift)
    const [lo, hi] = this.boxRows(toCam, x0, x1, y0, y1, z0, z1)
    if (hi < this.y0 || lo > this.y1 - 1) return
    const [sx, sy, W, H] = s.texel
    const aw = atlas.w
    // the stretch (a door filling its doorway): the columns either side as they are, those between taking up the rest
    const Wq = (2 * qw) / k
    let bandA = 0, bandB = 0, bandS = 1
    if (Wq - W > 1e-3) {
      const edge = ring ? Math.min(miscY, Math.floor(W / 2)) : 0
      bandA = edge
      bandB = W - edge
      bandS = (bandB - bandA + Wq - W) / (bandB - bandA)
    }
    const colX = (i: number) => (i <= bandA ? i : i <= bandB ? bandA + (i - bandA) * bandS : i + (bandB - bandA) * (bandS - 1))
    const colAt = (x: number) => {
      const xa = bandA, xb = colX(bandB)
      return Math.floor(x <= xa ? x : x <= xb ? bandA + (x - xa) / bandS : x - (xb - bandB))
    }
    const body = (tx: number, ty: number) => tx >= 0 && ty >= 0 && tx < W && ty < H && dist[(sy + ty) * aw + sx + tx] === 0
    /** how far texel (tx, ty) stands from this tile's body, in axis steps as the ink is drawn: the tile's own body alone */
    const hullDist = (tx: number, ty: number, g: number) => {
      if (body(tx + 1, ty) || body(tx - 1, ty) || body(tx, ty + 1) || body(tx, ty - 1)) return 1
      if (g < 2) return FAR
      if (body(tx + 2, ty) || body(tx - 2, ty) || body(tx, ty + 2) || body(tx, ty - 2)) return 2
      if (body(tx + 1, ty + 1) || body(tx + 1, ty - 1) || body(tx - 1, ty + 1) || body(tx - 1, ty - 1)) return 2
      return FAR
    }
    // the eye in the sprite's frame: camera space's origin, back through toCam
    const eye = invertAt(toCam)
    // texel space: column right, row down from the tile's top-left corner, depth into the block from its front
    const ox = x0, oy = y1, oz = z1
    const D = thick ? (z1 - z0) / k : 0
    const eTx = (eye[0] - ox) / k, eTy = -(eye[1] - oy) / k, eTz = -(eye[2] - oz) / k
    const ghost = how === 'ghost'
    const ghostVisible = s.pass === 'ghostVisible'
    const fadeStart = ghostVisible ? GHOST_FADE_VISIBLE_START : GHOST_FADE_START
    const fadeRange = ghostVisible ? GHOST_FADE_VISIBLE : GHOST_FADE
    const shade = mode & MODE_SHADE_MAP ? this.shadeAt(s.cell[0], s.cell[1]) : 1
    const col = s.color
    const lin: RGB = [0, 0, 0]
    const enc: RGB = [0, 0, 0]
    const frag: Frag = (o, _depth, a) => {
      const lx = a[0], ly = a[1], lz = a[2]
      const px = (lx - ox) / k, py = -(ly - oy) / k, pz = -(lz - oz) / k
      let dx = px - eTx, dy = py - eTy, dz = pz - eTz
      const len = Math.hypot(dx, dy, dz) || 1
      dx /= len
      dy /= len
      dz /= len
      let tHit = 0
      let hit = false
      /** set when the hit is a hull face: the distance of the hull texel it belongs to (1 ink, 2 shell) */
      let hullHit = 0
      let ti = 0
      let face = 0
      if (!thick) {
        const tx = colAt(px), ty = Math.floor(py)
        if (body(tx, ty)) {
          ti = ((sy + ty) * aw + sx + tx) * 4
          hit = true
        } else if (grow > 0) {
          const hd = hullDist(tx, ty, grow)
          if (hd <= grow) {
            hullHit = hd
            hit = true
          }
        }
      } else {
        // the texel the entry point is in, pulled a hair inside the box so a point on its boundary lands right
        const qx_ = Math.min(Wq - 1e-5, Math.max(1e-5, px + 1e-4 * Math.sign(dx)))
        const qy_ = Math.min(H - 1e-5, Math.max(1e-5, py + 1e-4 * Math.sign(dy)))
        let tx = colAt(qx_), ty = Math.floor(qy_)
        const stx = dx >= 0 ? 1 : -1, sty = dy >= 0 ? 1 : -1
        const tDeltaY = 1 / Math.max(Math.abs(dy), 1e-6)
        // columns are walked by where their edges lie across the quad, as a stretch widens some of them
        let tMaxX = Math.abs(dx) < 1e-6 ? 1e9 : (colX(tx + (stx > 0 ? 1 : 0)) - px) / dx
        let tMaxY = Math.abs(dy) < 1e-6 ? 1e9 : (ty + (sty > 0 ? 1 : 0) - py) / dy
        // the face the ray came in by: 0 front, 1 back, 2 side, 3 top, 4 bottom
        if (pz < 1e-3) face = 0
        else if (pz > D - 1e-3) face = 1
        else if (px < 1e-3 || px > Wq - 1e-3) face = 2
        else face = dy > 0 ? 3 : 4
        let tNow = 0
        // a board's ink: the ring round its body, flat on either face (a door is walked round), off the edge columns
        if (ring && face <= 1 && tx > 0 && tx < W - 1 && !body(tx, ty) && hullDist(tx, ty, 1) <= 1) {
          hullHit = 1
          hit = true
        }
        for (let i = 0; i < 128 && !hit; i++) {
          if (body(tx, ty)) {
            ti = ((sy + ty) * aw + sx + tx) * 4
            tHit = tNow
            hit = true
            break
          }
          const d = grow > 0 ? hullDist(tx, ty, grow) : FAR
          const hull = d <= grow
          const tExit = Math.min(tMaxX, tMaxY)
          const zExit = pz + dz * tExit
          if (zExit > D || zExit < 0) {
            // out of the block through its front or back: black if the hull has a face there
            const back = zExit > D
            if (hull && (back || hullFront)) {
              tHit = ((back ? D : 0) - pz) / dz
              hullHit = d
              hit = true
            }
            break
          }
          if (tMaxX < tMaxY) {
            tx += stx
            tNow = tMaxX
            tMaxX = (colX(tx + (stx > 0 ? 1 : 0)) - px) / dx
            face = 2
          } else {
            ty += sty
            tNow = tMaxY
            tMaxY += tDeltaY
            face = sty > 0 ? 3 : 4
          }
          if (tx < 0 || ty < 0 || tx >= W || ty >= H) {
            // out of the tile sideways: the hull's own side face where it ends at the tile's edge
            if (hull) {
              tHit = tNow
              hullHit = d
              hit = true
            }
            break
          }
          if (hull && !body(tx, ty) && hullDist(tx, ty, grow) > grow) {
            // leaving the hull for air: its side face
            tHit = tNow
            hullHit = d
            hit = true
            break
          }
        }
      }
      if (!hit) return
      // the hit, in the sprite's frame and in camera space
      const hx = lx + dx * tHit * k, hy = ly - dy * tHit * k, hz = lz - dz * tHit * k
      const depth = toCam[8] * hx + toCam[9] * hy + toCam[10] * hz + toCam[11]
      let alpha = col[3]
      if (ghost) {
        // only what stands clear behind the level shows through it
        const gap = depth - this.sceneDepth[o]
        if (!(gap > GHOST_GAP)) return
        alpha *= 1 - smoothstep(fadeStart, fadeRange, gap)
      } else if (depth >= this.zbuf[o]) return
      if (hullHit > 0) {
        const h = hullHit > 1 ? SHELL_LINEAR : BLACK
        lin[0] = h[0]
        lin[1] = h[1]
        lin[2] = h[2]
      } else {
        const fs = thick ? faceShade(face) : 1
        const d = atlas.data
        lin[0] = d[ti] * fs * col[0] * shade
        lin[1] = d[ti + 1] * fs * col[1] * shade
        lin[2] = d[ti + 2] * fs * col[2] * shade
        alpha *= d[ti + 3]
      }
      // the hands stand in a frame of their own, with no world to read the field at: they take the flash handed to them
      if (flash) {
        lin[0] += (flash.r - lin[0]) * flash.a
        lin[1] += (flash.g - lin[1]) * flash.a
        lin[2] += (flash.b - lin[2]) * flash.a
      } else if (toWorld)
        this.flashed(lin, toWorld[0] * hx + toWorld[1] * hy + toWorld[2] * hz + toWorld[3], toWorld[8] * hx + toWorld[9] * hy + toWorld[10] * hz + toWorld[11])
      enc[0] = encode(lin[0])
      enc[1] = encode(lin[1])
      enc[2] = encode(lin[2])
      // the fixtures are drawn whole; the crowd, the translucent and the ghosts blend
      if (s.pass === 'fixture') this.blend(o, enc, 1)
      else this.blend(o, enc, alpha)
      if (how === 'solid') this.zbuf[o] = depth
    }
    // the faces of the box the eye sees, each carrying the point of the sprite's frame it is at
    const xs = [x0, x1], ys = [y0, y1], zs = [z0, z1]
    const Q = this.boxQ
    for (const f of BOX_FACES) {
      for (let c = 0; c < 4; c++) {
        const [i, j, l] = f[c]
        const q = Q[c]
        const lx = xs[i], ly = ys[j], lz = zs[l]
        q[0] = toCam[0] * lx + toCam[1] * ly + toCam[2] * lz + toCam[3]
        q[1] = toCam[4] * lx + toCam[5] * ly + toCam[6] * lz + toCam[7]
        q[2] = toCam[8] * lx + toCam[9] * ly + toCam[10] * lz + toCam[11]
        q[3] = lx
        q[4] = ly
        q[5] = lz
      }
      this.poly(Q, 3, true, frag, false)
    }
  }

  /**
   * The rows the box x0..x1, y0..y1, z0..z1 of a frame `toCam` takes to camera
   * space can reach, [lo, hi]: its corners on the screen, as `poly` puts
   * them; all where any is behind the near plane, none where it is off the
   * frame's sides. A band passes over the sprites it misses before their
   * setting up, the most of a band's work where the pixels are few.
   */
  private boxRows(toCam: Float64Array, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): [number, number] {
    const W = this.width, H = this.height
    let loX = Infinity, hiX = -Infinity, loY = Infinity, hiY = -Infinity
    for (let i = 0; i < 8; i++) {
      const lx = i & 1 ? x1 : x0, ly = i & 2 ? y1 : y0, lz = i & 4 ? z1 : z0
      const z = toCam[8] * lx + toCam[9] * ly + toCam[10] * lz + toCam[11]
      if (z < NEAR) return [0, H]
      const sx = W / 2 + ((toCam[0] * lx + toCam[1] * ly + toCam[2] * lz + toCam[3]) / z) * this.f
      const sy = H / 2 - ((toCam[4] * lx + toCam[5] * ly + toCam[6] * lz + toCam[7]) / z) * this.fy
      if (sx < loX) loX = sx
      if (sx > hiX) hiX = sx
      if (sy < loY) loY = sy
      if (sy > hiY) hiY = sy
    }
    if (Math.ceil(hiX) < 0 || Math.floor(loX) > W - 1) return [H, H]
    return [Math.floor(loY), Math.ceil(hiY)]
  }

  /** A shadow: a disc on the floor under what stands, darkening what it lies on, gliding with it. */
  private shadow(s: { x: number; y: number; r: number; moverId?: number }) {
    const o = s.moverId === undefined ? undefined : this.motion.offsets.get(s.moverId)
    const cx = s.x + 0.5 + (o?.x ?? 0), cz = s.y + 0.5 + (o?.y ?? 0)
    const R = SHADOW_RADIUS * s.r
    const P: Float64Array[] = []
    for (let i = 0; i < 16; i++) {
      const t = (i / 16) * 2 * Math.PI
      const p = new Float64Array(3)
      this.toCamera([cx + Math.cos(t) * R, 0.003, cz - Math.sin(t) * R], p)
      P.push(p)
    }
    const black: RGB = [0, 0, 0]
    this.poly(P, 0, false, (o) => this.blend(o, black, SHADOW_ALPHA), true)
  }

  /** The cursor over everything: its tile laid on the floor, or the ring round its cell. */
  private drawCursor() {
    const cur = this.cursor
    if (!cur) return
    const cx = cur.x + 0.5, cz = cur.y + 0.5
    const rect = cur.tile !== undefined ? this.tiles!.tile(cur.tile) : undefined
    const atlas = rect ? this.drawn(rect.atlas) : null
    const m = rect && atlas ? 0.5 : RING_REACH
    const P = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => {
      const p = new Float64Array(5)
      this.toCamera([cx + i * m, 0.012, cz + j * m], p)
      p[3] = i * m
      p[4] = j * m
      return p
    })
    if (rect && atlas) {
      const cell = rect.cell
      const enc: RGB = [0, 0, 0]
      this.poly(P, 2, false, (o, _d, a) => {
        // the tile over the cell where its offsets place it
        const px = Math.floor((a[0] + 0.5) * cell) - rect.ox, py = Math.floor((a[1] + 0.5) * cell) - rect.oy
        if (px < 0 || py < 0 || px >= rect.w || py >= rect.h) return
        const i = ((rect.sy + py) * atlas.w + rect.sx + px) * 4
        if (atlas.data[i + 3] < 0.01) return
        enc[0] = encode(atlas.data[i])
        enc[1] = encode(atlas.data[i + 1])
        enc[2] = encode(atlas.data[i + 2])
        this.blend(o, enc, atlas.data[i + 3])
      })
      return
    }
    // the ring's colour as render-3d's uniform holds it, linear (three's Color of the sRGB), and then encoded as the
    // shader encodes it: the sRGB again
    const hex = cursorColour(cur)
    const enc: RGB = [encode(srgbToLinear((hex >> 16) / 255)), encode(srgbToLinear(((hex >> 8) & 255) / 255)), encode(srgbToLinear((hex & 255) / 255))]
    this.poly(P, 2, false, (o, depth, a) => {
      // the band's coverage of the pixel as the shader works it, the pixel's width on the floor taken from its depth
      const al = ringCover(a[0] + 0.5, a[1] + 0.5, (1.5 * depth) / this.f)
      if (al >= 0.01) this.blend(o, enc, CURSOR_ALPHA * al)
    })
  }

  // ------------------------------------------------------------ the hands

  /**
   * The hands (render-3d's `renderViewmodel`), over everything in a frame of
   * their own: a lens VM_FOV high, two units tall at their depth; each icon
   * a block VM_DEPTH texels thick with its hull closed both sides, hanging
   * from the bottom centre of its art at its pose, turned and pitched as
   * posed; the weapon pushed along its pose by the swing's lift; in the
   * level's tint, washed by the flash over the player's cell.
   */
  private drawHands(scene: Scene) {
    const vm = this.viewmodel
    if (!this.opts.viewmodel || !vm || (!vm.weapon && !vm.offhand)) return
    const flash = flashOf(getCell(scene, scene.player.x, scene.player.y))
    const tint = scene.level.tint
    const asp = this.width / (this.height * this.pixelAspect)
    // the hands' own lens, and the depth cleared for them
    const f = this.f, fy = this.fy
    this.fy = this.height / 2 / Math.tan((VM_FOV * Math.PI) / 360)
    this.f = this.fy * this.pixelAspect
    this.zbuf.fill(Infinity, this.y0 * this.width, this.y1 * this.width)
    const camZ = 1 / Math.tan((VM_FOV * Math.PI) / 360)
    const pose = (item: HandItem | null | undefined, rest: HandPose, push = 0) => {
      const h = item && this.hand(item)
      if (!h) return
      const len = Math.hypot(rest.x * asp, rest.y) || 1
      const tx = rest.x * asp * (1 - push / len), ty = rest.y * (1 - push / len)
      // three's Euler YXZ: yaw, then pitch, then roll
      const R = mul3(mul3(rotY(rest.yaw), rotX(rest.pitch)), rotZ(rest.roll))
      // the hand's frame into the lens's camera space (x right, y up, z ahead), the lens at camZ looking down -z
      const toCam = new Float64Array(12)
      for (let j = 0; j < 3; j++) {
        toCam[j] = R[j]
        toCam[4 + j] = R[3 + j]
        toCam[8 + j] = -R[6 + j]
      }
      toCam[3] = tx
      toCam[7] = ty
      toCam[11] = camZ
      const inst: SpriteInstance = {
        atlas: '',
        pass: 'opaque',
        anchor: [0, 0, 0],
        quad: h.quad,
        z: [0, VM_DEPTH * h.scale],
        texel: [0, 0, h.cell, h.cell],
        color: [tint.r, tint.g, tint.b, 1],
        misc: [MODE_THICK | MODE_HULL_FRONT | MODE_FLASH_OVERRIDE, 1, h.scale, 0],
        cell: [0, 0],
        x: 0,
        y: 0,
      }
      this.box(h.atlas, inst, null, toCam, 'solid', false, flash)
    }
    pose(vm.weapon, VM_WEAPON_REST, this.motion.lift * VM_LIFT)
    pose(vm.offhand, vm.offhand?.name?.startsWith('HAND2_') ? VM_SHIELD_REST : VM_OFFWEAPON_REST)
    this.f = f
    this.fy = fy
  }

  /**
   * An item's icon layers painted into one cell as WebTiles composes an
   * inventory icon, its outline peeled as the world's sprites' is, with how
   * far each texel stands from its art, and the quad that hangs it from the
   * bottom centre of its opaque texels (render-3d's `buildHand`).
   */
  private hand(item: HandItem): Hand | null {
    const key = JSON.stringify(item.layers)
    let h = this.hands.get(key)
    if (h !== undefined) return h
    h = null
    let cell = 32
    let px: Uint8ClampedArray | null = null
    for (const l of item.layers) {
      const r = this.tiles!.tile(l.tile, l.layer)
      const atlas = r && this.atlas(r.atlas)
      if (!r || !atlas) continue
      let rows = r.h
      if (l.ymax !== undefined && l.ymax < r.oy + r.h) rows = Math.max(0, l.ymax - r.oy)
      if (rows <= 0) continue
      cell = r.cell
      px ??= new Uint8ClampedArray(cell * cell * 4)
      // drawn over what is there as a canvas draws, in sRGB bytes
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < r.w; x++) {
          const dx = x + r.ox, dy = y + r.oy
          if (dx < 0 || dy < 0 || dx >= cell || dy >= cell) continue
          const s = ((r.sy + y) * atlas.w + r.sx + x) * 4
          const a = atlas.data[s + 3]
          if (a <= 0) continue
          const d = (dy * cell + dx) * 4
          for (let ch = 0; ch < 3; ch++) px[d + ch] = px[d + ch] * (1 - a) + encode(atlas.data[s + ch]) * 255 * a
          px[d + 3] = (a + (px[d + 3] / 255) * (1 - a)) * 255
        }
    }
    if (px) {
      // the hands are the same art as the world's sprites, so they lose the same outline
      peelInk(px, cell, cell, 128)
      const mask = new Uint8Array(cell * cell)
      let bx0 = cell, bx1 = -1, by0 = cell, by1 = -1
      for (let y = 0; y < cell; y++)
        for (let x = 0; x < cell; x++)
          if (px[(y * cell + x) * 4 + 3] >= 128) {
            mask[y * cell + x] = 1
            bx0 = Math.min(bx0, x)
            bx1 = Math.max(bx1, x)
            by0 = Math.min(by0, y)
            by1 = Math.max(by1, y)
          }
      if (bx1 >= 0) {
        const atlas: Atlas = { ...linearAtlas({ width: cell, height: cell, data: px }), dist: distanceField(mask, cell, cell) }
        const cxb = (bx0 + bx1 + 1) / 2, bottom = by1 + 1
        const scale = (VM_SIZE * VM_FILL) / Math.max(bx1 - bx0 + 1, by1 - by0 + 1)
        h = { atlas, cell, scale, quad: [(cell / 2 - cxb) * scale, (bottom - cell / 2) * scale, (cell / 2) * scale, (cell / 2) * scale] }
      }
    }
    this.hands.set(key, h)
    return h
  }

  // ------------------------------------------------------------ the raster

  /**
   * The frame's buffers for `width` x `height`: kept, not made again, where
   * they are big enough, as the view goes between its sizes moving and at rest
   * with every step and turn.
   */
  private size(width: number, height: number) {
    this.width = width
    this.height = height
    if (this.zbuf.length >= width * height) return
    this.colour = new Float32Array(width * height * 3)
    this.zbuf = new Float32Array(width * height)
    this.sceneDepth = new Float32Array(width * height)
  }

  /** The camera as render-3d stands it: at eye height in the middle of the eye's cell, turned YXZ by (pitch, -yaw). */
  private place(cam: Camera) {
    this.ex = cam.eyeX + 0.5
    this.ey = Math.max(EYE_MIN, Math.min(EYE_MAX, this.opts.eyeHeight))
    this.ez = cam.eyeY + 0.5
    const sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw), sp = Math.sin(cam.pitch), cp = Math.cos(cam.pitch)
    this.ax = [cy, 0, sy]
    this.ay = [-sy * sp, cp, cy * sp]
    this.af = [sy * cp, sp, -cy * cp]
    this.fy = this.height / 2 / Math.tan((this.opts.fov * Math.PI) / 360)
    this.f = this.fy * this.pixelAspect
    this.standYaw = -cam.yaw
  }

  /** A world point into camera space (x right, y up, z ahead), in p[0..2]. */
  private toCamera(w: RGB, p: Float64Array) {
    const dx = w[0] - this.ex, dy = w[1] - this.ey, dz = w[2] - this.ez
    p[0] = dx * this.ax[0] + dy * this.ax[1] + dz * this.ax[2]
    p[1] = dx * this.ay[0] + dy * this.ay[1] + dz * this.ay[2]
    p[2] = dx * this.af[0] + dy * this.af[1] + dz * this.af[2]
  }

  /**
   * A convex polygon in camera space, `k` attributes after the position,
   * clipped at the near plane and filled pixel by pixel: `frag` gets each
   * pixel whose middle it covers, with its depth and the attributes there,
   * perspective-correct. `cullBack` leaves out a polygon that faces away (a
   * wall's face seen from inside the wall), as GL culls a back face.
   */
  private poly(P: Float64Array[], k: number, cullBack: boolean, frag: Frag, test = false) {
    const n = 3 + k
    // the polygon clipped, into buffers kept from one polygon to the next: the most are wholly in front, and kept as they are
    const Q = this.polyQ
    let nq = 0
    let front = true
    for (let i = 0; i < P.length; i++) if (P[i][2] < NEAR) front = false
    if (front) for (let i = 0; i < P.length; i++) Q[nq++] = P[i]
    else
      for (let i = 0, cut = 0; i < P.length; i++) {
        const a = P[i], b = P[(i + 1) % P.length]
        const ina = a[2] >= NEAR, inb = b[2] >= NEAR
        if (ina) Q[nq++] = a
        if (ina !== inb) {
          const t = (NEAR - a[2]) / (b[2] - a[2])
          const q = this.polyCut[cut++]
          for (let j = 0; j < n; j++) q[j] = a[j] + (b[j] - a[j]) * t
          Q[nq++] = q
        }
      }
    if (nq < 3) return
    const W = this.width, H = this.height, f = this.f, fy = this.fy
    const sx = this.polySx, sy = this.polySy
    let loX = Infinity, hiX = -Infinity, loY = Infinity, hiY = -Infinity
    for (let i = 0; i < nq; i++) {
      const q = Q[i]
      sx[i] = W / 2 + (q[0] / q[2]) * f
      sy[i] = H / 2 - (q[1] / q[2]) * fy
      if (sx[i] < loX) loX = sx[i]
      if (sx[i] > hiX) hiX = sx[i]
      if (sy[i] < loY) loY = sy[i]
      if (sy[i] > hiY) hiY = sy[i]
    }
    // wholly off the rows drawn, or off the sides
    if (Math.ceil(hiY) < this.y0 || Math.floor(loY) > this.y1 - 1 || Math.ceil(hiX) < 0 || Math.floor(loX) > W - 1) return
    if (cullBack) {
      let area = 0
      for (let i = 0; i < nq; i++) {
        const j = (i + 1) % nq
        area += sx[i] * sy[j] - sx[j] * sy[i]
      }
      // a front face winds counter-clockwise with y up, which is clockwise with the screen's y down
      if (area >= 0) return
    }
    const attrs = this.attrs
    for (let t = 1; t + 1 < nq; t++) {
      const A = 0, B = t, C = t + 1
      const area = (sx[B] - sx[A]) * (sy[C] - sy[A]) - (sx[C] - sx[A]) * (sy[B] - sy[A])
      if (Math.abs(area) < 1e-9) continue
      const minX = Math.max(0, Math.floor(Math.min(sx[A], sx[B], sx[C]))), maxX = Math.min(W - 1, Math.ceil(Math.max(sx[A], sx[B], sx[C])))
      const minY = Math.max(this.y0, Math.floor(Math.min(sy[A], sy[B], sy[C]))), maxY = Math.min(this.y1 - 1, Math.ceil(Math.max(sy[A], sy[B], sy[C])))
      if (minX > maxX || minY > maxY) continue
      const V0 = Q[A], V1 = Q[B], V2 = Q[C]
      const iz0 = 1 / V0[2], iz1 = 1 / V1[2], iz2 = 1 / V2[2]
      const uv = k >= 2
      const u0 = uv ? V0[3] : 0, u1 = uv ? V1[3] : 0, u2 = uv ? V2[3] : 0, v0 = uv ? V0[4] : 0, v1 = uv ? V1[4] : 0, v2 = uv ? V2[4] : 0
      // the barycentric weights are linear across the screen: w = ax·x + by·y + c, for the pixel's middle
      const a0 = -(sy[C] - sy[B]) / area, b0 = (sx[C] - sx[B]) / area, c0 = (sx[B] * sy[C] - sx[C] * sy[B]) / area
      const a1 = -(sy[A] - sy[C]) / area, b1 = (sx[A] - sx[C]) / area, c1 = (sx[C] * sy[A] - sx[A] * sy[C]) / area
      const a2 = -a0 - a1, b2 = -b0 - b1, c2 = 1 - c0 - c1
      const zb = this.zbuf
      // the attributes after the uv (up to three: the point in the world, or in a sprite's frame), at each corner
      const m0 = k > 2 ? V0[5] : 0, m1 = k > 2 ? V1[5] : 0, m2 = k > 2 ? V2[5] : 0
      const n0 = k > 3 ? V0[6] : 0, n1 = k > 3 ? V1[6] : 0, n2 = k > 3 ? V2[6] : 0
      const q0 = k > 4 ? V0[7] : 0, q1 = k > 4 ? V1[7] : 0, q2 = k > 4 ? V2[7] : 0
      for (let y = minY; y <= maxY; y++) {
        const py = y + 0.5
        // the span of the row inside all three edges: each weight is non-negative on one side of an x
        let lo = minX + 0.5, hi = maxX + 0.5
        const e0 = b0 * py + c0, e1 = b1 * py + c1, e2 = b2 * py + c2
        if (a0 > 0) lo = Math.max(lo, -e0 / a0)
        else if (a0 < 0) hi = Math.min(hi, -e0 / a0)
        else if (e0 < 0) continue
        if (a1 > 0) lo = Math.max(lo, -e1 / a1)
        else if (a1 < 0) hi = Math.min(hi, -e1 / a1)
        else if (e1 < 0) continue
        if (a2 > 0) lo = Math.max(lo, -e2 / a2)
        else if (a2 < 0) hi = Math.min(hi, -e2 / a2)
        else if (e2 < 0) continue
        const x0 = Math.ceil(lo - 0.5), x1 = Math.floor(hi - 0.5)
        for (let x = x0, o = y * W + x0; x <= x1; x++, o++) {
          const px = x + 0.5
          const w0 = Math.max(0, a0 * px + e0), w1 = Math.max(0, a1 * px + e1), w2 = Math.max(0, a2 * px + e2)
          const p0 = w0 * iz0, p1 = w1 * iz1, p2 = w2 * iz2
          const inv = p0 + p1 + p2
          const depth = 1 / inv
          if (test && depth >= zb[o]) continue
          // the attributes, the uv alone written out as most polygons want only it
          attrs[0] = (p0 * u0 + p1 * u1 + p2 * u2) * depth
          attrs[1] = (p0 * v0 + p1 * v1 + p2 * v2) * depth
          if (k > 2) {
            attrs[2] = (p0 * m0 + p1 * m1 + p2 * m2) * depth
            if (k > 3) {
              attrs[3] = (p0 * n0 + p1 * n1 + p2 * n2) * depth
              attrs[4] = (p0 * q0 + p1 * q1 + p2 * q2) * depth
            }
          }
          frag(o, depth, attrs)
        }
      }
    }
  }

  /** `enc` over the pixel at `alpha`, on encoded values, as the canvas blends. */
  private blend(o: number, enc: RGB, alpha: number) {
    const c = this.colour
    if (alpha >= 1) {
      c[o * 3] = enc[0]
      c[o * 3 + 1] = enc[1]
      c[o * 3 + 2] = enc[2]
      return
    }
    if (alpha <= 0) return
    c[o * 3] += (enc[0] - c[o * 3]) * alpha
    c[o * 3 + 1] += (enc[1] - c[o * 3 + 1]) * alpha
    c[o * 3 + 2] += (enc[2] - c[o * 3 + 2]) * alpha
  }

  // ------------------------------------------------------------ the atlases

  /**
   * An atlas in linear light, as the level draws it, or with its ink peeled
   * and its distance field, as the sprites do (`sprite`); null where its
   * pixels cannot be had.
   */
  private atlas(name: string, sprite = false): Atlas | null {
    const key = `${sprite ? 'sprite' : 'level'}|${name}`
    let a = this.atlases.get(key)
    if (a !== undefined) return a
    a = this.linear?.(name, sprite)
    if (a === undefined) {
      const px = this.pixels(name)
      a = px ? (sprite ? spriteAtlas(px, this.tiles?.spriteRects?.(name)) : linearAtlas(px)) : null
    }
    this.atlases.set(key, a)
    return a
  }

  /**
   * An atlas as the level and the cursor draw from it: render-3d draws them
   * from the atlas's texture, which its peel replaces with the peeled art, so
   * an atlas the sprites are drawn from (`spriteAtlases`, or, where the
   * source says nothing, one a sprite has been drawn from) is drawn peeled
   * here too: a sprite's tile laid on the floor (gold as a cell's overlay)
   * without crawl's ink.
   */
  private drawn(name: string): Atlas | null {
    const listed = this.tiles?.spriteAtlases?.()
    const peeled = listed ? listed.includes(name) : this.atlases.has(`sprite|${name}`)
    return this.atlas(name, peeled)
  }
}

/** Floats in memory threads can share, where there is any. */
function floats(n: number): Float32Array {
  return typeof SharedArrayBuffer === 'function' ? new Float32Array(new SharedArrayBuffer(n * 4)) : new Float32Array(n)
}

/** An atlas's pixels in linear light, as the level samples them: in memory threads can share, where there is any. */
export function linearAtlas(px: Pixels): Atlas {
  const { width: w, height: h, data: src } = px
  const data = floats(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = DECODE[src[i * 4]]
    data[i * 4 + 1] = DECODE[src[i * 4 + 1]]
    data[i * 4 + 2] = DECODE[src[i * 4 + 2]]
    data[i * 4 + 3] = src[i * 4 + 3] / 255
  }
  return { w, h, data, dist: null }
}

/**
 * An atlas as the sprites are drawn from it (render-3d's `peelNow`): the ink
 * the eye can reach from outside each sprite peeled off (peel.ts
 * `peelInk`), only inside `sprites` where given, then in linear light, with
 * how far each texel stands from the body (`distanceField`), which the
 * sprite march reads to tell body from hull from air.
 */
export function spriteAtlas(px: Pixels, sprites?: ReadonlyArray<{ sx: number; sy: number; w: number; h: number }>): Atlas {
  const data = new Uint8ClampedArray(px.data)
  const mask = peelInk(data, px.width, px.height, OPAQUE_ALPHA, sprites)
  const dist = distanceField(mask, px.width, px.height)
  const shared = typeof SharedArrayBuffer === 'function' ? new Uint8Array(new SharedArrayBuffer(dist.length)) : new Uint8Array(dist.length)
  shared.set(dist)
  return { ...linearAtlas({ width: px.width, height: px.height, data }), dist: shared }
}

interface Hand {
  /** the icon, peeled, with its distance field */
  atlas: Atlas
  cell: number
  /** world units a texel */
  scale: number
  /** the quad that hangs it from the bottom centre of its art (centre x, centre y, half width, half height) */
  quad: [number, number, number, number]
}

/** The texel of `atlas` under uv (u, v), into `out` as linear RGBA: the nearest, as render-3d samples. */
function sample(atlas: Atlas, u: number, v: number, out: number[]) {
  const x = Math.min(atlas.w - 1, Math.max(0, Math.floor(u * atlas.w)))
  const y = Math.min(atlas.h - 1, Math.max(0, Math.floor(v * atlas.h)))
  const i = (y * atlas.w + x) * 4
  out[0] = atlas.data[i]
  out[1] = atlas.data[i + 1]
  out[2] = atlas.data[i + 2]
  out[3] = atlas.data[i + 3]
}

/** a block's face's shade (sprites.ts BLOCK_SHADE): 0 front, 1 back, 2 side, 3 top, 4 bottom */
function faceShade(face: number): number {
  return face === 2 ? BLOCK_SHADE.side : face === 3 ? BLOCK_SHADE.top : face === 4 ? BLOCK_SHADE.bottom : BLOCK_SHADE.front
}

type M3 = number[]
const rotX = (a: number): M3 => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)]
const rotY = (a: number): M3 => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)]
const rotZ = (a: number): M3 => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1]
function mul3(a: M3, b: M3): M3 {
  const out: M3 = []
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) out.push(a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j])
  return out
}

/** The point an affine map `m` (3x4, rows) takes to the origin. */
function invertAt(m: Float64Array): RGB {
  const [a, b, c, tx, d, e, f, ty, g, h, i, tz] = m
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g
  const det = a * A + b * B + c * C
  // the inverse's rows, times -t
  const inv = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d]
  return [0, 1, 2].map((r) => -(inv[r * 3] * tx + inv[r * 3 + 1] * ty + inv[r * 3 + 2] * tz) / det) as RGB
}

/** exp(-d / LID_FADE), from a table: the lid's every pixel asks */
const LID_STEP = 1 / 64
const LID_TABLE = new Float32Array(64 * 64 + 1)
for (let i = 0; i < LID_TABLE.length; i++) LID_TABLE[i] = Math.exp(-(i * LID_STEP) / LID_FADE)
function lidFade(d: number): number {
  const i = (d / LID_STEP) | 0
  return i < LID_TABLE.length ? LID_TABLE[i] : 0
}

/**
 * A mark sampled over the pixel's footprint (shaders.ts `footprint`): a tap
 * a texel along each of the footprint's axes, 1 to 8, none past the tile's
 * `rect`, averaged with the colour weighted by alpha, and the coverage `c`
 * of `n` taps across drawn as 1 - (1 - c)^n, so a line thinner than a pixel
 * stays whole and a slanted one smooth. Into `out` as linear RGBA.
 */
function footprint(atlas: Atlas, u: number, v: number, grad: number[], rect: number[], out: number[]) {
  const L = atlas
  const lo0 = Math.min(rect[0], rect[2]), hi0 = Math.max(rect[0], rect[2])
  const lo1 = Math.min(rect[1], rect[3]), hi1 = Math.max(rect[1], rect[3])
  const e0 = lo0 - 0.25 / L.w, e1 = hi0 + 0.25 / L.w, f0 = lo1 - 0.25 / L.h, f1 = hi1 + 0.25 / L.h
  const nx = Math.max(1, Math.min(8, Math.ceil(Math.hypot(grad[0] * L.w, grad[1] * L.h))))
  const ny = Math.max(1, Math.min(8, Math.ceil(Math.hypot(grad[2] * L.w, grad[3] * L.h))))
  let r = 0, g = 0, b = 0, a = 0
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++) {
      const ox = (i + 0.5) / nx - 0.5, oy = (j + 0.5) / ny - 0.5
      const tu = u + ox * grad[0] + oy * grad[2], tv = v + ox * grad[1] + oy * grad[3]
      if (tu < e0 || tu > e1 || tv < f0 || tv > f1) continue
      const x = Math.min(L.w - 1, Math.max(0, Math.floor(Math.min(hi0, Math.max(lo0, tu)) * L.w)))
      const y = Math.min(L.h - 1, Math.max(0, Math.floor(Math.min(hi1, Math.max(lo1, tv)) * L.h)))
      const k = (y * L.w + x) * 4
      const al = L.data[k + 3]
      r += L.data[k] * al
      g += L.data[k + 1] * al
      b += L.data[k + 2] * al
      a += al
    }
  const taps = nx * ny
  if (a <= 0) {
    out[0] = out[1] = out[2] = out[3] = 0
    return
  }
  out[0] = r / a
  out[1] = g / a
  out[2] = b / a
  out[3] = 1 - Math.pow(1 - a / taps, Math.max(nx, ny))
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** sRGB bytes to linear light */
const DECODE = new Float32Array(256)
for (let i = 0; i < 256; i++) {
  const c = i / 255
  DECODE[i] = srgbToLinear(c)
}

/** linear light to sRGB, 0..1, as the shaders' toSRGB */
const ENCODE_N = 4096
const ENCODE = new Float32Array(ENCODE_N + 1)
for (let i = 0; i <= ENCODE_N; i++) {
  const c = i / ENCODE_N
  ENCODE[i] = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}
function encode(c: number): number {
  return c <= 0 ? 0 : c >= 1 ? 1 : ENCODE[(c * ENCODE_N + 0.5) | 0]
}
