/**
 * The focus layer: one cursor over whatever the top overlay offers, driven by
 * the d-pad or the arrow keys, with A / Enter to activate and B / Escape to
 * cancel. Every overlay renderer registers its `Focusable`s in visual order;
 * `FocusNav` owns the cursor, paints one highlight class, keeps the focused
 * element in view and exposes its label for the action bar.
 *
 * Server menus are not routed through here: their hover is the server's
 * (`menu_hover`), and `Overlays.menuOp` already keeps the two in step.
 */

export interface Focusable {
  label: string
  el: HTMLElement
  activate(): void
  /** column-like grouping: left / right move within a row, so a group is what a row spans */
  group?: string
  /** stable identity across rebuilds of the same screen (default: the label) */
  id?: string
  /** visual row; items without one are each their own row, in order */
  row?: number
  /** visual column within the row (default: order of registration in the row) */
  col?: number
  /** what B / Escape means on this screen (a "No", a "Close"); at most one */
  cancel?: boolean
  /** a second thing the item can do (a skill row's "Set target"), on Y */
  alt?: { label: string; activate(): void }
  /** the cursor arrived here by a move (not by a rebuild): the screen may follow it, as the new-game description does */
  onFocus?(): void
}

export type FocusDir = 'up' | 'down' | 'left' | 'right'
export type FocusOp = 'next' | 'prev' | 'left' | 'right' | 'select' | 'altSelect' | 'cancel' | 'pageNext' | 'pagePrev' | 'first' | 'last'

/** The cursor as the bindings see it: what A and B would do, for the bar. */
export interface FocusInfo {
  /** label of the focused item, or null when nothing is focusable */
  label: string | null
  /** label of the cancel item when the screen has one ("No"), else null */
  cancelLabel: string | null
  /** label of the focused item's second action (Y), when it has one */
  altLabel?: string | null
  index: number
  count: number
}

const FOCUS_CLASS = 'focused'

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

/** Past an edge: the start of the first row going down, the end of the last row going up, the far end of the row (or, in `columns`, of the screen) sideways. */
export function focusWrap(slots: FocusSlot[], index: number, dir: FocusDir, opts: { columns?: boolean } = {}): number | null {
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
    if (best < 0 || (dir === 'down' ? s.col < slots[best].col : s.col > slots[best].col)) best = i
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

export interface FocusOptions {
  /** past an edge, continue from the other end (else the caller forwards the key) */
  wrap?: boolean
  /** bumpers move the cursor by this many rows (else the caller forwards page keys) */
  pageRows?: number
  /** a single row of chips: up and down walk it too */
  linear?: boolean
  /** the screen is laid out in columns: left and right cross to the next column, not only along a row */
  columns?: boolean
}

/**
 * The cursor over one screen's focusables. `set` is called on every rebuild
 * of the overlay; the same `screen` key keeps the cursor on the item with the
 * same id, a new screen starts at `initial` (or the first item).
 */
export class FocusNav {
  private items: Focusable[] = []
  private slots: FocusSlot[] = []
  private index = -1
  private screen = ''
  private opts: FocusOptions = {}

  get count(): number {
    return this.items.length
  }

  get options(): FocusOptions {
    return this.opts
  }

  current(): Focusable | null {
    return this.items[this.index] ?? null
  }

  info(): FocusInfo {
    const cur = this.current()
    const cancel = this.items.find((f) => f.cancel)
    const info: FocusInfo = { label: cur ? cur.label : null, cancelLabel: cancel ? cancel.label : null, index: this.index, count: this.items.length }
    if (cur?.alt) info.altLabel = cur.alt.label
    return info
  }

  set(items: Focusable[], screen: string, opts: FocusOptions = {}, initial?: number, forceInitial = false) {
    const prev = this.current()
    const sameScreen = screen === this.screen && !!prev && !forceInitial
    this.items = items
    this.slots = focusSlots(items)
    this.screen = screen
    this.opts = opts
    let idx = -1
    if (items.length) {
      if (sameScreen) {
        const id = prev.id ?? prev.label
        idx = items.findIndex((f) => (f.id ?? f.label) === id)
      }
      if (idx < 0) idx = initial !== undefined && initial >= 0 && initial < items.length ? initial : 0
    }
    this.index = idx
    this.paint(false)
  }

  clear() {
    this.items = []
    this.slots = []
    this.index = -1
    this.screen = ''
  }

  /** Put the cursor on item `i`; returns false if there is none. */
  focus(i: number): boolean {
    if (i < 0 || i >= this.items.length) return false
    this.items[this.index]?.el.classList.remove(FOCUS_CLASS)
    this.index = i
    this.paint(true)
    this.items[i].onFocus?.()
    return true
  }

  /**
   * Move the cursor. Returns true when it moved (or wrapped); false when the
   * edge was hit without wrap, so the caller can forward the key.
   */
  move(dir: FocusDir): boolean {
    if (!this.items.length) return false
    if (this.opts.linear && (dir === 'up' || dir === 'down')) dir = dir === 'up' ? 'left' : 'right'
    const cols = { columns: this.opts.columns }
    let nx = focusStep(this.slots, this.index, dir, cols)
    if (nx === null && this.opts.wrap) nx = focusWrap(this.slots, this.index, dir, cols)
    if (nx === null) return false
    return this.focus(nx)
  }

  /** A bumper: `pageRows` rows on, when the screen pages on the client. */
  page(dir: 1 | -1): boolean {
    const n = this.opts.pageRows
    if (!n || !this.items.length) return false
    const nx = focusPage(this.slots, this.index, dir * n)
    if (nx === null) return false
    return this.focus(nx)
  }

  first(): boolean {
    return this.items.length ? this.focus(0) : false
  }

  last(): boolean {
    return this.items.length ? this.focus(this.items.length - 1) : false
  }

  /** Fire the focused item. False when there is none. */
  activate(): boolean {
    const cur = this.current()
    if (!cur) return false
    cur.activate()
    return true
  }

  /** Fire the focused item's second action, if it has one. */
  altActivate(): boolean {
    const cur = this.current()
    if (!cur?.alt) return false
    cur.alt.activate()
    return true
  }

  /** Fire the screen's cancel item if it has one. */
  cancel(): boolean {
    const c = this.items.find((f) => f.cancel)
    if (!c) return false
    c.activate()
    return true
  }

  private paint(scroll: boolean) {
    for (let i = 0; i < this.items.length; i++) this.items[i].el.classList.toggle(FOCUS_CLASS, i === this.index)
    const cur = this.current()
    if (cur && scroll) cur.el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
}
