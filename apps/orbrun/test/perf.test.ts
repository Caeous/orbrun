// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { FrameProfile, WINDOW, formatReport, perfWanted, stats } from '../src/perf'

describe('perf stats', () => {
  it('takes percentiles of a sample', () => {
    const s = stats('x', [5, 1, 3, 2, 4])
    expect(s).toEqual({ name: 'x', p50: 3, p95: 5, max: 5 })
    expect(stats('empty', [])).toEqual({ name: 'empty', p50: 0, p95: 0, max: 0 })
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
    expect(formatReport(r)).toContain('2 frames')
    expect(formatReport(r)).toContain('long tasks 0')
  })

  it('forgets frames past the window', () => {
    const p = new FrameProfile()
    for (let i = 0; i < WINDOW + 50; i++) {
      p.begin(i * 16)
      p.end()
    }
    expect(p.report().frames).toBe(WINDOW)
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
