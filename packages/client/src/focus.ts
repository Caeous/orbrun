/**
 * The focus layer's rules, with no page: what a cursor over a screen's items
 * can be asked to do (`FocusOp`), what the bindings see of it (`FocusInfo`),
 * and how it steps over their rows and columns (`focusStep`). The cursor
 * itself, over elements, is the app's (focus.ts `FocusNav`).
 */

export type FocusDir = 'up' | 'down' | 'left' | 'right'
export type FocusOp = 'next' | 'prev' | 'left' | 'right' | 'select' | 'altSelect' | 'cancel' | 'pageNext' | 'pagePrev' | 'first' | 'last'

/** The cursor as the bindings see it: what A and B would do, for the bar. */
export interface FocusInfo {
  /** label of the focused item, or null when nothing is focusable */
  label: string | null
  /** the focused item's colour (`Focusable.colour`), when it has one */
  colour?: number
  /** label of the cancel item when the screen has one ("No"), else null */
  cancelLabel: string | null
  /** label of the focused item's second action (Y), when it has one */
  altLabel?: string | null
  index: number
  count: number
}

/** A slot in the pure layout: what `focusStep` needs to know about an item. */
export interface FocusSlot {
  row: number
  col: number
}

/** Resolve the row / col of each item: rows default to registration order, cols to order within the row. */
export function focusSlots(items: { row?: number; col?: number }[]): FocusSlot[] {
  const out: FocusSlot[] = []
  const perRow = new Map<number, number>()
  items.forEach((it, i) => {
    const row = it.row ?? i
    const n = perRow.get(row) ?? 0
    perRow.set(row, n + 1)
    out.push({ row, col: it.col ?? n })
  })
  return out
}

/**
 * Where the cursor goes from `index` in `dir`. Up and down go to the nearest
 * row above or below, keeping the column as close as possible; left and right
 * stay on the row, unless the screen is laid out in columns (`columns`), where
 * they cross to the nearest row of the next column — the skills screen prints
 * rows the other column has no entry on, and the cursor must still leave them
 * sideways or the key falls through to the server. Returns null at an edge, so
 * the caller can wrap or hand the key to the server (a popup scrolls its text
 * on up / down).
 */
export function focusStep(slots: FocusSlot[], index: number, dir: FocusDir, opts: { columns?: boolean } = {}): number | null {
  const cur = slots[index]
  if (!cur) return slots.length ? 0 : null
  if (dir === 'left' || dir === 'right') {
    const forward = dir === 'right'
    let best = -1
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i]
      if (i === index) continue
      if (!opts.columns && s.row !== cur.row) continue
      if (forward ? s.col <= cur.col : s.col >= cur.col) continue
      if (best < 0) best = i
      else {
        const b = slots[best]
        // the nearest column that way; within it, the nearest row
        if (s.col === b.col ? Math.abs(s.row - cur.row) < Math.abs(b.row - cur.row) : forward ? s.col < b.col : s.col > b.col) best = i
      }
    }
    return best < 0 ? null : best
  }
  // the nearest row in that direction with an item in the same column (down a
  // column of the skills screen), else the nearest row at all, nearest column
  const nearestRow = (sameCol: boolean): number | null => {
    let row: number | null = null
    for (const s of slots) {
      if (sameCol && s.col !== cur.col) continue
      if (dir === 'down' ? s.row > cur.row : s.row < cur.row) {
        if (row === null || (dir === 'down' ? s.row < row : s.row > row)) row = s.row
      }
    }
    return row
  }
  const row = nearestRow(true) ?? nearestRow(false)
  if (row === null) return null
  let best = -1
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i]
    if (s.row !== row) continue
    if (best < 0 || Math.abs(s.col - cur.col) < Math.abs(slots[best].col - cur.col)) best = i
  }
  return best
}

/** Past an edge: the start of the first row going down, the end of the last row going up (with `keepColumn`, the far row's nearest column), the far end of the row (or, in `columns`, of the screen) sideways. */
export function focusWrap(slots: FocusSlot[], index: number, dir: FocusDir, opts: { columns?: boolean; keepColumn?: boolean } = {}): number | null {
  if (!slots.length) return null
  const cur = slots[index]
  if (!cur) return 0
  if (dir === 'left' || dir === 'right') {
    // the far end of the same row; in columns, the far column, nearest row
    let best = -1
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i]
      if (!opts.columns && s.row !== cur.row) continue
      if (best < 0) best = i
      else {
        const b = slots[best]
        if (s.col === b.col ? opts.columns && Math.abs(s.row - cur.row) < Math.abs(b.row - cur.row) : dir === 'right' ? s.col < b.col : s.col > b.col) best = i
      }
    }
    return best === index || (best >= 0 && slots[best].col === cur.col) ? null : best
  }
  let row: number | null = null
  for (const s of slots) if (row === null || (dir === 'down' ? s.row < row : s.row > row)) row = s.row
  if (row === null || row === cur.row) return null
  let best = -1
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i]
    if (s.row !== row) continue
    if (best < 0 || (opts.keepColumn ? Math.abs(s.col - cur.col) < Math.abs(slots[best].col - cur.col) : dir === 'down' ? s.col < slots[best].col : s.col > slots[best].col)) best = i
  }
  return best
}

/** The cursor `n` rows on, clamped: what a bumper does on a client-paged list. */
export function focusPage(slots: FocusSlot[], index: number, n: number): number | null {
  let i = index
  const step = n > 0 ? 'down' : 'up'
  for (let k = 0; k < Math.abs(n); k++) {
    const nx = focusStep(slots, i, step)
    if (nx === null) break
    i = nx
  }
  return i === index ? null : i
}
