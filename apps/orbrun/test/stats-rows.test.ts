import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { initialState, reduce, type ServerMessage } from '@orbrun/webtiles'
import { HP_BAR, MP_BAR, PORTRAIT_ROWS, statsRows } from '../src/grid/stats'
import { rowLength, type Row } from '../src/grid/rows'
import { STAT_WIDTH } from '../src/grid/console'

const here = dirname(fileURLToPath(import.meta.url))

/** the recorded CDI 0.34 spectating session (packages/webtiles/test/fixtures), replayed to its last `player` message */
function recordedState() {
  const text = readFileSync(join(here, '../../../packages/webtiles/test/fixtures/cdi-0.34-watch.ndjson'), 'utf8')
  const st = initialState()
  for (const l of text.trim().split('\n')) reduce(st, JSON.parse(l).m as ServerMessage)
  return st
}

describe('stats pane rows beside the portrait', () => {
  const st = recordedState()

  it('leaves the portrait its cells on the first rows only, and keeps the pane width', () => {
    const plain = statsRows(st.player, st.options).rows
    const { rows } = statsRows(st.player, st.options, {}, STAT_WIDTH, 5)
    expect(rows.length).toBe(plain.length)
    for (let i = 0; i < PORTRAIT_ROWS; i++) {
      expect(rows[i][0].text).toBe('     ')
      expect(rows[i][0].bg).toBeUndefined()
      expect(rowLength(rows[i])).toBeLessThanOrEqual(STAT_WIDTH)
      // the same words, moved over (a floated marker's padding shrinks with the room)
      const words = (row: typeof plain[number]) => row.map((s) => s.text).join('').replace(/ +/g, ' ').trim()
      expect(words(rows[i].slice(1))).toBe(words(plain[i]))
    }
    // the row under the portrait and everything below it run the full width, unchanged
    for (let i = PORTRAIT_ROWS; i < rows.length; i++) expect(rows[i]).toEqual(plain[i])
    expect(rows[PORTRAIT_ROWS][0].text).toBe('AC:')
  })

  it('runs the Health and Magic bars from the portrait to one column, the values to the right of them', () => {
    for (const lead of [0, 9]) {
      const { rows } = statsRows({ ...st.player, hp: 13, hp_max: 13, real_hp_max: 13, mp: 6, mp_max: 6 }, st.options, {}, STAT_WIDTH, lead)
      const ends: number[] = []
      for (const [i, value] of [
        [2, '13/13'],
        [3, '6/6'],
      ] as const) {
        const row = rows[i]
        expect(rowLength(row)).toBe(STAT_WIDTH)
        expect(row.some((s) => /Health|Magic/.test(s.text))).toBe(false)
        const barAt = row.findIndex((s) => typeof s.bg === 'string')
        const barEnd = row.findLastIndex((s) => typeof s.bg === 'string')
        // the bar starts where the portrait's room does
        expect(rowLength(row.slice(0, barAt))).toBe(lead)
        expect(row[barEnd + 1]).toEqual({ text: ' ' })
        expect(row[barEnd + 2].text + row[barEnd + 3].text).toBe(value)
        expect(row[barEnd + 2].title).toBe(i === 2 ? 'Health' : 'Magic')
        // the value is left-aligned in its column, so the shorter one is padded to the pane's edge
        expect(row.slice(barEnd + 2).map((s) => s.text).join('')).toBe(value.padEnd('13/13'.length))
        ends.push(rowLength(row.slice(0, barEnd + 1)))
      }
      // both bars end together, one cell before the wider value, having filled the rest of the room
      expect(ends[0]).toBe(ends[1])
      expect(ends[0]).toBe(STAT_WIDTH - '13/13'.length - 1)
    }
  })

  it('names a drained maximum as WebTiles does, HP with the real max in parentheses', () => {
    const { rows } = statsRows({ ...st.player, hp: 13, hp_max: 13, real_hp_max: 20 }, st.options)
    const barEnd = rows[2].findLastIndex((s) => typeof s.bg === 'string')
    expect(rows[2].slice(barEnd + 2).map((s) => s.text).join('').trim()).toBe('13/13 (20)')
    expect(rows[2][barEnd + 2].title).toBe('HP')
  })

  it('still floats the wizmode marker to the right edge of the pane', () => {
    const p = { ...st.player, wizard: true }
    const { rows } = statsRows(p, st.options, {}, STAT_WIDTH, 5)
    expect(rowLength(rows[0])).toBe(STAT_WIDTH)
    expect(rows[0][rows[0].length - 1].text).toBe('*WIZARD*')
  })

  it('cuts a long title to the room beside the portrait', () => {
    const p = { ...st.player, name: 'A'.repeat(30), title: 'the Very Long Titled' }
    const { rows } = statsRows(p, st.options, {}, STAT_WIDTH, 5)
    expect(rowLength(rows[0])).toBe(STAT_WIDTH)
  })

  it('draws no portrait cells when none are asked for', () => {
    const { rows } = statsRows(st.player, st.options)
    expect(rows[0][0].text.startsWith(st.player.name)).toBe(true)
  })
})

describe('stats pane bars in WebTiles’ style', () => {
  const st = recordedState()
  // the Health row is the pane's third, the Magic row its fourth (update_stats_pane order)
  const HP_ROW = 2
  const MP_ROW = 3
  /** the bar: one span over its cells, the whole bar in a single background */
  const barOf = (row: number, p = st.player, prev = {}) => {
    const spans = statsRows(p, st.options, prev).rows[row].filter((s) => typeof s.bg === 'string') as { text: string; bg: string }[]
    expect(spans).toHaveLength(1)
    return spans[0]
  }
  /** the background's stops: `update_bar`'s segments left to right, each a palette entry (or `track`, the bars' own dark
      darkgray) over its stretch of the bar */
  const TRACK = 'track'
  const stops = (bg: string) =>
    [...bg.matchAll(/var\((--[a-z0-9-]+)\) ([\d.]+)% ([\d.]+)%/g)].map((s) => ({
      colour: s[1] === '--stats-bar-track' ? TRACK : +s[1].replace('--color-', ''),
      from: +s[2],
      to: +s[3],
    }))
  /** where a value falls along the bar, as the percentage a stop carries: `update_bar`'s percentage of the maximum */
  const frac = (v: number, max: number) => Math.round((10000 * v) / max) / 100

  it('paints the health bar in style.css’s colours: lightgreen on a dark track, the row’s full height', () => {
    const hurtBg = barOf(HP_ROW, { ...st.player, hp: 4, hp_max: 21, real_hp_max: 21, poison_survival: 4 }).bg
    const hurt = stops(hurtBg)
    // the track is styles.css's `--stats-bar-track`, not the palette's darkgray as it stands: WebTiles' darkgray
    // reads dark because its pane is black, and the pane here is bare over the dungeon
    expect(hurtBg).toContain('var(--stats-bar-track)')
    expect(hurtBg).not.toContain('var(--color-8)')
    // the fill is #stats_hp_bar_full lightgreen whatever the wound level, as WebTiles paints it, and the rest
    // of the bar is #stats_hp_bar's darkgray track — two flat blocks, nothing translucent and no bevel
    expect(hurt).toEqual([
      { colour: HP_BAR.full, from: 0, to: frac(4, 21) },
      { colour: TRACK, from: frac(4, 21), to: 100 },
    ])

    const fine = barOf(HP_ROW, { ...st.player, hp: 21, hp_max: 21, real_hp_max: 21, poison_survival: 21 })
    // a full bar: the fill alone, the bar's whole width, no track left
    expect(stops(fine.bg)).toEqual([{ colour: HP_BAR.full, from: 0, to: 100 }])
    // the bar runs from the pane's left edge to the value's column (a cell and "21/21")
    expect(fine.text.length).toBe(STAT_WIDTH - '21/21'.length - 1)
    // game.html gives .bar `height: 1em`: one background over the row, not rows laid inside it
    expect(fine.bg).not.toContain('var(--ch')
    expect(fine.bg).not.toContain('no-repeat')
  })

  it('keeps update_bar’s segments: poison yellow, the loss red, the gain green', () => {
    const poisoned = stops(barOf(HP_ROW, { ...st.player, hp: 12, hp_max: 21, poison_survival: 8 }).bg)
    // full (to poison_survival), then #stats_hp_bar_poison yellow for the rest of hp
    expect(poisoned[0]).toEqual({ colour: HP_BAR.full, from: 0, to: frac(8, 21) })
    expect(poisoned[1].colour).toBe(14)
    expect(poisoned[1].from).toBe(frac(8, 21))
    // update_bar rounds each segment, so the poison's end is the two percentages summed, not the one for 12 of 21
    expect(poisoned[1].to).toBeCloseTo(frac(8, 21) + frac(4, 21), 2)

    const lost = stops(barOf(HP_ROW, { ...st.player, hp: 8, hp_max: 21, poison_survival: 8 }, { hp: 16 }).bg)
    // #stats_hp_bar_decrease red, past the fill: the part just lost
    expect(lost[1].colour).toBe(HP_BAR.decrease)
    expect(lost[1].from).toBe(frac(8, 21))
    expect(lost[1].to).toBeCloseTo(frac(16, 21), 2)

    const gained = stops(barOf(HP_ROW, { ...st.player, hp: 16, hp_max: 21, poison_survival: 16 }, { hp: 8 }).bg)
    // #stats_hp_bar_increase green, from the old value to the new: the part just gained
    expect(gained[0].colour).toBe(HP_BAR.full)
    expect(gained[1].colour).toBe(HP_BAR.increase)
    expect(gained[1].from).toBe(frac(8, 21))
    expect(gained[1].to).toBeCloseTo(frac(16, 21), 2)
  })

  it('remembers nothing from the pane drawn before the first player message (player.js old_hp)', () => {
    // game_init leaves hp_max 0; the HUD draws that pane, then the first player message arrives
    const blank = statsRows(initialState().player, st.options)
    expect(blank.prev.hp).toBeUndefined()
    expect(blank.prev.mp).toBeUndefined()
    const first = statsRows({ ...st.player, hp: 21, hp_max: 21, real_hp_max: 21, poison_survival: 21 }, st.options, blank.prev)
    const bar = first.rows[HP_ROW].filter((s) => typeof s.bg === 'string') as { bg: string }[]
    // a full bar, one segment: no "increase" green over the whole width
    expect(stops(bar[0].bg)).toEqual([{ colour: HP_BAR.full, from: 0, to: 100 }])
    expect(first.prev.hp).toBe(21)
    expect(first.prev.mp).toBe(Math.max(0, st.player.mp))
  })

  it('keeps the bar’s length while health climbs past a digit, and paints a level-up as an increase (player.js update_bar)', () => {
    const barAt = (hp: number, hp_max: number, prev = {}) => barOf(HP_ROW, { ...st.player, hp, hp_max, real_hp_max: hp_max, poison_survival: hp }, prev)
    // 9/120 and 100/120 show the same bar length: the value column is sized for 120/120
    expect(barAt(9, 120).text.length).toBe(barAt(100, 120).text.length)
    expect(barAt(9, 120).text.length).toBe(barAt(120, 120).text.length)
    // a level-up from 20/20 to 26/26: full to the old value, the gain green to the bar's end (update_bar's
    // segments are percentages of the new max: 7692 + 2307)
    const up = stops(barAt(26, 26, { hp: 20 }).bg)
    expect(up[0].colour).toBe(HP_BAR.full)
    expect(up[1].colour).toBe(HP_BAR.increase)
    // update_bar floors the change, so a bar filled by a level-up ends a hundredth of a percent short
    expect(up[up.length - 1].to).toBeCloseTo(100, 1)
    // a drained max from 26/26 to 20/20: old_hp is clamped to the max, so no change segment
    expect(stops(barAt(20, 20, { hp: 26 }).bg)).toEqual([{ colour: HP_BAR.full, from: 0, to: 100 }])
    // a max that outgrows the column, 99/99 to 100/100, shifts the bar by the two digits gained and no more
    expect(barAt(99, 99).text.length).toBe(barAt(100, 100).text.length + 2)
  })

  it('paints the magic bar in style.css’s lightblue', () => {
    const mp = barOf(MP_ROW, { ...st.player, species: 'Human', mp: 3, mp_max: 8 })
    expect(stops(mp.bg)).toEqual([
      { colour: MP_BAR.full, from: 0, to: 37.5 },
      { colour: TRACK, from: 37.5, to: 100 },
    ])
  })
})

/**
 * The narrow pane (grid/stats.ts `COMPACT_WIDTH`), which WebTiles has no
 * counterpart for: its `#stats` is always `enums.stat_width` wide.
 */
describe('stats pane on a narrow sidebar', () => {
  const st = recordedState()
  const width = 30
  const HP = 2
  const text = (row: Row) => row.map((s) => s.text).join('')
  const rowWith = (rows: Row[], re: RegExp) => rows.find((r) => re.test(text(r))) as Row | undefined

  it('cuts the captions to what names them and keeps every row inside the pane', () => {
    const { rows } = statsRows(st.player, st.options, {}, width, 4)
    for (const row of rows) expect(rowLength(row)).toBeLessThanOrEqual(width)
    // `Next:` goes entirely; the percentage follows the level
    expect(text(rowWith(rows, /XL:/)!)).toMatch(/XL: \d+ +\d+%/)
    expect(rowWith(rows, /Next/)).toBeUndefined()
    for (const short of [/ St: /, / In: /, / Dx: /, / @: /, / T: /, /^N:/]) expect(rowWith(rows, short)).toBeDefined()
    for (const long of [/Str:/, /Int:/, /Dex:/, /Place:/, /Turn:|Time:/, /Noise:/]) expect(rowWith(rows, long)).toBeUndefined()
    // the caption WebTiles prints stays as the short one's tooltip
    expect(rowWith(rows, / @: /)!.find((s) => s.text === '@:')!.title).toBe('Place')
  })

  it('stands the portrait on four rows, as the wide pane does', () => {
    const lead = 4
    const blank = ' '.repeat(lead)
    const wide = statsRows(st.player, st.options, {}, STAT_WIDTH, lead).rows
    const narrow = statsRows(st.player, st.options, {}, width, lead).rows
    // both keep four rows beside the portrait: the title, the species line and the two bars
    for (const rows of [wide, narrow]) {
      for (let i = 0; i < 4; i++) expect(rows[i][0].text).toBe(blank)
      expect(rows[4][0].text).not.toBe(blank)
    }
    // the Health bar starts after the portrait and the row still ends at the pane's right edge
    expect(narrow[HP][1].bg).toBeTypeOf('string')
    expect(rowLength(narrow[HP])).toBe(width)
  })
})

/** The strip across the top of a phone held upright (grid/stats.ts `stripRows`), which WebTiles has no counterpart for. */
describe('stats pane as a strip', () => {
  const st = recordedState()
  const text = (row: Row) => row.map((s) => s.text).join('')
  const lead = 9

  it('stands the title, the species line and the bars beside the portrait, the level, the place, the noise, the time and the six stats at the right', () => {
    for (const width of [58, 62]) {
      const rows = statsRows(st.player, st.options, {}, width, lead, true).rows
      for (const row of rows) expect(rowLength(row)).toBeLessThanOrEqual(width)
      for (let i = 0; i < PORTRAIT_ROWS; i++) expect(rows[i][0].text).toBe(' '.repeat(lead))
      expect(text(rows[0])).toMatch(/^ +Dwarfsong .* XL: 14 \d+%/)
      expect(text(rows[1])).toMatch(/^ +Mountain Dwarf .* @: Snake Pit:2/)
      expect(rows[2][1].bg).toBeTypeOf('string')
      expect(rows[3][1].bg).toBeTypeOf('string')
      // the defences over the attributes, three a row, each column lined up
      expect(text(rows[2])).toMatch(/AC: 35 EV: 7 +SH: 11$/)
      expect(text(rows[3])).toMatch(/St: 30 In: 10 Dx: 9 *$/)
      expect(text(rows[2]).indexOf('EV:')).toBe(text(rows[3]).indexOf('In:'))
      // the stats block starts on one column down the four rows
      const at = text(rows[0]).indexOf('XL:')
      for (const [i, re] of [[1, '@:'], [2, 'AC:'], [3, 'St:']] as const) expect(text(rows[i]).indexOf(re)).toBe(at)
      // the noise beside the level and the time beside the place, on one column
      expect(text(rows[0]).indexOf('N:')).toBeGreaterThan(at)
      expect(text(rows[1]).indexOf('T:')).toBe(text(rows[0]).indexOf('N:'))
      // the last action's length is left out: the strip has no room for it
      expect(text(rows[1])).toMatch(/T: \d+(\.\d)?$/)
    }
  })

  it('keeps the time room for a long game\'s count, so it is never cut and a growing count moves nothing, a cell clear of the edge', () => {
    const at = (time: number) => statsRows({ ...st.player, time, turn: Math.round(time / 10) }, st.options, {}, 58, lead, true).rows
    const short = at(10)
    const long = at(1234567)
    expect(text(long[1])).toMatch(/T: \d{5,7}(\.\d)?$/)
    for (const rows of [short, long]) for (const row of rows) expect(rowLength(row)).toBeLessThanOrEqual(57)
    // the bars and the block stand where they stood
    expect(text(long[1]).indexOf('T:')).toBe(text(short[1]).indexOf('T:'))
    expect(text(long[2])).toBe(text(short[2]))
  })

  it('puts what is in hand under the portrait, the whole width of it, then the status lights', () => {
    const rows = statsRows(st.player, st.options, {}, 58, lead, true).rows
    expect(text(rows[4])).toBe('e) +2 hand axe (elec)  Throw: 23 darts (poison)')
    expect(text(rows[5])).toBe('Drain')
    expect(rows).toHaveLength(6)
    // Doom and Contam, when they show, stand at its right end
    const doomed = statsRows({ ...st.player, doom: 40, contam: 120 }, st.options, {}, 58, lead, true).rows
    expect(text(doomed[4])).toMatch(/^e\) .*Dm: 40% +Cn: 120%$/)
  })

  it('wraps the status lights short of the minimap\'s column beside them', () => {
    const lit = { ...st.player, status: ['Slow', 'Poison', 'Might', 'Agile', 'Haste'].map((light) => ({ light, col: 7 })) } as typeof st.player
    expect(statsRows(lit, st.options, {}, 58, lead, true).rows.slice(5).map(text)).toEqual(['Slow Poison Might Agile Haste'])
    const short = statsRows(lit, st.options, {}, 58, lead, true, 16).rows.slice(5)
    expect(short.map((r) => text(r).trimEnd())).toEqual(['Slow Poison', 'Might Agile', 'Haste'])
    for (const row of short) expect(rowLength(row)).toBeLessThanOrEqual(16)
  })

  it('a pane with no Magic row keeps its block where it was', () => {
    const rows = statsRows({ ...st.player, species: 'Djinni' }, st.options, {}, 58, lead, true).rows
    expect(text(rows[3])).toMatch(/^ +St: 30/)
    expect(text(rows[3]).indexOf('St:')).toBe(text(rows[0]).indexOf('XL:'))
  })
})
