import { flashOf, getCell, keyToXY, shadeOf, type CellKey, type Camera, type HandItem, type Scene, type SceneCursor, type TileSource, type Viewmodel } from '@orbrun/scene'
import { LevelGrid } from '@orbrun/render-3d/grid'
import { VM_OFFWEAPON_REST, VM_SHIELD_REST, VM_SIZE, VM_WEAPON_REST, type HandPose } from '@orbrun/render-3d/hands'
import { LEVEL_CHUNK, LevelMesher, MARK_MARGIN, uvFor, type ChunkGeometry, type MeshContext, type TileDraw } from '@orbrun/render-3d/level-mesh'
import { SEL_GROW, crowdInstances, fixtureInstances, type SpriteInstance } from '@orbrun/render-3d/sprites'

/**
 * A first-person renderer of a `@orbrun/scene` `Scene` for terminals, drawn
 * as render-3d draws it: render-3d's own level geometry (level-mesh.ts) and
 * sprite instances (sprites.ts), rasterized on the CPU into a small RGB
 * buffer with render-3d's shading (shaders.ts) worked the same way: colour
 * in linear light, each cell lit by the shade field, the flash washed over,
 * the lid receding into the dark, then encoded, and what blends blending on
 * the encoded values. A terminal shows a cell as 2x2 quadrant blocks, so
 * 80x24 is 160x48 pixels.
 *
 * What a terminal's pixels cannot carry is left out or made simpler: a
 * picture that small is the browser's shrunk, so textures are averaged as
 * they recede (mipmaps) where render-3d samples the nearest texel; sprites
 * are their front face, without the texel-deep block behind it, and keep
 * the art's own ink where render-3d peels it off and draws it back as a
 * hull; a way up stands whole rather than folded; the hands are flat icons
 * in their place, with no lift.
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

// render-3d's numbers (index.ts, shaders.ts), kept in step by hand
const EYE = 0.6
const EYE_MIN = 0.25
const EYE_MAX = 0.9
const WALL_INSET = 12 / 32
const CHAMFER = 1 / 32
const NEAR = 0.05
const LID_LIGHT = 0.7
const LID_FADE = 5
const WALL_TOP = 0.75
const WALL_SHADOW = 0.3
const OPAQUE_ALPHA = 26 / 255
const GHOST_GAP = 0.06
const GHOST_FADE_START = 5
const GHOST_FADE = 14
const GHOST_FADE_VISIBLE_START = 8
const GHOST_FADE_VISIBLE = 30
const RING_INNER = 0.34
const RING_OUTER = 0.46
const RING_REACH = RING_OUTER + MARK_MARGIN
/** the cursor's colours, linear, as render-3d's uniforms hold them */
const CURSOR_COLOUR: RGB = [1, 0.53, 0]
const CURSOR_MAP_COLOUR: RGB = [1, 1, 1]
/** the selected sprite's shell, encoded (HULL_SEL_COLOUR) */
const SHELL: RGB = [0xff / 255, 0xdd / 255, 0x33 / 255]
const SHADOW_RADIUS = 0.22
const SHADOW_ALPHA = 0.35
const VM_FILL = 0.9
const MODE_BILLBOARD = 1
const MODE_RING = 8
const MODE_SHADE_MAP = 16
const MODE_LIE = 64
const MODE_FACE_EYE = 128
/** the coarsest a sprite is averaged to: a 32-texel tile down to two */
const SPRITE_MIP_MAX = 4
/** the coarsest mip a level texture is sampled at: past this, its averages would reach into the next tile in the atlas */
const MIP_MAX = 3

type RGB = [number, number, number]

/** An atlas in linear light, RGBA floats, with its mips. */
interface Atlas {
  levels: { w: number; h: number; data: Float32Array }[]
}

/** What a polygon's pixel is drawn with: the pixel, its depth, and the attributes there. */
type Frag = (o: number, depth: number, a: Float64Array) => void

export class RenderTerm {
  private tiles: TileSource | null = null
  private pixels: (atlas: string) => Pixels | undefined = () => undefined
  private atlases = new Map<string, Atlas | null>()
  private scene: Scene | null = null
  private opts: Required<RenderTermOptions>
  private cursor: SceneCursor | null = null
  private viewmodel: Viewmodel | null = null
  private hands = new Map<string, Hand | null>()
  private spriteMips = new Map<string, { w: number; h: number; data: Float32Array }[]>()

  // the level, as render-3d keeps it
  private mesher = new LevelMesher()
  private grid: LevelGrid | null = null
  private builtRevision = -1
  private builtLayout = -1
  private builtTint = ''
  private fixtures: SpriteInstance[] = []
  private crowd: SpriteInstance[] = []
  private shadows: { x: number; y: number; r: number }[] = []
  private crowdRevision = -1
  private crowdSelection = ''
  // the fields: each cell's light and the flash over it
  private field = { ox: 0, oz: 0, w: 1, h: 1, shade: new Uint8Array(1), flash: new Uint8Array(4), near: new Uint8Array(1) }

  // the frame
  private width = 0
  private height = 0
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

  constructor(opts: RenderTermOptions = {}) {
    this.opts = { fov: 85, eyeHeight: EYE, wallInset: WALL_INSET, chamfer: CHAMFER, viewmodel: true, ...opts }
  }

  setOptions(opts: RenderTermOptions): void {
    const before = this.opts
    this.opts = { ...this.opts, ...opts }
    if (before.wallInset !== this.opts.wallInset || before.chamfer !== this.opts.chamfer) this.relevel()
  }

  setTiles(tiles: TileSource, pixels: (atlas: string) => Pixels | undefined): void {
    this.tiles = tiles
    this.pixels = pixels
    this.atlases.clear()
    this.hands.clear()
    this.spriteMips.clear()
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
   * `pixelAspect` times as tall as it is wide (2 for a terminal's quadrant
   * blocks, whose cells are about twice as tall as wide).
   */
  render(cam: Camera, width: number, height: number, out: Uint8Array, pixelAspect = 1): void {
    this.pixelAspect = pixelAspect
    const scene = this.scene
    if (!scene || !this.tiles) {
      out.fill(0)
      return
    }
    this.size(width, height)
    this.update(scene)
    this.place(cam)
    const bg = scene.level.sky === 'open' ? 0x0b1220 : scene.level.sky === 'dark' ? 0x120818 : 0
    const c = this.colour
    for (let i = 0; i < width * height; i++) {
      c[i * 3] = ((bg >> 16) & 255) / 255
      c[i * 3 + 1] = ((bg >> 8) & 255) / 255
      c[i * 3 + 2] = (bg & 255) / 255
    }
    this.zbuf.fill(Infinity)
    // the level and its fixtures, then what the ghosts show through
    this.level(['level', 'void'])
    for (const s of this.fixtures) this.sprite(s, 'solid')
    this.sceneDepth.set(this.zbuf)
    // the transparent passes, in render-3d's render order
    for (const s of this.crowd) if (s.pass === 'ghostVisible') this.sprite(s, 'ghost')
    for (const s of this.crowd) if (s.pass === 'ghostRemembered') this.sprite(s, 'ghost')
    for (const s of this.crowd) if (s.pass === 'opaque') this.sprite(s, 'solid')
    for (const s of this.shadows) this.shadow(s)
    this.drawCursor()
    this.level(['decal'])
    const eye = { x: cam.eyeX + 0.5, y: cam.eyeY + 0.5 }
    const far = (s: SpriteInstance) => (s.anchor[0] - eye.x) ** 2 + (s.anchor[2] - eye.y) ** 2
    for (const s of this.crowd.filter((s) => s.pass === 'blend').sort((p, q) => far(q) - far(p))) this.sprite(s, 'blend')
    this.level(['marks'])
    this.drawHands(scene)
    // every value is in 0..1: encoded, or blended between encoded values
    for (let i = 0; i < width * height * 3; i++) out[i] = (c[i] * 255 + 0.5) | 0
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
        this.fixtures = fixtureInstances(scene, (id) => this.tiles!.tile(id), grid.framed, grid.occupied, undefined, this.opts.wallInset)
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

  /** Whether any of the box x0..x1, 0..1, z0..z1 can be in sight: in front of the eye and not wholly past one side of the view. */
  private boxInView(x0: number, z0: number, x1: number, z1: number): boolean {
    const halfX = this.width / 2 / this.f, halfY = this.height / 2 / this.fy
    let front = false, left = true, right = true, below = true, above = true
    for (let i = 0; i < 8; i++) {
      const dx = (i & 1 ? x1 : x0) - this.ex, dy = (i & 2 ? 1 : 0) - this.ey, dz = (i & 4 ? z1 : z0) - this.ez
      const px = dx * this.ax[0] + dy * this.ax[1] + dz * this.ax[2]
      const py = dx * this.ay[0] + dy * this.ay[1] + dz * this.ay[2]
      const pz = dx * this.af[0] + dy * this.af[1] + dz * this.af[2]
      if (pz > NEAR) front = true
      if (px > -halfX * pz) left = false
      if (px < halfX * pz) right = false
      if (py > -halfY * pz) below = false
      if (py < halfY * pz) above = false
    }
    return front && !left && !right && !below && !above
  }

  /** One mesh of a chunk, as LEVEL_FRAG (or VOID_FRAG) draws it. */
  private geometry(g: ChunkGeometry, lidded: boolean) {
    const atlas = g.kind === 'void' ? null : this.atlas(g.atlas)
    if (g.kind !== 'void' && !atlas) return
    const pos = g.position, uv = g.uv, idx = g.index
    const n = pos.length / 3
    // the vertices into camera space, once
    const cam = new Float64Array(n * 3)
    for (let i = 0; i < n; i++) {
      const dx = pos[i * 3] - this.ex, dy = pos[i * 3 + 1] - this.ey, dz = pos[i * 3 + 2] - this.ez
      cam[i * 3] = dx * this.ax[0] + dy * this.ax[1] + dz * this.ax[2]
      cam[i * 3 + 1] = dx * this.ay[0] + dy * this.ay[1] + dz * this.ay[2]
      cam[i * 3 + 2] = dx * this.af[0] + dy * this.af[1] + dz * this.af[2]
    }
    const aw = atlas ? atlas.levels[0].w : 1, ah = atlas ? atlas.levels[0].h : 1
    const alphaTest = g.kind === 'level' ? 0.5 : g.kind === 'decal' ? 0.02 : 0.01
    const blend = g.kind === 'decal' || g.kind === 'marks'
    const enc: RGB = [0, 0, 0]
    const tex = [0, 0, 0, 0]
    const c: RGB = [0, 0, 0]
    let level = 0, col0 = 0, col1 = 0, col2 = 0, shade = 1, cut = false
    // a mark's tile rect, and how its uv moves a pixel across and a pixel down (the shader's dFdx, dFdy)
    const marks = g.kind === 'marks'
    const rect = [0, 0, 0, 0]
    const grad = [0, 0, 0, 0]
    const frag: Frag = (o, depth, a) => {
      if (depth >= this.zbuf[o]) return
      if (!atlas) {
        // never-seen space: black, however lit
        this.zbuf[o] = depth
        this.colour[o * 3] = this.colour[o * 3 + 1] = this.colour[o * 3 + 2] = 0
        return
      }
      if (marks) footprint(atlas, a[0], a[1], grad, rect, tex)
      else sample(atlas, level, a[0], a[1], tex)
      if (tex[3] < alphaTest) return
      c[0] = tex[0] * col0 * shade
      c[1] = tex[1] * col1 * shade
      c[2] = tex[2] * col2 * shade
      const wx = a[2], wy = a[3], wz = a[4]
      this.flashed(c, wx, wz)
      // the lid recedes, and a wall darkens toward it (LID)
      let over = 1
      if (cut) over = 1 + ((lidded ? WALL_TOP : 1) - 1) * smoothstep(1 - WALL_SHADOW, 1, wy)
      else if (wy > 0.999) {
        const dx = wx - this.ex, dy = wy - this.ey, dz = wz - this.ez
        over = LID_LIGHT * lidFade(Math.sqrt(dx * dx + dy * dy + dz * dz))
      }
      enc[0] = encode(c[0] * over)
      enc[1] = encode(c[1] * over)
      enc[2] = encode(c[2] * over)
      if (blend) this.blend(o, enc, tex[3])
      else {
        this.zbuf[o] = depth
        this.blend(o, enc, 1)
      }
    }
    const P = [0, 0, 0].map(() => new Float64Array(8))
    const tris = idx.length / 3
    const order = new Uint32Array(tris)
    for (let t = 0; t < tris; t++) order[t] = t
    if (!blend) {
      const key = new Float64Array(tris)
      for (let t = 0; t < tris; t++) key[t] = Math.min(cam[idx[t * 3] * 3 + 2], cam[idx[t * 3 + 1] * 3 + 2], cam[idx[t * 3 + 2] * 3 + 2])
      order.sort((a, b) => key[a] - key[b])
    }
    for (let n = 0; n < tris; n++) {
      const t = order[n] * 3
      const i0 = idx[t], i1 = idx[t + 1], i2 = idx[t + 2]
      if (cam[i0 * 3 + 2] < NEAR && cam[i1 * 3 + 2] < NEAR && cam[i2 * 3 + 2] < NEAR) continue
      const vs = [i0, i1, i2]
      for (let k = 0; k < 3; k++) {
        const i = vs[k], p = P[k]
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
      shade = this.shadeAt(g.cell[i0 * 2], g.cell[i0 * 2 + 1])
      cut = g.cut[i0] > 0.5
      if (atlas) {
        const uvArea = Math.abs((P[1][3] - P[0][3]) * (P[2][4] - P[0][4]) - (P[2][3] - P[0][3]) * (P[1][4] - P[0][4])) * aw * ah
        level = this.mipFor(P, uvArea)
      }
      if (marks && g.rect) {
        for (let j = 0; j < 4; j++) rect[j] = g.rect[i0 * 4 + j]
        this.uvGradient(P, grad)
      }
      this.poly(P, 5, cut, frag, true)
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

  /** The mip for a polygon whose texels cover `texelArea`: log2 of the texels a pixel, rounded, up to MIP_MAX. */
  private mipFor(P: Float64Array[], texelArea: number): number {
    let area = 0
    const sx: number[] = [], sy: number[] = []
    for (const p of P) {
      const z = Math.max(NEAR, p[2])
      sx.push((p[0] / z) * this.f)
      sy.push((p[1] / z) * this.fy)
    }
    for (let i = 0; i < sx.length; i++) {
      const j = (i + 1) % sx.length
      area += sx[i] * sy[j] - sx[j] * sy[i]
    }
    area = Math.abs(area) / 2
    if (area <= 1e-6) return MIP_MAX
    return Math.max(0, Math.min(MIP_MAX, Math.round(0.5 * Math.log2(texelArea / area))))
  }

  // ------------------------------------------------------------ the sprites

  /**
   * One standing instance, its face toward the eye (SPRITE_VERT, SPRITE_FRAG):
   * `solid` depth-tested and written (the fixtures, the crowd), `blend` tested
   * and blended, `ghost` drawn only where the level and its fixtures hide it,
   * fading with how far behind.
   */
  private sprite(s: SpriteInstance, how: 'solid' | 'blend' | 'ghost') {
    const atlas = this.atlas(s.atlas)
    if (!atlas) return
    const [mode, miscY, k, miscW] = s.misc
    const [ax, ay, az] = s.anchor
    // the eye from the sprite's origin, and the heading it stands at
    const e: RGB = [this.ex - ax, this.ey - ay, this.ez - az]
    let yaw = mode & MODE_BILLBOARD ? this.standYaw : miscW
    if (mode & MODE_FACE_EYE) {
      const toEye = Math.atan2(e[0], e[2])
      let turn = this.standYaw - toEye
      turn -= 2 * Math.PI * Math.floor((turn + Math.PI) / (2 * Math.PI))
      yaw = toEye + miscW * turn
    }
    const [qx, qy, qw, qh] = s.quad
    const x0 = qx - qw, x1 = qx + qw, y0 = qy - qh, y1 = qy + qh
    let z1 = s.z[0], z0 = s.z[0] - s.z[1]
    const c = Math.cos(yaw), sn = Math.sin(yaw)
    if (mode & MODE_RING && c * e[2] + sn * e[0] < 0) {
      const shift = -(z0 + z1)
      z0 += shift
      z1 += shift
    }
    const lie = (mode & MODE_LIE) !== 0
    // the face toward the eye: the front, or a block's back seen from behind it (a closed door from its far side)
    const eLocalZ = lie ? e[1] : c * e[2] + sn * e[0]
    const z = eLocalZ < z0 ? z0 : z1
    const W = s.texel[2], H = s.texel[3]
    // the stretch (a door filling its doorway): the columns either side as they are, those between taking up the rest
    const Wq = (2 * qw) / k
    let bandA = 0, bandB = 0, bandS = 1
    if (Wq - W > 1e-3) {
      const edge = mode & MODE_RING ? Math.min(miscY, Math.floor(W / 2)) : 0
      bandA = edge
      bandB = W - edge
      bandS = (bandB - bandA + Wq - W) / (bandB - bandA)
    }
    const colX = (i: number) => (i <= bandA ? i : i <= bandB ? bandA + (i - bandA) * bandS : i + (bandB - bandA) * (bandS - 1))
    const colAt = (x: number) => {
      const xa = bandA, xb = colX(bandB)
      return Math.floor(x <= xa ? x : x <= xb ? bandA + (x - xa) / bandS : x - (xb - bandB))
    }
    const toWorld = (lx: number, ly: number, lz: number): RGB => {
      // lying, the frame is tipped onto its back: its y along the floor, its z up
      const ux = lx, uy = lie ? lz : ly, uz = lie ? -ly : lz
      return [ax + c * ux + sn * uz, ay + uy, az + c * uz - sn * ux]
    }
    const P = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([lx, ly]) => {
      const w = toWorld(lx, ly, z)
      const p = new Float64Array(8)
      this.toCamera(w, p)
      // texel space: column right, row down from the tile's top-left corner
      p[3] = (lx - x0) / k
      p[4] = (y1 - ly) / k
      p[5] = w[0]
      p[6] = w[1]
      p[7] = w[2]
      return p
    })
    const L0 = atlas.levels[0]
    const [sx, sy] = s.texel
    // far off, the tile averaged down to about a texel a pixel, its edge drawn as far as it covers the pixel
    const fx = ax - this.ex, fy = ay + qy - this.ey, fz = az - this.ez
    const far = Math.max(NEAR, fx * this.af[0] + fy * this.af[1] + fz * this.af[2])
    const texels = Math.max(far / (this.f * k), far / (this.fy * k))
    const L = Math.max(0, Math.min(SPRITE_MIP_MAX, Math.floor(Math.log2(texels))))
    const mip = L ? this.spriteMip(s.atlas, L0, sx, sy, W, H, L) : null
    const body = (cx: number, cy: number) => {
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) return false
      return L0.data[((sy + cy) * L0.w + sx + cx) * 4 + 3] >= OPAQUE_ALPHA
    }
    const grow = mode & MODE_RING ? 0 : miscY
    const ghostVisible = s.pass === 'ghostVisible'
    const fadeStart = ghostVisible ? GHOST_FADE_VISIBLE_START : GHOST_FADE_START
    const fadeRange = ghostVisible ? GHOST_FADE_VISIBLE : GHOST_FADE
    const shade = mode & MODE_SHADE_MAP ? this.shadeAt(s.cell[0], s.cell[1]) : 1
    const lin: RGB = [0, 0, 0]
    const enc: RGB = [0, 0, 0]
    const frag: Frag = (o, depth, a) => {
      if (how !== 'ghost' && depth >= this.zbuf[o]) return
      let alpha = s.color[3]
      if (how === 'ghost') {
        // only what stands clear behind the level shows through it
        const gap = depth - this.sceneDepth[o]
        if (!(gap > GHOST_GAP)) return
        alpha *= 1 - smoothstep(fadeStart, fadeRange, gap)
      }
      const tcx = colAt(a[0]), tcy = Math.floor(a[1])
      if (mip) {
        if (tcx < 0 || tcy < 0 || tcx >= W || tcy >= H) return
        const i = ((tcy >> L) * mip.w + (tcx >> L)) * 4
        const cover = mip.data[i + 3]
        if (cover < 0.02) return
        lin[0] = (mip.data[i] / cover) * s.color[0] * shade
        lin[1] = (mip.data[i + 1] / cover) * s.color[1] * shade
        lin[2] = (mip.data[i + 2] / cover) * s.color[2] * shade
        alpha *= cover
        this.flashed(lin, a[2], a[4])
        enc[0] = encode(lin[0])
        enc[1] = encode(lin[1])
        enc[2] = encode(lin[2])
        if (how === 'solid' && cover >= 0.5) this.zbuf[o] = depth
        this.blend(o, enc, alpha)
        return
      }
      if (body(tcx, tcy)) {
        const i = ((sy + tcy) * L0.w + sx + tcx) * 4
        lin[0] = L0.data[i] * s.color[0] * shade
        lin[1] = L0.data[i + 1] * s.color[1] * shade
        lin[2] = L0.data[i + 2] * s.color[2] * shade
        alpha *= L0.data[i + 3]
        this.flashed(lin, a[2], a[4])
        enc[0] = encode(lin[0])
        enc[1] = encode(lin[1])
        enc[2] = encode(lin[2])
      } else if (grow >= SEL_GROW && (body(tcx + 1, tcy) || body(tcx - 1, tcy) || body(tcx, tcy + 1) || body(tcx, tcy - 1))) {
        // the shell round the sprite the cursor is on; the art's own ink is the hull inside it
        enc[0] = SHELL[0]
        enc[1] = SHELL[1]
        enc[2] = SHELL[2]
      } else return
      if (how === 'solid') this.zbuf[o] = depth
      this.blend(o, enc, alpha)
    }
    this.poly(P, 5, false, frag, how !== 'ghost')
  }

  /**
   * A sprite tile's texels averaged `level` times over, two by two, each
   * level of its own so no average reaches into the next tile in the atlas:
   * colour premultiplied by alpha, and alpha, which is how much of the
   * texel the art covers. Kept per tile.
   */
  private spriteMip(atlas: string, L0: Atlas['levels'][number], sx: number, sy: number, W: number, H: number, level: number): { w: number; data: Float32Array } {
    const key = `${atlas}|${sx},${sy},${W},${H}`
    let levels = this.spriteMips.get(key)
    if (!levels) {
      const base = new Float32Array(W * H * 4)
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const i = ((sy + y) * L0.w + sx + x) * 4, o = (y * W + x) * 4
          const al = L0.data[i + 3]
          base[o] = L0.data[i] * al
          base[o + 1] = L0.data[i + 1] * al
          base[o + 2] = L0.data[i + 2] * al
          base[o + 3] = al
        }
      levels = [{ w: W, h: H, data: base }]
      this.spriteMips.set(key, levels)
    }
    while (levels.length <= level) {
      const s = levels[levels.length - 1]
      const w = Math.ceil(s.w / 2), h = Math.ceil(s.h / 2)
      const d = new Float32Array(w * h * 4)
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          for (let ch = 0; ch < 4; ch++) {
            // past the tile's edge is clear
            let v = 0
            for (let j = 0; j < 2; j++)
              for (let i = 0; i < 2; i++) {
                const xx = 2 * x + i, yy = 2 * y + j
                if (xx < s.w && yy < s.h) v += s.data[(yy * s.w + xx) * 4 + ch]
              }
            d[(y * w + x) * 4 + ch] = v / 4
          }
      levels.push({ w, h, data: d })
    }
    return levels[level]
  }

  /** A shadow: a disc on the floor under what stands, darkening what it lies on. */
  private shadow(s: { x: number; y: number; r: number }) {
    const R = SHADOW_RADIUS * s.r
    const P: Float64Array[] = []
    for (let i = 0; i < 16; i++) {
      const t = (i / 16) * 2 * Math.PI
      const p = new Float64Array(3)
      this.toCamera([s.x + 0.5 + Math.cos(t) * R, 0.003, s.y + 0.5 - Math.sin(t) * R], p)
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
    const atlas = rect ? this.atlas(rect.atlas) : null
    const m = rect && atlas ? 0.5 : RING_REACH
    const P = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => {
      const p = new Float64Array(5)
      this.toCamera([cx + i * m, 0.012, cz + j * m], p)
      p[3] = i * m
      p[4] = j * m
      return p
    })
    if (rect && atlas) {
      const L0 = atlas.levels[0]
      const cell = rect.cell
      const enc: RGB = [0, 0, 0]
      this.poly(P, 2, false, (o, _d, a) => {
        // the tile over the cell where its offsets place it
        const px = Math.floor((a[0] + 0.5) * cell) - rect.ox, py = Math.floor((a[1] + 0.5) * cell) - rect.oy
        if (px < 0 || py < 0 || px >= rect.w || py >= rect.h) return
        const i = ((rect.sy + py) * L0.w + rect.sx + px) * 4
        if (L0.data[i + 3] < 0.01) return
        enc[0] = encode(L0.data[i])
        enc[1] = encode(L0.data[i + 1])
        enc[2] = encode(L0.data[i + 2])
        this.blend(o, enc, L0.data[i + 3])
      })
      return
    }
    const lin = cur.mode === 'map' ? CURSOR_MAP_COLOUR : CURSOR_COLOUR
    const enc: RGB = [encode(lin[0]), encode(lin[1]), encode(lin[2])]
    this.poly(P, 2, false, (o, depth, a) => {
      // the band's coverage of the pixel as the shader works it, the pixel's width on the floor taken from its depth
      const d = Math.abs(a[0]) + Math.abs(a[1])
      const w = Math.max((1.5 * depth) / this.f, 1e-5)
      const cov = Math.max(0, Math.min(1, (Math.min(d + 0.5 * w, RING_OUTER) - Math.max(d - 0.5 * w, RING_INNER)) / w))
      const al = 1 - Math.pow(1 - cov, Math.max(1, w / (RING_OUTER - RING_INNER)))
      if (al >= 0.01) this.blend(o, enc, 0.95 * al)
    })
  }

  // ------------------------------------------------------------ the hands

  /**
   * The hands at rest, flat: each icon's opaque art filling VM_FILL of a
   * VM_SIZE square hanging from its pose's point, in a view two units tall at
   * their depth, the wielded weapon turned about to show its other side; in
   * the level's tint, washed by the flash where the player stands.
   */
  private drawHands(scene: Scene) {
    const vm = this.viewmodel
    if (!this.opts.viewmodel || !vm || (!vm.weapon && !vm.offhand)) return
    const flash = flashOf(getCell(scene, scene.player.x, scene.player.y))
    const fl: RGB = [flash.r, flash.g, flash.b]
    const tint = scene.level.tint
    const unit = this.height / 2
    const unitX = unit * this.pixelAspect
    const aspect = this.width / (this.height * this.pixelAspect)
    const pose = (item: HandItem | null | undefined, rest: HandPose) => {
      const h = item && this.hand(item)
      if (!h) return
      const size = VM_SIZE * unit
      const sizeX = VM_SIZE * unitX
      const px0 = this.width / 2 + rest.x * aspect * unitX - sizeX / 2
      const py1 = this.height / 2 - rest.y * unit
      const py0 = py1 - size
      const mirror = Math.abs(rest.yaw - Math.PI) < 1e-6
      const mid = (h.x0 + h.x1) / 2
      const lin: RGB = [0, 0, 0]
      const enc: RGB = [0, 0, 0]
      for (let y = Math.max(0, Math.floor(py0)); y < Math.min(this.height, Math.ceil(py1)); y++)
        for (let x = Math.max(0, Math.floor(px0)); x < Math.min(this.width, Math.ceil(px0 + sizeX)); x++) {
          let u = (x + 0.5 - px0) / sizeX
          if (mirror) u = 1 - u
          const v = (y + 0.5 - py0) / size
          const tx = Math.floor(mid + (u - 0.5) * h.span)
          const ty = Math.floor(h.y1 - (1 - v) * h.span)
          if (tx < 0 || ty < 0 || tx >= h.cell || ty >= h.cell) continue
          const i = (ty * h.cell + tx) * 4
          if (h.data[i + 3] < OPAQUE_ALPHA) continue
          lin[0] = h.data[i] * tint.r
          lin[1] = h.data[i + 1] * tint.g
          lin[2] = h.data[i + 2] * tint.b
          for (let ch = 0; ch < 3; ch++) lin[ch] += (fl[ch] - lin[ch]) * flash.a
          enc[0] = encode(lin[0])
          enc[1] = encode(lin[1])
          enc[2] = encode(lin[2])
          this.blend(y * this.width + x, enc, h.data[i + 3])
        }
    }
    pose(vm.weapon, VM_WEAPON_REST)
    pose(vm.offhand, vm.offhand?.name?.startsWith('HAND2_') ? VM_SHIELD_REST : VM_OFFWEAPON_REST)
  }

  /** An item's icon layers composed into one cell, linear RGBA, with the box its opaque art fills. */
  private hand(item: HandItem): Hand | null {
    const key = JSON.stringify(item.layers)
    let h = this.hands.get(key)
    if (h !== undefined) return h
    h = null
    let cell = 32
    let data: Float32Array | null = null
    for (const l of item.layers) {
      const r = this.tiles!.tile(l.tile, l.layer)
      const atlas = r && this.atlas(r.atlas)
      if (!r || !atlas) continue
      cell = r.cell
      data ??= new Float32Array(cell * cell * 4)
      const L0 = atlas.levels[0]
      let rows = r.h
      if (l.ymax !== undefined && l.ymax < r.oy + r.h) rows = Math.max(0, l.ymax - r.oy)
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < r.w; x++) {
          const dx = x + r.ox, dy = y + r.oy
          if (dx < 0 || dy < 0 || dx >= cell || dy >= cell) continue
          const s = ((r.sy + y) * L0.w + r.sx + x) * 4
          const a = L0.data[s + 3]
          if (a <= 0) continue
          const d = (dy * cell + dx) * 4
          for (let ch = 0; ch < 3; ch++) data[d + ch] = data[d + ch] * (1 - a) + L0.data[s + ch] * a
          data[d + 3] = a + data[d + 3] * (1 - a)
        }
    }
    if (data) {
      let x0 = cell, y0 = cell, x1 = 0, y1 = 0
      for (let y = 0; y < cell; y++)
        for (let x = 0; x < cell; x++)
          if (data[(y * cell + x) * 4 + 3] >= OPAQUE_ALPHA) {
            x0 = Math.min(x0, x)
            y0 = Math.min(y0, y)
            x1 = Math.max(x1, x + 1)
            y1 = Math.max(y1, y + 1)
          }
      if (x1 > x0) h = { data, cell, x0, x1, y1, span: Math.max(x1 - x0, y1 - y0) / VM_FILL }
    }
    this.hands.set(key, h)
    return h
  }

  // ------------------------------------------------------------ the raster

  private size(width: number, height: number) {
    if (width === this.width && height === this.height) return
    this.width = width
    this.height = height
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
    const Q: Float64Array[] = []
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length]
      const ina = a[2] >= NEAR, inb = b[2] >= NEAR
      if (ina) Q.push(a)
      if (ina !== inb) {
        const t = (NEAR - a[2]) / (b[2] - a[2])
        const q = new Float64Array(n)
        for (let j = 0; j < n; j++) q[j] = a[j] + (b[j] - a[j]) * t
        Q.push(q)
      }
    }
    if (Q.length < 3) return
    const W = this.width, H = this.height, f = this.f, fy = this.fy
    const sx = Q.map((q) => W / 2 + (q[0] / q[2]) * f)
    const sy = Q.map((q) => H / 2 - (q[1] / q[2]) * fy)
    if (cullBack) {
      let area = 0
      for (let i = 0; i < Q.length; i++) {
        const j = (i + 1) % Q.length
        area += sx[i] * sy[j] - sx[j] * sy[i]
      }
      // a front face winds counter-clockwise with y up, which is clockwise with the screen's y down
      if (area >= 0) return
    }
    const attrs = new Float64Array(k)
    for (let t = 1; t + 1 < Q.length; t++) {
      const A = 0, B = t, C = t + 1
      const area = (sx[B] - sx[A]) * (sy[C] - sy[A]) - (sx[C] - sx[A]) * (sy[B] - sy[A])
      if (Math.abs(area) < 1e-9) continue
      const minX = Math.max(0, Math.floor(Math.min(sx[A], sx[B], sx[C]))), maxX = Math.min(W - 1, Math.ceil(Math.max(sx[A], sx[B], sx[C])))
      const minY = Math.max(0, Math.floor(Math.min(sy[A], sy[B], sy[C]))), maxY = Math.min(H - 1, Math.ceil(Math.max(sy[A], sy[B], sy[C])))
      if (minX > maxX || minY > maxY) continue
      const V0 = Q[A], V1 = Q[B], V2 = Q[C]
      const iz0 = 1 / V0[2], iz1 = 1 / V1[2], iz2 = 1 / V2[2]
      // the barycentric weights are linear across the screen: w = ax·x + by·y + c, for the pixel's middle
      const a0 = -(sy[C] - sy[B]) / area, b0 = (sx[C] - sx[B]) / area, c0 = (sx[B] * sy[C] - sx[C] * sy[B]) / area
      const a1 = -(sy[A] - sy[C]) / area, b1 = (sx[A] - sx[C]) / area, c1 = (sx[C] * sy[A] - sx[A] * sy[C]) / area
      const a2 = -a0 - a1, b2 = -b0 - b1, c2 = 1 - c0 - c1
      const zb = this.zbuf
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
          for (let j = 0; j < k; j++) attrs[j] = (p0 * V0[3 + j] + p1 * V1[3 + j] + p2 * V2[3 + j]) * depth
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

  /** An atlas in linear light with its mips, or null where its pixels cannot be had. */
  private atlas(name: string): Atlas | null {
    let a = this.atlases.get(name)
    if (a !== undefined) return a
    a = null
    const px = this.pixels(name)
    if (px) {
      const { width: w, height: h, data: src } = px
      const data = new Float32Array(w * h * 4)
      for (let i = 0; i < w * h; i++) {
        data[i * 4] = DECODE[src[i * 4]]
        data[i * 4 + 1] = DECODE[src[i * 4 + 1]]
        data[i * 4 + 2] = DECODE[src[i * 4 + 2]]
        data[i * 4 + 3] = src[i * 4 + 3] / 255
      }
      const levels = [{ w, h, data }]
      for (let l = 1; l <= MIP_MAX; l++) {
        const s = levels[l - 1]
        const nw = Math.max(1, s.w >> 1), nh = Math.max(1, s.h >> 1)
        const d = new Float32Array(nw * nh * 4)
        const at = (xx: number, yy: number, ch: number) => s.data[(Math.min(s.h - 1, yy) * s.w + Math.min(s.w - 1, xx)) * 4 + ch]
        for (let y = 0; y < nh; y++)
          for (let x = 0; x < nw; x++)
            for (let ch = 0; ch < 4; ch++) d[(y * nw + x) * 4 + ch] = (at(2 * x, 2 * y, ch) + at(2 * x + 1, 2 * y, ch) + at(2 * x, 2 * y + 1, ch) + at(2 * x + 1, 2 * y + 1, ch)) / 4
        levels.push({ w: nw, h: nh, data: d })
      }
      a = { levels }
    }
    this.atlases.set(name, a)
    return a
  }
}

interface Hand {
  data: Float32Array
  cell: number
  x0: number
  x1: number
  y1: number
  /** texels across the square the icon stands in */
  span: number
}

/** The texel of `atlas` at mip `level` under uv (u, v), into `out` as linear RGBA. */
function sample(atlas: Atlas, level: number, u: number, v: number, out: number[]) {
  const L = atlas.levels[level]
  const x = Math.min(L.w - 1, Math.max(0, Math.floor(u * L.w)))
  const y = Math.min(L.h - 1, Math.max(0, Math.floor(v * L.h)))
  const i = (y * L.w + x) * 4
  out[0] = L.data[i]
  out[1] = L.data[i + 1]
  out[2] = L.data[i + 2]
  out[3] = L.data[i + 3]
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
  const L = atlas.levels[0]
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

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** sRGB bytes to linear light */
const DECODE = new Float32Array(256)
for (let i = 0; i < 256; i++) {
  const c = i / 255
  DECODE[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
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

