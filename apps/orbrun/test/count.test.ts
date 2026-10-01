// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { BLOB_COLUMNS, COUNTED_SETTINGS, COUNT_PATH, DOUBLE_COLUMNS, EVENTS, NUMBER_SETTINGS, SETTING_KEYS, WORD_SETTINGS, countedHost, dataPoint, parseCount, sideParam, versionTag } from '../src/count-events'
import { countUrl } from '../src/count'
import { ALL_SETTING_ROWS } from '../src/settings-rows'
import { defaultSettings, type Settings } from '../src/servers'
import { countEvent, type EventsDataset } from '../worker/count'

/**
 * The counts name nobody: the Worker keeps an event from the list, a bundled
 * server, stable or trunk, the window's size, whether a pad was connected and
 * each setting, and nothing else a beacon carries, not even a header. And
 * nothing is counted once a game is under way.
 */
const q = (s: string) => new URLSearchParams(s)
const DECK = { width: 1280, height: 800 }
/** The defaults as a row keeps them: words as text, numbers as numbers, yes 1 and no 0. */
const defaultText = Object.fromEntries(WORD_SETTINGS.map((k) => [k, String(defaultSettings[k])]))
const defaultNumbers = Object.fromEntries(NUMBER_SETTINGS.map((k) => [k, Number(defaultSettings[k])]))

describe('counts: what the Worker keeps', () => {
  it('keeps a listed event, its server, version, window size, pad and settings', () => {
    expect(parseCount(q('e=boot&w=1280&h=800'))).toEqual({ event: 'boot', text: { event: 'boot', server: '', version: '' }, numbers: { pad: 0, width: 1280, height: 800 } })
    expect(parseCount(q('e=spectate&s=other&pad=1'))).toEqual({ event: 'spectate', text: { event: 'spectate', server: 'other', version: '' }, numbers: { pad: 1 } })
    expect(parseCount(q('e=play&s=cdi&v=trunk&fov=95&hints=off&uiScale=1.15&viewmodel=0&eyeHeight=0.62&nearby=other'))).toEqual({
      event: 'play',
      text: { event: 'play', server: 'cdi', version: 'trunk', hints: 'off', nearby: 'other' },
      numbers: { pad: 0, fov: 95, uiScale: 1.15, viewmodel: 0, eyeHeight: 0.62 },
    })
  })

  it('counts only the start of a game: no event from inside one', () => {
    expect([...EVENTS]).toEqual(['boot', 'play', 'play-offline', 'spectate'])
    for (const e of ['newchar', 'dead', 'won-each', 'rune-each']) expect(parseCount(q(`e=${e}`)), e).toBeNull()
  })

  it('drops anything that could carry a name, or more than it needs', () => {
    for (const s of [
      'e=orbrun',
      'e=play&who=orbrun',
      'e=play&installed=1',
      'e=play&fullscreen=1',
      'e=play&screen=large',
      'e=play&g=dcss-0.34',
      'e=play&v=dcss-0.34',
      'e=play&v=0.34',
      'e=play&s=orbrun.example.com',
      'e=play&s=192.168.1.20',
      'e=play&pad=orbrun',
      'e=play&pad=0',
      'e=play&w=1280x800',
      'e=play&w=20000',
      'e=play&w=-10',
      'e=play&w=12.5',
      'e=play&fov=orbrun',
      'e=play&fov=120',
      'e=play&fov=1e2',
      'e=play&eyeHeight=0.123',
      'e=play&viewmodel=2',
      'e=play&hints=orbrun',
      '',
    ]) expect(parseCount(q(s)), s).toBeNull()
  })

  it('writes the row and nothing of the request', () => {
    const points: unknown[] = []
    const EVENTS: EventsDataset = { writeDataPoint: (p) => void points.push(p) }
    const req = new Request(`https://orbrun.app${countUrl('play-offline', { server: 'offline', game: 'dcss-0.34', settings: defaultSettings, pad: true }, DECK)}`, {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '203.0.113.7', 'User-Agent': 'orbrun-test', Referer: 'https://orbrun.app/play/offline/dcss-0.34#orbrun' },
    })
    expect(countEvent(req, new URL(req.url), { EVENTS }).status).toBe(204)
    expect(points).toEqual([{
      blobs: ['play-offline', 'offline', 'stable', ...WORD_SETTINGS.map((k) => defaultText[k])],
      doubles: [1, 1280, 800, ...NUMBER_SETTINGS.map((k) => defaultNumbers[k])],
      indexes: ['play-offline'],
    }])
    expect(JSON.stringify(points)).not.toMatch(/203\.0\.113|orbrun-test|#orbrun|0\.34/)
  })

  it('names its columns in the order they are written, within what Analytics Engine keeps (20 of each)', () => {
    expect(BLOB_COLUMNS).toEqual(['event', 'server', 'version', 'leftRightKeys', 'leftRightPad', 'hints', 'nearby'])
    expect(DOUBLE_COLUMNS).toEqual(['pad', 'width', 'height', 'eyeHeight', 'restPitch', 'fov', 'viewmodel', 'lookSensitivity', 'invertLook', 'uiScale', 'minimapTiles', 'minimapCell'])
    expect(BLOB_COLUMNS.length).toBeLessThanOrEqual(20)
    expect(DOUBLE_COLUMNS.length).toBeLessThanOrEqual(20)
    expect(new Set([...BLOB_COLUMNS, ...DOUBLE_COLUMNS]).size).toBe(BLOB_COLUMNS.length + DOUBLE_COLUMNS.length)
  })

  it('leaves a column the beacon did not fill empty, or 0', () => {
    const p = dataPoint(parseCount(q('e=boot'))!)
    expect(p.blobs).toEqual(['boot', ...Array(BLOB_COLUMNS.length - 1).fill('')])
    expect(p.doubles).toEqual(Array(DOUBLE_COLUMNS.length).fill(0))
  })

  it('answers the same for a dropped beacon, a GET and a missing dataset', () => {
    const points: unknown[] = []
    const EVENTS: EventsDataset = { writeDataPoint: (p) => void points.push(p) }
    const bad = new Request(`https://orbrun.app${COUNT_PATH}?e=orbrun`, { method: 'POST' })
    const get = new Request(`https://orbrun.app${COUNT_PATH}?e=boot`)
    expect(countEvent(bad, new URL(bad.url), { EVENTS }).status).toBe(204)
    expect(countEvent(get, new URL(get.url), { EVENTS }).status).toBe(204)
    expect(points).toEqual([])
    const ok = new Request(`https://orbrun.app${COUNT_PATH}?e=boot`, { method: 'POST' })
    expect(countEvent(ok, new URL(ok.url), {}).status).toBe(204)
  })

  it('keeps nothing from a browser that asks not to be measured (Sec-GPC)', () => {
    const points: unknown[] = []
    const EVENTS: EventsDataset = { writeDataPoint: (p) => void points.push(p) }
    // a browser's Request drops the Sec- headers it may not set (happy-dom does too); the Workers runtime keeps them
    const url = new URL(`https://orbrun.app${COUNT_PATH}?e=boot`)
    const req = (gpc: string | null) => ({ method: 'POST', headers: new Map(gpc ? [['Sec-GPC', gpc]] : []) }) as unknown as Request
    expect(countEvent(req('1'), url, { EVENTS }).status).toBe(204)
    expect(points).toEqual([])
    countEvent(req(null), url, { EVENTS })
    expect(points).toHaveLength(1)
  })

  it('counts orbrun.app and not workers.dev', () => {
    expect(countedHost('orbrun.app')).toBe(true)
    expect(countedHost('orbrun.someone.workers.dev')).toBe(false)
    expect(countedHost('ORBRUN.SOMEONE.WORKERS.DEV.')).toBe(false)
    expect(countedHost('notworkers.dev')).toBe(true)
  })

  it('keeps nothing sent to a workers.dev address', () => {
    const points: unknown[] = []
    const EVENTS: EventsDataset = { writeDataPoint: (p) => void points.push(p) }
    const req = new Request(`https://orbrun.someone.workers.dev${COUNT_PATH}?e=boot`, { method: 'POST' })
    expect(countEvent(req, new URL(req.url), { EVENTS }).status).toBe(204)
    expect(points).toEqual([])
  })
})

describe('counts: stable or trunk, and the window size', () => {
  it('reads a game id as stable, trunk or other, never which release', () => {
    for (const id of ['dcss-0.34', 'dcss-0.30', 'spr-0.33', 'seeded-0.34', 'tut-0.31']) expect(versionTag(id), id).toBe('stable')
    for (const id of ['dcss-git', 'seeded-git', 'spr-git', 'dcss-web-trunk', 'trunk']) expect(versionTag(id), id).toBe('trunk')
    for (const id of ['zotdef', 'dcss-experimental']) expect(versionTag(id), id).toBe('other')
  })

  it('sends a window side to the nearest ten px, keeping the common sizes exact', () => {
    expect([1280, 800, 1920, 1080, 1366, 1277, 1284, 0, -5, NaN, 50000].map(sideParam)).toEqual(['1280', '800', '1920', '1080', '1370', '1280', '1280', null, null, null, '10000'])
  })

  it('sends a size only when it has both sides', () => {
    expect(countUrl('boot', {}, DECK)).toBe(`${COUNT_PATH}?e=boot&w=1280&h=800`)
    expect(countUrl('boot', {}, { width: 1280, height: 0 })).toBe(`${COUNT_PATH}?e=boot`)
    expect(countUrl('boot', {})).toBe(`${COUNT_PATH}?e=boot`)
  })
})

describe('counts: the settings a game starts on', () => {
  it('counts every setting the player is offered, with the same stops', () => {
    const offered = ALL_SETTING_ROWS.filter((r) => r.key !== 'renderer')
    expect(SETTING_KEYS.slice().sort()).toEqual(offered.map((r) => r.key).sort())
    for (const r of offered) expect([...COUNTED_SETTINGS[r.key as keyof typeof COUNTED_SETTINGS]], r.key).toEqual([...r.values])
  })

  it('keeps words as text and numbers and yes-or-no as numbers', () => {
    expect(WORD_SETTINGS).toEqual(['leftRightKeys', 'leftRightPad', 'hints', 'nearby'])
    expect(NUMBER_SETTINGS).toEqual(['eyeHeight', 'restPitch', 'fov', 'viewmodel', 'lookSensitivity', 'invertLook', 'uiScale', 'minimapTiles', 'minimapCell'])
  })

  it("counts every default as one of its row's stops", () => {
    for (const k of SETTING_KEYS) expect(COUNTED_SETTINGS[k] as readonly unknown[], k).toContain(defaultSettings[k])
  })

  it('keeps a number between two stops as it is, and leaves one out of range out', () => {
    const s: Settings = { ...defaultSettings, eyeHeight: 0.62, fov: 120, invertLook: true }
    const row = parseCount(new URL(countUrl('play', { settings: s }), 'https://orbrun.app').searchParams)!
    expect(row.numbers.eyeHeight).toBe(0.62)
    expect(row.numbers.invertLook).toBe(1)
    expect(row.numbers).not.toHaveProperty('fov')
  })

  it('sends a word off every stop as other', () => {
    const s = { ...defaultSettings, hints: 'sometimes' } as unknown as Settings
    expect(parseCount(new URL(countUrl('play', { settings: s }), 'https://orbrun.app').searchParams)?.text.hints).toBe('other')
  })
})

describe('counts: what the app sends', () => {
  it('sends every event in a form the Worker keeps', () => {
    for (const e of EVENTS) {
      const url = new URL(countUrl(e, { server: 'cdi', game: 'dcss-git', settings: defaultSettings, pad: true }, DECK), 'https://orbrun.app')
      expect(url.pathname).toBe(COUNT_PATH)
      expect(parseCount(url.searchParams), e).toEqual({
        event: e,
        text: { event: e, server: 'cdi', version: 'trunk', ...defaultText },
        numbers: { pad: 1, width: 1280, height: 800, ...defaultNumbers },
      })
    }
  })

  it('sends a pad only when there is one', () => {
    expect(countUrl('spectate', { pad: true })).toBe(`${COUNT_PATH}?e=spectate&pad=1`)
    expect(countUrl('spectate', { pad: false })).toBe(`${COUNT_PATH}?e=spectate`)
  })

  it('names a server added by hand as other, since its address is what the player typed', () => {
    expect(countUrl('play', { server: 'crawl.example.com', game: 'dcss-0.34' })).toBe(`${COUNT_PATH}?e=play&s=other&v=stable`)
    expect(countUrl('play', { server: 'offline', game: 'dcss-git' })).toBe(`${COUNT_PATH}?e=play&s=offline&v=trunk`)
  })
})

describe('counts: sending', () => {
  let sends: string[]
  beforeEach(() => {
    vi.resetModules()
    sends = []
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: (url: string) => (sends.push(url), true) })
    vi.stubGlobal('innerWidth', 1280)
    vi.stubGlobal('innerHeight', 800)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('counts each event once a page load, with the window size', async () => {
    vi.stubEnv('DEV', false)
    const { count } = await import('../src/count')
    count('play', { server: 'cdi' })
    count('play', { server: 'cko' })
    count('spectate')
    expect(sends).toEqual([`${COUNT_PATH}?e=play&s=cdi&w=1280&h=800`, `${COUNT_PATH}?e=spectate&w=1280&h=800`])
  })

  it('sends nothing from a dev server', async () => {
    vi.stubEnv('DEV', true)
    const { count } = await import('../src/count')
    count('boot')
    expect(sends).toEqual([])
  })

  it('sends nothing when the browser asks not to be measured (Global Privacy Control)', async () => {
    vi.stubEnv('DEV', false)
    vi.stubGlobal('navigator', { ...navigator, globalPrivacyControl: true, sendBeacon: (url: string) => (sends.push(url), true) })
    const { count } = await import('../src/count')
    count('boot')
    count('play', { server: 'cdi' })
    expect(sends).toEqual([])
  })

  it('sends nothing from a workers.dev address', async () => {
    vi.stubEnv('DEV', false)
    vi.stubGlobal('location', { ...location, hostname: 'abc123-orbrun.someone.workers.dev' })
    const { count } = await import('../src/count')
    count('boot')
    expect(sends).toEqual([])
  })

  it('never throws at the game when the beacon does', async () => {
    vi.stubEnv('DEV', false)
    vi.stubGlobal('navigator', { sendBeacon: () => { throw new Error('blocked') } })
    const { count } = await import('../src/count')
    expect(() => count('boot')).not.toThrow()
  })
})
