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
 *
 * The wire is measured alongside it (`NetProfile`), because half of what a
 * player calls slowness is the server's answer and no frame counter shows
 * it, and the two together make one verdict (`verdict`) — the one line that
 * says whether what is on the screen is good.
 */
import type { Session } from './session'


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
  /** the display's period, taken as the shortest interval seen (see `displayPeriod`) */
  period: number
  /** frames of the window that arrived more than half a period late */
  dropped: number
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
    const gaps = fs.map((f) => f.gap).filter((g) => !Number.isNaN(g))
    // the shortest interval is the display's period: an average cannot tell 60 Hz held from 120 Hz halved,
    // and anything under 4 ms is two callbacks in one tick rather than a refresh
    let period = 16.7
    for (const g of gaps) if (g >= 4 && g < period) period = g
    return {
      frames: fs.length,
      period,
      dropped: gaps.filter((g) => g > period * 1.5).length,
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

export function formatReport(r: Report, n: NetReport | null = null): string {
  // a gamedata load or a lost packet puts four figures in a column: the decimal goes rather than the gap
  const f = (x: number) => (x >= 100 ? x.toFixed(0) : x.toFixed(1)).padStart(7)
  const row = (s: Section) => `${s.name.padEnd(9)}${String(s.n).padStart(4)}${f(s.last)}${f(s.p50)}${f(s.p95)}${f(s.max)}`
  const head = `${r.frames}f ${(r.span / 1000).toFixed(1)}s`.padEnd(9) + '   n   last    p50    p95    max'
  const lines = [r.age > 250 ? `${head}  (${(r.age / 1000).toFixed(1)}s ago)` : head, row(r.interval), row(r.body), ...r.sections.map(row)]
  if (r.worst) {
    const parts = r.worst.parts.map(([n, ms]) => `${n} ${ms.toFixed(1)}`).join('  ')
    lines.push(`worst ${r.worst.total.toFixed(1)}ms ${(r.worst.ago / 1000).toFixed(1)}s back: ${parts}${r.worst.tags.length ? '  [' + r.worst.tags.join(', ') + ']' : ''}`)
  }
  lines.push(`long tasks ${r.longTasks.count}, max ${r.longTasks.max.toFixed(0)}ms`)
  if (n) {
    lines.push(row(n.rtt))
    if (n.ttd.n) lines.push(row(n.ttd))
    const kb = (n.in.bytes / 1024).toFixed(1)
    const quiet = n.quiet >= 1000 ? `  quiet ${(n.quiet / 1000).toFixed(1)}s` : ''
    const pending = n.pending ? `  waiting ${n.pending}` : ''
    lines.push(`net ${n.open ? 'up' : 'DOWN'}  in ${n.in.msgs.toFixed(0)}/s ${kb}KB/s  out ${n.out.msgs.toFixed(0)}/s${pending}${quiet}`)
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------- the wire

/**
 * The client messages that are the player acting. What the server sends back
 * after one is the latency they feel on a step, and it is nothing the frame
 * loop can fix: a game can hold a perfect 60 Hz and still answer late.
 */
const INPUT_MSGS = new Set(['key', 'input', 'text_input', 'click_cell'])

export interface NetReport {
  /** ms from the player's key going out to the first message the server sent back */
  rtt: Section
  /** ms from that key to the frame that drew the answer: the whole of what the hand feels */
  ttd: Section
  /** what arrived over the window, per second */
  in: { msgs: number; bytes: number }
  /** what went out over the window, per second */
  out: { msgs: number; bytes: number }
  /** ms since anything last arrived */
  quiet: number
  /** keys sent with nothing back yet */
  pending: number
  open: boolean
}

/**
 * Traffic over the same window as the frames, but aged by the clock rather
 * than by the newest sample: a socket that has gone quiet is quiet, and that
 * is worth seeing, where a loop that has parked is only asleep.
 *
 * The round trip is timed from a key going out to the next message the
 * server sent of its own accord, one key to one batch. A message the player
 * did not ask for — someone else's chat, a lobby update — can land on a
 * waiting key and time it short; over a window of steps that is noise, and
 * `pending` says when a key has gone unanswered rather than answered fast.
 */
export class NetProfile {
  private rtts: { at: number; ms: number }[] = []
  private ttds: { at: number; ms: number }[] = []
  private ins: { at: number; bytes: number; msgs: number }[] = []
  private outs: { at: number; bytes: number }[] = []
  private waiting: number[] = []
  /** keys the server has answered, waiting on the frame that puts the answer on the screen */
  private undrawn: number[] = []
  /** a batch arrived and has not yet been credited to a waiting key */
  private fresh = false
  private lastIn = 0
  open = true

  /** `now` is the clock; a test gives its own, where the frames carry theirs in with them */
  constructor(private now: () => number = () => performance.now()) {}

  /** a client message went out */
  sent(name: string, bytes = 0) {
    const at = this.now()
    this.outs.push({ at, bytes })
    if (INPUT_MSGS.has(name)) this.waiting.push(at)
    this.trim(at)
  }

  /** a frame arrived off the socket, before its messages were handled */
  arrived(bytes: number, msgs: number) {
    const at = this.now()
    this.ins.push({ at, bytes, msgs })
    this.lastIn = at
    this.fresh = true
    this.trim(at)
  }

  /** a message from that frame reached the state: the first one answers the oldest key waiting */
  applied() {
    if (!this.fresh) return
    this.fresh = false
    const t = this.waiting.shift()
    if (t === undefined) return
    const at = this.now()
    this.rtts.push({ at, ms: at - t })
    this.undrawn.push(t)
    this.trim(at)
  }

  /**
   * A frame drew. The key whose answer it drew is the oldest one answered
   * but not yet on the screen, so `ttd` spans the whole of what the player
   * feels: the wire out, the server's turn, the wire back, the state, and
   * the frame. Called only for a frame that actually rendered — the loop
   * skips the render when nothing changed, and those frames drew no answer.
   */
  drew() {
    const t = this.undrawn.shift()
    if (t === undefined) return
    const at = this.now()
    this.ttds.push({ at, ms: at - t })
    this.trim(at)
  }

  closed() {
    this.open = false
  }

  opened() {
    this.open = true
  }

  reset() {
    this.rtts = []
    this.ttds = []
    this.ins = []
    this.outs = []
    this.waiting = []
    this.undrawn = []
    this.fresh = false
  }

  private trim(now: number) {
    const from = now - WINDOW_MS
    while (this.rtts.length && this.rtts[0].at < from) this.rtts.shift()
    while (this.ttds.length && this.ttds[0].at < from) this.ttds.shift()
    while (this.ins.length && this.ins[0].at < from) this.ins.shift()
    while (this.outs.length && this.outs[0].at < from) this.outs.shift()
    // a key the server never answered is not waiting any more, it is lost; travel answers its own key long after
    while (this.waiting.length > 8) this.waiting.shift()
    while (this.undrawn.length > 8) this.undrawn.shift()
  }

  report(): NetReport {
    const now = this.now()
    const per = WINDOW_MS / 1000
    this.trim(now)
    return {
      rtt: stats('rtt', this.rtts.map((r) => r.ms)),
      ttd: stats('ttd', this.ttds.map((r) => r.ms)),
      in: { msgs: this.ins.reduce((n, i) => n + i.msgs, 0) / per, bytes: this.ins.reduce((n, i) => n + i.bytes, 0) / per },
      out: { msgs: this.outs.length / per, bytes: this.outs.reduce((n, o) => n + o.bytes, 0) / per },
      quiet: this.lastIn ? now - this.lastIn : 0,
      pending: this.waiting.length,
      open: this.open,
    }
  }
}

// ------------------------------------------------------------- the verdict

export type Rank = 'good' | 'fair' | 'bad' | 'idle'

export interface Verdict {
  rank: Rank
  /** the one thing that decided it */
  why: string
}

/** The display's period the window revealed; 16.7 until a frame arrives faster (`FrameProfile.report`). */
export function displayPeriod(r: Report): number {
  return r.period
}

/**
 * One line's worth of answer: is this good. The thresholds are the ones in
 * docs/front-end-perf.md, read against the display's own period rather than
 * a fixed 60 Hz, and the worst complaint wins. Only what the player would
 * feel counts: a loop with headroom and a server answering promptly is good
 * however busy the numbers look.
 */
export function verdict(r: Report, n: NetReport | null, period = displayPeriod(r)): Verdict {
  if (n && !n.open) return { rank: 'bad', why: 'disconnected' }
  if (r.frames < 10) return { rank: 'idle', why: 'nothing to draw' }
  const worst = r.worst && [...r.worst.parts].sort((a, b) => b[1] - a[1])[0]
  const blame = worst && worst[1] >= 1 ? ` (${worst[0]} ${worst[1].toFixed(0)}ms)` : ''
  const bad: string[] = []
  const fair: string[] = []
  // the count of late frames, not a percentile of the intervals: one step in ten stuttering is what is felt,
  // and a p95 hides it whenever the other nineteen frames were on time
  const late = r.dropped / r.frames
  if (late > 0.1) bad.push(`${r.dropped} of ${r.frames} frames dropped${blame}`)
  else if (late > 0.02) fair.push(`${r.dropped} of ${r.frames} frames dropped${blame}`)
  if (r.body.p50 > 8) bad.push(`loop ${r.body.p50.toFixed(1)}ms every frame`)
  else if (r.body.p50 > 4) fair.push(`loop ${r.body.p50.toFixed(1)}ms every frame`)
  if (r.body.max > 33) bad.push(`a ${r.body.max.toFixed(0)}ms frame${blame}`)
  else if (r.body.max > period) fair.push(`a ${r.body.max.toFixed(0)}ms frame${blame}`)
  if (r.longTasks.count > 1) bad.push(`${r.longTasks.count} long tasks`)
  else if (r.longTasks.count === 1) fair.push(`a ${r.longTasks.max.toFixed(0)}ms task`)
  if (n && n.rtt.n) {
    if (n.rtt.p95 > 250) bad.push(`server ${n.rtt.p95.toFixed(0)}ms behind`)
    else if (n.rtt.p95 > 120) fair.push(`server ${n.rtt.p95.toFixed(0)}ms behind`)
  }
  // what the hand actually waits for: the wire out, the server's turn, the wire back, and the frame
  if (n && n.ttd.n) {
    if (n.ttd.p95 > 400) bad.push(`${n.ttd.p95.toFixed(0)}ms key to pixels`)
    else if (n.ttd.p95 > 200) fair.push(`${n.ttd.p95.toFixed(0)}ms key to pixels`)
  }
  if (n && n.pending > 2) fair.push(`${n.pending} keys unanswered`)
  if (bad.length) return { rank: 'bad', why: bad[0] }
  if (fair.length) return { rank: 'fair', why: fair[0] }
  const feel = n && n.ttd.n ? `, ${n.ttd.p50.toFixed(0)}ms key to pixels` : n && n.rtt.n ? `, server ${n.rtt.p50.toFixed(0)}ms` : ''
  return { rank: 'good', why: `${Math.round(1000 / period)}Hz${feel}` }
}

const MARK: Record<Rank, string> = { good: '▲', fair: '–', bad: '▼', idle: '·' }

export function formatVerdict(v: Verdict): string {
  return `${MARK[v.rank]} ${v.rank}  ${v.why}`
}

// ----------------------------------------------------------------- the log

/** how often a sample is taken */
export const LOG_INTERVAL_MS = 1000

/** the whole file's budget: small enough to read or paste whole, and the oldest samples go to hold it */
export const LOG_BYTES = 24_000

/** a sample line is truncated here, so one frame with thirty sections cannot run away with the file */
const LOG_WIDTH = 260

/** worst frames kept out of the ring, so a spike an hour old is still in the file */
const WORST_KEPT = 6

/** events kept; a place change, a socket, a long task */
const EVENTS_KEPT = 40

/**
 * What only the app knows about the moment. Timings say what was slow; this
 * says what was on the screen while it was, which is most of what turns a
 * number into a change: 28 ms of `level` on a 2 000-cell level with the
 * chunk counter stepping once is the chunk rebuild working, and the same 28
 * ms with it stepping forty times is not.
 */
export interface LogContext {
  /** what the player is doing: `command`, `menu`, `targeting` */
  mode?: string
  /** where they are: `D:3` */
  place?: string
  /** cells built in the scene, and billboards standing in it */
  cells?: number
  crowd?: number
  /** the renderer's cumulative counters (`RenderStats`), which the log diffs between samples */
  counters?: Record<string, number>
  /** gamedata is loading: a long task here is the load, not the game */
  loading?: boolean
}

/**
 * Each sample is a snapshot of the last few seconds, and the windows
 * overlap: frames counted across samples would be counted four times over,
 * so what is kept here is what survives being averaged — the share of frames
 * dropped, the worst of each measure, and the seconds by verdict.
 */
interface Totals {
  seconds: Record<Rank, number>
  worstBody: number
  worstRtt: number
  worstTtd: number
  worstTask: number
  /** the share of frames dropped, summed over samples for a mean, and the worst single second */
  dropRate: number
  dropWorst: number
  samples: number
  bytesIn: number
}

/**
 * A log to hand to somebody who was not holding the device, and enough of
 * one to act on: a header saying what it was taken on, the events that
 * explain the outliers, a line a second of the pane's numbers, the worst
 * frames kept whole where the ring cannot lose them, and totals.
 *
 * Standing still is most of a turn-based game's seconds and none of its
 * interest, so a run of idle samples collapses to one line with a count. The
 * worst frame is printed on the sample it happened in, not for as long as it
 * sits in the window, so a spike appears once and on the second it occurred.
 *
 * The file is held under LOG_BYTES by dropping the oldest samples. Nothing
 * else is dropped: the header, the events, the worst frames and the totals
 * are what a reader needs first and are small.
 */
export class PerfLog {
  private head: string[] = []
  private events: string[] = []
  private samples: string[] = []
  private worst: string[] = []
  private idleRun = 0
  private started = 0
  private last: LogContext = {}
  private counters: Record<string, number> = {}
  private open = true
  private totals: Totals = blankTotals()

  constructor(private now: () => number = () => performance.now()) {}

  /** what was measured and on what: numbers off a Deck and off a desktop are not the same numbers */
  begin(info: string[]) {
    this.head = info
    this.events = []
    this.samples = []
    this.worst = []
    this.idleRun = 0
    this.started = this.now()
    this.last = {}
    this.counters = {}
    this.totals = blankTotals()
  }

  /** something worth a line of its own, against the clock */
  event(what: string) {
    this.events.push(`${this.stamp()} ${what}`)
    if (this.events.length > EVENTS_KEPT) this.events.shift()
  }

  private stamp(): string {
    return `${((this.now() - this.started) / 1000).toFixed(0).padStart(4)}s`
  }

  add(r: Report, n: NetReport | null, ctx: LogContext = {}) {
    const t = this.stamp()
    this.watchContext(ctx, n)
    const v = verdict(r, n)
    this.totals.seconds[v.rank]++
    if (r.frames < 10) {
      // asleep between turns: one line however long it lasts
      this.idleRun++
      const line = `${t} ·idle x${this.idleRun}`
      if (this.idleRun > 1) this.samples[this.samples.length - 1] = line
      else this.push(line)
      return
    }
    this.idleRun = 0
    this.totals.samples++
    this.totals.dropRate += r.dropped / r.frames
    this.totals.dropWorst = Math.max(this.totals.dropWorst, r.dropped / r.frames)
    this.totals.worstBody = Math.max(this.totals.worstBody, r.body.max)
    this.totals.worstTask = Math.max(this.totals.worstTask, r.longTasks.max)
    if (n) {
      this.totals.worstRtt = Math.max(this.totals.worstRtt, n.rtt.max)
      this.totals.worstTtd = Math.max(this.totals.worstTtd, n.ttd.max)
      this.totals.bytesIn += n.in.bytes
    }
    const q = (s: Section) => `${num(s.p50)}/${num(s.p95)}/${num(s.max)}`
    const bits = [t, `${MARK[v.rank]}${v.rank}`, `f${r.frames}${r.dropped ? 'd' + r.dropped : ''}`, `i${q(r.interval)}`, `b${q(r.body)}`]
    // the sections that cost anything, largest first: a name with a × fired on some frames, not all
    const sections = r.sections
      .filter((s) => s.p50 >= 0.3 || s.max >= 2)
      .sort((a, b) => b.p50 * b.n - a.p50 * a.n)
      .slice(0, 5)
      .map((s) => `${s.name}${s.n < r.frames ? '×' + s.n : ''}:${num(s.p50)}${s.max > s.p50 * 2 ? '^' + num(s.max) : ''}`)
    if (sections.length) bits.push(sections.join(' '))
    if (n && n.rtt.n) bits.push(`rtt${num(n.rtt.p50)}/${num(n.rtt.p95)}`)
    if (n && n.ttd.n) bits.push(`ttd${num(n.ttd.p50)}/${num(n.ttd.p95)}`)
    if (n && n.in.msgs) bits.push(`in${n.in.msgs.toFixed(0)}/${(n.in.bytes / 1024).toFixed(n.in.bytes < 10240 ? 1 : 0)}k`)
    if (n && n.pending) bits.push(`wait${n.pending}`)
    if (r.longTasks.count) bits.push(`lt${r.longTasks.count}:${num(r.longTasks.max)}`)
    const heap = usedHeapMb()
    if (heap) bits.push(`heap${heap.toFixed(0)}`)
    if (ctx.cells !== undefined) bits.push(`c${ctx.cells}${ctx.crowd ? 'm' + ctx.crowd : ''}`)
    if (ctx.mode) bits.push(ctx.mode)
    // only the frame of this second, and only the sections of it worth a name; before the counters,
    // because a line long enough to be cut loses its tail and this is the part worth keeping
    if (r.worst && r.worst.ago < LOG_INTERVAL_MS * 1.2 && r.worst.total >= r.period) {
      bits.push('W' + this.frameLine(r.worst))
      this.keepWorst(r, ctx)
    }
    const stepped = this.stepCounters(ctx.counters)
    if (stepped) bits.push(stepped)
    this.push(bits.join(' '))
  }

  /** a frame's cost, section by section, worth naming */
  private frameLine(w: NonNullable<Report['worst']>): string {
    const parts = w.parts
      .filter(([, ms]) => ms >= 0.5)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, ms]) => `${name} ${ms.toFixed(1)}`)
    const tags = w.tags.length ? '[' + w.tags.join(',') + ']' : ''
    // a frame whose time is in none of its sections says so by naming none: the cost was outside the marks
    return `${w.total.toFixed(0)}:${parts.length ? parts.join(',') : 'unmarked'}${tags}`
  }

  /** the worst frames of the whole run, out of the ring's reach */
  private keepWorst(r: Report, ctx: LogContext) {
    const w = r.worst!
    const line = `${this.stamp()} ${this.frameLine(w)} · ${ctx.place ?? '?'} c${ctx.cells ?? 0}m${ctx.crowd ?? 0} ${ctx.mode ?? ''}`.trimEnd()
    this.worst.push(`${w.total.toFixed(1).padStart(8)}\t${line}`)
    this.worst.sort((a, b) => parseFloat(b) - parseFloat(a))
    if (this.worst.length > WORST_KEPT) this.worst.pop()
  }

  /** the renderer's counters as steps taken since the last sample, which is what a second cost */
  private stepCounters(now: Record<string, number> | undefined): string {
    if (!now) return ''
    const steps: [string, number][] = []
    /** counters in milliseconds, which are a cost rather than a tally */
    const ms: [string, number][] = []
    for (const [k, v] of Object.entries(now)) {
      const was = this.counters[k] ?? v
      if (v > was) (k.endsWith('Ms') ? ms : steps).push([k, v - was])
    }
    this.counters = { ...now }
    // Milliseconds first and always. They say what a section's time was spent
    // on, which is the question the counters are read for, and a vertex count
    // in the tens of thousands would take every slot before they got one.
    const out = ms
      .filter(([, d]) => d >= 0.5)
      .sort((a, b) => b[1] - a[1])
      // the `Ms` says only what the decimal already says
      .map(([k, d]) => `${k.slice(0, -2)}+${d.toFixed(1)}`)
    // then the busiest three tallies: the rest are along for the ride with them
    out.push(
      ...steps
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([k, d]) => `${k}+${d}`),
    )
    return out.join(' ')
  }

  /** what changed between samples is an event: where the player is, whether the socket is up, a load */
  private watchContext(ctx: LogContext, n: NetReport | null) {
    // the first sample is where everything starts, not where everything changed: the header has it already
    const first = this.samples.length === 0
    if (!first) {
      if (ctx.place && ctx.place !== this.last.place) this.event(`place ${this.last.place ?? '—'} → ${ctx.place}`)
      if (ctx.loading !== this.last.loading) this.event(ctx.loading ? 'gamedata loading' : 'gamedata ready')
      if (n && !n.open && this.open) this.event('socket closed')
    }
    if (n) this.open = n.open
    this.last = { ...ctx }
  }

  private push(line: string) {
    this.samples.push(line.length > LOG_WIDTH ? line.slice(0, LOG_WIDTH - 1) + '…' : line)
    while (this.samples.length > 8 && this.size() > LOG_BYTES) this.samples.shift()
  }

  private size(): number {
    return this.samples.reduce((n, l) => n + l.length + 1, 0) + 1200
  }

  text(): string {
    const t = this.totals
    const secs = (Object.entries(t.seconds) as [Rank, number][]).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`)
    const out = [
      ...this.head,
      'legend: t verdict f=frames d=dropped i=interval p50/p95/max b=body section×frames:p50^max',
      '        rtt=key→answer ttd=key→pixels in=msgs/KB per s lt=long tasks c=cells m=crowd W=worst frame',
      '',
      'events',
      ...(this.events.length ? this.events : ['  (none)']),
      '',
      'samples',
      ...(this.samples.length ? this.samples : ['  (none)']),
      '',
      'worst frames of the run',
      ...(this.worst.length ? this.worst.map((l) => l.slice(l.indexOf('\t') + 1)) : ['  (none)']),
      '',
      'totals',
      `  ${secs.join(', ')} of ${this.stamp().trim()} · frames dropped ${pct(t.samples ? t.dropRate / t.samples : 0)} mean, ${pct(t.dropWorst)} at worst`,
      `  worst body ${num(t.worstBody)}ms · worst rtt ${num(t.worstRtt)}ms · worst key→pixels ${num(t.worstTtd)}ms · worst task ${num(t.worstTask)}ms · ${(t.bytesIn / 1024 / 1024).toFixed(2)}MB in`,
    ]
    return out.join('\n') + '\n'
  }
}

function blankTotals(): Totals {
  return { seconds: { good: 0, fair: 0, bad: 0, idle: 0 }, worstBody: 0, worstRtt: 0, worstTtd: 0, worstTask: 0, dropRate: 0, dropWorst: 0, samples: 0, bytesIn: 0 }
}

function pct(x: number): string {
  return `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`
}

/** compact enough for a line: a decimal under 100, none over it */
function num(x: number): string {
  return x >= 100 ? x.toFixed(0) : x.toFixed(1)
}

/**
 * The GPU as the driver names it, once, off a throwaway context: a browser
 * that masks it says so itself, and a browser that does not settles whether
 * a slow `draw` is the machine or the code.
 */
function gpuName(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl2')
    if (!gl) return 'no webgl2'
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER))
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return name.slice(0, 90)
  } catch {
    return '?'
  }
}

/** Chrome's heap, in MB, for spotting a long task that is a collection; absent everywhere else. */
function usedHeapMb(): number {
  const m = (performance as { memory?: { usedJSHeapSize: number } }).memory
  return m ? m.usedJSHeapSize / 1024 / 1024 : 0
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
  readonly net = new NetProfile()
  readonly log = new PerfLog()
  private el: HTMLElement | null = null
  private verdictEl: HTMLElement | null = null
  private bodyEl: HTMLElement | null = null
  private hintEl: HTMLElement | null = null
  private said = 0
  private timer = 0
  private logTimer = 0
  private observer: PerformanceObserver | null = null
  private shown = false
  /** what the last save did, for the pane's own hint */
  private saved: 'ok' | 'failed' | null = null
  private name = ''

  /** `context` says what is on the screen at the moment of a sample; the log turns it into events and columns */
  constructor(
    private host: HTMLElement,
    private context: () => LogContext = () => ({}),
  ) {
    if (perfWanted()) this.on()
    ;(window as unknown as { orbrunPerf: unknown }).orbrunPerf = {
      on: () => this.on(),
      off: () => this.off(),
      reset: () => {
        this.profile.reset()
        this.net.reset()
        this.log.begin(this.header())
      },
      report: () => this.text(),
      event: (what: string) => this.log.event(String(what)),
      verdict: () => formatVerdict(verdict(this.profile.report(), this.net.report())),
      log: () => this.log.text(),
      save: () => this.save(),
    }
  }

  /**
   * What the log was taken on. The same numbers mean different things on a
   * Deck and on a desktop, and the GPU's name settles at a glance what a
   * `draw` in the tens of ms means — SwiftShader is software, and software
   * is not slow the way hardware is slow.
   */
  private header(): string[] {
    const d = new Date().toISOString().slice(0, 19).replace('T', ' ')
    // the UA's last word is the interesting one (the browser build); the rest is boilerplate
    const ua = navigator.userAgent.replace(/^.*\) /, '').slice(0, 60)
    const ctx = this.context()
    return [
      `orbrun perf · ${d} · ${ua}`,
      `screen ${window.innerWidth}x${window.innerHeight} dpr${window.devicePixelRatio ?? 1} · ${navigator.hardwareConcurrency ?? '?'} cores · ${(navigator as { deviceMemory?: number }).deviceMemory ?? '?'}GB · ${window.location.search || '(no query)'}`,
      `gpu ${gpuName()}`,
      `start ${ctx.place ?? '?'} · ${ctx.mode ?? '?'} · ${ctx.cells ?? 0} cells`,
    ]
  }

  /**
   * Put the log on disk. A file is the only way off a device with no console
   * to copy from — a Deck in Gaming Mode — and it is kept small enough to be
   * handed on whole.
   */
  save(): string {
    const text = this.log.text()
    // date-time, sortable and with nothing in it a file system dislikes
    const [date, time] = new Date().toISOString().slice(0, 19).split('T')
    this.name = `orbrun-perf-${date.replace(/-/g, '')}-${time.replace(/:/g, '')}.txt`
    try {
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
      const a = document.createElement('a')
      a.href = url
      a.download = this.name
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      this.saved = 'ok'
    } catch {
      // nowhere to put a download (a kiosk that refuses one): the text is still to be had from the console
      this.saved = 'failed'
    }
    return text
  }

  /** the tap's own answer, so the player knows the file went somewhere */
  private saveFromTap() {
    this.save()
    this.said = performance.now()
    this.draw()
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
    this.verdictEl = document.createElement('span')
    this.bodyEl = document.createElement('span')
    this.hintEl = document.createElement('span')
    this.hintEl.className = 'hint'
    this.el.append(this.verdictEl, this.bodyEl, this.hintEl)
    // a tap on the pane saves the log. A Deck in Gaming Mode has no console to call `save()` from,
    // and a device with no way to get the numbers off it is a device the numbers were not taken on
    this.el.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      this.saveFromTap()
    })
    this.host.append(this.el)
    this.timer = window.setInterval(() => this.draw(), 250)
    this.log.begin(this.header())
    this.logTimer = window.setInterval(() => this.log.add(this.profile.report(), this.net.report(), this.context()), LOG_INTERVAL_MS)
    this.draw()
    if (typeof PerformanceObserver !== 'undefined') {
      try {
        this.observer = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            this.profile.longTask(e.duration)
            // a task this long is a freeze, not a slow frame: it gets a line of its own, with what was up
            if (e.duration >= 200) this.log.event(`long task ${e.duration.toFixed(0)}ms${this.context().loading ? ' (gamedata loading)' : ''}`)
          }
        })
        this.observer.observe({ type: 'longtask', buffered: false })
      } catch {
        this.observer = null
      }
    }
  }

  /** the whole readout as text, verdict first */
  text(): string {
    const r = this.profile.report()
    const n = this.net.report()
    return `${formatVerdict(verdict(r, n))}\n${formatReport(r, n)}`
  }

  private draw() {
    if (!this.verdictEl || !this.bodyEl) return
    const r = this.profile.report()
    const n = this.net.report()
    const v = verdict(r, n)
    this.verdictEl.className = `verdict ${v.rank}`
    this.verdictEl.textContent = formatVerdict(v) + '\n'
    this.bodyEl.textContent = formatReport(r, n)
    if (this.hintEl) {
      // the answer to the tap stands for a few seconds, then the pane goes back to offering
      const fresh = this.saved && performance.now() - this.said < 6000
      const said = this.saved === 'ok' ? `saved ${this.name}` : 'could not save — orbrunPerf.log() has the text'
      this.hintEl.className = `hint${fresh && this.saved === 'ok' ? ' saved' : ''}`
      this.hintEl.textContent = '\n' + (fresh ? said : 'tap to save the log')
    }
  }

  /**
   * Watch a session's wire. The bytes come from the connection, which is the
   * only layer that sees them; the round trip is timed to the state, so a
   * server ping (answered under the connection, never handled) cannot pass
   * for an answer to a key.
   */
  watch(session: Session): () => void {
    const conn = session.conn
    conn.onTraffic = (e) => {
      if (e.dir === 'in') this.net.arrived(e.bytes, e.msgs)
      else this.net.sent(e.name ?? '')
    }
    const off = session.on((e) => {
      if (e.type === 'state') this.net.applied()
      if (e.type === 'closed') this.net.closed()
      // the same session, back on a fresh socket after a drop
      if (e.type === 'open') this.net.opened()
    })
    return () => {
      conn.onTraffic = null
      off()
    }
  }

  off() {
    if (!this.shown) return
    this.shown = false
    clearInterval(this.timer)
    clearInterval(this.logTimer)
    this.observer?.disconnect()
    this.observer = null
    this.el?.remove()
    this.el = this.verdictEl = this.bodyEl = this.hintEl = null
  }

  destroy() {
    this.off()
    delete (window as unknown as { orbrunPerf?: unknown }).orbrunPerf
  }
}
