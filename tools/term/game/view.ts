/**
 * The game's view for a terminal, told what render-3d is told (the tiles,
 * the scene, the camera, the cursor, the hands, the 3D options), and the
 * same of what moves (a swing, the glides). It draws nothing when told: it
 * keeps what it is given and says when a frame is wanted, and the terminal
 * draws it at its own pace (`cells`) as the
 * glyph view's cells (glyph/render.ts), on threads: the level cast a ray a
 * column through crawl's grid, its walls standing back from the floor as
 * render-3d stands them, its tiles' texels averaged as they recede; what
 * stands (the monsters, the items, the features, the plants, the clouds)
 * each its own sprite drawn finer, or crawl's glyph where it is too far to
 * make out; the cursor's ring, the flash, and the hands over all.
 */
import type { Pixels } from '@orbrun/render-term'
import {
  Movers,
  VM_LIFT,
  VM_OFFWEAPON_REST,
  VM_SHIELD_REST,
  VM_SIZE,
  VM_WEAPON_REST,
  WALL_INSET,
  crowd,
  fixtures,
  framedDoors,
  liftEnvelope,
  monsterId,
  occupiedFeatures,
  type HandPose,
} from '@orbrun/world'
import { cellKey } from '@orbrun/scene'
import type { Camera, CellKey, HandItem, Scene, SceneCursor, TileRect, TileSource, Viewmodel } from '@orbrun/scene'
import { isRgbaBitmap } from './env'
import { GlyphThreads, glyphThreads } from '../glyph/threads'
import { CRAWL, GLYPH_DEFAULTS, type Art, type GlyphViewOptions, type Thing } from '../glyph/render'
import { encoders } from '../glyph/encode'
import { warmGlyphs } from '../glyph/font'

/** a tile's cell, in texels */
const CELL = 32
/** render-3d's bounds on the eye's height (EYE_MIN, EYE_MAX) */
const EYE_MIN = 0.25
const EYE_MAX = 0.9
/** the trapped mark's share of the view's shorter side (hud.ts TRAPPED_FRACTION) */
const TRAPPED_FRACTION = 0.8

/** How the view is drawn: the glyph view's options the client takes (config.ts `view`). */
export interface ViewOptions {
  /** threads that draw it; undefined for the default */
  threads?: number
  mosaic?: GlyphViewOptions['mosaic']
  /** monsters as crawl's letters rather than their sprites */
  letters?: boolean
}

/** The game's 3D options (game.ts `render3dOptions`), as far as a terminal takes them. */
export interface ViewSettings {
  /** the vertical field of view, degrees */
  fov?: number
  eyeHeight?: number
  wallInset?: number
  /** the hands */
  viewmodel?: boolean
  /** things move: glides and the swing */
  motion?: boolean
}

export class TermView {
  scene: Scene | null = null
  camera: Camera | null = null
  cursor: SceneCursor | null = null
  /** a frame is wanted: the game asked for one since the terminal last drew */
  dirty = true
  private glyph: GlyphThreads | null = null
  private fov = 80
  private eye = 0.6
  private wallInset = WALL_INSET
  private handsOn = true
  private viewmodel: Viewmodel | null = null
  /** the view's width over its height, as last drawn */
  private lensAspect = 2
  private tiles: TileSource | null = null
  private atlases = new Map<string, Pixels | undefined>()
  /** how many times what the view is drawn from has changed, besides the camera and the scene's revision */
  private changes = 0
  /** the last cells drawn, and what they were drawn from */
  private last: { key: string; cells: Int32Array } | null = null
  /** the doors in their doorways and the features something stands on (world doors.ts), as worked out for the scene's revision */
  private features: { scene: Scene; revision: number; framed: Map<CellKey, number>; occupied: Set<CellKey> } | null = null
  /** crawl's glyphs set in the font for the big letters, and those on their way */
  private warmed = new Set<string>()
  // what moves, as render-3d keeps it: the monsters' glides, and the swing
  private motionOn = true
  private movers = new Movers()
  private motionRevision = -1
  /** when the swing began, seconds; NaN at rest */
  private liftAt = NaN

  /** `opts`: the threads, and the glyph view's options the client takes */
  constructor(
    private onFrame: () => void,
    private opts: ViewOptions = {},
  ) {}

  setTiles(tiles: TileSource): void {
    this.tiles = tiles
    this.atlases.clear()
    // the glyph view's threads keep the tiles they were asked for: new ones for new tiles
    this.glyph?.destroy()
    const t = this.opts.threads
    this.glyph = new GlyphThreads(tiles, (name) => this.pixels(name), { ...GLYPH_DEFAULTS, mosaic: this.opts.mosaic ?? GLYPH_DEFAULTS.mosaic, letters: !!this.opts.letters, grid: true }, t === undefined ? glyphThreads() : Math.min(t, glyphThreads()))
    if (this.scene) this.glyph.setScene(this.scene)
    this.changed()
  }
  setScene(scene: Scene): void {
    this.scene = scene
    this.glyph?.setScene(scene)
    this.track()
  }
  setCamera(cam: Camera): void {
    this.camera = cam
  }
  setCursor(cursor: SceneCursor | null): void {
    this.cursor = cursor
    this.changed()
  }
  /** the game's 3D options (game.ts `render3dOptions`), as far as a terminal takes them */
  setOptions(opts: ViewSettings): void {
    if (opts.fov) this.fov = opts.fov
    if (opts.eyeHeight) this.eye = opts.eyeHeight
    if (opts.wallInset !== undefined) this.wallInset = opts.wallInset
    if (opts.viewmodel !== undefined) this.handsOn = opts.viewmodel
    if (opts.motion === false && this.motionOn) {
      this.resetMotion()
      this.liftAt = NaN
    }
    if (opts.motion !== undefined) this.motionOn = opts.motion
    this.changed()
  }
  setViewmodel(vm: Viewmodel | null): void {
    this.viewmodel = vm
    this.changed()
  }
  /** A melee swing: the weapon lifts a touch, and frames follow until it settles. */
  attack(): void {
    if (this.motionOn) this.liftAt = performance.now() / 1000
    this.changed()
  }
  /** Every monster forgotten, so none glides from where a level or the map left it. */
  resetMotion(): void {
    this.movers.clear()
    this.motionRevision = -1
    this.changes++
  }
  /** Whether something still moves (a monster's glide, the swing), so frames keep coming. */
  get animating(): boolean {
    return !Number.isNaN(this.liftAt) || this.movers.active
  }
  /**
   * The view as `cols` x `rows` terminal cells, packed (glyph/encode.ts
   * `pack`: a cell's code point, foreground and background), each cell
   * `aspect` times as tall as it is wide; null with nothing to show. The
   * cells are the view's until it draws again.
   */
  async cells(cols: number, rows: number, aspect: number): Promise<Int32Array | null> {
    const cam = this.camera, sc = this.scene, g = this.glyph
    if (!cam || !sc || !g || cols <= 0 || rows <= 0) return null
    // the last cells again, where nothing they are drawn from has changed since and nothing moves: the terminal asks
    // for frames for the HUD's sake as often as the view's
    const key = `${this.changes}|${cam.eyeX},${cam.eyeY},${cam.yaw},${cam.pitch}|${sc.revision},${sc.layoutRevision}|${cols}x${rows}|${aspect}|${this.warmed.size}`
    if (this.last?.key === key && !this.animating) return this.last.cells
    // the game's lens, its field of view the height's as render-3d's is: across, as wide as the cells make the view
    this.lensAspect = cols / (rows * aspect)
    const o = g.opts
    o.aspect = aspect
    o.fov = (2 * Math.atan(Math.tan((this.fov * Math.PI) / 360) * this.lensAspect) * 180) / Math.PI
    o.eye = Math.max(EYE_MIN, Math.min(EYE_MAX, this.eye))
    o.wallInset = this.wallInset
    o.cursor = this.cursor ? { x: this.cursor.x, y: this.cursor.y, mode: this.cursor.mode, tile: this.cursor.tile } : null
    g.things = this.things(sc, performance.now() / 1000)
    const cells = await g.cellsOnly(cam, cols, rows)
    this.last = { key, cells }
    return cells
  }

  /** the scene's monsters read against the last revision's, for their glides */
  private track(now = performance.now() / 1000) {
    const sc = this.scene
    if (!sc || !this.motionOn || sc.revision === this.motionRevision) return
    this.movers.track(sc.billboards, now)
    this.motionRevision = sc.revision
  }

  /** The art of a tile `id` (of `layer`'s texture), moved by (ox, oy) in its cell, cut off at row `ymax`, or turned about. */
  private artOf(id: number, ox = 0, oy: number | ((r: TileRect) => number) = 0, ymax?: number, layer?: string, mirror = false): Art | null {
    const r = this.tiles?.tile(id, layer)
    const px = r && this.pixels(r.atlas)
    if (!r || !px) return null
    const y = typeof oy === 'number' ? r.oy + oy : oy(r)
    const h = ymax === undefined ? r.h : Math.max(0, Math.min(r.h, ymax - y))
    return h > 0 ? { px, rect: { ...r, ox: r.ox + ox, oy: y, h }, mirror } : null
  }

  /**
   * What stands in the scene as the glyph view draws it, at `now`: the
   * features that stand in their cells (statues, altars, fountains); each
   * monster, item, missile and cloud, its layers and badges as render-3d
   * stacks them, where it is this frame (its glide off its cell), washed with
   * its cell's flash, a cloud or what is translucent showing what is behind
   * it, with crawl's glyph and colour for it from far off; what lies (a
   * corpse) the glyph view lays on its floor. Then the hands, posed as
   * render-3d poses them, the weapon lifting for a swing, and the net or the
   * web round a trapped player.
   */
  private things(sc: Scene, now: number): Thing[] {
    const out: Thing[] = []
    const cold: string[] = []
    const flashOf = (x: number, y: number): Thing['flash'] => {
      const f = sc.cells.get(cellKey(x, y))?.flash
      return f && f.a > 0 ? [f.r / 255, f.g / 255, f.b / 255, Math.min(1, f.a / 255)] : undefined
    }
    // what stands (world things.ts): the features upright in their cells, as sprites (a door in its doorway is the
    // level's, glyph/render.ts `doors`, and what lies the floor's), then the monsters, items, missiles and clouds
    if (this.features?.scene !== sc || this.features.revision !== sc.revision) {
      const framed = framedDoors(sc)
      this.features = { scene: sc, revision: sc.revision, framed, occupied: occupiedFeatures(sc, framed) }
    }
    const { framed, occupied } = this.features
    for (const f of fixtures(sc, framed, occupied)) {
      if (f.stance !== 'upright') continue
      const art = this.artOf(f.layers[0].tile)
      if (!art) continue
      out.push({ x: f.x, y: f.y, art: [art], glyph: f.glyph ?? '', colour: CRAWL[(f.colour ?? 7) & 15], size: f.height, flash: flashOf(f.x, f.y) })
    }
    // what moves this frame
    this.track(now)
    const glides = new Map<number, { x: number; y: number }>()
    if (this.motionOn)
      for (const b of sc.billboards) {
        const id = b.kind === 'monster' ? monsterId(b) : undefined
        const o = id === undefined ? null : this.movers.offset(id, now)
        if (o) glides.set(id!, o)
      }
    this.movers.landed(now)
    for (const t of crowd(sc)) {
      // what lies the glyph view lays on its floor
      if (t.lie) continue
      const art = t.layers.filter((l) => !l.badge).map((l) => this.artOf(l.tile, l.ox, l.oy, l.ymax)).filter((a): a is Art => !!a)
      if (!art.length) continue
      // the badges over it, the damage bar pinned over its head
      for (const l of t.layers) {
        if (!l.badge) continue
        const a = this.artOf(l.tile, l.ox, l.top ? () => 0 : l.oy)
        if (a) art.push(a)
      }
      const alive = t.kind === 'monster' && !t.scenery
      const o = t.moverId === undefined ? undefined : glides.get(t.moverId)
      const glyph = t.glyph ?? ''
      if (glyph && alive && !this.warmed.has(glyph)) cold.push(glyph)
      out.push({
        x: t.x + (o?.x ?? 0),
        y: t.y + (o?.y ?? 0),
        art,
        glyph,
        colour: CRAWL[(t.colour ?? 7) & 15],
        size: t.height,
        name: t.name,
        alive,
        alpha: t.alpha,
        lift: t.lift,
        flash: flashOf(t.x, t.y),
      })
    }
    out.push(...this.hands(sc, now))
    // the letters a monster too far for its sprite may be drawn large in, set in the font once each, off this frame
    if (cold.length) {
      for (const g of cold) this.warmed.add(g)
      void warmGlyphs(cold).then(() => this.changed())
    }
    return out
  }

  /**
   * The hands (world hands.ts) and the trapped mark, in the hands' own
   * lens: each hand a VM_SIZE square hanging from its pose's point, the
   * wielded weapon turned about and lifting VM_LIFT for a swing, a shield as
   * drawn; the net or the web round a trapped player (its `full` badges)
   * blown up in the middle, TRAPPED_FRACTION of the view's shorter side
   * (hud.ts `renderTrapped`).
   */
  private hands(sc: Scene, now: number): Thing[] {
    const out: Thing[] = []
    const me = sc.cells.get(cellKey(sc.player.x, sc.player.y))?.flash
    const flash: Thing['flash'] = me && me.a > 0 ? [me.r / 255, me.g / 255, me.b / 255, Math.min(1, me.a / 255)] : undefined
    const hold = (item: HandItem | null, pose: HandPose, mirror: boolean, lift = 0) => {
      const art = (item?.layers ?? []).map((l) => this.artOf(l.tile, 0, 0, l.ymax, l.layer, mirror)).filter((a): a is Art => !!a)
      if (art.length) out.push({ x: 0, y: 0, art, glyph: '', colour: CRAWL[7], size: 1, flash, hand: { x: pose.x, y: pose.y + lift, size: VM_SIZE, fit: true } })
    }
    const vm = this.viewmodel
    if (this.handsOn && vm && sc.playerOnLevel) {
      let lift = 0
      if (!Number.isNaN(this.liftAt)) {
        const e = liftEnvelope(now - this.liftAt)
        if (Number.isNaN(e)) this.liftAt = NaN
        else lift = e * VM_LIFT
      }
      hold(vm.weapon, VM_WEAPON_REST, true, lift)
      hold(vm.offhand, vm.offhand?.name?.startsWith('HAND2_') ? VM_SHIELD_REST : VM_OFFWEAPON_REST, false)
    }
    const player = sc.playerOnLevel ? sc.billboards.find((b) => b.kind === 'player' && b.x === sc.player.x && b.y === sc.player.y) : undefined
    const marks = (player?.statusIcons ?? []).filter((i) => i.full).map((i) => this.artOf(i.tile)).filter((a): a is Art => !!a)
    if (marks.length) {
      const size = TRAPPED_FRACTION * 2 * Math.min(1, this.lensAspect)
      out.push({ x: 0, y: 0, art: marks, glyph: '', colour: CRAWL[7], size: 1, hand: { x: 0, y: -size / 2, size } })
    }
    return out
  }

  /** The threads, let go. */
  close(): void {
    this.glyph?.destroy()
  }

  /**
   * Tiles one over another, each blown up to fill the square but a tenth of
   * it each side (render-2d `drawTileFit`: a status badge, the net round a
   * trapped player), fitted to `cols` x `rows` cells of the view's mosaic; what
   * they leave clear, `under` (0xRRGGBB). Null where none is known.
   */
  tileCells(ids: number[], cols: number, rows: number, under = 0, pad = 0.1): Int32Array | null {
    return this.cached(`tiles|${ids.join(',')}|${cols}x${rows}|${under}|${pad}`, () => {
      const art = new Uint8Array(CELL * CELL * 4)
      for (let i = 0; i < CELL * CELL; i++) art.set([under >> 16, (under >> 8) & 255, under & 255, 255], i * 4)
      let any = false
      for (const id of ids) {
        const r = this.tiles?.tile(id)
        const px = r && this.pixels(r.atlas)
        if (!r || !px || !r.w || !r.h) continue
        any = true
        // the tile's own texels, as large as fit inside the padding, in the middle
        const side = CELL * (1 - 2 * pad), k = side / Math.max(r.w, r.h)
        const x0 = (CELL - r.w * k) / 2, y0 = (CELL - r.h * k) / 2
        for (let y = 0; y < CELL; y++)
          for (let x = 0; x < CELL; x++) {
            const tx = Math.floor((x + 0.5 - x0) / k), ty = Math.floor((y + 0.5 - y0) / k)
            if (tx < 0 || ty < 0 || tx >= r.w || ty >= r.h) continue
            const sI = ((r.sy + ty) * px.width + r.sx + tx) * 4
            const a = px.data[sI + 3] / 255
            const d = (y * CELL + x) * 4
            for (let ch = 0; ch < 3; ch++) art[d + ch] = art[d + ch] * (1 - a) + px.data[sI + ch] * a
          }
      }
      return any ? this.artCells(art, cols, rows) : null
    })
  }

  /**
   * An image (`w` x `h`, RGBA) as `cols` x `rows` cells of the view's mosaic, as a badge is, laid over `under`
   * (0xRRGGBB) where it is clear: the front screen's logo. `key` names the image, for the cells kept of it.
   */
  imageCells(key: string, rgba: Uint8Array, w: number, h: number, cols: number, rows: number, under = 0): Int32Array {
    return this.cached(`image|${key}|${cols}x${rows}|${under}`, () => {
      const art = new Uint8Array(w * h * 4)
      const ground = [under >> 16, (under >> 8) & 255, under & 255]
      for (let i = 0; i < w * h; i++) {
        const a = rgba[i * 4 + 3] / 255
        for (let ch = 0; ch < 3; ch++) art[i * 4 + ch] = ground[ch] * (1 - a) + rgba[i * 4 + ch] * a
        art[i * 4 + 3] = 255
      }
      return this.artCells(art, cols, rows, w, h)
    })!
  }

  /** what the cells made of art were, by what they were made from: a few at a time */
  private made = new Map<string, Int32Array | null>()
  private cached(key: string, make: () => Int32Array | null): Int32Array | null {
    if (this.made.has(key)) return this.made.get(key)!
    const cells = make()
    if (this.made.size > 64) this.made.clear()
    this.made.set(key, cells)
    return cells
  }

  /** art (`aw` x `ah` pixels, a cell's CELL square unless said, RGBA) as `cols` x `rows` cells of the view's mosaic, each in the two colours that show it best */
  private artCells(art: Uint8Array, cols: number, rows: number, aw = CELL, ah = CELL): Int32Array {
    const enc = encoders.fit(this.opts.mosaic ?? GLYPH_DEFAULTS.mosaic, { ...GLYPH_DEFAULTS.fit, hybrid: false })
    const { SX, SY } = enc
    const W = cols * SX, H = rows * SY
    const pix = new Float32Array(W * H * 3)
    // each pixel the mean of the texels under it, in linear light
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const tx0 = Math.floor((x * aw) / W), tx1 = Math.max(tx0 + 1, Math.floor(((x + 1) * aw) / W))
        const ty0 = Math.floor((y * ah) / H), ty1 = Math.max(ty0 + 1, Math.floor(((y + 1) * ah) / H))
        let r = 0, g = 0, b = 0, n = 0
        for (let ty = ty0; ty < ty1; ty++)
          for (let tx = tx0; tx < tx1; tx++) {
            const s = (ty * aw + tx) * 4
            r += LINEAR[art[s]]
            g += LINEAR[art[s + 1]]
            b += LINEAR[art[s + 2]]
            n++
          }
        const o = (y * W + x) * 3
        pix[o] = r / n
        pix[o + 1] = g / n
        pix[o + 2] = b / n
      }
    const cells = new Int32Array(cols * rows * 3)
    enc.encodeInto({ W, H, SX, SY, pix, weight: new Float32Array(W * H).fill(1), thing: new Float32Array(W * H).fill(1), zbuf: new Float32Array(W), glyphs: [] }, cols, rows, cells)
    return cells
  }

  private pixels(name: string): Pixels | undefined {
    if (!this.atlases.has(name)) {
      const img = this.tiles?.atlas(name)
      this.atlases.set(name, isRgbaBitmap(img) ? { width: img.width, height: img.height, data: img.rgba } : undefined)
    }
    return this.atlases.get(name)
  }

  private want() {
    this.dirty = true
    this.onFrame()
  }

  /** what the view is drawn from has changed (`picture`), and a frame is wanted */
  private changed() {
    this.changes++
    this.want()
  }
}

/** sRGB bytes in linear light */
const LINEAR = Float32Array.from({ length: 256 }, (_, i) => {
  const v = i / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
})

