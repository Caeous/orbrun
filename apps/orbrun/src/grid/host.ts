/**
 * The grid on the screen.
 *
 * One element hosts the console grid: it measures a cell of the grid font at
 * the wanted size, fits as many whole cells as the host holds (`fitGrid`),
 * and publishes the cell as css variables on the host (`--cw`, `--ch`,
 * `--fs`, and `--gx`, `--gy` for where the first cell sits), as backdrop.ts
 * does for the front end's floors. Everything set on the grid is then a
 * rectangle of cells: `place` puts an element on one.
 *
 * The cell follows the text-size setting; when the host is too small for the
 * console's least window at that size, the size comes down until it fits,
 * so a layout never has to cope with fewer than `MIN_COLS` × `MIN_ROWS`.
 * On a phone (`setLeast`) it comes down further, to `PHONE_COLS` ×
 * `PHONE_ROWS`: the size a desktop reads at leaves a phone a cramped
 * console.
 */
import { MIN_COLS, MIN_ROWS, fitGrid, type CellRect, type Grid } from './console'

/** the cell's height as a multiple of the font size: a console cell is about twice as tall as it is wide */
const LINE_HEIGHT = 1.2
/** the smallest font the grid falls back to, in px */
const MIN_PX = 8
/**
 * on a phone held upright, the grid is wide enough for the stats strip across the top (stats.ts `stripRows`): the
 * portrait, bars long enough to read beside it, and the stats three to a row
 */
export const PHONE_COLS = 58
/** on a phone on its side, tall enough for the stats pane, a few messages and the dungeon between them, over the touch bar */
export const PHONE_ROWS = 28

/** A phone: a finger for a pointer, on a screen no more than `PHONE_SIDE` css px across its short side (not a tablet, nor a Steam Deck). */
const PHONE_SIDE = 600
export function isPhone(): boolean {
  if (!(window.matchMedia?.('(pointer: coarse)').matches ?? false)) return false
  return Math.min(window.screen?.width || Infinity, window.screen?.height || Infinity) < PHONE_SIDE
}

/**
 * The font px for a `w`×`h` host whose characters advance `adv` of the
 * size: `px`, or less until the grid holds `cols` × `rows` cells.
 */
export function fitPx(w: number, h: number, adv: number, px: number, cols = MIN_COLS, rows = MIN_ROWS): number {
  while (px > MIN_PX && (Math.floor(w / (px * adv)) < cols || Math.floor(h / Math.round(px * LINE_HEIGHT)) < rows)) px--
  return px
}

export class GridHost {
  grid: Grid
  /** called after the grid was fitted again (the host changed size, the text size changed) */
  onfit: (() => void) | null = null
  private host: HTMLElement
  private ro: ResizeObserver | null = null
  private fontPx = 16
  /** the font px the grid was fitted at: `fontPx`, or less where the host is too small for it */
  private fittedPx = 16
  /** the grid is a phone's (`setLeast`): what a phone has no room for stays off it */
  phone = false
  /** the least grid the size comes down to (`setLeast`) */
  private least = { cols: MIN_COLS, rows: MIN_ROWS }
  /** the width of one character of the grid font at 100px, measured once per font */
  private advance = 0

  constructor(host: HTMLElement, px = 16) {
    this.host = host
    this.fontPx = px
    this.fittedPx = px
    this.grid = fitGrid(host.clientWidth || 1280, host.clientHeight || 800, px * 0.6, Math.round(px * LINE_HEIGHT))
    this.fit = this.fit.bind(this)
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(this.fit)
      this.ro.observe(host)
    }
    // the grid face is a web font (styles.css): measured before it landed, the cells were cut to the fallback's advance
    this.refont = this.refont.bind(this)
    document.fonts?.addEventListener('loadingdone', this.refont)
    // a finger for a pointer is half of what makes a phone (`isPhone`), and can change with no resize: a device toolbar's
    // mobile/desktop switch
    this.coarse = window.matchMedia?.('(pointer: coarse)') ?? null
    this.coarse?.addEventListener?.('change', this.fit)
  }
  private coarse: MediaQueryList | null

  destroy() {
    this.ro?.disconnect()
    document.fonts?.removeEventListener('loadingdone', this.refont)
    this.coarse?.removeEventListener?.('change', this.fit)
  }

  /** the text size: the font's px at which a cell is measured */
  setTextSize(px: number) {
    if (px === this.fontPx) return
    this.fontPx = px
    this.fit()
  }

  /** how far the text came down from the text size to fit (1: not at all) */
  get shrink(): number {
    return this.fittedPx / this.fontPx
  }

  /**
   * A phone: the text comes down until the grid holds `PHONE_COLS` ×
   * `PHONE_ROWS`; otherwise only to `MIN_COLS` × `MIN_ROWS`. Given a test
   * (`isPhone`), it is asked again at every fit: the screen can become a
   * phone's under a running game, as a browser's device toolbar makes it.
   */
  setLeast(phone: boolean | (() => boolean)) {
    this.phoneTest = typeof phone === 'function' ? phone : () => phone
    this.fit()
  }
  private phoneTest: () => boolean = () => false

  /** the least grid for what the screen is now (`setLeast`); true when it changed */
  private takeLeast(): boolean {
    this.phone = this.phoneTest()
    const least = this.phone ? { cols: PHONE_COLS, rows: PHONE_ROWS } : { cols: MIN_COLS, rows: MIN_ROWS }
    if (least.cols === this.least.cols && least.rows === this.least.rows) return false
    this.least = least
    return true
  }

  /** Measure the grid font: the advance of one character, at 100px, in the host's own font. */
  private measure(): number {
    if (this.advance) return this.advance
    const probe = document.createElement('span')
    probe.className = 'grid-probe'
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font-size:100px;line-height:1'
    probe.textContent = 'M'.repeat(50)
    this.host.append(probe)
    const w = probe.getBoundingClientRect().width / 50
    probe.remove()
    // no layout yet (a detached host, a test): a typical monospace advance
    this.advance = w > 0 ? w : 60.2
    return this.advance
  }

  /** the font was changed (the rc's family arrived, a web font landed): measure again */
  refont() {
    this.advance = 0
    this.fit()
  }

  fit() {
    const w = this.host.clientWidth || window.innerWidth
    const hgt = this.host.clientHeight || window.innerHeight
    const adv = this.measure() / 100
    // a phone's least window or a desktop's, for the screen as it is now
    const leastChanged = this.takeLeast()
    // too small for the least window at this size: the text comes down until it fits
    const px = fitPx(w, hgt, adv, this.fontPx, this.least.cols, this.least.rows)
    const cw = px * adv
    const ch = Math.round(px * LINE_HEIGHT)
    this.fittedPx = px
    const g = fitGrid(w, hgt, cw, ch)
    const same = g.cols === this.grid.cols && g.rows === this.grid.rows && g.cw === this.grid.cw && g.ch === this.grid.ch && g.ox === this.grid.ox && g.oy === this.grid.oy
    this.grid = g
    const st = this.host.style
    st.setProperty('--cw', cw.toFixed(3) + 'px')
    st.setProperty('--ch', ch + 'px')
    st.setProperty('--fs', px + 'px')
    st.setProperty('--gx', g.ox + 'px')
    st.setProperty('--gy', g.oy + 'px')
    if (!same || leastChanged) this.onfit?.()
  }

  /** a rectangle of cells in css px, relative to the host */
  px(r: CellRect): { left: number; top: number; width: number; height: number } {
    const { cw, ch, ox, oy } = this.grid
    return { left: ox + r.x * cw, top: oy + r.y * ch, width: r.w * cw, height: r.h * ch }
  }

  /** set `el` on the cells of `r` (absolute, within the host) */
  place(el: HTMLElement, r: CellRect) {
    const p = this.px(r)
    el.style.left = p.left.toFixed(2) + 'px'
    el.style.top = p.top.toFixed(2) + 'px'
    el.style.width = p.width.toFixed(2) + 'px'
    el.style.height = p.height.toFixed(2) + 'px'
  }
}
