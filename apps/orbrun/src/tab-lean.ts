/**
 * A finger swiping over a tabbed menu (swipe.ts) leans its tab strip: the
 * underline stretches a little the way the finger goes, as if pulled, more
 * the nearer the finger is to a turn, and no further once letting go would
 * turn. Let go short and it springs back; let go past and it slides to the
 * new tab and stays there until the menu turns under it (crawl's pack
 * answers a moment later, so a line that went back first would read as a
 * turn refused).
 *
 * The tabs it reads are the strip's own buttons, so it turns as the d-pad
 * does: round past the ends, over the empty pages (they are disabled).
 */

/** how far the underline stretches at most, in css px */
const STRETCH_MAX = 14

/** how long a turned line waits for the menu to turn before it gives up */
const HOLD_MS = 1000

export class TabLean {
  private line: HTMLElement | null = null
  private strip: HTMLElement | null = null
  private from: HTMLElement | null = null
  private to: HTMLElement | null = null
  private timer = 0

  constructor(private readonly root: HTMLElement) {}

  /** The finger has gone `lean` of the way toward a turn, -1 to 1 (1 toward Right, swipe.ts swipeLean). */
  lean(lean: number) {
    // a new swipe while the last one's line waits on its turn starts afresh
    if (this.line?.classList.contains('settle')) this.clear(this.line)
    if (!this.line) {
      if (!lean || !this.begin()) return
    }
    const step = Math.sign(lean)
    this.to = step ? this.neighbour(step) : null
    this.stretch(Math.abs(lean), step)
  }

  /** The finger has lifted, turning by `step` (0 for no turn). */
  end(step: -1 | 0 | 1) {
    if (!this.line) return
    const line = this.line
    line.classList.add('settle')
    const to = step ? this.neighbour(step) : null
    if (!to) {
      this.under(this.from!)
      line.addEventListener('transitionend', () => this.clear(line), { once: true })
      this.timer = window.setTimeout(() => this.clear(line), 350)
      return
    }
    this.to = to
    this.under(to)
    const from = this.from
    const strip = this.strip!
    const started = performance.now()
    // the line stays until the strip turns (or is drawn anew, as the pack's is) or the menu goes
    const watch = () => {
      if (this.line !== line) return
      if (!strip.isConnected || strip.querySelector('[role="tab"].current') !== from || performance.now() - started > HOLD_MS) this.clear(line)
      else requestAnimationFrame(watch)
    }
    requestAnimationFrame(watch)
  }

  /** The strip of the menu on top, with its page up, under a line of its own. */
  private begin(): boolean {
    const strips = this.root.querySelectorAll<HTMLElement>('.popup .pack-tabs')
    const strip = strips[strips.length - 1]
    const from = strip?.querySelector<HTMLElement>('[role="tab"].current')
    if (!strip || !from || !strip.offsetParent) return false
    this.strip = strip
    this.from = from
    this.line = document.createElement('span')
    this.line.className = 'tab-lean'
    strip.classList.add('leaning')
    strip.append(this.line)
    return true
  }

  /** The tab `step` turns to from the page up, round past the ends and over the empty ones; null when there is no other. */
  private neighbour(step: number): HTMLElement | null {
    const tabs = Array.from(this.strip!.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    const live = tabs.filter((t) => !t.disabled || t === this.from)
    const n = live.length
    const at = live.indexOf(this.from as HTMLButtonElement)
    if (n < 2 || at < 0) return null
    return live[(((at + step) % n) + n) % n]
  }

  /** The line under the page up, pulled `p` of the way to its whole stretch toward the tab it leans to; it gives less the further it goes, as a thing pulled does. */
  private stretch(p: number, step: number) {
    const a = this.from!
    const pull = this.to ? STRETCH_MAX * (1 - (1 - p) ** 2) : 0
    const left = a.offsetLeft
    const right = left + a.offsetWidth
    if (step > 0) this.span(left, right + pull)
    else this.span(left - pull, right)
  }

  /** The line under `tab` alone. */
  private under(tab: HTMLElement) {
    this.span(tab.offsetLeft, tab.offsetLeft + tab.offsetWidth)
  }

  private span(left: number, right: number) {
    const a = this.from!
    const s = this.line!.style
    s.left = `${left}px`
    s.width = `${right - left}px`
    s.top = `${a.offsetTop + a.offsetHeight - 2}px`
  }

  private clear(line: HTMLElement) {
    if (this.line !== line) return
    clearTimeout(this.timer)
    line.remove()
    this.strip?.classList.remove('leaning')
    this.line = this.strip = this.from = this.to = null
  }
}
