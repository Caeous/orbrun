// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { CHAMFER, defaultSettings, getSavedView, getSettings, leftRightTurns, saveSettings, saveView, VIEW_OPTIONS, WALL_INSET, type DirSource } from '../src/servers'
import { REST_PITCH } from '@orbrun/scene'
import { settingsPanel } from '../src/settings-panel'
import { adjustSetting, ALL_SETTING_ROWS, groupAtDefaults, resetGroup, settingGroups, CAM_ANGLES, EYE_HEIGHTS, MESSAGE_LINES, MESSAGE_LINES_AUTO, MINIMAP_AUTO, MINIMAP_CELLS, MINIMAP_TILES, rowHint, rowOff, SETTING_ROWS, settingValue, FOV_AUTO, FOVS, fovOf, messageLinesOf, setAutoMessageLines, setAutoMinimap } from '../src/settings-rows'

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

describe('what is written down', () => {
  beforeEach(() => store.clear())

  it('is only what the player changed, so a later default reaches everyone who never touched the row', () => {
    saveSettings({ ...defaultSettings })
    expect(JSON.parse(store.get('orbrun.settings')!)).toEqual({})
    saveSettings({ ...defaultSettings, fov: 95 })
    expect(JSON.parse(store.get('orbrun.settings')!)).toEqual({ fov: 95 })
    // the row goes back to its default: the override is dropped, not pinned at today's value
    saveSettings({ ...defaultSettings })
    expect(JSON.parse(store.get('orbrun.settings')!)).toEqual({})
    expect(getSettings().fov).toBe(defaultSettings.fov)
  })

  it('drops the old split hint fields once hints are saved once', () => {
    store.set('orbrun.settings', JSON.stringify({ gamepadHints: 'contextual', keyHints: false }))
    const s = getSettings()
    expect(s.hints).toBe('contextual')
    saveSettings(s)
    expect(JSON.parse(store.get('orbrun.settings')!)).toEqual({ hints: 'contextual' })
  })

  it('keeps only the yaw of the view: a look up or down does not carry over', () => {
    saveView({ yaw: 1.5, pitch: 0.4 } as never)
    expect(JSON.parse(store.get('orbrun.view')!)).toEqual({ yaw: 1.5 })
    expect(getSavedView()).toEqual({ yaw: 1.5 })
    // an older session that wrote a pitch too: the yaw is still read, the pitch ignored
    store.set('orbrun.view', JSON.stringify({ yaw: 2, pitch: 0.3 }))
    expect(getSavedView()).toEqual({ yaw: 2 })
  })

  it('keeps a view the build has taken away rather than erasing it on the next save', () => {
    if (VIEW_OPTIONS) return
    store.set('orbrun.settings', JSON.stringify({ renderer: '2d' }))
    saveSettings(getSettings())
    expect(JSON.parse(store.get('orbrun.settings')!)).toEqual({ renderer: '2d' })
  })
})

describe('camera rows', () => {
  beforeEach(() => saveSettings({ ...defaultSettings }))

  it('Camera height sets the eye', () => {
    const height = row('Camera height')
    expect(height.key).toBe('eyeHeight')
    expect(settingValue(height)).toBe('0.60 cells')
    expect(rowHint(height)).toMatch(/eyes/)
  })

  it('the default eye is a stop and steps a twentieth either way', () => {
    const height = row('Camera height')
    expect(EYE_HEIGHTS).toContain(defaultSettings.eyeHeight)
    adjustSetting(height, -1)
    expect(getSettings().eyeHeight).toBe(0.55)
    saveSettings({ ...defaultSettings })
    adjustSetting(height, 1)
    expect(getSettings().eyeHeight).toBe(0.65)
  })

  it('no row is ever off', () => {
    for (const r of ALL_SETTING_ROWS) expect(rowOff(r)).toBe(false)
  })
})

describe('2D is temporarily out (VIEW_OPTIONS)', () => {
  beforeEach(() => saveSettings({ ...defaultSettings }))

  it('the flag is off, so the View row is not offered', () => {
    expect(VIEW_OPTIONS).toBe(false)
    expect(row('View')).toBeDefined()
    expect(SETTING_ROWS.find((r) => r.label === 'View')).toBeUndefined()
  })

  it('a session saved in 2D comes back in 3D', () => {
    saveSettings({ ...defaultSettings, renderer: '2d' })
    expect(getSettings().renderer).toBe('3d')
  })
})

describe('Camera angle', () => {
  beforeEach(() => saveSettings({ ...defaultSettings }))

  it('looks five degrees down by default, the rest pitch every camera starts on', () => {
    const angle = row('Camera angle')
    expect(defaultSettings.restPitch).toBe(-5)
    expect((Math.PI / 180) * defaultSettings.restPitch).toBeCloseTo(REST_PITCH, 12)
    expect(SETTING_ROWS).toContain(angle)
    expect(settingValue(angle)).toBe('5° down')
    expect(rowOff(angle)).toBe(false)
  })

  it('runs from 30 down to 10 up, five degrees a step, and reads level at the horizon', () => {
    const angle = row('Camera angle')
    expect(CAM_ANGLES[0]).toBe(-30)
    expect(CAM_ANGLES[CAM_ANGLES.length - 1]).toBe(10)
    for (let i = 1; i < CAM_ANGLES.length; i++) expect(CAM_ANGLES[i] - CAM_ANGLES[i - 1]).toBe(5)
    expect(adjustSetting(angle, -1)).toBe('10° down')
    expect(getSettings().restPitch).toBe(-10)
    expect(adjustSetting(angle, 1)).toBe('5° down')
    expect(adjustSetting(angle, 1)).toBe('Level')
    expect(adjustSetting(angle, 1)).toBe('5° up')
    expect(adjustSetting(angle, -1)).toBe('Level')
    expect(getSettings().restPitch).toBe(0)
  })
})

describe('removed settings', () => {
  it('are gone, Corners among them: every wall corner is cut back the same 1/32 (CHAMFER)', () => {
    expect(CHAMFER).toBe(1 / 32)
    for (const label of ['Corners', 'Wall thickness', 'Purist look', 'Render scale', 'Auto-facing', 'Edge pips', 'Key hints', 'Gamepad hints', 'Menu room turn']) expect(ALL_SETTING_ROWS.find((r) => r.label === label)).toBeUndefined()
  })

  it('include Wall thickness: every wall face stands the same 12/32 back (WALL_INSET), whatever a saved session says', () => {
    expect(WALL_INSET).toBe(12 / 32)
    expect('wallInset' in defaultSettings).toBe(false)
    saveSettings({ ...defaultSettings, wallInset: 0 } as never)
    expect(ALL_SETTING_ROWS.some((r) => r.key === 'wallInset')).toBe(false)
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

  it('is Auto by default, and any other stop reads as a tile count', () => {
    const size = row('Minimap size')
    expect(defaultSettings.minimapTiles).toBe(MINIMAP_AUTO)
    expect(settingValue(size)).toBe('Auto (19 tiles)')
    saveSettings({ ...defaultSettings, minimapTiles: 19 })
    expect(settingValue(size)).toBe('19 tiles')
    expect(rowOff(size)).toBe(false)
    expect(rowHint(size)).toMatch(/tiles across/)
  })

  it('runs from Auto over every odd count from 15 (crawl\'s line of sight) to 61, two a step, so the player stands on the centre tile', () => {
    expect(MINIMAP_TILES[0]).toBe(MINIMAP_AUTO)
    const counts = MINIMAP_TILES.slice(1)
    expect(counts[0]).toBe(15)
    expect(counts[counts.length - 1]).toBe(61)
    for (const n of counts) expect(n % 2).toBe(1)
    for (let i = 1; i < counts.length; i++) expect(counts[i] - counts[i - 1]).toBe(2)
  })

  it('right from Auto is the fewest tiles, left the most; then right is two tiles more, left two fewer', () => {
    const size = row('Minimap size')
    expect(adjustSetting(size, 1)).toBe('15 tiles')
    expect(adjustSetting(size, -1)).toBe('Auto (19 tiles)')
    expect(adjustSetting(size, -1)).toBe('61 tiles')
    saveSettings({ ...defaultSettings, minimapTiles: 19 })
    expect(adjustSetting(size, 1)).toBe('21 tiles')
    expect(getSettings().minimapTiles).toBe(21)
    expect(adjustSetting(size, -1)).toBe('19 tiles')
    expect(adjustSetting(size, -1)).toBe('17 tiles')
    expect(getSettings().minimapTiles).toBe(17)
  })
})

describe('Minimap tile size', () => {
  beforeEach(() => saveSettings({ ...defaultSettings }))

  it('is Auto by default, and any other stop reads in px', () => {
    const cell = row('Minimap tile size')
    expect(defaultSettings.minimapCell).toBe(MINIMAP_AUTO)
    expect(settingValue(cell)).toBe('Auto (20px)')
    saveSettings({ ...defaultSettings, minimapCell: 20 })
    expect(settingValue(cell)).toBe('20px')
    expect(rowOff(cell)).toBe(false)
  })

  it('runs from Auto, then 8px to 32px, every stop bigger than the last', () => {
    expect(MINIMAP_CELLS[0]).toBe(MINIMAP_AUTO)
    expect(MINIMAP_CELLS[1]).toBe(8)
    expect(MINIMAP_CELLS[MINIMAP_CELLS.length - 1]).toBe(32)
    for (let i = 1; i < MINIMAP_CELLS.length; i++) expect(MINIMAP_CELLS[i]).toBeGreaterThan(MINIMAP_CELLS[i - 1])
  })

  it('right is the next cell up, left the one down, and the tile count is left alone', () => {
    const cell = row('Minimap tile size')
    expect(adjustSetting(cell, 1)).toBe('8px')
    expect(adjustSetting(cell, -1)).toBe('Auto (20px)')
    saveSettings({ ...defaultSettings, minimapCell: 20 })
    expect(adjustSetting(cell, 1)).toBe('24px')
    expect(getSettings().minimapCell).toBe(24)
    expect(adjustSetting(cell, -1)).toBe('20px')
    expect(adjustSetting(cell, -1)).toBe('16px')
    expect(getSettings().minimapCell).toBe(16)
    expect(getSettings().minimapTiles).toBe(defaultSettings.minimapTiles)
  })
})

describe('Message lines', () => {
  beforeEach(() => saveSettings({ ...defaultSettings }))

  it('is an Interface row, Auto by default (the server\'s layout), any other stop reading as lines', () => {
    const lines = row('Message lines')
    expect(SETTING_ROWS).toContain(lines)
    expect(lines.group).toBe('Interface')
    expect(defaultSettings.messageLines).toBe(MESSAGE_LINES_AUTO)
    expect(settingValue(lines)).toBe('Auto (6 lines)')
    saveSettings({ ...defaultSettings, messageLines: 4 })
    expect(settingValue(lines)).toBe('4 lines')
    expect(rowOff(lines)).toBe(false)
    expect(rowHint(lines)).toMatch(/msg_webtiles_height/)
  })

  it('runs from Auto over every count from 2 to 20, one a step', () => {
    expect(MESSAGE_LINES[0]).toBe(MESSAGE_LINES_AUTO)
    expect(MESSAGE_LINES.slice(1)).toEqual(Array.from({ length: 19 }, (_, i) => 2 + i))
  })

  it('right from Auto is the fewest lines, left the most; then a line a step', () => {
    const lines = row('Message lines')
    expect(adjustSetting(lines, 1)).toBe('2 lines')
    expect(adjustSetting(lines, -1)).toBe('Auto (6 lines)')
    expect(adjustSetting(lines, -1)).toBe('20 lines')
    saveSettings({ ...defaultSettings, messageLines: 6 })
    expect(adjustSetting(lines, 1)).toBe('7 lines')
    expect(adjustSetting(lines, -1)).toBe('6 lines')
    expect(adjustSetting(lines, -1)).toBe('5 lines')
    expect(getSettings().messageLines).toBe(5)
  })

  it('reads Auto with what the game\'s server asks for, and crawl\'s 6 again once the game is gone', () => {
    const lines = row('Message lines')
    setAutoMessageLines(9)
    expect(settingValue(lines)).toBe('Auto (9 lines)')
    setAutoMessageLines(null)
    expect(settingValue(lines)).toBe('Auto (6 lines)')
  })
})

describe('Field of view', () => {
  beforeEach(() => saveSettings({ ...defaultSettings }))
  afterEach(() => vi.unstubAllGlobals())

  /** a phone to grid/host.ts `isPhone`: a finger for a pointer, a short side under 600px */
  const phone = (held: 'upright' | 'sideways') => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(pointer: coarse)' }))
    vi.stubGlobal('screen', { width: 390, height: 844 })
    vi.stubGlobal('innerWidth', held === 'upright' ? 390 : 844)
    vi.stubGlobal('innerHeight', held === 'upright' ? 844 : 390)
  }

  it('is Auto by default: 85° on a computer, 75° on a phone on its side, 110° upright, and the row says which', () => {
    const fov = row('Field of view')
    expect(defaultSettings.fov).toBe(FOV_AUTO)
    expect(FOVS[0]).toBe(FOV_AUTO)
    expect(fovOf(defaultSettings, false, false)).toBe(85)
    expect(fovOf(defaultSettings, false, true)).toBe(85)
    expect(fovOf(defaultSettings, true, false)).toBe(75)
    expect(fovOf(defaultSettings, true, true)).toBe(110)
    expect(settingValue(fov)).toBe('Auto (85°)')
    phone('sideways')
    expect(settingValue(fov)).toBe('Auto (75°)')
    phone('upright')
    expect(settingValue(fov)).toBe('Auto (110°)')
  })

  it('takes a chosen angle on any device', () => {
    const s = { ...defaultSettings, fov: 95 }
    expect(fovOf(s, false)).toBe(95)
    expect(fovOf(s, true, false)).toBe(95)
    expect(fovOf(s, true, true)).toBe(95)
    saveSettings(s)
    expect(settingValue(row('Field of view'))).toBe('95°')
  })

  it('the minimap\'s Auto reads what a game drew it as, and where Auto starts again once the game is gone', () => {
    setAutoMinimap({ tiles: 17, cell: 16 })
    expect(settingValue(row('Minimap size'))).toBe('Auto (17 tiles)')
    expect(settingValue(row('Minimap tile size'))).toBe('Auto (16px)')
    saveSettings({ ...defaultSettings, minimapTiles: 25 })
    expect(settingValue(row('Minimap size'))).toBe('25 tiles')
    setAutoMinimap(null)
    expect(settingValue(row('Minimap tile size'))).toBe('Auto (20px)')
  })

  it('Message lines on Auto is 4 on a phone, whatever the server asks; a chosen count anywhere', () => {
    expect(messageLinesOf(defaultSettings, 9, true)).toBe(4)
    expect(messageLinesOf(defaultSettings, 9, false)).toBe(9)
    expect(messageLinesOf({ ...defaultSettings, messageLines: 8 }, 9, true)).toBe(8)
    setAutoMessageLines(9)
    phone('sideways')
    expect(settingValue(row('Message lines'))).toBe('Auto (4 lines)')
    setAutoMessageLines(null)
  })

  it('upright, the minimap\'s Auto reads the band\'s 13 tiles', () => {
    phone('upright')
    expect(settingValue(row('Minimap size'))).toBe('Auto (13 tiles)')
  })
})

describe('what left and right do', () => {
  beforeEach(() => {
    store.clear()
    saveSettings({ ...defaultSettings })
  })

  const families: [string, DirSource][] = [
    ['Keyboard left/right', 'arrows'],
    ['Keyboard left/right', 'vim'],
    ['Keyboard left/right', 'numpad'],
    ['Gamepad left/right', 'dpad'],
    ['Gamepad left/right', 'lstick'],
  ]

  it('is a Controls row per hand, turning by default', () => {
    for (const [label, source] of families) {
      const r = row(label)
      expect(SETTING_ROWS).toContain(r)
      expect(r.group).toBe('Controls')
      expect(settingValue(r)).toBe('Turn')
      expect(rowOff(r)).toBe(false)
      expect(leftRightTurns(source)).toBe(true)
    }
    // two rows, not the five it was: one per hand, whatever key set or stick the direction came from
    expect(SETTING_ROWS.filter((r) => r.label.endsWith('left/right'))).toHaveLength(2)
  })

  it('is chosen per hand: the keyboard can strafe while the pad still turns', () => {
    expect(adjustSetting(row('Keyboard left/right'), 1)).toBe('Strafe')
    for (const source of ['arrows', 'vim', 'numpad'] as const) expect(leftRightTurns(source)).toBe(false)
    for (const source of ['dpad', 'lstick'] as const) expect(leftRightTurns(source)).toBe(true)
    expect(adjustSetting(row('Gamepad left/right'), 1)).toBe('Strafe')
    expect(leftRightTurns('lstick')).toBe(false)
    expect(leftRightTurns('dpad')).toBe(false)
  })

  it('cycles back to turning, and only what was changed is written down', () => {
    const keys = row('Keyboard left/right')
    adjustSetting(keys, 1)
    expect(JSON.parse(store.get('orbrun.settings')!)).toEqual({ leftRightKeys: 'strafe' })
    expect(adjustSetting(keys, 1)).toBe('Turn')
    expect(JSON.parse(store.get('orbrun.settings')!)).toEqual({})
  })

  /**
   * The five rows this replaced (2026-09-15, one per input family) are read
   * back by hand: a session that strafed on any keyboard set strafes on all
   * three, and the same for the pad's two sources.
   */
  it('reads a session saved with the old row per family back by hand', () => {
    store.set('orbrun.settings', JSON.stringify({ leftRightNumpad: 'strafe' }))
    expect(getSettings().leftRightKeys).toBe('strafe')
    expect(getSettings().leftRightPad).toBe('turn')
    store.set('orbrun.settings', JSON.stringify({ leftRightStick: 'strafe', leftRightArrows: 'turn' }))
    expect(getSettings().leftRightKeys).toBe('turn')
    expect(getSettings().leftRightPad).toBe('strafe')
  })

  /**
   * One group to a page (settings-panel.ts): the settings screen and the pause
   * menu both list the groups as rows, so every offered row has to sit in one
   * of them, and every group has to have a line to print under its name.
   */
  it('lays every offered row out in one of the groups, each with its own line', () => {
    const groups = settingGroups()
    expect(groups.map((g) => g.group)).toEqual(['Camera', 'Controls', 'Interface'])
    for (const g of groups) {
      expect(g.hint.length).toBeGreaterThan(0)
      expect(g.rows.length).toBeGreaterThan(0)
    }
    expect(groups.flatMap((g) => g.rows)).toEqual([...SETTING_ROWS])
  })
})

describe('settings: reset a page to its defaults', () => {
  beforeEach(() => store.clear())

  it("puts back only the page's own settings, and leaves the rest as they were", () => {
    saveSettings({ ...defaultSettings, fov: 60, eyeHeight: 0.3, uiScale: 1.3, minimapTurns: false })
    expect(groupAtDefaults('Camera')).toBe(false)
    resetGroup('Camera')
    const s = getSettings()
    expect(s.fov).toBe(defaultSettings.fov)
    expect(s.eyeHeight).toBe(defaultSettings.eyeHeight)
    expect(groupAtDefaults('Camera')).toBe(true)
    expect(s.uiScale).toBe(1.3)
    expect(s.minimapTurns).toBe(false)
    resetGroup('Interface')
    expect(getSettings().uiScale).toBe(defaultSettings.uiScale)
    expect(document.documentElement.style.getPropertyValue('--ui-scale')).toBe(String(defaultSettings.uiScale))
  })

  it("is a row of each page, above Back, dark while there is nothing to put back", () => {
    const onchange = () => void changes++
    let changes = 0
    for (const { group } of settingGroups()) {
      const panel = settingsPanel(group, { onchange, back: () => {} })
      const ids = panel.rows.map((r) => r.dataset.focus)
      expect(ids.slice(-2)).toEqual(['settings-reset', 'settings-back'])
      const reset = panel.rows[ids.indexOf('settings-reset')]
      expect(reset.classList.contains('off')).toBe(true)
      reset.click()
      expect(changes).toBe(0)
    }
    saveSettings({ ...defaultSettings, invertLook: true })
    const panel = settingsPanel('Controls', { onchange })
    const reset = panel.rows.find((r) => r.dataset.focus === 'settings-reset')!
    expect(reset.classList.contains('off')).toBe(false)
    reset.click()
    expect(getSettings().invertLook).toBe(false)
    expect(changes).toBe(1)
    expect(reset.classList.contains('off')).toBe(true)
  })
})
