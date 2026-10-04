/**
 * The one console grid.
 *
 * The screen is a grid of console cells sized from the resolution and the
 * text size. In a game the dungeon view fills the whole grid and the panes
 * lie over it, each on its own cells, sized as the official client sizes
 * them (game.js `layout`): the stats pane at the top-left corner, a column
 * of `enums.stat_width` character cells on the right holding the minimap
 * and the monster list, a message pane of as many lines as the server's
 * `layout` message asks for along the bottom. Nothing here touches the DOM:
 * measuring a cell is the caller's job, everything else is arithmetic on
 * cells.
 */

/** the grid: how many cells, how big each is, and where the top-left cell sits, in css px */
export interface Grid {
  cols: number
  rows: number
  cw: number
  ch: number
  ox: number
  oy: number
  /** the grid is a phone's (host.ts `setLeast`): only a phone's stacks its panes when held upright (`isPortrait`) */
  phone?: boolean
}

/** a rectangle of cells: `x`, `y` are the top-left cell, `w`, `h` the size in cells */
export interface CellRect {
  x: number
  y: number
  w: number
  h: number
}

/** game.js `stat_width` / `enums.stat_width`: the sidebar is this many character cells wide */
export const STAT_WIDTH = 42
/**
 * The least the dungeon view keeps, in cells, on a screen too narrow for a
 * full sidebar beside it. The official client never meets one (it is a
 * desktop client); this is Orbrun's own floor, so a phone in portrait still
 * shows the dungeon. `show_diameter` in game.js is 17 cells: the view is
 * meant to show that many at once.
 */
const MIN_VIEW_COLS = 34

/** the console's smallest window, so a layout never has to cope with nothing */
export const MIN_COLS = 40
export const MIN_ROWS = 16

/**
 * Fit a grid of `cw`×`ch` px cells into `width`×`height` px: as many whole
 * cells as fit, centred by whole pixels so what stands on the grid lands on
 * its cells exactly (backdrop.ts does the same for the front-end floors).
 */
export function fitGrid(width: number, height: number, cw: number, ch: number): Grid {
  const cols = Math.max(MIN_COLS, Math.floor(width / cw))
  const rows = Math.max(MIN_ROWS, Math.floor(height / ch))
  return { cols, rows, cw, ch, ox: Math.floor((width - cols * cw) / 2), oy: Math.floor((height - rows * ch) / 2) }
}


/** the game screen's regions, all in cells of the one grid; the panes lie over the view */
export interface GameLayout {
  /** the dungeon view: the whole grid, the panes over it */
  view: CellRect
  /**
   * The part of the view no pane lies over: left of the sidebar column,
   * above the messages. What rides the view's edges (the action panel, the
   * action bar) rides this rectangle's, and the level map is
   * confined to it as game.js confines the map to the view.
   */
  clear: CellRect
  /**
   * The message pane along the bottom, under the clear rectangle: `msgRows`
   * rows of messages and one more row for the `--more--` line, as game.js
   * `layout` sizes it (`msg_height + 1` lines, the messages container
   * capped at `msg_height` of them, `#more` on the last).
   */
  messages: CellRect
  /** the right column: the minimap at its top, the monster list under it, the chat at its foot */
  sidebar: CellRect
  /** the stats pane: the view's top-left corner, as wide as the sidebar, as many rows as the pane prints */
  stats: CellRect
}

/** the stats pane prints this many rows before its status lights wrap (game.html #stats: title, god, hp, mp, 5 rows of two columns, weapon, quiver, status) */
const STATS_ROWS = 13

/**
 * A phone's grid too narrow for even a compact sidebar beside the view's
 * least width, and taller than it is wide: a phone held upright. The panes
 * then stack instead of standing side by side (`gameSplit`). A desktop
 * window of that shape keeps its panes side by side, compact, as it always
 * did: the stack is laid out for a phone's least grid (host.ts PHONE_COLS),
 * and cuts its numbers off on a narrower one.
 */
const PORTRAIT_SIDE = 36
/**
 * In portrait, the stats pane is a strip across the top this many rows tall
 * (stats.ts `stripRows`): four beside the portrait, the row under it, and a
 * row of status lights. The minimap stands under it, so it has the whole
 * screen across rather than what a pane beside it leaves.
 */
export const STRIP_ROWS = 6
/** in portrait, the minimap's column when no width is given for it (hud.ts `portraitMapCols` gives one) */
export const PORTRAIT_MAP_COLS = 34

export function isPortrait(grid: Grid): boolean {
  return !!grid.phone && grid.cols - MIN_VIEW_COLS < PORTRAIT_SIDE && grid.rows * grid.ch > grid.cols * grid.cw
}

/** the least column, in cells, the touch bar stands in beside the view (`touchBeside`): four buttons a finger can hit */
const TOUCH_SIDE_COLS = 20
/**
 * The least the right column takes, in css px, with the touch bar standing
 * at its foot (`touchColumn`): five buttons of 64px and the gaps between
 * them, so a word as long as "Character" fits a button at a phone's text
 * size. The sidebar's own 42 cells come out at under 300px on a phone on its
 * side, and cut the words to "Charac".
 */
export const TOUCH_SIDE_PX = 5 * 64 + 4 * 6 + 8

/** The right column's width in cells, with the touch bar at its foot: the sidebar's, or wider to TOUCH_SIDE_PX. */
export function touchColumn(grid: Grid): number {
  return Math.max(STAT_WIDTH, Math.ceil(TOUCH_SIDE_PX / grid.cw))
}

/**
 * On its side, the touch bar stands in the right column, under the minimap,
 * where the right thumb rests, and the view keeps its whole height: a
 * phone's landscape screen is short already. Upright, or with no column
 * wide enough for it, it runs along the foot.
 */
export function touchBeside(grid: Grid): boolean {
  return !isPortrait(grid) && grid.cols - MIN_VIEW_COLS >= TOUCH_SIDE_COLS
}

/**
 * Lay the panes over the grid, each sized as game.js `layout` sizes it: the
 * view is the whole grid; the stats pane takes `statWidth` columns at the
 * top-left corner; the sidebar (minimap, monster list) takes `statWidth`
 * columns on the right; the message pane takes `msgRows` rows of messages
 * and the `--more--` row along the bottom, left of the sidebar; `clear` is
 * what none of the sidebar and the messages covers. On a grid too narrow
 * for a column beside `MIN_VIEW_COLS` of clear view, the column (and the
 * stats pane with it) gives way down to nothing.
 *
 * Orbrun's own, for a phone: `foot` rows along the bottom are the touch
 * bar's (hud.ts renderTouchBar). The view runs on under them, the buttons
 * standing over the dungeon rather than on black, but every pane stands
 * above them, so no button covers a line of text. Held
 * upright (`isPortrait`), there is no room for a column beside the view, so
 * the panes stack over it instead: the stats pane as a strip across the top
 * (STRIP_ROWS), the minimap's column under it at the right, `mapCols` wide
 * (the monster list under the map), and the messages across the whole width,
 * above the foot. On
 * its side the bar stands at the column's foot instead (`touchBeside`):
 * `sideFoot` rows there are the bar's, the column ends above them, and it
 * is `columnWidth` cells wide (`touchColumn`), wider than the stats pane.
 */
export function gameSplit(grid: Grid, msgRows: number, statWidth = STAT_WIDTH, foot = 0, sideFoot = 0, columnWidth = statWidth, mapCols = PORTRAIT_MAP_COLS): GameLayout {
  const rows = Math.max(MIN_ROWS - 4, grid.rows - foot)
  const msgs = Math.max(2, Math.min(msgRows + 1, rows - 4))
  const clearH = rows - msgs
  const view = { x: 0, y: 0, w: grid.cols, h: Math.max(rows, grid.rows) }
  if (isPortrait(grid)) {
    const top = Math.min(STRIP_ROWS, clearH)
    const side = Math.max(0, Math.min(grid.cols, mapCols))
    return {
      view,
      clear: { x: 0, y: top, w: grid.cols - side, h: clearH - top },
      messages: { x: 0, y: clearH, w: grid.cols, h: msgs },
      sidebar: { x: grid.cols - side, y: top, w: side, h: clearH - top },
      stats: { x: 0, y: 0, w: grid.cols, h: top },
    }
  }
  const side = Math.max(0, Math.min(columnWidth, grid.cols - MIN_VIEW_COLS))
  const leftW = grid.cols - side
  return {
    view,
    clear: { x: 0, y: 0, w: leftW, h: clearH },
    messages: { x: 0, y: clearH, w: leftW, h: msgs },
    sidebar: { x: leftW, y: 0, w: side, h: Math.max(0, rows - sideFoot) },
    stats: { x: 0, y: 0, w: Math.min(side, statWidth), h: Math.min(STATS_ROWS, rows) },
  }
}

/**
 * The level map (`X`) as game.js `toggle_full_window_dungeon_view` lays it
 * out: the map keeps to the clear part of the view, and grows over the
 * sidebar with `tile_level_map_hide_sidebar` and over the messages with
 * `tile_level_map_hide_messages`, the panes stepping off the grid. Held
 * upright (`isPortrait`) it takes the whole width: the panes stand over the
 * view there rather than beside it, and the minimap's column, half the
 * screen, would otherwise be a black band down the map's side. Grown over
 * the messages it ends above the touch bar's rows (`gameSplit` `foot`):
 * this is the map's part no button covers, which what rides its edges keeps
 * to; the canvas itself runs on under the bar (`levelMapCanvas`).
 */
export function levelMapSplit(grid: Grid, layout: GameLayout, opts: { hideSidebar?: boolean; hideMessages?: boolean }): CellRect {
  const w = opts.hideSidebar || isPortrait(grid) ? layout.view.w : layout.clear.w
  const h = opts.hideMessages ? layout.messages.y + layout.messages.h : layout.clear.h
  return { x: 0, y: 0, w, h }
}

/**
 * Orbrun's own, for a phone: the level map's canvas runs on under the touch
 * bar as the view does, the buttons standing over the map rather than on
 * black. Where the map reaches the bar's rows along the foot it takes them
 * too; with the bar at the right column's foot (`touchBeside`), a map that
 * reaches the foot takes the column across, its minimap off while the map
 * is open. A map that stops above the messages stays as it was: they stand
 * between it and the bar.
 */
export function levelMapCanvas(layout: GameLayout, map: CellRect, beside: boolean): CellRect {
  const reachesFoot = map.h >= layout.messages.y + layout.messages.h
  if (!reachesFoot) return map
  return { x: 0, y: 0, w: beside ? layout.view.w : map.w, h: layout.view.h }
}

