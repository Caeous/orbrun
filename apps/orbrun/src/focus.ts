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
import { type FocusDir, type FocusInfo, type FocusOp, type FocusSlot, focusPage, focusSlots, focusStep, focusWrap } from '@orbrun/client/focus'

export interface Focusable {
  label: string
  /** the terminal colour the label wears where it came from (a prompt's word in the message log), for the action bar */
  colour?: number
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
  /** the screen brings the item into view itself (What's new glides a release to the top): the cursor does not */
  ownScroll?: boolean
}

const FOCUS_CLASS = 'focused'

export interface FocusOptions {
  /** past an edge, continue from the other end (else the caller forwards the key) */
  wrap?: boolean
  /** bumpers move the cursor by this many rows (else the caller forwards page keys) */
  pageRows?: number
  /** a single row of chips: up and down walk it too */
  linear?: boolean
  /** the screen is laid out in columns: left and right cross to the next column, not only along a row */
  columns?: boolean
  /** wrapping up or down lands in the far row's nearest column, not at its far end: up from the top of the title screen is the account, not About */
  keepColumn?: boolean
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
    if (cur?.colour !== undefined) info.colour = cur.colour
    return info
  }

  /** `initial` -1: a new screen starts with nothing lit, and the first move lights its first item. */
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
      if (idx < 0 && initial !== -1) idx = initial !== undefined && initial >= 0 && initial < items.length ? initial : 0
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
    if (nx === null && this.opts.wrap) nx = focusWrap(this.slots, this.index, dir, { ...cols, keepColumn: this.opts.keepColumn })
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
    if (cur && scroll && !cur.ownScroll) cur.el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
}

const tapped = new WeakSet<HTMLElement>()

/**
 * A finger lights a row before it chooses it: a tap on a row the cursor is
 * not on moves the cursor there, as the arrows would, and only a tap on the
 * lit row does what A does. A mouse click and a key still choose at once.
 * Whether the row was lit is read as the finger goes down, before a native
 * focus can move the cursor there. A control of its own inside the row (a
 * setting's arrows, a field) acts at once. Installed once per element.
 */
export function tapLights(el: HTMLElement, lit: () => boolean, light: () => void) {
  if (tapped.has(el)) return
  tapped.add(el)
  let lightOnly = false
  el.addEventListener('pointerdown', (ev) => {
    lightOnly = ev.pointerType === 'touch' && !lit()
  }, { capture: true, passive: true })
  el.addEventListener('click', (ev) => {
    const wanted = lightOnly
    lightOnly = false
    if (!wanted) return
    const inner = (ev.target as Element | null)?.closest?.('button, a, input, textarea, select, [role="button"]')
    if (inner && inner !== el && el.contains(inner)) return
    ev.preventDefault()
    ev.stopImmediatePropagation()
    light()
  }, { capture: true })
}
