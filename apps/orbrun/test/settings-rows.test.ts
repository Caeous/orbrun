// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { CHAMFER, defaultSettings, getSettings, saveSettings, VIEW_OPTIONS, WALL_INSET } from '../src/servers'
import { REST_PITCH } from '@orbrun/scene'
import { adjustSetting, ALL_SETTING_ROWS, CAM_ANGLES, CAM_HEIGHTS, MINIMAP_CELLS, MINIMAP_TILES, rowHint, rowKey, rowOff, SETTING_ROWS, settingValue } from '../src/settings-rows'

// happy-dom's localStorage has no working methods; give servers.ts a plain one
const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  },
})

/** Any row, offered or not; `SETTING_ROWS` is what the player sees. */
const row = (label: string) => ALL_SETTING_ROWS.find((r) => r.label === label)!
const third = () => ({ ...defaultSettings, view: 'third' as const })

describe('camera rows follow the Camera setting', () => {
  beforeEach(() => saveSettings({ ...defaultSettings }))

  it('Camera height sets the eye in first person and the shot in third', () => {
    const height = row('Camera height')
    expect(rowKey(height)).toBe('eyeHeight')
    expect(settingValue(height)).toBe('0.60 cells')
    expect(rowHint(height)).toMatch(/eyes/)
    expect(rowKey(height, third())).toBe('camHeight')
    expect(settingValue(height, third())).toBe('0.75 cells')
    expect(rowHint(height, third())).toMatch(/third-person/)
  })

  it('each height is kept on its own', () => {
    const height = row('Camera height')
    adjustSetting(height, 1)
    expect(getSettings().eyeHeight).toBe(0.65)
    expect(getSettings().camHeight).toBe(0.75)
  })

  it('the default eye is a stop and steps a twentieth either way', () => {
    const height = row('Camera height')
    expect(CAM_HEIGHTS).toContain(defaultSettings.eyeHeight)
    adjustSetting(height, -1)
    expect(getSettings().eyeHeight).toBe(0.55)
    saveSettings({ ...defaultSettings })
    adjustSetting(height, 1)
    expect(getSettings().eyeHeight).toBe(0.65)
  })

  it('Camera distance is off in first person and inert, on in third', () => {
    const dist = row('Camera distance')
    expect(rowOff(dist)).toBe(true)
    expect(rowHint(dist)).toMatch(/Third person only/)
    expect(adjustSetting(dist, 1)).toBe('0.70 cells')
    expect(getSettings().camDistance).toBe(0.7)
    expect(rowOff(dist, third())).toBe(false)
    expect(rowHint(dist, third())).toMatch(/How far behind/)
  })

  it('no other row is ever off', () => {
    for (const view of ['first', 'third'] as const) {
      saveSettings({ ...defaultSettings, view })
      for (const r of SETTING_ROWS) if (r.label !== 'Camera distance') expect(rowOff(r)).toBe(false)
    }
  })
})

describe('2D and third person are temporarily out (VIEW_OPTIONS)', () => {
  beforeEach(() => saveSettings({ ...defaultSettings }))

  it('the flag is off, so the rows that choose them are not offered', () => {
    expect(VIEW_OPTIONS).toBe(false)
    for (const label of ['View', 'Camera', 'Camera distance']) {
      expect(row(label)).toBeDefined()
      expect(SETTING_ROWS.find((r) => r.label === label)).toBeUndefined()
    }
  })

  it('a session saved in 2D or third person comes back in 3D first person', () => {
    saveSettings({ ...defaultSettings, renderer: '2d', view: 'third' })
    expect(getSettings().renderer).toBe('3d')
    expect(getSettings().view).toBe('first')
  })

  it('no offered row is ever off, since the only one that can be is out', () => {
    for (const r of SETTING_ROWS) expect(rowOff(r)).toBe(false)
  })
})

describe('Camera angle', () => {
  beforeEach(() => saveSettings({ ...defaultSettings }))

  it('looks ten degrees down by default, the rest pitch every camera starts on', () => {
    const angle = row('Camera angle')
    expect(defaultSettings.restPitch).toBe(-10)
    expect((Math.PI / 180) * defaultSettings.restPitch).toBeCloseTo(REST_PITCH, 12)
    expect(SETTING_ROWS).toContain(angle)
    expect(settingValue(angle)).toBe('10° down')
    expect(rowOff(angle)).toBe(false)
  })

  it('runs from 30 down to 10 up, five degrees a step, and reads level at the horizon', () => {
    const angle = row('Camera angle')
    expect(CAM_ANGLES[0]).toBe(-30)
    expect(CAM_ANGLES[CAM_ANGLES.length - 1]).toBe(10)
    for (let i = 1; i < CAM_ANGLES.length; i++) expect(CAM_ANGLES[i] - CAM_ANGLES[i - 1]).toBe(5)
    expect(adjustSetting(angle, 1)).toBe('5° down')
    expect(getSettings().restPitch).toBe(-5)
    expect(adjustSetting(angle, 1)).toBe('Level')
    expect(adjustSetting(angle, 1)).toBe('5° up')
    expect(adjustSetting(angle, -1)).toBe('Level')
    expect(getSettings().restPitch).toBe(0)
  })
})

describe('removed settings', () => {
  it('are gone, Corners among them: every wall corner is cut back the same 1/32 (CHAMFER)', () => {
    expect(CHAMFER).toBe(1 / 32)
    for (const label of ['Corners', 'Wall thickness', 'Purist look', 'Render scale', 'Auto-facing', 'Edge pips', 'Key hints', 'Gamepad hints']) expect(ALL_SETTING_ROWS.find((r) => r.label === label)).toBeUndefined()
  })

  it('include Wall thickness: every wall face stands the same 12/32 back (WALL_INSET), whatever a saved session says', () => {
    expect(WALL_INSET).toBe(12 / 32)
    expect('wallInset' in defaultSettings).toBe(false)
    saveSettings({ ...defaultSettings, wallInset: 0 } as never)
    expect(ALL_SETTING_ROWS.some((r) => rowKey(r, getSettings()) === 'wallInset')).toBe(false)
  })
})

describe('Nearby', () => {
  beforeEach(() => saveSettings({ ...defaultSettings }))

  it('is the edge pips by default in 3D, or the WebTiles monster list: one or the other', () => {
    const nearby = row('Nearby')
    expect(defaultSettings.nearby).toBe('pips')
    expect(settingValue(nearby)).toBe('Edge pips')
    expect(adjustSetting(nearby, 1)).toBe('Monster list')
    expect(getSettings().nearby).toBe('list')
    expect(adjustSetting(nearby, 1)).toBe('Edge pips')
    expect(nearby.values).toEqual(['list', 'pips'])
  })

  it('is off in 2D, where the list always shows', () => {
    const nearby = row('Nearby')
    expect(rowOff(nearby)).toBe(false)
    // 2D is out for now (VIEW_OPTIONS), so ask the row directly rather than through storage
    const flat = { ...defaultSettings, renderer: '2d' as const }
    expect(rowOff(nearby, flat)).toBe(true)
    expect(rowHint(nearby, flat)).toMatch(/3D only/)
  })
})

describe('Hints', () => {
  beforeEach(() => saveSettings({ ...defaultSettings }))

  it('is one row for gamepad and keyboard, adaptive by default, then contextual, then off', () => {
    const hints = row('Hints')
    expect(defaultSettings.hints).toBe('adaptive')
    expect(SETTING_ROWS).toContain(hints)
    expect(hints.group).toBe('Controls')
    expect(settingValue(hints)).toBe('Adaptive')
    expect(rowOff(hints)).toBe(false)
    expect(adjustSetting(hints, 1)).toBe('Contextual only')
    expect(getSettings().hints).toBe('contextual')
    expect(adjustSetting(hints, 1)).toBe('Off')
    expect(getSettings().hints).toBe('off')
    expect(adjustSetting(hints, 1)).toBe('Adaptive')
  })
})

describe('Minimap size', () => {
  beforeEach(() => saveSettings({ ...defaultSettings }))

  it('is 19 tiles across by default (enough of the level to read at a glance) and reads as a tile count', () => {
    const size = row('Minimap size')
    expect(defaultSettings.minimapTiles).toBe(19)
    expect(MINIMAP_TILES).toContain(19)
    expect(settingValue(size)).toBe('19 tiles')
    expect(rowOff(size)).toBe(false)
    expect(rowHint(size)).toMatch(/tiles across/)
  })

  it('runs over every odd count from 9 to 61, two a step, so the player stands on the centre tile', () => {
    expect(MINIMAP_TILES[0]).toBe(9)
    expect(MINIMAP_TILES[MINIMAP_TILES.length - 1]).toBe(61)
    for (const n of MINIMAP_TILES) expect(n % 2).toBe(1)
    for (let i = 1; i < MINIMAP_TILES.length; i++) expect(MINIMAP_TILES[i] - MINIMAP_TILES[i - 1]).toBe(2)
  })

  it('right is two tiles more, left two fewer', () => {
    const size = row('Minimap size')
    expect(adjustSetting(size, 1)).toBe('21 tiles')
    expect(getSettings().minimapTiles).toBe(21)
    expect(adjustSetting(size, -1)).toBe('19 tiles')
    expect(adjustSetting(size, -1)).toBe('17 tiles')
    expect(getSettings().minimapTiles).toBe(17)
  })
})

describe('Minimap tile size', () => {
  beforeEach(() => saveSettings({ ...defaultSettings }))

  it('is the 20px cell the map follows the player at, and reads in px', () => {
    const cell = row('Minimap tile size')
    expect(defaultSettings.minimapCell).toBe(20)
    expect(MINIMAP_CELLS).toContain(20)
    expect(settingValue(cell)).toBe('20px')
    expect(rowOff(cell)).toBe(false)
  })

  it('runs from 8px to 32px, every stop bigger than the last', () => {
    expect(MINIMAP_CELLS[0]).toBe(8)
    expect(MINIMAP_CELLS[MINIMAP_CELLS.length - 1]).toBe(32)
    for (let i = 1; i < MINIMAP_CELLS.length; i++) expect(MINIMAP_CELLS[i]).toBeGreaterThan(MINIMAP_CELLS[i - 1])
  })

  it('right is the next cell up, left the one down, and the tile count is left alone', () => {
    const cell = row('Minimap tile size')
    expect(adjustSetting(cell, 1)).toBe('24px')
    expect(getSettings().minimapCell).toBe(24)
    expect(adjustSetting(cell, -1)).toBe('20px')
    expect(adjustSetting(cell, -1)).toBe('16px')
    expect(getSettings().minimapCell).toBe(16)
    expect(getSettings().minimapTiles).toBe(defaultSettings.minimapTiles)
  })
})
