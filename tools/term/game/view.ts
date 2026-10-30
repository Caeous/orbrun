/**
 * The game screen's map view for a terminal: the MapRenderer GameScreen
 * draws through (its `renderer` hook), answering the 3D view's extra calls
 * as render-3d does, but for picking. It draws nothing when asked: it keeps
 * what it is given (the tiles, the scene, the camera) and says when a frame
 * is wanted, and the terminal draws it at its own pace (`cells`) as the
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
import type { Billboard, Camera, CellKey, HandItem, MapRenderer, Scene, SceneCursor, TileRect, TileSource, Viewmodel } from '@orbrun/scene'
import { isRgbaBitmap } from './env'
import { GlyphThreads, glyphThreads } from '../glyph/threads'
import { CRAWL, GLYPH_DEFAULTS, type Art, type GlyphViewOptions, type Thing } from '../glyph/render'
import { encoders } from '../glyph/encode'
import { warmGlyphs } from '../glyph/font'

/** a tile's cell, in texels */
const CELL = 32
/** how the 2D map draws what is remembered: dimmer */
const REMEMBERED = 0.55
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

export class TermView implements MapRenderer {
  scene: Scene | null = null
  camera: Camera | null = null
  cursor: SceneCursor | null = null
  /** a frame is wanted: the game asked for one since the terminal last drew */
  dirty = true
  readonly stats = {}
  mark: ((n: string) => void) | null = null
  cellSize = 32
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
  /** each cell's minimap tile, `tile` pixels square, and what was drawn on it then (`minimap`) */
  private tileBlocks: { tile: number; tiles: TileSource | null; blocks: Map<CellKey, { what: string; px: Uint8Array | null }> } = { tile: 0, tiles: null, blocks: new Map() }
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

  mount(): void {}
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
  render(): void {
    this.want()
  }
  pick(): CellKey | null {
    return null
  }
  resize(): void {}

  // what GameScreen asks of a 3D view
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
  setFoot(): void {}
  setUpright(): void {}
  setLensTop(): void {}
  setLensFoot(): void {}
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
  /** Whether something still moves (a monster's glide, the swing), so GameScreen keeps asking for frames. */
  get animating(): boolean {
    return !Number.isNaN(this.liftAt) || this.movers.active
  }
  handsFootprint(): [] {
    return []
  }
  /** How wide the view opens across, radians, on a view `aspect` times as wide as it is tall (for the minimap's cone). */
  fovAcross(aspect: number): number {
    return 2 * Math.atan(Math.tan((this.fov * Math.PI) / 360) * aspect)
  }

  /** the lens, for the HUD: camera space as three.js has it, x right, y up, looking down -z */
  projector() {
    const cam = this.camera
    return {
      tanHalfY: Math.tan((this.fov * Math.PI) / 360),
      aspect: this.lensAspect,
      shiftY: 0,
      height: 1,
      toCamera: (x: number, y: number, h: number) => {
        if (!cam) return { x: 0, y: 0, z: 0 }
        const dx = x + 0.5 - (cam.eyeX + 0.5)
        const dy = y + 0.5 - (cam.eyeY + 0.5)
        const fx = Math.sin(cam.yaw)
        const fy = -Math.cos(cam.yaw)
        return { x: dx * -fy + dy * fx, y: h - this.eye, z: -(dx * fx + dy * fy) }
      },
    }
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

  /** what GameScreen asks when it goes: the view outlives it, for the next game */
  destroy(): void {}

  /** The threads, let go. */
  close(): void {
    this.glyph?.destroy()
  }

  /**
   * The portrait (hud.ts `renderPortrait`): the player's own cell as the cell
   * renderer paints it (`cellArt`), `side` pixels square, RGBA, each texel
   * blown up whole. Null off the level.
   */
  portrait(side: number): Uint8Array | null {
    const sc = this.scene
    if (!sc || !sc.playerOnLevel) return null
    const art = this.cellArt(sc.player.x, sc.player.y, sc.billboards.filter((b) => b.x === sc.player.x && b.y === sc.player.y))
    if (!art) return null
    const out = new Uint8Array(side * side * 4)
    for (let y = 0; y < side; y++)
      for (let x = 0; x < side; x++) {
        const s = (Math.floor((y * CELL) / side) * CELL + Math.floor((x * CELL) / side)) * 4
        const d = (y * side + x) * 4
        out[d] = art[s]
        out[d + 1] = art[s + 1]
        out[d + 2] = art[s + 2]
        out[d + 3] = 255
      }
    return out
  }

  /**
   * The portrait as `cols` x `rows` terminal cells, packed as `cells` are:
   * the player's own cell (`portrait`) fitted to the glyphs of the view's
   * mosaic, each cell in the two colours that show it best. Null off the
   * level.
   */
  portraitCells(cols: number, rows: number): Int32Array | null {
    const key = `portrait|${this.scene?.revision}|${cols}x${rows}`
    return this.cached(key, () => {
      const art = this.portrait(CELL)
      return art && this.artCells(art, cols, rows)
    })
  }

  /**
   * Tiles one over another, each blown up to fill the square but a tenth of
   * it each side (render-2d `drawTileFit`: a status badge, the net round a
   * trapped player), fitted to `cols` x `rows` cells as the portrait is; what
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
   * An inventory item's tile as the action panel draws it (hud.ts
   * `renderActionPanel`): its layers where they are in the cell, plain ids in
   * crawl's main texture and the rest in their own, over `under`, fitted to
   * `cols` x `rows` cells.
   */
  itemCells(tile: number | (number | { t: number; tex: number; ymax?: number })[], cols: number, rows: number, under = 0): Int32Array | null {
    const layers = Array.isArray(tile) ? tile : [tile]
    return this.cached(`item|${JSON.stringify(layers)}|${cols}x${rows}|${under}`, () => {
      const art = new Uint8Array(CELL * CELL * 4)
      for (let i = 0; i < CELL * CELL; i++) art.set([under >> 16, (under >> 8) & 255, under & 255, 255], i * 4)
      let any = false
      for (const t of layers) any = (typeof t === 'number' ? this.lay(art, t, 0, 0, undefined, 'main') : this.lay(art, t.t, 0, 0, t.ymax, String(t.tex))) || any
      return any ? this.artCells(art, cols, rows) : null
    })
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

  /** a cell's art (CELL pixels square, RGBA) as `cols` x `rows` cells of the view's mosaic, each in the two colours that show it best */
  private artCells(art: Uint8Array, cols: number, rows: number): Int32Array {
    const enc = encoders.fit(this.opts.mosaic ?? GLYPH_DEFAULTS.mosaic, { ...GLYPH_DEFAULTS.fit, hybrid: false })
    const { SX, SY } = enc
    const W = cols * SX, H = rows * SY
    const pix = new Float32Array(W * H * 3)
    // each pixel the mean of the texels under it, in linear light
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const tx0 = Math.floor((x * CELL) / W), tx1 = Math.max(tx0 + 1, Math.floor(((x + 1) * CELL) / W))
        const ty0 = Math.floor((y * CELL) / H), ty1 = Math.max(ty0 + 1, Math.floor(((y + 1) * CELL) / H))
        let r = 0, g = 0, b = 0, n = 0
        for (let ty = ty0; ty < ty1; ty++)
          for (let tx = tx0; tx < tx1; tx++) {
            const s = (ty * CELL + tx) * 4
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

  /**
   * The minimap in the level's own tiles: `cols` x `rows` cells from (left,
   * top), each cell's art (`cellArt`) averaged down to `tile` pixels square,
   * what is remembered dimmed as the 2D map dims it, what is not known left
   * clear. RGBA, `cols * tile` x `rows * tile`.
   */
  minimap(left: number, top: number, cols: number, rows: number, tile: number): Uint8Array {
    const sc = this.scene
    const w = cols * tile
    const out = new Uint8Array(w * rows * tile * 4)
    if (!sc) return out
    const standing = new Map<CellKey, Billboard[]>()
    for (const b of sc.billboards) {
      const k = cellKey(b.x, b.y)
      const list = standing.get(k)
      if (list) list.push(b)
      else standing.set(k, [b])
    }
    // the texels under each of a tile's pixels: a whole number of them or not
    const span = Array.from({ length: tile }, (_, t) => [Math.floor((t * CELL) / tile), Math.max(Math.floor((t * CELL) / tile) + 1, Math.floor(((t + 1) * CELL) / tile))])
    if (this.tileBlocks.tile !== tile || this.tileBlocks.tiles !== this.tiles) this.tileBlocks = { tile, tiles: this.tiles, blocks: new Map() }
    const blocks = this.tileBlocks.blocks
    const seen = new Set<CellKey>()
    for (let cy = 0; cy < rows; cy++)
      for (let cx = 0; cx < cols; cx++) {
        const x = left + cx, y = top + cy
        const k = cellKey(x, y)
        const c = sc.cells.get(k)
        if (!c || c.kind === 'unknown') continue
        const here = standing.get(k) ?? []
        const dim = c.visibility === 'visible' ? 1 : REMEMBERED
        // the cell's tile, worked out again only when what is drawn on it is not what it was: a step changes few cells
        const what = `${dim}|${cellLayers(c)}|${here.map(standingLayers).join(';')}`
        seen.add(k)
        let block = blocks.get(k)
        if (block?.what !== what) {
          const art = this.cellArt(x, y, here)
          block = { what, px: art && new Uint8Array(tile * tile * 4) }
          if (art && block.px)
            for (let ty = 0; ty < tile; ty++)
              for (let tx = 0; tx < tile; tx++) {
                let r = 0, g = 0, b = 0, k = 0
                for (let sy = span[ty][0]; sy < span[ty][1]; sy++)
                  for (let sx = span[tx][0]; sx < span[tx][1]; sx++) {
                    const s = (sy * CELL + sx) * 4
                    r += art[s]
                    g += art[s + 1]
                    b += art[s + 2]
                    k++
                  }
                const d = (ty * tile + tx) * 4
                block.px[d] = (r / k) * dim
                block.px[d + 1] = (g / k) * dim
                block.px[d + 2] = (b / k) * dim
                block.px[d + 3] = 255
              }
          blocks.set(k, block)
        }
        if (!block.px) continue
        for (let ty = 0; ty < tile; ty++) out.set(block.px.subarray(ty * tile * 4, (ty + 1) * tile * 4), ((cy * tile + ty) * w + cx * tile) * 4)
      }
    // the tiles of cells gone out of the map's reach let go, once there are many
    if (blocks.size > 4 * seen.size + 256) for (const k of blocks.keys()) if (!seen.has(k)) blocks.delete(k)
    return out
  }

  /**
   * One cell as the cell renderer paints it, CELL pixels square, RGBA: the
   * floor and what lies on it, then whatever stands there (`here`), the
   * player's doll last with its badges over it. Null where there is no cell.
   */
  private cellArt(x: number, y: number, here: Billboard[]): Uint8Array | null {
    const c = this.scene?.cells.get(cellKey(x, y))
    if (!c && !here.length) return null
    const art = new Uint8Array(CELL * CELL * 4)
    const lay = (id: number | undefined, ox = 0, oy = 0, ymax?: number) => this.lay(art, id, ox, oy, ymax)
    if (c) {
      lay(c.wallTile ?? c.floorTile)
      for (const id of c.underlays ?? []) lay(id)
      lay(c.featureTile)
      for (const id of c.overlays ?? []) lay(id)
    }
    const standing = here.filter((b) => b.kind !== 'cloud').sort((p, q) => (p.kind === 'player' ? 1 : 0) - (q.kind === 'player' ? 1 : 0))
    for (const b of standing) {
      if (b.layers?.length) for (const l of b.layers) lay(l.tile, l.ox ?? 0, l.oy ?? 0, l.ymax)
      else lay(b.tile)
      for (const i of b.statusIcons ?? []) lay(i.tile, i.ox, i.at === 'top' ? 0 : i.oy)
    }
    return art
  }

  /** the tile `id` laid over `art` (CELL pixels square, RGBA) where it is in its cell, moved by (ox, oy), cut off at row `ymax`; whether there was one */
  private lay(art: Uint8Array, id: number | undefined, ox = 0, oy = 0, ymax?: number, layer?: string): boolean {
    const r = id === undefined ? undefined : this.tiles?.tile(id, layer)
    const px = r && this.pixels(r.atlas)
    if (!r || !px) return false
    let rows = r.h
    if (ymax !== undefined && ymax < r.oy + r.h) rows = Math.max(0, ymax - r.oy)
    for (let ty = 0; ty < rows; ty++)
      for (let tx = 0; tx < r.w; tx++) {
        const dx = tx + r.ox + ox, dy = ty + r.oy + oy
        if (dx < 0 || dy < 0 || dx >= CELL || dy >= CELL) continue
        const s = ((r.sy + ty) * px.width + r.sx + tx) * 4
        const a = px.data[s + 3] / 255
        if (a <= 0) continue
        const d = (dy * CELL + dx) * 4
        for (let ch = 0; ch < 3; ch++) art[d + ch] = art[d + ch] * (1 - a) + px.data[s + ch] * a
        art[d + 3] = 255
      }
    return true
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

/** What `cellArt` paints of a cell, in a word: the same word, the same art. */
function cellLayers(c: { wallTile?: number; floorTile?: number; underlays?: readonly number[]; featureTile?: number; overlays?: readonly number[] }): string {
  return `${c.wallTile ?? c.floorTile},${c.underlays?.join(' ') ?? ''},${c.featureTile},${c.overlays?.join(' ') ?? ''}`
}

/** What `cellArt` paints of a billboard standing on a cell, in a word. */
function standingLayers(b: Billboard): string {
  const layers = b.layers?.length ? b.layers.map((l) => `${l.tile}:${l.ox ?? 0}:${l.oy ?? 0}:${l.ymax}`).join(' ') : `${b.tile}`
  return `${b.kind},${layers},${(b.statusIcons ?? []).map((i) => `${i.tile}:${i.ox}:${i.at === 'top' ? 0 : i.oy}`).join(' ')}`
}

/** How far the facing cone reaches, in cells (render-2d FACING_REACH). */
const FACING_REACH = 3.5

/**
 * The facing cone (render-2d `drawFacing`) on a clear image `w` x `h`, RGBA:
 * a wedge of warm light as wide as the view (`fov`) toward `yaw` (north 0,
 * clockwise) from (`cx`, `cy`), fading out over FACING_REACH cells of `cell`
 * pixels, for a north-up minimap to say which way the view faces.
 */
export function facingCone(w: number, h: number, cx: number, cy: number, cell: number, yaw: number, fov: number): Uint8Array {
  const out = new Uint8Array(w * h * 4)
  const r0 = cell * 0.3, r1 = cell * FACING_REACH
  for (let y = Math.max(0, Math.floor(cy - r1)); y < Math.min(h, Math.ceil(cy + r1)); y++)
    for (let x = Math.max(0, Math.floor(cx - r1)); x < Math.min(w, Math.ceil(cx + r1)); x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy
      const d = Math.hypot(dx, dy)
      if (d > r1) continue
      // the heading of the pixel from the cell's middle, north 0 and clockwise, as yaw is
      let off = Math.atan2(dx, -dy) - yaw
      off -= 2 * Math.PI * Math.round(off / (2 * Math.PI))
      if (Math.abs(off) > fov / 2 && d > 0.5) continue
      // the canvas's radial gradient: 0.25 at r0 and inside it, nothing at r1
      const a = 0.25 * (1 - Math.max(0, Math.min(1, (d - r0) / (r1 - r0))))
      const o = (y * w + x) * 4
      out[o] = 255
      out[o + 1] = 240
      out[o + 2] = 200
      out[o + 3] = Math.round(a * 255)
    }
  return out
}
