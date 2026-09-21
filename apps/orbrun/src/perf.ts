/**
 * Frame timing, for finding hitches on a device where DevTools is out of
 * reach (a Steam Deck in Gaming Mode). Turned on with `?perf` in the URL
 * (which sticks until `?perf=0`), and from the console with
 * `orbrunPerf.on()` / `.off()` / `.reset()`; `orbrunPerf.report()` returns
 * the numbers as text for pasting.
 *
 * The frame loop marks its sections (`begin`, `mark`, `end`), and the
 * profile keeps a ring of the last WINDOW awake frames: how far apart they
 * arrived, and how long each section took. The loop parks between turns on
 * purpose, so an interval across a sleep is not a hitch and is not counted:
 * `resume` tells the profile the next frame starts a fresh run.
 *
 * A long task (Chrome's `longtask` entry, a main-thread task past 50 ms)
 * reported between frames — a message burst parsed, a gamedata load, a GC —
 * is counted too, since the player feels it whether or not the loop ran.
 */

/** frames kept for the percentiles */
export const WINDOW = 240

export interface Section {
  name: string
  p50: number
  p95: number
  max: number
}

export interface Report {
  frames: number
  /** ms between consecutive awake frames */
  interval: Section
  /** the loop body, all sections together */
  body: Section
  sections: Section[]
  /** the worst body of the window, section by section, with what marked it */
  worst: { total: number; at: number; parts: [string, number][]; tags: string[] } | null
  longTasks: { count: number; max: number }
}

export class FrameProfile {
  private intervals: number[] = []
  private bodies: number[] = []
  private parts = new Map<string, number[]>()
  private prevFrame = NaN
  private frameStart = 0
  private markAt = 0
  private cur: [string, number][] = []
  private tags: string[] = []
  private worst: Report['worst'] = null
  private longCount = 0
  private longMax = 0

  /** the loop woke from a sleep: the next interval has nothing to be measured against */
  resume() {
    this.prevFrame = NaN
  }

  /** the loop's callback fired at `now` and is running its body */
  begin(now: number) {
    if (!Number.isNaN(this.prevFrame)) push(this.intervals, now - this.prevFrame)
    this.prevFrame = now
    this.frameStart = this.markAt = performance.now()
    this.cur = []
    this.tags = []
  }

  /** the section since the last mark ends here under `name` */
  mark(name: string) {
    const t = performance.now()
    this.cur.push([name, t - this.markAt])
    this.markAt = t
  }

  /** something notable this frame (a scene rebuild, a level change), shown with the worst frame if this is it */
  tag(what: string) {
    this.tags.push(what)
  }

  end() {
    const total = performance.now() - this.frameStart
    push(this.bodies, total)
    for (const [name, ms] of this.cur) {
      let arr = this.parts.get(name)
      if (!arr) this.parts.set(name, (arr = []))
      push(arr, ms)
    }
    if (!this.worst || total > this.worst.total) this.worst = { total, at: this.prevFrame, parts: this.cur, tags: this.tags }
  }

  longTask(ms: number) {
    this.longCount++
    if (ms > this.longMax) this.longMax = ms
  }

  reset() {
    this.intervals = []
    this.bodies = []
    this.parts.clear()
    this.worst = null
    this.longCount = 0
    this.longMax = 0
    this.prevFrame = NaN
  }

  report(): Report {
    return {
      frames: this.bodies.length,
      interval: stats('interval', this.intervals),
      body: stats('body', this.bodies),
      sections: [...this.parts].map(([n, a]) => stats(n, a)),
      worst: this.worst,
      longTasks: { count: this.longCount, max: this.longMax },
    }
  }
}

function push(arr: number[], v: number) {
  arr.push(v)
  if (arr.length > WINDOW) arr.shift()
}

export function stats(name: string, xs: readonly number[]): Section {
  if (!xs.length) return { name, p50: 0, p95: 0, max: 0 }
  const s = [...xs].sort((a, b) => a - b)
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))]
  return { name, p50: at(0.5), p95: at(0.95), max: s[s.length - 1] }
}

export function formatReport(r: Report): string {
  const f = (x: number) => x.toFixed(1).padStart(6)
  const row = (s: Section) => `${s.name.padEnd(9)}${f(s.p50)}${f(s.p95)}${f(s.max)}`
  const lines = [`${r.frames} frames`.padEnd(9) + '   p50   p95   max', row(r.interval), row(r.body), ...r.sections.map(row)]
  if (r.worst) {
    const parts = r.worst.parts.map(([n, ms]) => `${n} ${ms.toFixed(1)}`).join('  ')
    lines.push(`worst ${r.worst.total.toFixed(1)}ms: ${parts}${r.worst.tags.length ? '  [' + r.worst.tags.join(', ') + ']' : ''}`)
  }
  lines.push(`long tasks ${r.longTasks.count}, max ${r.longTasks.max.toFixed(0)}ms`)
  return lines.join('\n')
}

/**
 * Whether the readout is asked for: `?perf` on the address, as `?fullscreen`
 * is read (quit.ts). The routes carry the query along (servers.ts
 * `formatRoute`), so the flag lasts as long as the address does — through the
 * lobby and into a game — and dropping it, or `?perf=0`, is the way off.
 */
export function perfWanted(): boolean {
  try {
    const q = new URLSearchParams(window.location.search)
    return q.has('perf') && q.get('perf') !== '0'
  } catch {
    return false
  }
}

/**
 * The on-screen readout: the report refreshed four times a second in a
 * corner, over everything. `orbrunPerf` on `window` switches it, so it can
 * be turned on from a remote console without a reload; that switch is this
 * page's, and a reload is back to what `?perf` says.
 */
export class PerfOverlay {
  readonly profile = new FrameProfile()
  private el: HTMLElement | null = null
  private timer = 0
  private observer: PerformanceObserver | null = null
  private shown = false

  constructor(private host: HTMLElement) {
    if (perfWanted()) this.on()
    ;(window as unknown as { orbrunPerf: unknown }).orbrunPerf = {
      on: () => this.on(),
      off: () => this.off(),
      reset: () => this.profile.reset(),
      report: () => formatReport(this.profile.report()),
    }
  }

  get enabled(): boolean {
    return this.shown
  }

  on() {
    if (this.shown) return
    this.shown = true
    this.profile.reset()
    this.el = document.createElement('pre')
    this.el.className = 'perf'
    this.host.append(this.el)
    this.timer = window.setInterval(() => {
      if (this.el) this.el.textContent = formatReport(this.profile.report())
    }, 250)
    if (typeof PerformanceObserver !== 'undefined') {
      try {
        this.observer = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) this.profile.longTask(e.duration)
        })
        this.observer.observe({ type: 'longtask', buffered: false })
      } catch {
        this.observer = null
      }
    }
  }

  off() {
    if (!this.shown) return
    this.shown = false
    clearInterval(this.timer)
    this.observer?.disconnect()
    this.observer = null
    this.el?.remove()
    this.el = null
  }

  destroy() {
    this.off()
    delete (window as unknown as { orbrunPerf?: unknown }).orbrunPerf
  }
}
