import { describe, it, expect } from 'vitest'
import { FILL_ALPHA, FILL_STEPS, FILL_TIP, MAGIC_COLOURS, MINIBAR_CELL, MINIBAR_ROWS, TRACK_COLOUR, WOUND_COLOURS, fillRun, lighten, minibarRects, woundLevel } from '../src/index.js'

describe('woundLevel (mon-util.cc mons_get_damage_level)', () => {
  it('steps through the five classes at crawl’s integer fifths', () => {
    // max 10: <= 2 almost dead, <= 4 severely, <= 6 heavily, <= 8 moderately, < 10 lightly
    const levels = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((hp) => woundLevel(hp, 10))
    expect(levels).toEqual([
      'almost_dead',
      'almost_dead',
      'almost_dead',
      'severely_damaged',
      'severely_damaged',
      'heavily_damaged',
      'heavily_damaged',
      'moderately_damaged',
      'moderately_damaged',
      'lightly_damaged',
      'uninjured',
    ])
  })
  it('rounds the thresholds down like C integer division', () => {
    // max 7: 7/5 = 1, 14/5 = 2, 21/5 = 4, 28/5 = 5
    expect(woundLevel(1, 7)).toBe('almost_dead')
    expect(woundLevel(2, 7)).toBe('severely_damaged')
    expect(woundLevel(3, 7)).toBe('heavily_damaged')
    expect(woundLevel(4, 7)).toBe('heavily_damaged')
    expect(woundLevel(5, 7)).toBe('moderately_damaged')
    expect(woundLevel(6, 7)).toBe('lightly_damaged')
  })
  it('treats no maximum or an overfull bar as uninjured', () => {
    expect(woundLevel(0, 0)).toBe('uninjured')
    expect(woundLevel(12, 10)).toBe('uninjured')
  })
})

describe('fillRun (the icons’ structure along the fill)', () => {
  it('steps the alpha at the frame’s texels 6 and 15 and lights the last fifth and twentieth', () => {
    const run = fillRun(26)
    expect(run[0]).toMatchObject({ x0: 0, x1: 6, alpha: FILL_STEPS[0].alpha, lift: { top: 0, bottom: 0 } })
    expect(run[1]).toMatchObject({ x0: 6, x1: 15, alpha: FILL_STEPS[1].alpha })
    expect(run[2]).toMatchObject({ x0: 15, alpha: FILL_ALPHA })
    expect(run[2].x1).toBeCloseTo(26 * 0.8)
    expect(run[3]).toMatchObject({ lift: { top: FILL_TIP[0].top, bottom: FILL_TIP[0].bottom } })
    expect(run[4]).toMatchObject({ lift: { top: FILL_TIP[1].top, bottom: FILL_TIP[1].bottom } })
    expect(run[4].x1).toBe(26)
    // contiguous, left to right
    for (let i = 1; i < run.length; i++) expect(run[i].x0).toBeCloseTo(run[i - 1].x1)
  })
  it('keeps only the dim start for a short bar, like the almost-dead icon', () => {
    const run = fillRun(6)
    expect(run.every((s) => s.alpha === FILL_STEPS[0].alpha)).toBe(true)
    expect(run.at(-1)!.lift.top).toBe(FILL_TIP[1].top)
  })
  it('scales the alpha steps with the frame', () => {
    const run = fillRun(60, 64)
    expect(run[0].x1).toBe(12)
    expect(run[1].x1).toBe(30)
  })
  it('is one plain segment for a full bar: the two tones, no dim start, no lit tip', () => {
    expect(fillRun(32)).toEqual([{ x0: 0, x1: 32, alpha: FILL_ALPHA, lift: { top: 0, bottom: 0 } }])
    expect(fillRun(23, 23)).toHaveLength(1)
  })
  it('is empty for no fill', () => {
    expect(fillRun(0)).toEqual([])
  })
})

describe('minibarRects (the damage-bar style, on the top edge)', () => {
  const m = { hp: 4, hpMax: 10, mp: 2, mpMax: 5, showHp: true, showMp: true }
  const tracks = (rs: ReturnType<typeof minibarRects>) => rs.filter((r) => r.colour === TRACK_COLOUR)
  const fills = (rs: ReturnType<typeof minibarRects>) => rs.filter((r) => r.colour !== TRACK_COLOUR)
  const extent = (rs: ReturnType<typeof minibarRects>, y: number) => Math.max(0, ...rs.filter((r) => r.y === y).map((r) => r.x + r.w))

  it('draws nothing when both bars are full, or both hidden', () => {
    expect(minibarRects({ ...m, hp: 10, mp: 5 })).toEqual([])
    expect(minibarRects({ ...m, showHp: false, showMp: false })).toEqual([])
    expect(minibarRects(null)).toEqual([])
  })

  it('lays health over magic, two texel rows each, the frame wide', () => {
    const rects = minibarRects(m)
    expect(tracks(rects).map((r) => r.y)).toEqual([0, 1, MINIBAR_ROWS, MINIBAR_ROWS + 1])
    for (const r of rects) expect(r.h).toBe(1)
    for (const t of tracks(rects)) expect(t).toMatchObject({ x: 0, w: MINIBAR_CELL })
    expect(tracks(rects)[0].alpha).toBeLessThan(1)
    // the fills run from the left edge to the exact fraction on both rows of each bar
    const f = fills(rects)
    expect(Math.min(...f.map((r) => r.x))).toBe(0)
    for (const y of [0, 1, MINIBAR_ROWS, MINIBAR_ROWS + 1]) expect(extent(f, y)).toBeCloseTo(MINIBAR_CELL * 0.4)
    // the run: dim at the start, the icons' alpha at the end
    const top = f.filter((r) => r.y === 0).sort((a, b) => a.x - b.x)
    expect(top[0].alpha).toBe(FILL_STEPS[0].alpha)
    expect(top.at(-1)!.alpha).toBe(FILL_STEPS[1].alpha)
  })

  it('colours the health fill by wound level, bright row over dark row, lit at the tip', () => {
    const at = (hp: number) => {
      const f = fills(minibarRects({ ...m, hp })).filter((r) => r.y < MINIBAR_ROWS)
      return { top: f.find((r) => r.y === 0 && r.x === 0)!.colour, bottom: f.find((r) => r.y === 1 && r.x === 0)!.colour, tip: f.filter((r) => r.y === 0).sort((a, b) => b.x - a.x)[0].colour }
    }
    expect(at(9)).toMatchObject({ top: WOUND_COLOURS.lightly_damaged.top, bottom: WOUND_COLOURS.lightly_damaged.bottom, tip: lighten(WOUND_COLOURS.lightly_damaged.top, FILL_TIP[1].top) })
    expect(at(5)).toMatchObject({ top: WOUND_COLOURS.heavily_damaged.top, bottom: WOUND_COLOURS.heavily_damaged.bottom })
    expect(at(1)).toMatchObject({ top: WOUND_COLOURS.almost_dead.top, bottom: WOUND_COLOURS.almost_dead.bottom })
    // the magic fill is WebTiles' magic blue
    const mp = fills(minibarRects(m)).filter((r) => r.y >= MINIBAR_ROWS && r.x === 0)
    expect(mp.map((r) => r.colour)).toEqual([MAGIC_COLOURS.top, MAGIC_COLOURS.bottom])
  })

  it('draws a full health bar when only magic is spent, as WebTiles does', () => {
    const rects = minibarRects({ ...m, hp: 10 })
    expect(tracks(rects)).toHaveLength(4)
    expect(extent(fills(rects), 0)).toBe(MINIBAR_CELL)
    // the two tones only, one rect per row
    const hp = fills(rects).filter((r) => r.y < MINIBAR_ROWS)
    expect(hp.map((r) => r.colour)).toEqual([WOUND_COLOURS.uninjured.top, WOUND_COLOURS.uninjured.bottom])

  })

  it('skips the magic bar for a player with no magic, and the hidden bar', () => {
    expect(tracks(minibarRects({ ...m, mpMax: 0, mp: 0 }))).toHaveLength(2)
    const noHp = minibarRects({ ...m, showHp: false })
    expect(tracks(noHp)).toHaveLength(2)
    expect(noHp[0].y).toBe(0)
  })

  it('keeps a texel of fill while anything is left, none at zero', () => {
    expect(extent(fills(minibarRects({ ...m, hp: 1, hpMax: 1000 })), 0)).toBe(1)
    expect(fills(minibarRects({ ...m, hp: 0 })).filter((r) => r.y < MINIBAR_ROWS)).toHaveLength(0)
  })
})
