/**
 * Frame timing, for finding hitches on a device where DevTools is out of
 * reach (a Steam Deck in Gaming Mode). Turned on with `?perf` in the URL
 * (which sticks until `?perf=0`), and from the console with
 * `orbrunPerf.on()` / `.off()` / `.reset()`; `orbrunPerf.report()` returns
 * the numbers as text for pasting.
 *
 * The frame loop marks its sections (`begin`, `mark`, `end`), and the
 * profile keeps a ring of recent awake frames: how far apart they arrived,
 * and how long each section took. The loop parks between turns on purpose,
 * so an interval across a sleep is not a hitch and is not counted: `resume`
 * tells the profile the next frame starts a fresh run.
 *
 * Everything in the readout is of that window and nothing older, which is
 * what makes it readable move by move. A section that only fires on some
 * frames (`level` on a rebuild, `bake` on an atlas change) would otherwise
 * keep its last WINDOW samples for as long as the game ran, and read as a
 * cost still being paid; so frames age out by time (WINDOW_MS) as well as by
 * count, the worst frame is the worst of the window rather than of the
 * session, and a section that has stopped firing leaves the readout. Age is
 * counted from the newest frame, not from the clock, so a report read while
 * the loop is parked still shows the turn that just happened.
 *
 * A long task (Chrome's `longtask` entry, a main-thread task past 50 ms)
 * reported between frames — a message burst parsed, a gamedata load, a GC —
 * is counted too, since the player feels it whether or not the loop ran.
 */

/** most frames kept for the percentiles */
export const WINDOW = 240

/** and how far back they are kept, measured from the newest frame */
export const WINDOW_MS = 4000

export interface Section {
  name: string
  /** frames of the window this section was marked on */
  n: number
  /** the most recent sample, for reading a single move as it happens */
  last: number
  p50: number
  p95: number
  max: number
}

/** one awake frame: when it ran, the gap from the frame before (NaN across a sleep), and what it did */
export interface Frame {
  at: number
  gap: number
  total: number
  parts: [string, number][]
  tags: string[]
}

export interface Report {
  frames: number
  /** how much time the window covers, ms */
  span: number
  /** how long ago the newest frame ran, ms — a parked loop's numbers are this stale */
  age: number
  /** ms between consecutive awake frames */
  interval: Section
  /** the loop body, all sections together */
  body: Section
  sections: Section[]
  /** the worst body of the window, section by section, with what marked it and how long ago it ran */
  worst: { total: number; ago: number; parts: [string, number][]; tags: string[] } | null
  longTasks: { count: number; max: number }
}

export class FrameProfile {
  private frames: Frame[] = []
  private longs: { at: number; ms: number }[] = []
  private prevFrame = NaN
  private newest = 0
  private gap = NaN
  private at = 0
  private frameStart = 0
  private markAt = 0
  private cur: [string, number][] = []
  private tags: string[] = []

  /** the loop woke from a sleep: the next interval has nothing to be measured against */
  resume() {
    this.prevFrame = NaN
  }

  /** the loop's callback fired at `now` and is running its body */
  begin(now: number) {
    this.gap = Number.isNaN(this.prevFrame) ? NaN : now - this.prevFrame
    this.prevFrame = this.at = now
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
    this.frames.push({ at: this.at, gap: this.gap, total, parts: this.cur, tags: this.tags })
    this.keep(this.at)
  }

  longTask(ms: number) {
    const at = performance.now()
    this.longs.push({ at, ms })
    this.keep(at)
  }

  /** drop what the window has left behind: past WINDOW frames, or older than WINDOW_MS before `now` */
  private keep(now: number) {
    this.newest = Math.max(this.newest, now)
    const from = this.newest - WINDOW_MS
    while (this.frames.length > WINDOW || (this.frames.length && this.frames[0].at < from)) this.frames.shift()
    while (this.longs.length && this.longs[0].at < from) this.longs.shift()
  }

  reset() {
    this.frames = []
    this.longs = []
    this.prevFrame = NaN
    this.newest = 0
  }

  report(): Report {
    const fs = this.frames
    const parts = new Map<string, number[]>()
    for (const f of fs)
      for (const [name, ms] of f.parts) {
        let arr = parts.get(name)
        if (!arr) parts.set(name, (arr = []))
        arr.push(ms)
      }
    let worst: Frame | null = null
    for (const f of fs) if (!worst || f.total > worst.total) worst = f
    const newest = fs.length ? fs[fs.length - 1].at : this.newest
    return {
      frames: fs.length,
      span: fs.length ? newest - fs[0].at : 0,
      age: Math.max(0, performance.now() - newest),
      interval: stats('interval', fs.map((f) => f.gap).filter((g) => !Number.isNaN(g))),
      body: stats('body', fs.map((f) => f.total)),
      sections: [...parts].map(([n, a]) => stats(n, a)),
      worst: worst && { total: worst.total, ago: newest - worst.at, parts: worst.parts, tags: worst.tags },
      longTasks: { count: this.longs.length, max: this.longs.reduce((m, l) => Math.max(m, l.ms), 0) },
    }
  }
}

export function stats(name: string, xs: readonly number[]): Section {
  if (!xs.length) return { name, n: 0, last: 0, p50: 0, p95: 0, max: 0 }
  const s = [...xs].sort((a, b) => a - b)
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))]
  return { name, n: xs.length, last: xs[xs.length - 1], p50: at(0.5), p95: at(0.95), max: s[s.length - 1] }
}

export function formatReport(r: Report): string {
  const f = (x: number) => x.toFixed(1).padStart(6)
  const row = (s: Section) => `${s.name.padEnd(9)}${String(s.n).padStart(4)}${f(s.last)}${f(s.p50)}${f(s.p95)}${f(s.max)}`
  const head = `${r.frames}f ${(r.span / 1000).toFixed(1)}s`.padEnd(9) + '   n  last   p50   p95   max'
  const lines = [r.age > 250 ? `${head}  (${(r.age / 1000).toFixed(1)}s ago)` : head, row(r.interval), row(r.body), ...r.sections.map(row)]
  if (r.worst) {
    const parts = r.worst.parts.map(([n, ms]) => `${n} ${ms.toFixed(1)}`).join('  ')
    lines.push(`worst ${r.worst.total.toFixed(1)}ms ${(r.worst.ago / 1000).toFixed(1)}s back: ${parts}${r.worst.tags.length ? '  [' + r.worst.tags.join(', ') + ']' : ''}`)
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
