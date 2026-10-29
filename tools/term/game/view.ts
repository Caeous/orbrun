/**
 * The game screen's map view for a terminal: the MapRenderer GameScreen
 * draws through (its `renderer` hook), answering the 3D view's extra calls
 * as a view with no motion and no picking does. It draws nothing
 * itself: it keeps what it is given (the tiles, the scene, the camera) and
 * says when a frame is wanted, and the terminal draws it with render-term,
 * on threads (`TermRaster`), at the terminal's own pace (`picture`).
 */
import type { Pixels, RenderTermOptions, TermGlyph } from '@orbrun/render-term'
import { cellKey } from '@orbrun/scene'
import type { Billboard, Camera, CellKey, MapRenderer, Scene, SceneCursor, TileSource, Viewmodel } from '@orbrun/scene'
import { isRgbaBitmap } from './env'
import { TermRaster, type Cells, type DrawOptions } from '../raster'

/** a tile's cell, in texels */
const CELL = 32
/** how the 2D map draws what is remembered: dimmer */
const REMEMBERED = 0.55

export class TermView implements MapRenderer {
  scene: Scene | null = null
  camera: Camera | null = null
  cursor: SceneCursor | null = null
  /** a frame is wanted: the game asked for one since the terminal last drew */
  dirty = true
  readonly animating = false
  readonly stats = {}
  mark: ((n: string) => void) | null = null
  cellSize = 32
  private r = new TermRaster()
  private fov = 80
  private eye = 0.6
  private tiles: TileSource | null = null
  private atlases = new Map<string, Pixels | undefined>()

  constructor(private onFrame: () => void) {
    this.r.setOptions({ fov: 80 })
  }

  mount(): void {}
  setTiles(tiles: TileSource): void {
    this.tiles = tiles
    this.atlases.clear()
    this.r.setTiles(tiles, (name) => this.pixels(name))
    this.want()
  }
  setScene(scene: Scene): void {
    this.scene = scene
    this.r.setScene(scene)
  }
  setCamera(cam: Camera): void {
    this.camera = cam
  }
  setCursor(cursor: SceneCursor | null): void {
    this.cursor = cursor
    this.r.setCursor(cursor)
    this.want()
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
  setOptions(opts: RenderTermOptions): void {
    if (opts.fov) this.fov = opts.fov
    if (opts.eyeHeight) this.eye = opts.eyeHeight
    this.r.setOptions(opts)
    this.want()
  }
  setFoot(): void {}
  setUpright(): void {}
  setLensTop(): void {}
  setLensFoot(): void {}
  setViewmodel(vm: Viewmodel | null): void {
    this.r.setViewmodel(vm)
    this.want()
  }
  attack(): void {}
  resetMotion(): void {}
  handsFootprint(): [] {
    return []
  }
  /** How wide the view opens across, radians, on a view `aspect` times as wide as it is tall (for the minimap's cone). */
  fovAcross(aspect: number): number {
    return 2 * Math.atan(Math.tan((this.fov * Math.PI) / 360) * aspect)
  }

  /** the lens, for the HUD's pips at the view's edges: camera space as three.js has it, x right, y up, looking down -z */
  projector() {
    const cam = this.camera
    return {
      tanHalfY: Math.tan((this.fov * Math.PI) / 360),
      aspect: 2,
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

  /** The view as `cols` x `rows` cells, with the monsters and items to be named by their glyphs; null with nothing to show. */
  async picture(cols: number, rows: number, o: DrawOptions): Promise<{ cells: Cells; glyphs: TermGlyph[] } | null> {
    if (!this.camera || !this.scene) return null
    return this.r.draw(this.camera, cols, rows, o)
  }

  /** what GameScreen asks when it goes: the view outlives it, for the next game */
  destroy(): void {}

  /** The threads, let go. */
  close(): void {
    this.r.destroy()
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
    for (let cy = 0; cy < rows; cy++)
      for (let cx = 0; cx < cols; cx++) {
        const x = left + cx, y = top + cy
        const k = cellKey(x, y)
        const c = sc.cells.get(k)
        if (!c || c.kind === 'unknown') continue
        const art = this.cellArt(x, y, standing.get(k) ?? [])
        if (!art) continue
        const dim = c.visibility === 'visible' ? 1 : REMEMBERED
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
            const d = ((cy * tile + ty) * w + cx * tile + tx) * 4
            out[d] = (r / k) * dim
            out[d + 1] = (g / k) * dim
            out[d + 2] = (b / k) * dim
            out[d + 3] = 255
          }
      }
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
    const lay = (id: number | undefined, ox = 0, oy = 0, ymax?: number) => {
      const r = id === undefined ? undefined : this.tiles?.tile(id)
      const px = r && this.pixels(r.atlas)
      if (!r || !px) return
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
    }
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
