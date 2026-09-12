import { formattedStringToHtml, formattedStringToText, UiState, type GameState, type InvItem, type Monster, actionPanelItems } from '@orbrun/webtiles'
import { bearingTo, dirToYaw, rotateDir, type Billboard, type Camera, type Dir8, type Scene, type SceneCursor } from '@orbrun/scene'
import { Render2d } from '@orbrun/render-2d'
import { monsterGroups } from '@orbrun/scene-webtiles'
import type { Gamedata } from '@orbrun/gamedata'
import { h, clear, escapeHtml, replace } from './dom'
import { CONTINUE, buttonGroup, promptLabels, type Action, type BindingLabel } from './bindings'

/** A tap-or-hold button down: which, and the press's length as a fraction of the hold (bindings.ts HOLD_MS). */
export interface HoldProgress {
  button: string
  fraction: number
}
import { glyph, glyphName } from './glyphs'
import type { Context } from './context'
import type { PadKind } from './gamepad'
import type { InputDevice } from './game'
import { MORPH, animate, coverTransform, reducedMotion, type Rect } from './mapmorph'
import type { CellRect, GameLayout } from './grid/console'
import type { GridHost } from './grid/host'
import { paneRows } from './grid/messages'
import { panelCellAt, panelCellIndex, panelGrid, panelSpan, type PanelBox, type PanelGrid } from './grid/panel'
import { paintRow } from './grid/paint'
import { PORTRAIT_ROWS, statsRows, type BarMemory } from './grid/stats'
import { edgePlace, pipSizeInView, pipTargets, placePips, type EdgePlace, type EdgePipMode, type Projector, type PxRect } from './pips'

const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖']

export interface HudHooks {
  onSelectMonster(b: Billboard): void
  onBarAction(a: Action): void
  onMinimapClick(): void
  /** action_panel.js: a left click uses the item (`inv_item_action`), a right click describes it (`inv_item_describe`). */
  onPanelItem(slot: number, describe: boolean): void
  /** action_panel.js show_panel: the placeholder brings a folded panel (`action_panel_show` off) back. */
  onPanelShow(): void
  /** action_panel.js hide_panel: the X button folds the panel away (`action_panel_show` off). */
  onPanelHide(): void
  /** action_panel.js: the game-menu button sends `main_menu_action`. */
  onGameMenu(): void
  /** action_panel.js show_settings: a right click on the X opens the panel's settings — Orbrun's own settings screen. */
  onPanelSettings(): void
}

/**
 * A pip is drawn the size the sprite would have been in the frame (pips.ts
 * pipSizeInView), bent by that function's knee toward this fraction of the
 * view's shorter side: in view, the thing in the next cell fills a third of
 * the screen, and a pip that big is a wall rather than a marker. Since the
 * knee only approaches the fraction, the ceiling can sit this low without
 * flattening the near range.
 */
const PIP_MAX_FRAC = 0.14
interface PipNode {
  node: HTMLDivElement
  canvas: HTMLCanvasElement
  r2d: Render2d
  /** what the sprite was last drawn from */
  drawn: string
}

/** monster_list.js: at most this many rows, then an ellipsis on the last. */
const MONSTER_LIST_MAX_ROWS = 5
/** monster_list.js: at most this many sprites in one grouped row. */
const MONSTER_LIST_MAX_SPRITES = 6
/**
 * action_panel.js reserves two cells before the first item: the X that folds
 * the panel away (a right click on it opens the panel's settings; Orbrun
 * opens its own settings screen there) and the game-menu button. Orbrun draws
 * both, as the official client does.
 */
const NUM_RESERVED_BUTTONS = 2

/** the action panel's cell before `action_panel_scale`, as cell_renderer.js sizes one (`tile_cell_pixels`) */
const PANEL_CELL = 32

/**
 * One row of the WebTiles monster list (`monster_list.js`): a strip of sprites
 * drawn with the cell renderer, the glyph-mode health box, the name.
 * Orbrun adds a bearing arrow relative to facing in front.
 */
interface MonsterRow {
  node: HTMLElement
  arrow: HTMLElement
  canvas: HTMLCanvasElement
  r2d: Render2d
  health: HTMLElement
  name: HTMLElement
  ellipsis: HTMLElement | null
}

/**
 * The "Minimap tile size" setting's default, in css px: the cell the map
 * follows the player at, the same on any screen and under any UI scale, so
 * the "Minimap size" setting can be a count of tiles and mean exactly that.
 */
export const MINIMAP_CELL_DEFAULT = 20
/**
 * The "Minimap size" setting's default, in tiles across: enough of the level
 * around the player to read at a glance, and at MINIMAP_CELL_DEFAULT a map
 * 380px wide — a little past the sidebar column of the reference layout (42
 * cells of 8px, game.js `stat_width`, 336px), so it hangs over the view.
 */
export const MINIMAP_TILES_DEFAULT = 19
/** the status strip's badges are squares this many rows of the grid tall (renderStatuses) */
export const STATUS_BADGE_ROWS = 3
/**
 * The map's shape is minimap.js's: `gym` rows to `gxm` columns, enums.js has
 * `gxm = 80`, `gym = 70`.
 */
const MAP_COLS = 80
const MAP_ROWS = 70
/**
 * The most the "Minimap size" setting can take: half the screen across (the
 * view keeps its left half clear) and MINIMAP_TALLEST of the column down, so
 * the monster list under it keeps some rows even at the biggest stop.
 */
const MINIMAP_WIDEST = 0.5
const MINIMAP_TALLEST = 0.7

/** the odd count within one of `n` (odd counts keep the player on the centre tile), never under 1 */
const oddUp = (n: number) => 2 * Math.floor(Math.max(0, n) / 2) + 1
/** the biggest odd count not over `n`, never under 1 */
const oddDown = (n: number) => Math.max(1, 2 * Math.ceil(Math.max(1, n) / 2) - 1)

/**
 * The minimap's size in css px on a sidebar column `sideW` × `sideH` on a
 * `gridW` wide screen, at the "Minimap size" setting `tiles` and the
 * "Minimap tile size" setting `cell`: that many `cell` px tiles across, and
 * `gym / gxm` as many down, both taken to an odd count so the player stands
 * on the centre tile. It hangs off the column's right edge, so more tiles
 * reach left over the view (the column is view too) and down the column, to
 * MINIMAP_WIDEST of the screen and MINIMAP_TALLEST of the column; a count
 * that would pass a cap is cut to the most whole tiles under it. Tiles say
 * how much of the level shows, the cell how big it is drawn: a bigger cell
 * on the same count is the same map, larger, until a cap cuts the count.
 */
export function minimapBox(sideW: number, sideH: number, gridW: number, tiles: number, cell: number = MINIMAP_CELL_DEFAULT): { w: number; h: number } {
  if (sideW <= 0 || sideH <= 0) return { w: 0, h: 0 }
  const across = tiles >= 1 ? Math.floor(tiles) : MINIMAP_TILES_DEFAULT
  const px = cell >= 1 ? Math.floor(cell) : MINIMAP_CELL_DEFAULT
  const cols = Math.min(oddUp(across), oddDown(Math.floor(gridW * MINIMAP_WIDEST) / px))
  const rows = Math.min(oddUp((cols * MAP_ROWS) / MAP_COLS), oddDown(Math.floor(sideH * MINIMAP_TALLEST) / px))
  return { w: cols * px, h: rows * px }
}
/**
 * The minimap's facing wedge: a short, faint hint of where the camera looks,
 * not a searchlight over the map. The level map (X) is the minimap grown
 * fullscreen, so it borrows these too (game.ts `applyServerOptions`).
 */
export const MINIMAP_WEDGE_REACH = 2.5
export const MINIMAP_WEDGE_ALPHA = 0.4

export class Hud {
  root: HTMLElement
  /** the right column (game.html `#right_column`): the stats pane, the minimap, the monster list, on the sidebar's cells */
  private sidebar = h('div', { class: 'sidebar' })
  /** the WebTiles `#stats` pane (player.js / game.html) as text rows on the grid (grid/stats.ts) */
  private stats = h('div', { class: 'stats' })
  /**
   * The portrait: the player's own cell, drawn with the same cell renderer
   * as the monster list's thumbnails (`render_cell`), at the pane's
   * top-left corner beside the title and god lines. The doll, its status
   * badges and whatever the player stands on, exactly as the 2D view draws
   * the player's cell; first person has no other place for them.
   */
  private portraitCanvas = h('canvas', { class: 'portrait' })
  private portrait = new Render2d({ mode: 'tiles', cellSize: 32 })
  /** the portrait's side in css px (PORTRAIT_ROWS of the grid) and the cells the rows beside it give up */
  private portraitPx = 0
  private portraitCols = 0
  private portraitKey = ''
  /** consumables action panel (action_panel.js): inventory items with action_panel_order >= 0, in the strip along the top between the stats pane and the minimap (grid/panel.ts) */
  private actionPanel = h('div', { class: 'action-panel' })
  private minimapCanvas = h('canvas', { class: 'minimap' })
  /**
   * The status strip: the player's own status badges (poison, a net, the
   * server's status icons) blown up beside the minimap, each a square
   * STATUS_BADGE_ROWS of the grid tall, stacked down the map's left edge a
   * cell's gutter away. The portrait paints them at a few texels in the
   * corner of a cell; here a poisoned character reads from across the
   * room. Hidden when there is nothing to show, and with the sidebar.
   */
  private statuses = h('div', { class: 'statuses', hidden: true })
  private statusCanvas = h('canvas', { class: 'status-canvas' })
  private statusR2d = new Render2d({ mode: 'tiles', cellSize: 32 })
  /** a badge's side in css px and how many stack down the map's side, from `layout` */
  private statusPx = 0
  private statusRows = 1
  /** where the stack hangs: its right edge and top in css px; null with no minimap to hang off */
  private statusAt: { right: number; top: number } | null = null
  private statusKey = ''
  /** the minimap's unexplored ground is the same translucent backing as the stats pane, since it lies over the view too */
  private minimap = new Render2d({ mode: 'tiles', cellSize: MINIMAP_CELL_DEFAULT, follow: true, background: 'rgba(0, 0, 0, 0)', wedgeReach: MINIMAP_WEDGE_REACH, wedgeAlpha: MINIMAP_WEDGE_ALPHA })
  /** Horizontal field of view (degrees) for the minimap wedge. */
  setFov(deg: number) {
    this.minimap.setOptions({ fov: deg })
  }
  /**
   * The server's cursor (targeting, `x` examine, level map) on the minimap
   * too, so the player sees where they are pointing on the map as well as in
   * the view.
   */
  setCursor(cursor: SceneCursor | null) {
    this.minimap.setCursor(cursor)
    this.minimapKey = ''
  }
  /** What the minimap was last drawn for; empty when it must draw again (a resize, a morph, a new cursor). */
  private minimapKey = ''
  private minimapTiles: Gamedata | null = null
  /** The level map is open: the minimap has morphed into it and stays out of sight. */
  private minimapHidden = false
  private minimapMorph: Promise<void> | null = null
  /** the WebTiles `#monster_list` */
  private monsters = h('div', { class: 'monsters' })
  private monsterRows: MonsterRow[] = []
  private monstersKey = ''
  /** action panel: the one canvas WebTiles draws the buttons and item tiles on */
  private panelCanvas = h('canvas', { class: 'action-canvas' })
  private panelR2d = new Render2d({ mode: 'tiles', cellSize: 32 })
  private panelItems: (InvItem & { letter: string })[] = []
  private panelSelected = -1
  /** the strip the panel stands in (grid/panel.ts `panelSpan`), from `layout`; zero width when there is no room for it */
  private panelBox: PanelBox = { left: 0, top: 0, width: 0, height: 0 }
  /** how the panel's cells last came out, and the cell's size in css px, so the pointer can name the cell it is over */
  private panelCells: PanelGrid = { cols: 0, rows: 0, shown: 0, overflow: false }
  private panelCell = 0
  private panelHorizontal = true
  private panelTooltip = h('div', { class: 'tooltip', style: { display: 'none' } })
  private panelTooltipTimer = 0
  private panelKey = ''
  /** the message pane (game.html `#message_pane`) as rows on the grid (grid/messages.ts), the `--more--` row last */
  private messages = h('div', { class: 'messages' })
  private actionbar = h('div', { class: 'actionbar' })
  private statusEl = h('div', { class: 'status-line', style: { display: 'none' } })
  private hooks: HudHooks
  private lastMsgKey = ''
  private lastPlayerRev = -1
  private logOffset = 0
  /** player.js `old_hp` / `old_mp` / `old_noise`: the previous values that size the increase/decrease bar segments */
  private bars: BarMemory = {}
  /** the grid and the split the pane last laid out on; nothing draws before the first `layout` */
  private host: GridHost | null = null
  private cells: GameLayout | null = null
  /** the free part of the view in css px, from `layout`, for `keepClear` */
  private freePx: PxRect | null = null
  /** where the edge pips ride (renderPips): the free view widened to the view's right edge and down to its bottom, so they go round the sidebar's panes rather than stop at its column, and stand over the bare message pane */
  private pipsPx: PxRect | null = null
  private handsInset = 0
  /** edge pips (pips.ts): one marker per monster or item in sight but out of the 3D frame, on the free view's edge */
  private pips = h('div', { class: 'pips' })
  private pipNodes = new Map<string, PipNode>()
  /** the size the minimap was last given, in css px; nothing draws before the first `layout` */
  private minimapSize = { w: 0, h: 0 }
  /** the "Minimap size" setting in tiles across and the "Minimap tile size" setting in css px (minimapBox); `layout` reads both, so a change needs a relayout */
  private minimapAcross = MINIMAP_TILES_DEFAULT
  private minimapCell = MINIMAP_CELL_DEFAULT
  setMinimapTiles(tiles: number, cell: number = MINIMAP_CELL_DEFAULT) {
    this.minimapAcross = tiles >= 1 ? tiles : MINIMAP_TILES_DEFAULT
    const px = cell >= 1 ? Math.floor(cell) : MINIMAP_CELL_DEFAULT
    if (px === this.minimapCell) return
    this.minimapCell = px
    this.minimap.setOptions({ cellSize: px })
    // the map draws at the new cell even where the box comes out the size it already was
    this.minimapSize = { w: 0, h: 0 }
    this.minimapKey = ''
  }

  constructor(host: HTMLElement, hooks: HudHooks) {
    this.hooks = hooks
    this.root = h('div', { class: 'hud' })
    this.sidebar.append(this.minimapCanvas, this.monsters)
    this.statuses.append(this.statusCanvas)
    this.statusR2d.mount(this.statusCanvas)
    this.root.append(this.pips, this.stats, this.sidebar, this.statuses, this.actionPanel, this.messages, this.actionbar)
    host.append(this.root, this.statusEl, this.panelTooltip)
    this.minimap.mount(this.minimapCanvas)
    this.portrait.mount(this.portraitCanvas)
    this.actionPanel.append(this.panelCanvas)
    this.panelR2d.mount(this.panelCanvas)
    this.attachPanelPointer()
    this.minimapCanvas.addEventListener('click', () => hooks.onMinimapClick())
    // a pending --more-- takes a click on the pane as space; otherwise the pane takes none, as #message_pane takes none
    this.messages.addEventListener('click', () => {
      if (this.messages.classList.contains('dismissable')) hooks.onBarAction(CONTINUE)
    })
  }

  /**
   * Set the HUD on the grid, over the view:
   * the stats pane on its cells at the top-left corner, the sidebar (the
   * minimap, the monster list) on its column at the right, the message pane
   * on its rows along the bottom. `free` is the part of the view no pane
   * lies over: the action panel sits at its top-left corner under the stats
   * pane, as close to where action_panel.js floats it as the pane allows,
   * the prompts stacked upward from its last row at the right. While the level map is
   * open the stats pane, the sidebar and the messages step aside when the
   * rc's `tile_level_map_hide_*` say so (game.js
   * `toggle_full_window_dungeon_view`, which hides the whole `#right_column`);
   * the stats pane alone steps aside while the new-game chooser is up.
   */
  layout(host: GridHost, cells: GameLayout, free: CellRect, hidden: { stats: boolean; sidebar: boolean; messages: boolean }) {
    this.host = host
    this.cells = cells
    host.place(this.stats, cells.stats)
    // the pane grows with its rows (the status lights wrap); the cells give it its width and where it starts
    this.stats.style.height = 'auto'
    host.place(this.sidebar, cells.sidebar)
    host.place(this.messages, cells.messages)
    this.stats.hidden = hidden.stats || cells.stats.w === 0
    this.sidebar.hidden = hidden.sidebar || cells.sidebar.w === 0
    // the portrait is a square PORTRAIT_ROWS tall; the rows beside it start a cell after it
    const side = cells.stats.w > 0 ? host.grid.ch * PORTRAIT_ROWS : 0
    this.portraitCols = side ? Math.min(cells.stats.w, Math.ceil(side / host.grid.cw) + 1) : 0
    if (side !== this.portraitPx) {
      this.portraitPx = side
      this.portrait.resize(side, side, window.devicePixelRatio || 1)
      this.portraitCanvas.style.width = side + 'px'
      this.portraitCanvas.style.height = side + 'px'
      this.portraitKey = ''
    }
    this.messages.hidden = hidden.messages
    const at = host.px(free)
    this.freePx = { left: at.left, top: at.top, width: at.width, height: at.height }
    // the pips ride the view's own right and bottom edges: the column under the minimap and the rows under the message pane are
    // 3D view too (the pane is bare, its text shadowed), so the panes on the column are stepped round and the messages are stood on
    const viewPx = host.px(cells.view)
    this.pipsPx = {
      left: at.left,
      top: at.top,
      width: Math.max(at.width, viewPx.left + viewPx.width - at.left),
      height: Math.max(at.height, viewPx.top + viewPx.height - at.top),
    }
    // as many tiles across as the "Minimap size" setting says (minimapBox); it hangs off the column's right edge, so a wide one
    // reaches left over the view
    const sidePx = host.px(cells.sidebar)
    const { w, h: size } = minimapBox(sidePx.width, sidePx.height, host.grid.cols * host.grid.cw, this.minimapAcross, this.minimapCell)
    if (this.minimapSize.w !== w || this.minimapSize.h !== size) {
      this.minimapSize = { w, h: size }
      const dpr = window.devicePixelRatio || 1
      this.minimap.resize(w, size, dpr)
      this.minimapCanvas.style.width = w + 'px'
      this.minimapCanvas.style.height = size + 'px'
      this.minimapKey = ''
    }
    // the prompts stack upward from the view's last row, their right edge on its (styles.css .actionbar.contextual)
    this.actionbar.style.left = at.left + 'px'
    this.actionbar.style.width = at.width + 'px'
    this.actionbar.style.top = at.top + at.height + 'px'
    this.actionbar.style.transform = 'translateY(-100%)'
    // the action panel stands in the strip along the top between the stats pane and the minimap (grid/panel.ts), each a
    // cell's gutter away; the minimap's left edge is where it hangs from the column's right edge, not the column's own
    const statsPx = host.px(cells.stats)
    const statsRight = this.stats.hidden ? null : statsPx.left + statsPx.width
    const minimapLeft = this.sidebar.hidden || w === 0 ? null : sidePx.left + sidePx.width - w
    this.panelBox = panelSpan(this.freePx, statsRight, minimapLeft, host.grid.cw, PANEL_CELL)
    // the status strip hangs down the minimap's left edge, a cell's gutter away: squares STATUS_BADGE_ROWS tall, as many
    // down as the map is tall, another column leftward past that
    this.statusPx = host.grid.ch * STATUS_BADGE_ROWS
    this.statusRows = Math.max(1, Math.floor(size / this.statusPx))
    this.statusAt = minimapLeft === null ? null : { right: minimapLeft - host.grid.cw, top: sidePx.top }
    this.statusKey = ''
    // left aligned in the strip, where action_panel.js stands it in the dungeon's top-left corner; it shrinks to what it
    // draws, so the edge pips step round the panel itself, not the whole strip
    this.actionPanel.style.left = this.panelBox.left + 'px'
    this.actionPanel.style.top = this.panelBox.top + 'px'
    this.panelKey = ''
    this.lastPlayerRev = -1
    this.lastMsgKey = ''
  }

  /**
   * Keep the corner clear of the hands (rendering-3d.md II.7): `x` is the
   * screen-px left edge of the weapon drawn low right, or null. The prompt
   * stack slides left of it by an inset (styles.css `--hands-inset`), a
   * cell's gap away, never past the middle of the free view.
   */
  keepClear(x: number | null) {
    let inset = 0
    if (x !== null && this.freePx && this.host) {
      const right = this.freePx.left + this.freePx.width
      inset = Math.min(Math.max(0, right - x + this.host.grid.cw), this.freePx.width * 0.5)
    }
    inset = Math.round(inset)
    if (inset === this.handsInset) return
    this.handsInset = inset
    this.actionbar.style.setProperty('--hands-inset', inset + 'px')
  }

  status(text: string) {
    this.statusEl.textContent = text
    this.statusEl.style.display = ''
    // restart the animation
    this.statusEl.style.animation = 'none'
    void this.statusEl.offsetHeight
    this.statusEl.style.animation = ''
    setTimeout(() => (this.statusEl.style.display = 'none'), 3000)
  }

  /** Read back through the log in the pane's own rows: the Info layer's stick, a spectator's d-pad. */
  scrollLog(delta: number) {
    this.logOffset = Math.max(0, this.logOffset - delta * 3)
    this.lastMsgKey = ''
  }

  /**
   * `list` draws the monster list; `pips` hides it, since the edge pips
   * (renderPips) say the same thing on the view's edge instead. Never both.
   * `hints` false hides the corner prompts on both devices (the Hints setting
   * is off). The game supplies the pad's adaptive/contextual selection
   * through `padLabels`, and `holding` names the tap-or-hold button it is
   * holding down, with how far towards the hold the press has come.
   */
  update(state: GameState, scene: Scene, cam: Camera, ctx: Context, padKind: PadKind, gd: Gamedata | null, spectating: boolean, device: InputDevice, nearby: 'list' | 'pips' = 'list', hints = true, padLabels?: BindingLabel[], holding?: HoldProgress | null) {
    if (!this.cells) return
    if (state.rev.player !== this.lastPlayerRev) {
      this.lastPlayerRev = state.rev.player
      this.renderStats(state)
    }
    this.renderPortrait(scene, state, gd)
    this.renderActionPanel(state, gd, spectating)
    this.monsters.hidden = nearby === 'pips'
    if (nearby === 'list') this.renderMonsters(scene, cam, state, gd)
    this.renderMinimap(scene, cam, state, gd)
    this.renderStatuses(scene, state, gd)
    // only the player's pane can be dismissed, so that is part of the key
    const msgKey = state.rev.messages + ':' + this.logOffset + (state.messages.more ? ':' + spectating : '')
    if (msgKey !== this.lastMsgKey) {
      this.lastMsgKey = msgKey
      this.renderMessages(state, spectating)
    }
    this.renderBar(ctx, padKind, spectating, device, hints, padLabels)
    this.showHold(holding)
  }

  /**
   * The held button's prompt fills its hold ring and warms the hold's
   * label as the press lengthens (styles.css `.chip.holding`), in place of a
   * strip of its own. Progress rides a custom property on the chip, so no
   * frame of the hold rebuilds the corner.
   */
  private showHold(holding?: HoldProgress | null) {
    for (const [button, chip] of this.barChips) {
      const on = !!holding && button === holding.button
      chip.classList.toggle('holding', on)
      if (on) chip.style.setProperty('--hold', String(Math.min(1, Math.max(0, holding.fraction))))
      else chip.style.removeProperty('--hold')
    }
  }

  // ------------------------------------------------------------- stats pane

  /**
   * The WebTiles stats pane as rows on the sidebar's cells (grid/stats.ts):
   * the same lines, captions, order and colours as `update_stats_pane` in
   * player.js, the bars painted as cells, the rc's colours from the
   * `options` message. A new `player` message rebuilds the rows; the bar
   * memory carries the previous values for the change segments.
   */
  private renderStats(state: GameState) {
    if (!this.cells) return
    const { rows, prev } = statsRows(state.player, state.options, this.bars, this.cells.stats.w, this.portraitCols)
    this.bars = prev
    // the canvas keeps its drawing across the move; the rows beside it left its cells blank
    replace(this.stats, this.portraitCanvas, ...rows.map((r) => paintRow(r)))
  }

  /**
   * The player's cell as cell_renderer.js `render_cell` draws it in the 2D
   * view (dungeon_renderer.js) and monster_list.js draws a monster's: the
   * terrain, the doll's parts (`draw_dolls`), then the status badges over
   * it in `draw_foreground`'s order; in glyph mode the `@` in its colour,
   * in hybrid the glyph over the terrain. Sized to the pane's rows rather
   * than `tile_cell_pixels`, so the title and god lines sit beside it. Off
   * the level (a remote level in view) the square is empty; the pane keeps
   * its shape.
   */
  private renderPortrait(scene: Scene, state: GameState, gd: Gamedata | null) {
    if (!this.portraitPx || this.stats.hidden) return
    const o = state.options
    const mode = o.tile_display_mode === 'glyphs' ? 'glyphs' : o.tile_display_mode === 'hybrid' ? 'hybrid' : 'tiles'
    const key = JSON.stringify([scene.revision, scene.playerOnLevel, scene.player.x, scene.player.y, mode, o.glyph_mode_font, o.tile_filter_scaling, gd?.version, this.portraitPx])
    if (key === this.portraitKey) return
    this.portraitKey = key
    const px = this.portraitPx
    this.portrait.setOptions({ cellSize: px, mode, filterScaling: o.tile_filter_scaling === true, glyphFont: typeof o.glyph_mode_font === 'string' && o.glyph_mode_font ? o.glyph_mode_font : 'monospace' })
    if (gd) this.portrait.setTiles(gd)
    this.portrait.setScene(scene)
    this.portrait.clear(true)
    if (scene.playerOnLevel) this.portrait.renderCell(scene.player.x, scene.player.y, 0, 0, px)
  }

  /**
   * The status strip beside the minimap: the badges on the player's own
   * billboard (scene-webtiles `statusIcons`, the same ones the portrait
   * paints over the doll), each blown up to a square of its own on one
   * canvas, stacked down the map's left edge from its top, a second column
   * leftward once the map's height is used up. Left out:
   * the damage bar, which the stats pane's HP bar already says, and the
   * "something under here" marks, which are about the square, not the
   * player. Glyph mode paints no badges anywhere, so none here. The strip
   * carries the status lights' descriptions as its tooltip.
   */
  private renderStatuses(scene: Scene, state: GameState, gd: Gamedata | null) {
    if (!this.statusPx) return
    const at = this.statusAt
    const me = scene.playerOnLevel ? scene.billboards.find((b) => b.kind === 'player' && b.x === scene.player.x && b.y === scene.player.y) : undefined
    const badges = (me?.statusIcons || []).filter((i) => !i.at && !i.square)
    const o = state.options
    const glyphs = o.tile_display_mode === 'glyphs'
    const tip = state.player.status
      .filter((s) => s.light)
      .map((s) => s.desc || s.text || s.light)
      .join('\n')
    const key = JSON.stringify([badges.map((b) => b.tile), glyphs, o.tile_filter_scaling, gd?.version, this.statusPx, this.statusRows, at, tip])
    if (key === this.statusKey) return
    this.statusKey = key
    const shown = badges.length > 0 && !glyphs && !!gd && !!at
    this.statuses.hidden = !shown
    if (!shown || !at) return
    this.statuses.title = tip
    const px = this.statusPx
    const rows = Math.min(this.statusRows, badges.length)
    const cols = Math.ceil(badges.length / rows)
    const width = cols * px
    const height = rows * px
    this.statuses.style.left = at.right - width + 'px'
    this.statuses.style.top = at.top + 'px'
    const dpr = window.devicePixelRatio || 1
    this.statusR2d.resize(width, height, dpr)
    this.statusCanvas.style.width = width + 'px'
    this.statusCanvas.style.height = height + 'px'
    this.statusR2d.setOptions({ filterScaling: o.tile_filter_scaling === true })
    this.statusR2d.setTiles(gd!)
    this.statusR2d.clear(true)
    // a tenth of the square clear on each side, so neighbours never touch
    const pad = Math.round(px * 0.1)
    // the first column is the one against the map; the next stands left of it
    badges.forEach((b, i) => this.statusR2d.drawTileFit(b.tile, (cols - 1 - Math.floor(i / rows)) * px, (i % rows) * px, px, pad))
  }

  /**
   * The consumables action panel, as action_panel.js draws it: one canvas
   * with every inventory item with `action_panel_order >= 0` in that order
   * (without the X and game-menu buttons WebTiles puts first) as its tile (or glyph
   * under `action_panel_glyphs`) with its quantity, a mesh over useless
   * items, a cursor over the hovered one and an ellipsis when it overflows.
   * `action_panel_scale`, `action_panel_orientation`, `action_panel_show`,
   * `action_panel_disabled` and `action_panel_font_*` come from the rc.
   * A left click uses the item, a right click describes it, exactly as the
   * official client sends them. Orbrun adds the inventory letter in the
   * corner so the same slot is reachable from the palette.
   *
   * It stands in the strip between the stats pane and the minimap
   * (grid/panel.ts) rather than over the view's top-left corner, which the
   * stats pane holds. A run that does not fit the strip wraps onto another
   * line (WebTiles has the whole dungeon width for one line; the strip is
   * narrower, and a stocked character carries more than fits across it),
   * PANEL_MAX_LINES of them at most, and what still does not fit is behind
   * the ellipsis exactly as the official client leaves it.
   */
  private renderActionPanel(state: GameState, gd: Gamedata | null, spectating: boolean) {
    const o = state.options
    const items = actionPanelItems(state)
    // action_panel.js update(): nothing until the inventory arrived, nothing for spectators
    const inited = Object.values(state.player.inv).length > 0
    // an empty panel still stands: action_panel.js draws its two buttons whether or not the character carries a
    // consumable. Nowhere to draw it when the strip between the panes has no room (a narrow screen, where the panes
    // meet), and game.js toggle_full_window_dungeon_view hides it outright while the level map is up, whatever the rc says
    const mapView = state.uiState === UiState.VIEW_MAP
    const disabled = o.action_panel_disabled === true || spectating || !inited || this.panelBox.width <= 0 || mapView
    const minimized = o.action_panel_show === false
    const scale = (typeof o.action_panel_scale === 'number' && o.action_panel_scale > 0 ? o.action_panel_scale : 100) / 100
    const horizontal = o.action_panel_orientation !== 'vertical'
    const glyphs = o.action_panel_glyphs === true
    const fontFamily = typeof o.action_panel_font_family === 'string' && o.action_panel_font_family ? o.action_panel_font_family : 'monospace'
    const fontSize = typeof o.action_panel_font_size === 'number' && o.action_panel_font_size > 0 ? o.action_panel_font_size : 16
    const box = this.panelBox
    const key = JSON.stringify([disabled, minimized, scale, horizontal, glyphs, fontFamily, fontSize, o.glyph_mode_font, o.tile_filter_scaling, this.panelSelected, gd?.version, box.width, box.height, items.map((i) => [i.slot, i.name, i.quantity, i.tile, i.useless])])
    if (key === this.panelKey) return
    this.panelKey = key
    this.panelItems = items
    this.actionPanel.classList.toggle('hidden', disabled)
    this.actionPanel.classList.toggle('minimized', minimized && !disabled)
    this.actionPanel.classList.toggle('vertical', !horizontal)
    if (disabled) return
    if (minimized) {
      // action_panel.js hide_panel: only the placeholder button that brings it back
      this.panelCanvas.style.display = 'none'
      if (!this.actionPanel.querySelector('.placeholder')) {
        this.actionPanel.append(h('button', { class: 'placeholder', title: 'Show the action panel', onclick: () => this.hooks.onPanelShow() }, '+'))
      }
      return
    }
    this.actionPanel.querySelector('.placeholder')?.remove()
    this.panelCanvas.style.display = ''
    const cell = Math.round(PANEL_CELL * scale)
    const count = items.length + NUM_RESERVED_BUTTONS
    // the panel keeps to the strip (action_panel.js: available_length is the dungeon's), wrapping onto another line rather
    // than dropping everything past the first
    const grid = panelGrid(count, cell, box, horizontal)
    this.panelCells = grid
    this.panelCell = cell
    this.panelHorizontal = horizontal
    const width = grid.cols * cell
    const height = grid.rows * cell
    const dpr = window.devicePixelRatio || 1
    this.panelR2d.resize(width, height, dpr)
    this.panelCanvas.style.width = width + 'px'
    this.panelCanvas.style.height = height + 'px'
    this.panelR2d.setOptions({ cellSize: cell, filterScaling: o.tile_filter_scaling === true, glyphFont: typeof o.glyph_mode_font === 'string' && o.glyph_mode_font ? o.glyph_mode_font : 'monospace' })
    if (gd) this.panelR2d.setTiles(gd)
    this.panelR2d.clear(true)
    if (!gd) return
    const ctx = this.panelCanvas.getContext('2d')!
    const at = (i: number) => panelCellAt(i, grid, cell, horizontal)
    const drawNamed = (layer: 'gui' | 'icons' | 'main', name: string, i: number) => {
      const id = (layer === 'gui' ? gd.gui : layer === 'icons' ? gd.icons : gd.main).id(name)
      if (id === undefined) return
      const rect = gd.tile(id, layer)
      const img = rect && gd.atlas(rect.atlas)
      if (!rect || !img) return
      const p = at(i)
      ctx.save()
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.imageSmoothingEnabled = o.tile_filter_scaling === true
      ctx.drawImage(img as CanvasImageSource, rect.sx, rect.sy, rect.w, rect.h, p.x + rect.ox * scale, p.y + rect.oy * scale, rect.w * scale, rect.h * scale)
      ctx.restore()
    }
    const cursorOn = (i: number) => {
      if (this.panelSelected === i) drawNamed('icons', 'CURSOR3', i)
    }
    // action_panel.js: the X that folds the panel away, then the game menu, before the first item
    if (grid.shown > 0) {
      drawNamed('gui', 'PROMPT_NO', 0)
      cursorOn(0)
    }
    if (grid.shown > 1) {
      drawNamed('gui', 'CMD_GAME_MENU', 1)
      cursorOn(1)
    }
    items.slice(0, grid.shown - NUM_RESERVED_BUTTONS).forEach((item, idx) => {
      const i = idx + NUM_RESERVED_BUTTONS
      const p = at(i)
      if (glyphs) {
        // action_panel.js draw_action: the item's glyph in its colour instead of the tile
        ctx.save()
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.font = `${Math.floor(cell * 0.8)}px ${typeof o.glyph_mode_font === 'string' && o.glyph_mode_font ? o.glyph_mode_font : 'monospace'}`
        ctx.fillStyle = TERM16[(item.col ?? 7) & 15]
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(typeof item.g === 'string' ? item.g : '?', p.x + cell / 2, p.y + cell / 2)
        ctx.restore()
      } else if (item.tile !== undefined) {
        // tileweb.cc `_send_item` sends `tile` as plain ids in the main texture (the known base item under the
        // item's own tile), which action_panel.js draw_action wraps in an array and draws against `main`; a
        // `{ t, tex }` layer keeps its own texture, as the map's tiles do
        for (const t of Array.isArray(item.tile) ? item.tile : [item.tile]) {
          const rect = typeof t === 'number' ? gd.tile(t, 'main') : gd.tile(t.t, String(t.tex))
          const img = rect && gd.atlas(rect.atlas)
          if (!rect || !img) continue
          let hh = rect.h
          const ymax = typeof t === 'number' ? undefined : t.ymax
          if (ymax !== undefined && ymax < rect.oy + rect.h) hh = Math.max(0, ymax - rect.oy)
          if (hh <= 0) continue
          ctx.save()
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          ctx.imageSmoothingEnabled = o.tile_filter_scaling === true
          ctx.drawImage(img as CanvasImageSource, rect.sx, rect.sy, rect.w, hh, p.x + rect.ox * scale, p.y + rect.oy * scale, rect.w * scale, hh * scale)
          ctx.restore()
        }
      }
      // cell_renderer.js draw_quantity: white with a black shadow, top-left
      const qtyField = typeof item.qty_field === 'string' ? item.qty_field : 'quantity'
      const qty = item[qtyField]
      if (typeof qty === 'number' || (typeof qty === 'string' && qty)) {
        ctx.save()
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.fillStyle = 'white'
        ctx.font = `${fontSize * scale}px ${fontFamily}`
        ctx.shadowColor = 'black'
        ctx.shadowBlur = 2
        ctx.shadowOffsetX = 1
        ctx.shadowOffsetY = 1
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        ctx.fillText(String(typeof qty === 'number' ? Math.max(0, Math.min(999, qty)) : qty), p.x + 2, p.y + 2)
        ctx.restore()
      }
      cursorOn(i)
      if (item.useless) drawNamed('icons', 'OOR_MESH', i)
      // Orbrun: the inventory letter, bottom-right, so the palette and the panel name the same slot
      ctx.save()
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.font = `${Math.max(8, Math.round(9 * scale))}px ${fontFamily}`
      ctx.shadowColor = 'black'
      ctx.shadowBlur = 2
      ctx.textAlign = 'right'
      ctx.textBaseline = 'bottom'
      ctx.fillText(item.letter, p.x + cell - 2, p.y + cell - 1)
      ctx.restore()
    })
    if (grid.overflow) {
      // action_panel.js: an ellipsis icon at the far end when items are cut off — here the far end of the last line
      const id = gd.icons.id('ELLIPSIS')
      const rect = id !== undefined ? gd.tile(id, 'icons') : undefined
      const img = rect && gd.atlas(rect.atlas)
      if (rect && img) {
        ctx.save()
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.drawImage(img as CanvasImageSource, rect.sx, rect.sy, rect.w, rect.h, width - rect.w * scale, height - rect.h * scale, rect.w * scale, rect.h * scale)
        ctx.restore()
      }
    }
  }

  /**
   * action_panel.js handle_mouse: hover tracks the cell under the pointer
   * (the cursor icon follows, a tooltip names the cell after half a second),
   * a left click uses the item, a right click describes. The two reserved
   * buttons take their own clicks: the X folds the panel away (right click:
   * the settings), the second opens the game menu.
   */
  private attachPanelPointer() {
    const c = this.panelCanvas
    // the cell the pointer is over, on the grid the last draw laid out (grid/panel.ts): a wrapped panel has lines, so
    // both axes count
    const cellAt = (ev: MouseEvent): number => {
      const rect = c.getBoundingClientRect()
      return panelCellIndex(ev.clientX - rect.left, ev.clientY - rect.top, this.panelCells, this.panelCell, this.panelHorizontal)
    }
    const hideTip = () => {
      clearTimeout(this.panelTooltipTimer)
      this.panelTooltip.style.display = 'none'
    }
    c.addEventListener('mousemove', (ev) => {
      const i = cellAt(ev)
      if (i !== this.panelSelected) {
        this.panelSelected = i
        this.panelKey = ''
        hideTip()
        if (i >= 0) {
          const html = this.panelTip(i)
          if (html) this.panelTooltipTimer = window.setTimeout(() => this.showTooltip(html, ev.pageX + 10, ev.pageY + 10), 500)
        }
      }
    })
    c.addEventListener('mouseleave', () => {
      this.panelSelected = -1
      this.panelKey = ''
      hideTip()
    })
    c.addEventListener('contextmenu', (ev) => ev.preventDefault())
    c.addEventListener('mousedown', (ev) => {
      const i = cellAt(ev)
      hideTip()
      if (i < 0) return
      if (ev.button === 0) {
        // the X folds the panel away even in targeting mode, as action_panel.js has it; the rest wait for command mode,
        // which the app's own hooks check
        if (i === 0) this.hooks.onPanelHide()
        else if (i === 1) this.hooks.onGameMenu()
        else {
          const item = this.panelItems[i - NUM_RESERVED_BUTTONS]
          if (item) this.hooks.onPanelItem(item.slot, false)
        }
      } else if (ev.button === 2) {
        if (i === 0) this.hooks.onPanelSettings()
        else if (i >= NUM_RESERVED_BUTTONS) {
          const item = this.panelItems[i - NUM_RESERVED_BUTTONS]
          if (item) this.hooks.onPanelItem(item.slot, true)
        }
      }
    })
  }

  /**
   * action_panel.js show_tooltip: the buttons say what their clicks do, an
   * item gives its letter and name and then its own two clicks (the server
   * names the left one in `action_verb`).
   */
  private panelTip(i: number): string {
    if (i === 0) return 'Left click: minimize<br>Right click: open settings'
    if (i === 1) return 'Left click: show main menu'
    const item = this.panelItems[i - NUM_RESERVED_BUTTONS]
    if (!item) return ''
    const verb = typeof item.action_verb === 'string' ? item.action_verb.toLowerCase() : ''
    return (
      escapeHtml(item.letter + ' - ' + (item.name || '')) +
      (verb ? '<br>Left click: ' + escapeHtml(verb) : '') +
      '<br>Right click: describe'
    )
  }

  /** mouse_control.js show_tooltip: a small box near the pointer. */
  showTooltip(html: string, x: number, y: number) {
    if (!html) return
    this.panelTooltip.innerHTML = html
    this.panelTooltip.style.left = x + 'px'
    this.panelTooltip.style.top = y + 'px'
    this.panelTooltip.style.display = ''
  }

  hideTooltip() {
    this.panelTooltip.style.display = 'none'
  }

  /**
   * The WebTiles monster list, as monster_list.js `update` draws it: the
   * visible monsters sorted and grouped (`monsterGroups`), at most five rows,
   * the "something invisible" description first when the server sent one,
   * each row a strip of up to six sprites drawn with the cell renderer (so
   * every badge the map cell carries is on the thumbnail too), the glyph-mode
   * health box, then the name (or "3 jackals") in its attitude and threat
   * colours; an ellipsis on the last row when rows were cut. Orbrun adds a
   * bearing arrow relative to facing, and a row can be tapped to face it.
   */
  private renderMonsters(scene: Scene, cam: Camera, state: GameState, gd: Gamedata | null) {
    const groups = monsterGroups(scene)
    const invis = state.map.invisibleMonsterDesc
    const o = state.options
    const mode = o.tile_display_mode === 'glyphs' ? 'glyphs' : o.tile_display_mode === 'hybrid' ? 'hybrid' : 'tiles'
    const px = typeof o.tile_cell_pixels === 'number' && o.tile_cell_pixels > 0 ? o.tile_cell_pixels : 32
    const vs = typeof o.tile_viewport_scale === 'number' && o.tile_viewport_scale > 0 ? o.tile_viewport_scale : 100
    const w = Math.max(16, Math.min(64, Math.round((px * vs) / 100)))
    const key = JSON.stringify([
      invis,
      cam.facing,
      mode,
      w,
      o.glyph_mode_font,
      o.tile_filter_scaling,
      gd?.version,
      state.rev.map,
      groups.map((g) => g.map((m) => [m.x, m.y, m.name, m.damage, m.attitude, m.threat])),
    ])
    if (key === this.monstersKey) return
    this.monstersKey = key
    let rows = Math.min(groups.length, MONSTER_LIST_MAX_ROWS)
    if (invis) rows++
    let i = 0
    for (; i < rows; i++) {
      const group = invis && i > 0 ? groups[i - 1] : groups[i]
      let row = this.monsterRows[i]
      if (!row) {
        // monster_list.js: <span class='group'><canvas class='picture'><span class='health'><span class='name'>
        const arrow = h('span', { class: 'arrow' })
        const canvas = h('canvas', { class: 'picture' })
        const health = h('span', { class: 'health' })
        const name = h('span', { class: 'name' })
        const node = h('div', { class: 'group' }, arrow, canvas, health, name)
        const r2d = new Render2d({ mode: 'tiles', cellSize: w })
        r2d.mount(canvas)
        row = { node, arrow, canvas, r2d, health, name, ellipsis: null }
        this.monsterRows.push(row)
        this.monsters.append(node)
      }
      row.node.onclick = null
      row.name.className = 'name'
      row.health.style.display = 'none'
      if (invis && i === 0) {
        // monster_list.js: the unseen-invisible tile and the description in magenta
        this.sizeRow(row, w, 1)
        row.r2d.clear()
        if (gd) {
          row.r2d.setTiles(gd)
          const id = gd.main.id('UNSEEN_INVISIBLE')
          if (id !== undefined) row.r2d.drawTiles([id], 0, 0, w)
        }
        row.name.innerHTML = formattedStringToHtml('<magenta>' + invis + '</magenta>')
        row.name.classList.add('invisible-desc')
        row.arrow.textContent = '?'
        row.ellipsis?.remove()
        row.ellipsis = null
        continue
      }
      const shown = Math.min(group.length, MONSTER_LIST_MAX_SPRITES)
      this.sizeRow(row, w, shown)
      row.r2d.setOptions({ cellSize: w, mode, filterScaling: o.tile_filter_scaling === true, glyphFont: typeof o.glyph_mode_font === 'string' && o.glyph_mode_font ? o.glyph_mode_font : 'monospace' })
      if (gd) row.r2d.setTiles(gd)
      row.r2d.setScene(scene)
      row.r2d.clear()
      for (let j = 0; j < shown; j++) row.r2d.renderCell(group[j].x, group[j].y, j * w, 0, w)
      const first = group[0]
      const mon = first.ref as Monster
      if (group.length === 1) {
        row.name.textContent = mon.name
        if (mode === 'glyphs') {
          // monster_list.js: in glyph mode a coloured box beside the glyph shows the wounds
          row.health.className = (first.damage || 'uninjured') + ' health'
          row.health.style.width = w + 'px'
          row.health.style.height = w + 'px'
          row.health.style.display = ''
        }
      } else row.name.textContent = group.length + ' ' + (mon.plural || mon.name)
      row.name.classList.add(first.attitude || 'hostile')
      row.name.classList.add(first.threat || 'easy')
      // Orbrun: where the first of the group stands, relative to facing; a tap turns the camera to it
      const b = bearingTo(scene, first.x, first.y)
      const rel = b === null ? 0 : rotateDir(b, -cam.facing)
      row.arrow.textContent = rel === 0 ? '▲' : ARROWS[rel]
      row.node.onclick = () => this.hooks.onSelectMonster(first)
      if (i === rows - 1 && rows < groups.length + (invis ? 1 : 0)) {
        if (!row.ellipsis) {
          row.ellipsis = h('span', { class: 'ellipse' }, '...')
          row.node.append(row.ellipsis)
        }
      } else {
        row.ellipsis?.remove()
        row.ellipsis = null
      }
    }
    for (; i < this.monsterRows.length; i++) this.monsterRows[i].node.remove()
    this.monsterRows = this.monsterRows.slice(0, rows)
  }

  /**
   * Edge pips (pips.ts; hud.md "What is around you"). After a 3D frame, one
   * marker on the free view's edge for each monster and item the server
   * shows in sight that the lens did not frame: the thing drawn by the same
   * renderer as the monster list's thumbnails (so the badges and the glyph
   * mode come with it), bare (render-2d `renderCell` `bare`) on a cleared
   * canvas — the sprite with its status icons and damage bar, no floor
   * under it and none of the cell's own marks, at the size the 3D frame
   * would have drawn it. The pips ride the view's own edges, the sidebar's column and the message
   * pane's rows included (the view runs under both; the pane is bare, so a
   * pip over its text still reads), keeping off the stats pane, the
   * minimap, the monster list and the prompt stack and spreading apart along
   * their edge. A tap turns the camera to the thing, as a monster row does.
   * `proj` is null when there is no 3D frame (2D, the level map), and then
   * there are no pips.
   */
  renderPips(scene: Scene, state: GameState, gd: Gamedata | null, proj: Projector | null, mode: EdgePipMode) {
    const rect = this.pipsPx
    if (!rect || !proj || mode === 'off' || !scene.playerOnLevel) {
      if (this.pipNodes.size) {
        for (const n of this.pipNodes.values()) n.node.remove()
        this.pipNodes.clear()
      }
      return
    }
    const o = state.options
    const dmode = o.tile_display_mode === 'glyphs' ? 'glyphs' : o.tile_display_mode === 'hybrid' ? 'hybrid' : 'tiles'
    const px = typeof o.tile_cell_pixels === 'number' && o.tile_cell_pixels > 0 ? o.tile_cell_pixels : 32
    const vs = typeof o.tile_viewport_scale === 'number' && o.tile_viewport_scale > 0 ? o.tile_viewport_scale : 100
    const w = Math.max(16, Math.min(64, Math.round((px * vs) / 100)))
    const maxPx = Math.round(Math.min(rect.width, rect.height) * PIP_MAX_FRAC)
    const targets = pipTargets(scene, mode)
    const shown: { b: Billboard; at: EdgePlace; size: number }[] = []
    for (const b of targets) {
      const cam = proj.toCamera(b.x, b.y, b.height / 2)
      const at = edgePlace(cam, proj)
      // the pip is the sprite at the size the frame would have drawn it, so the ring round the view reads as depth
      if (at) shown.push({ b, at, size: pipSizeInView(cam, proj, b.height, maxPx) })
    }
    const avoid: PxRect[] = []
    // the panes a pip steps round: the stats pane, the action panel in the strip beside it, the prompt stack, and the
    // sidebar's panes (skipped with the column)
    for (const el of [this.stats, this.actionPanel, this.actionbar, this.statuses, this.minimapCanvas, this.monsters]) {
      if (el.hidden || (this.sidebar.hidden && el.parentElement === this.sidebar)) continue
      const r = el.getBoundingClientRect()
      const host = this.root.getBoundingClientRect()
      if (r.width && r.height) avoid.push({ left: r.left - host.left, top: r.top - host.top, width: r.width, height: r.height })
    }
    const placed = placePips(
      shown.map((s) => s.at),
      rect,
      shown.map((s) => s.size),
      avoid,
    )
    const keep = new Set<string>()
    shown.forEach(({ b }, i) => {
      const key = b.x + ',' + b.y
      keep.add(key)
      let pn = this.pipNodes.get(key)
      if (!pn) {
        const canvas = h('canvas', { class: 'picture' })
        const node = h('div', { class: 'pip' }, canvas)
        const r2d = new Render2d({ mode: 'tiles', cellSize: w })
        r2d.mount(canvas)
        pn = { node, canvas, r2d, drawn: '' }
        this.pipNodes.set(key, pn)
        this.pips.append(node)
      }
      const p = placed[i]
      pn.node.title = b.name || ''
      pn.node.style.left = p.x + 'px'
      pn.node.style.top = p.y + 'px'
      pn.node.style.setProperty('--pip', p.size + 'px')
      pn.node.onclick = () => this.hooks.onSelectMonster(b)
      // the sprite: redrawn only when the cell or the rc's look changed
      const drawn = JSON.stringify([scene.revision, dmode, w, o.glyph_mode_font, o.tile_filter_scaling, gd?.version])
      if (drawn !== pn.drawn) {
        pn.drawn = drawn
        const dpr = window.devicePixelRatio || 1
        if (pn.canvas.width !== Math.floor(w * dpr)) {
          pn.r2d.resize(w, w, dpr)
          pn.canvas.style.width = w + 'px'
          pn.canvas.style.height = w + 'px'
        }
        pn.r2d.setOptions({ cellSize: w, mode: dmode, filterScaling: o.tile_filter_scaling === true, glyphFont: typeof o.glyph_mode_font === 'string' && o.glyph_mode_font ? o.glyph_mode_font : 'monospace' })
        if (gd) pn.r2d.setTiles(gd)
        pn.r2d.setScene(scene)
        pn.r2d.clear(true)
        pn.r2d.renderCell(b.x, b.y, 0, 0, w, { bare: true })
      }
    })
    for (const [key, pn] of this.pipNodes) {
      if (keep.has(key)) continue
      pn.node.remove()
      this.pipNodes.delete(key)
    }
  }

  private sizeRow(row: MonsterRow, w: number, sprites: number) {
    const dpr = window.devicePixelRatio || 1
    const width = w * Math.max(1, sprites)
    if (row.canvas.width !== Math.floor(width * dpr) || row.canvas.height !== Math.floor(w * dpr)) {
      row.r2d.resize(width, w, dpr)
      row.canvas.style.width = width + 'px'
      row.canvas.style.height = w + 'px'
    }
  }

  /**
   * The WebTiles 2D view in miniature: the same tile renderer as the main 2D
   * mode, following the player. Falls back to solid colour blocks until the
   * gamedata tileset is ready.
   */
  private renderMinimap(scene: Scene, cam: Camera, state: GameState, gd: Gamedata | null) {
    if (this.minimapHidden || !this.minimapSize.w) return
    // the map is a full redraw of every known cell: only when something it shows moved.
    // The rc's palette rides `rev.player` (state.ts: `options` and `set_option` bump it).
    const key = `${scene.revision}|${cam.x},${cam.y},${cam.yaw}|${state.rev.player}|${gd?.version}`
    if (key === this.minimapKey) return
    this.minimapKey = key
    const opts = state.options
    const c = (name: string) => {
      const v = opts[name] as { r: number; g: number; b: number } | undefined
      return v ? `rgb(${v.r},${v.g},${v.b})` : undefined
    }
    if (gd && gd !== this.minimapTiles) {
      this.minimapTiles = gd
      this.minimap.setTiles(gd)
    }
    const mode = opts.tile_display_mode === 'glyphs' ? 'glyphs' : opts.tile_display_mode === 'hybrid' ? 'hybrid' : 'tiles'
    // minimap.js init_options: one colour per map_feature, in map-feature.h order
    const mfColours = MF_OPTION_NAMES.map((n) => c(n))
    this.minimap.setOptions({
      mode,
      mfColours,
      filterScaling: opts.tile_filter_scaling === true,
      glyphFont: typeof opts.glyph_mode_font === 'string' && opts.glyph_mode_font ? opts.glyph_mode_font : 'monospace',
      minimapColours: {
        floor: c('tile_floor_col'),
        wall: c('tile_wall_col'),
        remembered: c('tile_mapped_floor_col'),
        door: c('tile_door_col'),
        item: c('tile_item_col'),
        monster: c('tile_monster_col'),
        friendly: c('tile_monster_col'),
        player: c('tile_player_col'),
        water: c('tile_water_col'),
        lava: c('tile_lava_col'),
        up: c('tile_upstairs_col'),
        down: c('tile_downstairs_col'),
        portal: c('tile_portal_col'),
        feature: c('tile_feature_col'),
        excluded: c('tile_excluded_col'),
        mappedWall: c('tile_mapped_wall_col'),
        branchStairs: c('tile_branchstairs_col'),
        trap: c('tile_trap_col'),
        transporter: c('tile_transporter_col'),
      },
    })
    this.minimap.setScene(scene)
    this.minimap.setCamera(cam)
    this.minimap.render()
  }

  /** Where the minimap sits on screen: the start (and end) of the level-map morph. */
  minimapRect(): Rect {
    return this.minimapCanvas.getBoundingClientRect()
  }

  /**
   * Level map opening: the minimap swells out over `view` and dissolves as
   * the fullscreen map (moving along the same path) takes over. Once gone it
   * stays hidden until `collapseMinimap`.
   */
  expandMinimap(view: Rect): Promise<void> {
    const el = this.minimapCanvas
    const from = this.minimapRect()
    this.minimapHidden = true
    el.classList.add('morphing')
    const reduced = reducedMotion()
    const t = reduced ? MORPH.reduced : MORPH.enter
    const frames: Keyframe[] = reduced
      ? [{ opacity: 1 }, { opacity: 0 }]
      : [
          { transform: 'none', opacity: 1 },
          { opacity: 0.85, offset: 0.25 },
          { opacity: 0, offset: 0.6 },
          { transform: coverTransform(from, view), opacity: 0 },
        ]
    const p = (this.minimapMorph = animate(el, frames, { duration: t.duration, easing: t.easing, fill: 'forwards' }).then(() => {
      if (this.minimapMorph !== p) return
      this.minimapMorph = null
      el.classList.remove('morphing')
      el.classList.add('hidden')
      for (const a of el.getAnimations?.() ?? []) a.cancel()
    }))
    return p
  }

  /**
   * Level map closing: the minimap arrives back in its corner, converging
   * with the shrinking map, and the live minimap picks up underneath.
   */
  collapseMinimap(view: Rect): Promise<void> {
    const el = this.minimapCanvas
    for (const a of el.getAnimations?.() ?? []) a.cancel()
    el.classList.remove('hidden')
    el.classList.add('morphing')
    this.minimapHidden = false
    this.minimapKey = ''
    const from = this.minimapRect()
    const reduced = reducedMotion()
    const t = reduced ? MORPH.reduced : MORPH.exit
    const frames: Keyframe[] = reduced
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [
          { transform: coverTransform(from, view), opacity: 0 },
          { opacity: 0.9, offset: 0.55 },
          { transform: 'none', opacity: 1 },
        ]
    const p = (this.minimapMorph = animate(el, frames, { duration: t.duration, easing: t.easing }).then(() => {
      if (this.minimapMorph !== p) return
      this.minimapMorph = null
      el.classList.remove('morphing')
    }))
    return p
  }

  /**
   * The message pane as rows (grid/messages.ts): the last lines of the log
   * that fit the pane's rows, wrapped to its width, the turn and command
   * markers in front as messages.js prints them, the text cursor on the last
   * line while the game reads there, and the `--more--` row under them.
   *
   * A `--more--` is a hard stop, and the pane says so where it stands: it
   * keeps its cells along the bottom and takes a black backing and a ring
   * until the more is acknowledged (styles.css `.messages.more`), as
   * `#message_pane` goes black in WebTiles. Nothing moves to the middle of
   * the view, so the player's eye stays on the log it was already reading.
   * The way out is on the action bar (Continue on A, or Space), and for the
   * player a click on the pane sends space (`.dismissable`). A spectator
   * cannot dismiss it, so its pane takes no click.
   */
  private renderMessages(state: GameState, spectating: boolean) {
    if (!this.cells) return
    const area = this.cells.messages
    const pane = paneRows(state.messages, area.h - 1, area.w, this.logOffset)
    this.logOffset = pane.offset
    replace(this.messages, ...pane.lines.map((r) => paintRow(r)), paintRow(pane.more, 'line more'))
    this.messages.classList.toggle('attention', state.messages.more || state.messages.textCursor)
    this.messages.classList.toggle('more', state.messages.more)
    this.messages.classList.toggle('dismissable', state.messages.more && !spectating)
  }

  /** The bar's prompt chips by button, so a hold can light one without a rebuild (showHold). */
  private barChips = new Map<string, HTMLElement>()

  /**
   * The contextual prompts, stacked in the bottom-right corner of the view.
   * They show only what the situation created (bindings.ts `promptLabels`):
   * Attack with a hostile ahead, Descend on the stairs, the pile's own name
   * where one lies underfoot, a prompt's own answers; the standing bindings
   * stay on the controls sheet. The stack grows upward from a fixed anchor:
   * the interact prompt (A) is always the lowest line, so it never jumps
   * when an attack prompt appears above it, and the pad's lessons
   * (gamepad-hints.ts) stack above the contextual ones. Labels sit left of
   * their glyphs so the glyphs line up in one column at the edge. Drawn only
   * while the pad spoke last: the keyboard and the mouse get no prompts (a
   * keyboard player knows the keys; a click acts on the cell itself). A chip
   * whose label did not change keeps its node, and prompts appear in place,
   * still: Attack comes and goes with every hostile, and a slide on each
   * would keep the corner moving under the player's eye. A spectator never
   * sees any of it.
   */
  private renderBar(ctx: Context, padKind: PadKind, spectating: boolean, device: InputDevice, hints: boolean, padLabels?: BindingLabel[]) {
    const labels = device === 'pad' && !spectating ? (padLabels ?? (hints ? promptLabels(ctx) : [])) : []
    const key = device + '|' + ctx.mode + '|' + ctx.layer + '|' + labels.map((l) => l.button + ':' + l.label + '/' + (l.hold || '') + !!l.teaching).join(',') + padKind
    if (this.actionbar.dataset.v === key) return
    this.actionbar.dataset.v = key
    this.actionbar.hidden = labels.length === 0
    this.actionbar.classList.add('contextual')
    const keep = new Map(this.barChips)
    this.barChips.clear()
    clear(this.actionbar)
    let group: HTMLElement | null = null
    let groupName = ''
    for (const l of labels) {
      const g = buttonGroup(l.button)
      if (g !== groupName || !group) {
        groupName = g
        group = this.group(g)
        this.actionbar.append(group)
      }
      const k = l.button + ':' + l.label + '/' + (l.hold || '') + !!l.teaching + padKind
      const kept = keep.get(l.button)
      const chip = kept && kept.dataset.k === k ? kept : this.chip(l, k, padKind)
      group.append(chip)
      this.barChips.set(l.button, chip)
    }
  }

  /** One prompt: the button's glyph, the label, and the hold's label under it when there is one. Inert to a press: the view answers, not the prompt. */
  private chip(l: BindingLabel, key: string, padKind: PadKind): HTMLElement {
    const chip = h(
      'span',
      { class: 'chip ' + l.button + (l.hold ? ' has-hold' : '') + (l.teaching ? ' teaching' : ''), title: glyphName(l.button, padKind) + (l.hold ? ': ' + formattedStringToText(l.label) + ', hold for ' + formattedStringToText(l.hold) : ''), onclick: l.teaching ? undefined : () => this.hooks.onBarAction(l.action) },
      h('span', { class: 'key' }, glyph(l.button, padKind)),
      h('span', { class: 'text' }, label(l.label), l.hold ? h('span', { class: 'hold' }, glyph('HOLD', padKind), h('span', { html: formattedStringToHtml(l.hold) })) : null),
    )
    chip.dataset.k = key
    return chip
  }

  private group(name: string, ...chips: (HTMLElement | null)[]): HTMLElement {
    return h('span', { class: 'group ' + name }, ...chips)
  }

  yawFor(d: Dir8): number {
    return dirToYaw(d)
  }
}


/**
 * A prompt's label as one more line of the HUD: a crawl formatted string,
 * drawn with the message pane's colours (format.ts `formattedStringToHtml`,
 * styles.css `.fg10`), so "a staff of alchemy" underfoot is the green the log
 * gave it. A label with no tags is its own plain text.
 */
function label(text: string): HTMLElement {
  return h('span', { class: 'label', html: formattedStringToHtml(text) })
}

/**
 * minimap.js `init_options`: the rc colour option for each `map_feature`
 * index, in map-feature.h order (MF_UNSEEN first).
 */
const MF_OPTION_NAMES = [
  'tile_unseen_col',
  'tile_floor_col',
  'tile_wall_col',
  'tile_mapped_floor_col',
  'tile_mapped_wall_col',
  'tile_door_col',
  'tile_item_col',
  'tile_monster_col', // MF_MONS_FRIENDLY
  'tile_monster_col', // MF_MONS_PEACEFUL
  'tile_monster_col', // MF_MONS_NEUTRAL
  'tile_monster_col', // MF_MONS_HOSTILE
  'tile_plant_col', // MF_MONS_NO_EXP
  'tile_upstairs_col',
  'tile_downstairs_col',
  'tile_branchstairs_col',
  'tile_feature_col',
  'tile_water_col',
  'tile_lava_col',
  'tile_trap_col',
  'tile_excl_centre_col',
  'tile_excluded_col',
  'tile_player_col',
  'tile_deep_water_col',
  'tile_portal_col',
  'tile_transporter_col',
  'tile_transporter_landing_col',
  'tile_explore_horizon_col',
]

/** The 16 terminal colours, for glyph-mode items on the action panel. */
const TERM16 = ['#000000', '#0000aa', '#00aa00', '#00aaaa', '#aa0000', '#aa00aa', '#aa5500', '#aaaaaa', '#555555', '#5555ff', '#55ff55', '#55ffff', '#ff5555', '#ff55ff', '#ffff55', '#ffffff']

