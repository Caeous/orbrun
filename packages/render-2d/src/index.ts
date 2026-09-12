import {
  cellKey,
  minibarRects,
  MINIBAR_CELL,
  type Minibars,
  type Camera,
  type CellKey,
  type MapRenderer,
  type Scene,
  type SceneCursor,
  type TileSource,
  type SceneCell,
} from '@orbrun/scene'

/**
 * @orbrun/render-2d
 *
 * Top-down tile grid on Canvas 2D. Draws the camera's field of view as a
 * translucent wedge from the player. Also serves as the minimap and level map
 * surface.
 */

export interface Render2dOptions {
  /** Cell size in CSS pixels. */
  cellSize?: number
  /**
   * 'tiles' draws atlas tiles; 'glyphs' draws the cell glyphs in the terminal
   * palette (WebTiles' tile_display_mode = glyphs); 'hybrid' draws tile
   * terrain with glyph foregrounds; 'minimap' draws solid colour blocks.
   */
  mode?: 'tiles' | 'glyphs' | 'hybrid' | 'minimap'
  /** Follow the player (true) or show the whole level (false). */
  follow?: boolean
  /**
   * The grid cell the view is centred on, overriding `follow`: the server's
   * view centre (`vgrdc`), which dungeon_renderer.js `set_view_center` keeps
   * the WebTiles view on. It is the player in normal play and the map cursor
   * while the level map is open, so the map scrolls as the cursor walks.
   */
  center?: { x: number; y: number } | null
  /** Palette for minimap mode. */
  minimapColours?: Partial<
    Record<
      | 'unknown' | 'floor' | 'wall' | 'door' | 'feature' | 'remembered' | 'item' | 'monster' | 'friendly' | 'player' | 'water' | 'lava' | 'up' | 'down' | 'portal' | 'excluded'
      | 'mappedWall' | 'branchStairs' | 'trap' | 'transporter',
      string
    >
  >
  /**
   * The official minimap palette (minimap.js `init_options`): one CSS colour
   * per `map_feature` index, from the `tile_*_col` rc options. When set, a
   * cell that carries its server `mf` takes this colour and `minimapColours`
   * is only the fallback for cells without one.
   */
  mfColours?: (string | undefined)[] | null
  /** Smooth scaled tiles (WebTiles' tile_filter_scaling). Default nearest-neighbour. */
  filterScaling?: boolean
  /** What a frame is cleared to before the cells are drawn: a CSS colour, black by default; translucent for a pane laid over another view. */
  background?: string
  /** Font for glyph modes, CSS shorthand family. */
  glyphFont?: string
  /** Terminal palette for glyph modes, 16 CSS colours. */
  glyphColours?: string[]
  /**
   * Mini health and magic bars over the player (WebTiles draws them under), when
   * tile_show_minihealthbar / tile_show_minimagicbar are on. Not drawn when
   * both are full. Laid out and coloured by the scene's `minibarRects`, in
   * the monsters' damage-bar style.
   */
  minibars?: Minibars | null
  /** Horizontal field of view in degrees, drawn as a wedge from the player. Default 90. */
  fov?: number
  /** How far the field-of-view wedge reaches from the player, in cells. Default 8. */
  wedgeReach?: number
  /** Opacity scale for the wedge, 0..1: 1 is the main view's marker, less makes a quieter one for a minimap. Default 1. */
  wedgeAlpha?: number
}

/** Horizontal field of view (degrees) from a vertical one and a viewport aspect ratio. */
export function horizontalFov(verticalDeg: number, aspect: number): number {
  const v = (verticalDeg * Math.PI) / 180
  return (2 * Math.atan(Math.tan(v / 2) * Math.max(0.1, aspect)) * 180) / Math.PI
}

/** Default terminal palette, as the official stylesheet. */
const TERM_COLOURS = [
  '#000000',
  '#0000cc',
  '#00aa00',
  '#00aaaa',
  '#cc0000',
  '#aa00aa',
  '#aa5500',
  '#aaaaaa',
  '#555555',
  '#5555ff',
  '#55ff55',
  '#55ffff',
  '#ff5555',
  '#ff55ff',
  '#ffff55',
  '#ffffff',
]

const DEFAULT_MINIMAP = {
  unknown: 'rgba(0,0,0,0)',
  floor: '#333333',
  wall: '#666666',
  remembered: '#222266',
  door: '#a58c50',
  feature: '#8888ff',
  item: '#66ff66',
  monster: '#ff5555',
  friendly: '#55ff55',
  player: '#ffffff',
  water: '#0000aa',
  lava: '#aa2200',
  up: '#00ffff',
  down: '#ff00ff',
  portal: '#ff88ff',
  excluded: '#884444',
  // more of the official tile_*_col set; the scene distinguishes these features
  mappedWall: '#444499',
  branchStairs: '#ffff00',
  trap: '#ff0000',
  transporter: '#ff88ff',
}

export class Render2d implements MapRenderer {
  private canvas: HTMLCanvasElement | OffscreenCanvas | null = null
  private ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null
  private tiles: TileSource | null = null
  private scene: Scene | null = null
  private camera: Camera | null = null
  private cursor: SceneCursor | null = null
  private width = 0
  private height = 0
  private dpr = 1
  private opts: Required<Omit<Render2dOptions, 'minimapColours'>> & { minimapColours: typeof DEFAULT_MINIMAP }
  private origin = { x: 0, y: 0 }

  constructor(opts: Render2dOptions = {}) {
    this.opts = {
      cellSize: opts.cellSize ?? 32,
      mode: opts.mode ?? 'tiles',
      follow: opts.follow ?? true,
      center: opts.center ?? null,
      minimapColours: { ...DEFAULT_MINIMAP, ...(opts.minimapColours || {}) },
      mfColours: opts.mfColours ?? null,
      filterScaling: opts.filterScaling ?? false,
      background: opts.background ?? '#000',
      glyphFont: opts.glyphFont ?? 'monospace',
      glyphColours: opts.glyphColours ?? TERM_COLOURS,
      minibars: opts.minibars ?? null,
      fov: opts.fov ?? 90,
      wedgeReach: opts.wedgeReach ?? 8,
      wedgeAlpha: opts.wedgeAlpha ?? 1,
    }
  }

  setOptions(opts: Render2dOptions) {
    if (opts.cellSize !== undefined) this.opts.cellSize = opts.cellSize
    if (opts.mode !== undefined) this.opts.mode = opts.mode
    if (opts.follow !== undefined) this.opts.follow = opts.follow
    if (opts.center !== undefined) this.opts.center = opts.center
    if (opts.minimapColours) this.opts.minimapColours = { ...this.opts.minimapColours, ...opts.minimapColours }
    if (opts.mfColours !== undefined) this.opts.mfColours = opts.mfColours
    if (opts.filterScaling !== undefined) this.opts.filterScaling = opts.filterScaling
    if (opts.background !== undefined) this.opts.background = opts.background
    if (opts.glyphFont !== undefined) this.opts.glyphFont = opts.glyphFont
    if (opts.glyphColours !== undefined) this.opts.glyphColours = opts.glyphColours
    if (opts.minibars !== undefined) this.opts.minibars = opts.minibars
    if (opts.fov !== undefined) this.opts.fov = opts.fov
    if (opts.wedgeReach !== undefined) this.opts.wedgeReach = opts.wedgeReach
    if (opts.wedgeAlpha !== undefined) this.opts.wedgeAlpha = opts.wedgeAlpha
  }

  mount(target: HTMLCanvasElement | OffscreenCanvas): void {
    this.canvas = target
    this.ctx = target.getContext('2d') as CanvasRenderingContext2D
  }
  setTiles(tiles: TileSource): void {
    this.tiles = tiles
  }
  setScene(scene: Scene): void {
    this.scene = scene
  }
  setCamera(cam: Camera): void {
    this.camera = cam
  }
  setCursor(cursor: SceneCursor | null): void {
    this.cursor = cursor
  }
  resize(width: number, height: number, dpr: number): void {
    this.width = width
    this.height = height
    this.dpr = dpr
    if (this.canvas) {
      this.canvas.width = Math.floor(width * dpr)
      this.canvas.height = Math.floor(height * dpr)
    }
  }
  destroy(): void {
    this.canvas = null
    this.ctx = null
  }

  /**
   * cell_renderer.js `render_cell` for one cell at canvas position (sx, sy):
   * the terrain, whatever stands there with its badges, then the cell's own
   * markers. In glyph mode the glyph stands in for all of it; hybrid draws
   * the terrain with the glyph over it. The WebTiles monster list and action
   * panel draw their thumbnails through this.
   *
   * `bare` drops everything that is the cell rather than the thing: no
   * terrain under it and none of the cell's own markers (the travel trail,
   * exclusions, the new-stairs badge), leaving what stands there and the
   * badges it carries — its status icons and damage bar. The glyph modes
   * lose their black square and their hybrid backing with it. Drawn on a
   * cleared canvas that is the sprite cut out of the dungeon, which is what
   * the edge pips (orbrun pips.ts) want: a marker on the view's edge should
   * be the monster, not a tile of floor with a monster on it.
   */
  renderCell(x: number, y: number, sx: number, sy: number, cs = this.opts.cellSize, { bare = false }: { bare?: boolean } = {}): void {
    const ctx = this.ctx
    const scene = this.scene
    if (!ctx || !scene) return
    const cell = scene.cells.get(cellKey(x, y))
    if (!cell) return
    const dpr = this.dpr
    ctx.save()
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.imageSmoothingEnabled = this.opts.filterScaling
    const minimap = this.opts.mode === 'minimap' || !this.tiles
    const glyphs = this.opts.mode === 'glyphs' && !minimap
    const hybrid = this.opts.mode === 'hybrid' && !minimap
    if (glyphs || hybrid) ctx.font = `${Math.floor(cs * 0.8)}px ${this.opts.glyphFont}`
    if (minimap) {
      if (!bare) this.drawMinimapCell(ctx, cell, sx, sy, cs)
    } else if (glyphs) this.drawGlyphCell(ctx, cell, sx, sy, cs, bare ? 'none' : 'fill')
    else {
      if (!bare) this.drawTileCell(ctx, cell, sx, sy, cs)
      const here = scene.billboards.filter((b) => b.x === x && b.y === y)
      for (const b of here) {
        if (hybrid && b.kind !== 'cloud' && b.kind !== 'projectile') continue
        const alpha = b.alpha ?? (b.kind === 'cloud' ? 0.75 : 1)
        if (alpha !== 1) ctx.globalAlpha = alpha
        if (b.layers) for (const l of b.layers) this.drawTile(ctx, l.tile, sx, sy, cs, l.ox, l.oy, l.ymax)
        else this.drawTile(ctx, b.tile, sx, sy, cs)
        if (alpha !== 1) ctx.globalAlpha = 1
      }
      if (hybrid && here.some((b) => b.kind !== 'cloud' && b.kind !== 'projectile')) this.drawGlyphCell(ctx, cell, sx, sy, cs, bare ? 'none' : 'shade')
      for (const b of here) if (b.statusIcons) for (const i of b.statusIcons) this.drawTile(ctx, i.tile, sx, sy, cs, i.ox, i.oy, undefined, i.at)
      if (!bare && cell.icons) for (const i of cell.icons) this.drawTile(ctx, i, sx, sy, cs)
    }
    ctx.restore()
  }

  /**
   * One tile (or a stack of them) at canvas position (sx, sy) with no cell
   * behind it: the action panel's item tiles and gui buttons.
   */
  drawTiles(ids: number[], sx: number, sy: number, cs = this.opts.cellSize, ymax?: number): void {
    const ctx = this.ctx
    if (!ctx) return
    const dpr = this.dpr
    ctx.save()
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.imageSmoothingEnabled = this.opts.filterScaling
    for (const id of ids) this.drawTile(ctx, id, sx, sy, cs, 0, 0, ymax)
    ctx.restore()
  }

  /**
   * One tile blown up to fill a `size` square at (sx, sy) with no cell
   * behind it: its opaque texels alone, scaled to fit inside the square
   * less `pad` on each side and centred, whatever corner of its cell the
   * tile is authored in. A status badge that paints a few texels in a
   * cell's corner comes out as a full-size mark this way (orbrun's status
   * strip).
   */
  drawTileFit(id: number, sx: number, sy: number, size: number, pad = 0): void {
    const ctx = this.ctx
    const tiles = this.tiles
    if (!ctx || !tiles) return
    const rect = tiles.tile(id)
    if (!rect || rect.w <= 0 || rect.h <= 0) return
    const img = tiles.atlas(rect.atlas)
    if (!img) return
    const room = Math.max(0, size - 2 * pad)
    const scale = room / Math.max(rect.w, rect.h)
    const w = rect.w * scale
    const h = rect.h * scale
    ctx.save()
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.imageSmoothingEnabled = this.opts.filterScaling
    ctx.drawImage(img as CanvasImageSource, rect.sx, rect.sy, rect.w, rect.h, sx + (size - w) / 2, sy + (size - h) / 2, w, h)
    ctx.restore()
  }

  /** Clear the whole canvas to black (or transparent). */
  clear(transparent = false): void {
    const ctx = this.ctx
    if (!ctx || !this.canvas) return
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    if (transparent) ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    else {
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    }
    ctx.restore()
  }

  pick(px: number, py: number): CellKey | null {
    const cs = this.opts.cellSize
    const x = Math.floor(px / cs) + this.origin.x
    const y = Math.floor(py / cs) + this.origin.y
    if (!this.scene) return null
    const k = cellKey(x, y)
    return this.scene.cells.has(k) ? k : null
  }

  render(): void {
    const ctx = this.ctx
    const scene = this.scene
    if (!ctx || !scene || !this.canvas) return
    const cs = this.opts.cellSize
    const dpr = this.dpr
    ctx.save()
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    // a translucent background must replace the last frame, not stack on it
    ctx.clearRect(0, 0, this.width, this.height)
    ctx.fillStyle = this.opts.background
    ctx.fillRect(0, 0, this.width, this.height)
    ctx.imageSmoothingEnabled = this.opts.filterScaling
    const cols = Math.ceil(this.width / cs)
    const rows = Math.ceil(this.height / cs)
    const cam = this.camera
    let ox: number
    let oy: number
    const centre = this.opts.center
    if (centre) {
      // dungeon_renderer.js set_view_center: view.x = centre - floor(cols / 2)
      ox = centre.x - Math.floor(cols / 2)
      oy = centre.y - Math.floor(rows / 2)
    } else if (this.opts.follow && cam) {
      ox = cam.x - Math.floor(cols / 2)
      oy = cam.y - Math.floor(rows / 2)
    } else {
      const b = scene.bounds
      const bw = b.right - b.left + 1
      const bh = b.bottom - b.top + 1
      ox = b.left - Math.floor((cols - bw) / 2)
      oy = b.top - Math.floor((rows - bh) / 2)
    }
    this.origin = { x: ox, y: oy }
    const minimap = this.opts.mode === 'minimap' || !this.tiles
    const glyphs = this.opts.mode === 'glyphs' && !minimap
    const hybrid = this.opts.mode === 'hybrid' && !minimap
    const inView = (sx: number, sy: number) => !(sx < -cs || sy < -cs || sx > this.width || sy > this.height)
    if (glyphs || hybrid) ctx.font = `${Math.floor(cs * 0.8)}px ${this.opts.glyphFont}`
    for (const cell of scene.cells.values()) {
      const sx = (cell.x - ox) * cs
      const sy = (cell.y - oy) * cs
      if (!inView(sx, sy)) continue
      if (minimap) this.drawMinimapCell(ctx, cell, sx, sy, cs)
      else if (glyphs) this.drawGlyphCell(ctx, cell, sx, sy, cs, 'fill')
      else this.drawTileCell(ctx, cell, sx, sy, cs)
    }
    if (!minimap && !glyphs) {
      // things standing in cells, in scene order, then their badges
      for (const b of scene.billboards) {
        const sx = (b.x - ox) * cs
        const sy = (b.y - oy) * cs
        if (!inView(sx, sy)) continue
        if (hybrid && b.kind !== 'cloud' && b.kind !== 'projectile') continue
        const alpha = b.alpha ?? (b.kind === 'cloud' ? 0.75 : 1)
        if (alpha !== 1) ctx.globalAlpha = alpha
        if (b.layers) for (const l of b.layers) this.drawTile(ctx, l.tile, sx, sy, cs, l.ox, l.oy, l.ymax)
        else this.drawTile(ctx, b.tile, sx, sy, cs)
        if (alpha !== 1) ctx.globalAlpha = 1
      }
      if (hybrid) {
        // hybrid: the glyph stands in for the sprite, so it goes under the badges
        for (const cell of scene.cells.values()) {
          const sx = (cell.x - ox) * cs
          const sy = (cell.y - oy) * cs
          if (!inView(sx, sy)) continue
          if (scene.billboards.some((b) => b.x === cell.x && b.y === cell.y && b.kind !== 'cloud' && b.kind !== 'projectile')) this.drawGlyphCell(ctx, cell, sx, sy, cs, 'shade')
        }
      }
      // status badges over the sprite (or over the glyph standing in for it)
      for (const b of scene.billboards) {
        if (!b.statusIcons) continue
        const sx = (b.x - ox) * cs
        const sy = (b.y - oy) * cs
        if (!inView(sx, sy)) continue
        for (const i of b.statusIcons) this.drawTile(ctx, i.tile, sx, sy, cs, i.ox, i.oy, undefined, i.at)
      }
    } else if (minimap) {
      for (const b of scene.billboards) {
        const sx = (b.x - ox) * cs
        const sy = (b.y - oy) * cs
        if (!inView(sx, sy)) continue
        const c = this.opts.minimapColours
        if (b.kind === 'monster' || b.kind === 'item') {
          ctx.fillStyle = b.kind === 'monster' ? (b.attitude === 'friendly' ? c.friendly : c.monster) : c.item

          ctx.fillRect(sx, sy, cs, cs)
        }
      }
    }
    // cell badges (travel trail, new stairs, exclusions) and veils, above everything at the cell
    if (!minimap) {
      for (const cell of scene.cells.values()) {
        const sx = (cell.x - ox) * cs
        const sy = (cell.y - oy) * cs
        if (!inView(sx, sy)) continue
        if (cell.icons && !glyphs) for (const i of cell.icons) this.drawTile(ctx, i, sx, sy, cs)
        if (cell.kind === 'unknown') continue
        if (cell.visibility !== 'visible') {
          ctx.fillStyle = cell.flags.magicMapped ? 'rgba(0,0,40,0.45)' : 'rgba(0,0,0,0.45)'
          ctx.fillRect(sx, sy, cs, cs)
        } else if (cell.flags.outOfRange) {
          ctx.fillStyle = 'rgba(0,0,0,0.3)'
          ctx.fillRect(sx, sy, cs, cs)
        }
        if (cell.flash) {
          ctx.fillStyle = `rgba(${cell.flash.r},${cell.flash.g},${cell.flash.b},${cell.flash.a / 255})`
          ctx.fillRect(sx, sy, cs, cs)
        }
      }
    }
    // player + facing
    if (scene.playerOnLevel) {
      const px = (scene.player.x - ox) * cs
      const py = (scene.player.y - oy) * cs
      if (minimap) {
        ctx.fillStyle = this.opts.minimapColours.player
        ctx.fillRect(px, py, cs, cs)
      }
      if (cam) {
        // field-of-view wedge
        const ax = px + cs / 2
        const ay = py + cs / 2
        const half = ((this.opts.fov / 2) * Math.PI) / 180
        const yaw = cam.yaw - Math.PI / 2
        const reach = cs * this.opts.wedgeReach
        const a = this.opts.wedgeAlpha
        ctx.fillStyle = `rgba(255,255,255,${0.15 * a})`
        ctx.beginPath()
        ctx.moveTo(ax, ay)
        ctx.arc(ax, ay, reach, yaw - half, yaw + half)
        ctx.closePath()
        ctx.fill()
        ctx.strokeStyle = `rgba(255,255,255,${0.45 * a})`
        ctx.lineWidth = Math.max(1, cs / 16)
        ctx.beginPath()
        ctx.moveTo(ax + Math.cos(yaw - half) * reach, ay + Math.sin(yaw - half) * reach)
        ctx.lineTo(ax, ay)
        ctx.lineTo(ax + Math.cos(yaw + half) * reach, ay + Math.sin(yaw + half) * reach)
        ctx.stroke()
      }
    }
    if (scene.playerOnLevel && !minimap) this.drawMinibars(ctx, (scene.player.x - ox) * cs, (scene.player.y - oy) * cs, cs)
    if (this.cursor) {
      if (this.cursor.grid && !minimap) {
        // a faint outline on every known cell: where the cursor may go
        ctx.strokeStyle = 'rgba(255,255,255,0.22)'
        ctx.lineWidth = 1
        for (const cell of scene.cells.values()) {
          if (cell.kind === 'unknown') continue
          const sx = (cell.x - ox) * cs
          const sy = (cell.y - oy) * cs
          if (!inView(sx, sy)) continue
          ctx.strokeRect(sx + 0.5, sy + 0.5, cs - 1, cs - 1)
        }
      }
      const cx = (this.cursor.x - ox) * cs
      const cy = (this.cursor.y - oy) * cs
      // the same icon WebTiles paints over the cell; an outline when the gamedata has none
      if (this.cursor.tile !== undefined && this.tiles && this.tiles.tile(this.cursor.tile)) this.drawTile(ctx, this.cursor.tile, cx, cy, cs)
      else {
        ctx.strokeStyle = this.cursor.mode === 'map' ? '#ffffff' : '#ff8800'
        ctx.lineWidth = 2
        ctx.strokeRect(cx + 1, cy + 1, cs - 2, cs - 2)
      }
    }
    ctx.restore()
  }

  private drawMinimapCell(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, cell: SceneCell, sx: number, sy: number, cs: number) {
    const c = this.opts.minimapColours
    // minimap.js `update`: the server's map feature indexes the rc palette directly
    const mfc = this.opts.mfColours
    if (mfc && cell.mf !== undefined && mfc[cell.mf]) {
      ctx.fillStyle = mfc[cell.mf] as string
      ctx.fillRect(sx, sy, cs, cs)
      return
    }
    let colour = c.unknown
    const f = cell.feature
    if (cell.kind === 'unknown') colour = c.unknown
    else if (cell.flags.excluded) colour = c.excluded
    else if (f?.type === 'stairs' && f.branch) colour = c.branchStairs
    else if (cell.beacon === 'up') colour = c.up
    else if (cell.beacon === 'down') colour = c.down
    else if (f?.type === 'transporter') colour = c.transporter
    else if (cell.beacon === 'portal') colour = c.portal
    else if (f?.type === 'trap') colour = c.trap
    else if (cell.kind === 'door') colour = c.door
    else if (cell.kind === 'feature') colour = c.feature
    else if (cell.flags.lava) colour = c.lava
    else if (cell.flags.water) colour = c.water
    else if (cell.kind === 'wall') colour = cell.visibility === 'visible' ? c.wall : c.mappedWall
    else colour = cell.visibility === 'visible' ? c.floor : c.remembered
    ctx.fillStyle = colour
    ctx.fillRect(sx, sy, cs, cs)
  }

  private drawTileCell(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, cell: SceneCell, sx: number, sy: number, cs: number) {
    if (cell.kind === 'unknown') return
    if (cell.kind === 'wall') {
      this.drawTile(ctx, cell.wallTile ?? cell.floorTile, sx, sy, cs)
      if (cell.wallOverlays) for (const o of cell.wallOverlays) this.drawTile(ctx, o, sx, sy, cs)
      return
    }
    this.drawTile(ctx, cell.floorTile, sx, sy, cs)
    if (cell.underlays) for (const o of cell.underlays) this.drawTile(ctx, o, sx, sy, cs)
    if (cell.featureTile !== undefined) this.drawTile(ctx, cell.featureTile, sx, sy, cs)
    if (cell.kind === 'door' && cell.wallOverlays) for (const o of cell.wallOverlays) this.drawTile(ctx, o, sx, sy, cs)
    if (cell.overlays) for (const o of cell.overlays) this.drawTile(ctx, o, sx, sy, cs)
  }

  /**
   * Glyph rendering: the server's glyph and colour for the cell, as WebTiles'
   * glyph and hybrid modes. `bg` is what goes behind the glyph: the cell's
   * black square in glyph mode, hybrid's dark backing over the tile, or
   * nothing at all for a bare cell, where the glyph is the whole sprite.
   */
  private drawGlyphCell(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, cell: SceneCell, sx: number, sy: number, cs: number, bg: 'fill' | 'shade' | 'none') {
    const g = cell.glyph || ' '
    if (bg === 'fill') {
      ctx.fillStyle = '#000'
      ctx.fillRect(sx, sy, cs, cs)
    } else if (bg === 'shade') {
      // hybrid: a dark square so the glyph reads over the tile
      ctx.fillStyle = 'rgba(0,0,0,0.75)'
      ctx.fillRect(sx + cs * 0.15, sy + cs * 0.1, cs * 0.7, cs * 0.8)
    }
    if (g === ' ') return
    const col = (cell.colour ?? 7) & 15
    ctx.fillStyle = this.opts.glyphColours[col] || '#aaaaaa'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(g, sx + cs / 2, sy + cs / 2)
  }

  /**
   * Mini bars over the player cell, adapted from WebTiles' draw_minibars.
   * WebTiles stacks them on the bottom edge (MP lowest, HP above it); Orbrun
   * puts the same stack on the top edge so the bars sit over the doll's head
   * instead of across its feet, HP over MP, and draws them as the monsters'
   * damage bars are drawn (scene bars.ts): two texel rows each, the fill
   * coloured by the wound level, on a translucent black track. Texel rows
   * are snapped to whole pixels so the bars stay crisp at any cell size.
   */
  private drawMinibars(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, x: number, y: number, cs: number) {
    const rects = minibarRects(this.opts.minibars)
    if (!rects.length) return
    const s = cs / MINIBAR_CELL
    const row = (t: number) => Math.round(t * s)
    for (const r of rects) {
      // edges snapped, not widths, so adjoining run segments neither gap nor overlap
      const top = row(r.y)
      const h = Math.max(1, row(r.y + r.h) - top)
      const left = row(r.x)
      const w = Math.max(1, row(r.x + r.w) - left)
      ctx.globalAlpha = r.alpha
      ctx.fillStyle = r.colour
      ctx.fillRect(x + left, y + top, w, h)
    }
    ctx.globalAlpha = 1
  }

  private drawTile(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    id: number,
    sx: number,
    sy: number,
    cs: number,
    ox = 0,
    oy = 0,
    ymax?: number,
    at?: 'top',
  ) {
    const tiles = this.tiles
    if (!tiles) return
    const rect = tiles.tile(id)
    if (!rect) return
    // a badge pinned to the top edge: its opaque texels start on row 0 of the frame
    if (at === 'top') oy = -rect.oy
    const img = tiles.atlas(rect.atlas)
    if (!img) return
    const scale = cs / rect.cell
    let h = rect.h
    let sh = rect.h
    if (ymax !== undefined && ymax < rect.oy + rect.h) {
      sh = Math.max(0, ymax - rect.oy)
      h = sh
    }
    if (h <= 0) return
    ctx.drawImage(
      img as CanvasImageSource,
      rect.sx,
      rect.sy,
      rect.w,
      sh,
      sx + (rect.ox + ox) * scale,
      sy + (rect.oy + oy) * scale,
      rect.w * scale,
      h * scale,
    )
  }
}
