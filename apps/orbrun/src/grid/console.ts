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
 * Lay the panes over the grid, each sized as game.js `layout` sizes it: the
 * view is the whole grid; the stats pane takes `statWidth` columns at the
 * top-left corner; the sidebar (minimap, monster list) takes `statWidth`
 * columns on the right; the message pane takes `msgRows` rows of messages
 * and the `--more--` row along the bottom, left of the sidebar; `clear` is
 * what none of the sidebar and the messages covers. On a grid too narrow
 * for a column beside `MIN_VIEW_COLS` of clear view, the column (and the
 * stats pane with it) gives way down to nothing.
 */
export function gameSplit(grid: Grid, msgRows: number, statWidth = STAT_WIDTH): GameLayout {
  const side = Math.max(0, Math.min(statWidth, grid.cols - MIN_VIEW_COLS))
  const leftW = grid.cols - side
  const msgs = Math.max(2, Math.min(msgRows + 1, grid.rows - 4))
  const clearH = grid.rows - msgs
  return {
    view: { x: 0, y: 0, w: grid.cols, h: grid.rows },
    clear: { x: 0, y: 0, w: leftW, h: clearH },
    messages: { x: 0, y: clearH, w: leftW, h: msgs },
    sidebar: { x: leftW, y: 0, w: side, h: grid.rows },
    stats: { x: 0, y: 0, w: side, h: Math.min(STATS_ROWS, grid.rows) },
  }
}

/**
 * The level map (`X`) as game.js `toggle_full_window_dungeon_view` lays it
 * out: the map keeps to the clear part of the view, and grows over the
 * sidebar with `tile_level_map_hide_sidebar` and over the messages with
 * `tile_level_map_hide_messages`, the panes stepping off the grid.
 */
export function levelMapSplit(grid: Grid, layout: GameLayout, opts: { hideSidebar?: boolean; hideMessages?: boolean }): CellRect {
  const w = opts.hideSidebar ? grid.cols : layout.clear.w
  const h = opts.hideMessages ? grid.rows : layout.clear.h
  return { x: 0, y: 0, w, h }
}

