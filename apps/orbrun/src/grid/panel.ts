/**
 * Where the consumables action panel (action_panel.js) stands and how its
 * cells are laid out.
 *
 * The official client floats the panel over the top-left corner of
 * `#dungeon`, where Orbrun's stats pane already is. Orbrun stands it in the
 * strip along the top of the view between the stats pane and the minimap:
 * the one place at the top of the screen no pane holds, so the panel reads
 * as part of the same row of HUD furniture and the view under it stays
 * clear. Nothing here touches the DOM; the HUD (hud.ts `renderActionPanel`)
 * draws what this places, so the arithmetic can be pinned by tests.
 */

export interface PanelBox {
  left: number
  top: number
  width: number
  height: number
}

/**
 * The panel wraps rather than truncating at one line (action_panel.js has
 * the whole dungeon width to run along; the strip between the panes is
 * narrower, and a stocked character carries more consumables than fit
 * across it). It never takes more than this many lines, so the panel stays
 * a strip and the view keeps its top.
 */
export const PANEL_MAX_LINES = 4
/** the least the strip may be for the panel to stand in it at all: one cell plus the gutters */
const PANEL_MIN_CELLS = 2

/**
 * The strip the panel stands in, in css px: along the top of the free view,
 * from the stats pane's right edge to the minimap's left edge, a `gutter`
 * clear of both. `statsRight` is null when the stats pane has stepped aside
 * (the level map, the new-game chooser) and `minimapLeft` is null when the
 * sidebar has; then the strip runs to the free view's own edge. A strip
 * narrower than `PANEL_MIN_CELLS` cells is no strip: the panel has nowhere
 * to stand and gets zero width, which folds it away.
 */
export function panelSpan(
  free: PanelBox,
  statsRight: number | null,
  minimapLeft: number | null,
  gutter: number,
  cell: number,
): PanelBox {
  const left = Math.max(free.left, statsRight === null ? free.left : statsRight + gutter)
  const right = Math.min(free.left + free.width, minimapLeft === null ? free.left + free.width : minimapLeft - gutter)
  const width = right - left
  if (width < PANEL_MIN_CELLS * cell) return { left, top: free.top, width: 0, height: 0 }
  return { left, top: free.top, width, height: Math.max(0, free.height) }
}

export interface PanelGrid {
  /** cells across and down the panel */
  cols: number
  rows: number
  /** how many of the items are drawn; the rest are behind the ellipsis */
  shown: number
  /** action_panel.js: the run did not fit, so the ellipsis icon goes at the far end */
  overflow: boolean
}

/**
 * How `count` cells lie in a strip `span` px wide and tall, at `cell` px a
 * cell. Horizontal, the panel fills a line across and wraps onto the next
 * (`PANEL_MAX_LINES` of them at most, fewer when the strip is short);
 * vertical, it fills a column down and wraps onto the next column. What
 * still does not fit is behind the ellipsis, as action_panel.js draws it
 * when its one line overflows.
 */
export function panelGrid(count: number, cell: number, span: { width: number; height: number }, horizontal: boolean): PanelGrid {
  const across = Math.max(1, Math.floor(span.width / cell))
  const down = Math.max(1, Math.floor(span.height / cell))
  const n = Math.max(0, count)
  let cols: number
  let rows: number
  if (horizontal) {
    cols = Math.min(across, Math.max(1, n))
    rows = Math.min(Math.min(down, PANEL_MAX_LINES), Math.max(1, Math.ceil(n / cols)))
  } else {
    rows = Math.min(down, Math.max(1, n))
    cols = Math.min(Math.min(across, PANEL_MAX_LINES), Math.max(1, Math.ceil(n / rows)))
  }
  const shown = Math.min(n, cols * rows)
  return { cols, rows, shown, overflow: n > shown }
}

/** The top-left corner of cell `i`, in panel px: horizontal fills a line at a time, vertical a column at a time. */
export function panelCellAt(i: number, grid: PanelGrid, cell: number, horizontal: boolean): { x: number; y: number } {
  const col = horizontal ? i % grid.cols : Math.floor(i / grid.rows)
  const row = horizontal ? Math.floor(i / grid.cols) : i % grid.rows
  return { x: col * cell, y: row * cell }
}

/** Which cell of the panel a point `x`, `y` px from its top-left corner is in, or -1 when it is past the last one. */
export function panelCellIndex(x: number, y: number, grid: PanelGrid, cell: number, horizontal: boolean): number {
  if (x < 0 || y < 0 || cell <= 0) return -1
  const col = Math.floor(x / cell)
  const row = Math.floor(y / cell)
  if (col >= grid.cols || row >= grid.rows) return -1
  const i = horizontal ? row * grid.cols + col : col * grid.rows + row
  return i < grid.shown ? i : -1
}
