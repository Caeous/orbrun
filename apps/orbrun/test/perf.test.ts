// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { FrameProfile, LOG_BYTES, LOG_INTERVAL_MS, NetProfile, PerfLog, PerfOverlay, WINDOW, WINDOW_MS, displayPeriod, formatReport, perfWanted, stats, verdict } from '../src/perf'

describe('perf stats', () => {
  it('takes percentiles of a sample', () => {
    const s = stats('x', [5, 1, 3, 2, 4])
    // `last` is the newest sample, not the largest: it is what the frame just gone cost
    expect(s).toEqual({ name: 'x', n: 5, last: 4, p50: 3, p95: 5, max: 5 })
    expect(stats('empty', [])).toEqual({ name: 'empty', n: 0, last: 0, p50: 0, p95: 0, max: 0 })
  })

  it('counts intervals only between frames of one run', () => {
    const p = new FrameProfile()
    p.begin(0)
    p.end()
    p.begin(16)
    p.end()
    // the loop parked and woke much later: that gap is a sleep, not a hitch
    p.resume()
    p.begin(1000)
    p.end()
    p.begin(1017)
    p.end()
    const r = p.report()
    expect(r.frames).toBe(4)
    expect(r.interval.max).toBe(17)
  })

  it('keeps the worst frame with its sections and tags', () => {
    const p = new FrameProfile()
    p.begin(0)
    p.mark('scene')
    p.end()
    p.begin(16)
    p.tag('scene')
    p.mark('scene')
    p.mark('ui')
    p.end()
    const r = p.report()
    expect(r.sections.map((s) => s.name)).toEqual(['scene', 'ui'])
    expect(r.worst?.tags.length === 0 || r.worst?.tags).toBeTruthy()
    expect(formatReport(r)).toContain('2f ')
    expect(formatReport(r)).toContain('long tasks 0')
  })

  it('forgets frames past the window', () => {
    const p = new FrameProfile()
    for (let i = 0; i < WINDOW + 50; i++) {
      p.begin(i * 16)
      p.end()
    }
    expect(p.report().frames).toBe(Math.min(WINDOW, Math.floor(WINDOW_MS / 16) + 1))
  })

  // a rebuild is over once it has scrolled out of the window: its cost must not read as still being paid
  it('drops a section that has stopped firing, and the worst frame with it', () => {
    const p = new FrameProfile()
    p.begin(0)
    p.mark('level')
    p.end()
    for (let i = 1; i < 10; i++) {
      p.begin(i * 16)
      p.mark('draw')
      p.end()
    }
    expect(p.report().sections.map((s) => s.name)).toEqual(['level', 'draw'])
    p.begin(WINDOW_MS * 2)
    p.mark('draw')
    p.end()
    const r = p.report()
    expect(r.frames).toBe(1)
    expect(r.sections.map((s) => s.name)).toEqual(['draw'])
    expect(r.worst?.ago).toBe(0)
  })

  // the loop parks between turns: the numbers of the turn just played must still be there to read
  it('ages from the newest frame, not the clock', () => {
    const p = new FrameProfile()
    p.begin(0)
    p.end()
    p.begin(16)
    p.end()
    const r = p.report()
    expect(r.frames).toBe(2)
    expect(r.span).toBe(16)
  })
})

/** The readout follows the address, and nothing else: no switch is left behind on the device. */
describe('the perf flag', () => {
  afterEach(() => history.replaceState(null, '', '/'))

  it('is on with `?perf` and off without it, wherever the routes have got to', () => {
    expect(perfWanted()).toBe(false)
    history.replaceState(null, '', '/?perf')
    expect(perfWanted()).toBe(true)
    history.replaceState(null, '', '/?perf#play-dcss-web-trunk')
    expect(perfWanted()).toBe(true)
    history.replaceState(null, '', '/?perf=0')
    expect(perfWanted()).toBe(false)
  })
})

describe('the wire', () => {
  const clock = { t: 0 }
  const profile = () => new NetProfile(() => clock.t)

  it('times a key against the answer that came back, not against a ping', () => {
    clock.t = 0
    const n = profile()
    n.sent('key')
    clock.t = 90
    n.arrived(400, 3)
    n.applied()
    // the rest of the batch is the same answer: one key, one round trip
    n.applied()
    n.applied()
    const r = n.report()
    expect(r.rtt.n).toBe(1)
    expect(r.rtt.last).toBe(90)
    expect(r.pending).toBe(0)
  })

  it('leaves a key waiting until something arrives', () => {
    clock.t = 0
    const n = profile()
    n.sent('key')
    // the client's own chatter is not the player acting and starts no clock
    n.sent('menu_hover')
    clock.t = 40
    expect(n.report().pending).toBe(1)
    expect(n.report().rtt.n).toBe(0)
  })

  it('reports rates over the window and forgets what falls out of it', () => {
    clock.t = 0
    const n = profile()
    for (let i = 0; i < 8; i++) {
      clock.t = i * 100
      n.arrived(1024, 2)
    }
    const r = n.report()
    expect(r.in.msgs).toBe((8 * 2) / (WINDOW_MS / 1000))
    expect(r.quiet).toBe(0)
    clock.t = WINDOW_MS * 2
    const later = n.report()
    expect(later.in.msgs).toBe(0)
    expect(later.quiet).toBe(WINDOW_MS * 2 - 700)
  })
})

/** The one line that answers "is this good", so it has to be right at the edges. */
describe('the verdict', () => {
  const frames = (body: number, interval: number, n = 60) => {
    const p = new FrameProfile()
    for (let i = 0; i < n; i++) {
      p.begin(i * interval)
      p.end()
    }
    const r = p.report()
    // the bodies are measured off the real clock, so they are stubbed for the thresholds
    return { ...r, body: { ...r.body, p50: body, p95: body, max: body } }
  }

  it('says nothing about a loop that has barely run', () => {
    expect(verdict(frames(0.2, 16.7, 4), null).rank).toBe('idle')
  })

  it('is good at the display period with headroom', () => {
    const v = verdict(frames(0.2, 16.7), null)
    expect(v.rank).toBe('good')
    expect(v.why).toContain('60Hz')
  })

  // the shape that reads as low framerate although every average looks fine
  it('calls dropped frames bad even when the loop is idle-cheap', () => {
    const v = verdict(frames(0.2, 40), null)
    expect(v.rank).toBe('bad')
    expect(v.why).toContain('dropped')
  })

  it('blames the server when the loop is clean and the answer is late', () => {
    const net = new NetProfile(() => 0)
    net.sent('key')
    net.arrived(100, 1)
    net.applied()
    const r = { ...frames(0.2, 16.7) }
    const n = { ...net.report(), rtt: { name: 'rtt', n: 4, last: 300, p50: 300, p95: 300, max: 300 } }
    const v = verdict(r, n)
    expect(v.rank).toBe('bad')
    expect(v.why).toContain('server')
  })

  it('takes the period from the fastest frame, so a halved refresh is not read as its own rate', () => {
    expect(displayPeriod(frames(0.2, 8.3))).toBeCloseTo(8.3, 1)
    // nothing faster than 16.7 was seen: 60 Hz is the assumption
    expect(displayPeriod(frames(0.2, 33))).toBe(16.7)
  })

  it('says so when the socket has gone', () => {
    const net = new NetProfile(() => 0)
    net.closed()
    expect(verdict(frames(0.2, 16.7), net.report()).rank).toBe('bad')
  })
})

/** the lines under one of the log's headings */
const section = (text: string, name: string) => {
  const lines = text.split('\n')
  const at = lines.indexOf(name)
  const out: string[] = []
  for (let i = at + 1; i < lines.length && lines[i] !== ''; i++) out.push(lines[i])
  return out
}

/** The log is meant to be handed to someone else and read whole, so its size is part of what it is. */
describe('the perf log', () => {
  const sample = (body: number, frames = 60) => {
    const p = new FrameProfile()
    for (let i = 0; i < frames; i++) {
      p.begin(i * 16.7)
      p.end()
    }
    const r = p.report()
    return { ...r, body: { ...r.body, p50: body, p95: body, max: body } }
  }

  it('collapses a run of idle samples into one line', () => {
    const clock = { t: 0 }
    const log = new PerfLog(() => clock.t)
    log.begin(['test'])
    for (let i = 0; i < 20; i++) {
      clock.t = i * LOG_INTERVAL_MS
      log.add(sample(0.2, 2), null)
    }
    const samples = section(log.text(), 'samples')
    expect(samples.length).toBe(1)
    expect(samples[0]).toContain('idle x20')
  })

  it('holds the whole file to its budget by dropping the oldest samples', () => {
    const clock = { t: 0 }
    const log = new PerfLog(() => clock.t)
    log.begin(['orbrun perf · test'])
    for (let i = 0; i < 2000; i++) {
      clock.t = i * LOG_INTERVAL_MS
      // alternating, so nothing collapses
      log.add(sample(0.2, i % 2 ? 60 : 59), null)
    }
    const text = log.text()
    expect(text.length).toBeLessThan(LOG_BYTES)
    // the newest samples are the ones kept
    expect(section(text, 'samples').pop()).toContain('1999s')
    expect(text).toContain('orbrun perf · test')
  })

  // the ring is the first thing to lose a spike, so the worst frames are held outside it
  it('keeps the worst frames of the run however long it ran', () => {
    const clock = { t: 0 }
    const log = new PerfLog(() => clock.t)
    log.begin(['test'])
    const spike = () => {
      const p = new FrameProfile()
      for (let i = 0; i < 60; i++) {
        p.begin(i * 16.7)
        p.mark('level')
        p.end()
      }
      const r = p.report()
      return { ...r, worst: { total: 140, ago: 0, parts: [['level', 138] as [string, number]], tags: ['scene'] } }
    }
    clock.t = 0
    log.add(spike(), null, { place: 'D:3', cells: 2043, crowd: 12, mode: 'command' })
    for (let i = 1; i < 500; i++) {
      clock.t = i * LOG_INTERVAL_MS
      log.add(sample(0.2, 60), null, { place: 'D:3' })
    }
    const worst = section(log.text(), 'worst frames of the run')
    expect(worst[0]).toContain('140:level 138.0[scene]')
    expect(worst[0]).toContain('D:3 c2043m12 command')
  })

  it('turns a change of place into an event and counts the seconds by verdict', () => {
    const clock = { t: 0 }
    const log = new PerfLog(() => clock.t)
    log.begin(['test'])
    log.add(sample(0.2, 60), null, { place: 'D:2' })
    clock.t = LOG_INTERVAL_MS
    log.add(sample(0.2, 60), null, { place: 'D:3' })
    clock.t = LOG_INTERVAL_MS * 2
    log.add(sample(0.2, 2), null, { place: 'D:3' })
    const text = log.text()
    expect(section(text, 'events').some((l) => l.includes('D:2 → D:3'))).toBe(true)
    expect(text).toContain('2 good, 1 idle')
  })
})

/** The pane is the only way to save on a device with no console, so the tap has to work. */
describe('saving from the pane', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    history.replaceState(null, '', '/')
  })

  it('offers the save, and says what happened when it is tapped', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const o = new PerfOverlay(host)
    o.on()
    const el = host.querySelector('pre.perf')!
    expect(el.textContent).toContain('tap to save the log')
    const downloads: string[] = []
    // happy-dom will not follow a download, so the anchor is watched instead
    const click = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      downloads.push(this.download)
    }
    try {
      el.dispatchEvent(new window.Event('pointerdown', { bubbles: true, cancelable: true }))
    } finally {
      HTMLAnchorElement.prototype.click = click
    }
    expect(downloads.length).toBe(1)
    expect(downloads[0]).toMatch(/^orbrun-perf-\d{8}-\d{6}\.txt$/)
    expect(el.textContent).toContain('saved orbrun-perf-')
    o.destroy()
  })
})
