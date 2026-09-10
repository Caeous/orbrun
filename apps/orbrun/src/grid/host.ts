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
 */
import { MIN_COLS, MIN_ROWS, fitGrid, type CellRect, type Grid } from './console'

/** the cell's height as a multiple of the font size: a console cell is about twice as tall as it is wide */
const LINE_HEIGHT = 1.2
/** the smallest font the grid falls back to, in px */
const MIN_PX = 8

export class GridHost {
  grid: Grid
  /** called after the grid was fitted again (the host changed size, the text size changed) */
  onfit: (() => void) | null = null
  private host: HTMLElement
  private ro: ResizeObserver | null = null
  private fontPx = 16
  /** the width of one character of the grid font at 100px, measured once per font */
  private advance = 0

  constructor(host: HTMLElement, px = 16) {
    this.host = host
    this.fontPx = px
    this.grid = fitGrid(host.clientWidth || 1280, host.clientHeight || 800, px * 0.6, Math.round(px * LINE_HEIGHT))
    this.fit = this.fit.bind(this)
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(this.fit)
      this.ro.observe(host)
    }
  }

  destroy() {
    this.ro?.disconnect()
  }

  /** the text size: the font's px at which a cell is measured */
  setTextSize(px: number) {
    if (px === this.fontPx) return
    this.fontPx = px
    this.fit()
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

  /** the font was changed (the rc's family arrived): measure again */
  refont() {
    this.advance = 0
    this.fit()
  }

  fit() {
    const w = this.host.clientWidth || window.innerWidth
    const hgt = this.host.clientHeight || window.innerHeight
    const adv = this.measure() / 100
    let px = this.fontPx
    // too small for the console's least window at this size: the text comes down until it fits
    while (px > MIN_PX && (Math.floor(w / (px * adv)) < MIN_COLS || Math.floor(hgt / Math.round(px * LINE_HEIGHT)) < MIN_ROWS)) px--
    const cw = px * adv
    const ch = Math.round(px * LINE_HEIGHT)
    const g = fitGrid(w, hgt, cw, ch)
    const same = g.cols === this.grid.cols && g.rows === this.grid.rows && g.cw === this.grid.cw && g.ch === this.grid.ch && g.ox === this.grid.ox && g.oy === this.grid.oy
    this.grid = g
    const st = this.host.style
    st.setProperty('--cw', cw.toFixed(3) + 'px')
    st.setProperty('--ch', ch + 'px')
    st.setProperty('--fs', px + 'px')
    st.setProperty('--gx', g.ox + 'px')
    st.setProperty('--gy', g.oy + 'px')
    if (!same) this.onfit?.()
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
