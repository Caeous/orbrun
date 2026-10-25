import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { charOf, morgueDate, morgueStamp, parseMorgue, placeOf, serverMorgueHead, serverMorgues } from '../src/morgues'
import { findServer, getMorgueDir, setMorgueDir } from '../src/servers'

// a plain localStorage for servers.ts and the heads kept
const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  },
})

/** A morgue's head, as crawl writes it (hiscores.cc `hiscore_line`, verbose), and the overview's title under it. */
const head = (version: string, lines: string[]) => [` Dungeon Crawl Stone Soup version ${version} (webtiles) character file.`, '', 'Game seed: 27', '', ...lines, '', 'orbrun the Covert (Vine Stalker Enchanter)          Turns: 2296, Time: 00:20:19', ''].join('\n')
const at = (l: string) => '             ' + l

const SLAIN = head('0.35-a0-1027-gfe65402f27', ['545 orbrun the Covert (level 7, 0/33 HPs)', at('Began as a Vine Stalker Enchanter on Sept 15, 2026.'), at('Slain by a gnoll'), at('... wielding a +0 halberd of entangling'), at(' (1 damage)'), at('... on level 4 of the Dungeon.'), at('The game lasted 00:20:18 (2296 turns).')])
const NEXT_DAY = head('0.35-a0-1027-gfe65402f27', ['53 orbrun the Sneak (level 3, -4/16 HPs)', at('Began as a Vine Stalker Enchanter on Sept 15, 2026.'), at('Slain by Natasha (6 damage)'), at('... on level 2 of the Dungeon on Sept 16, 2026.'), at('The game lasted 00:07:16 (1202 turns).')])
const AFAR = head('0.35-a0-1027-gfe65402f27', ['257 orbrun the Cutter (level 6, 0/30 HPs)', at('Began as a Vine Stalker Enchanter on Sept 15, 2026.'), at('Killed from afar by an orc wizard (4 damage)'), at('... with a puff of flame'), at('... on level 3 of the Dungeon.'), at('The game lasted 00:06:48 (2164 turns).')])
const QUIT = head('0.34.1-4-g0e95e087e2', ['0 orbrun the Cudgeller (level 1, 20/20 HPs)', at('Began as a Gnoll Reaver on Sept 10, 2026.'), at('Quit the game on level 1 of the Dungeon on Sept 14, 2026.'), at('The game lasted 00:00:34 (30 turns).')])
const SMITED = head('0.35-a0-1027-gfe65402f27', ['56 orbrun the Trooper (level 3, -9/34 HPs)', at('Began as a Minotaur Fighter on Sept 14, 2026.'), at('Killed by divine providence'), at('... invoked by an orc priest'), at(' (12 damage)'), at('... on level 2 of the Dungeon on Sept 15, 2026.'), at('The game lasted 00:12:20 (960 turns).')])

const cdi = findServer('cdi')!

beforeEach(() => store.clear())
afterEach(() => vi.unstubAllGlobals())

describe('a morgue’s head', () => {
  it('says who, how it ended, where, and when, however the game ended', () => {
    for (const [f, text] of [['morgue-orbrun-20260915-155745.txt', SLAIN], ['morgue-orbrun-20260916-000707.txt', NEXT_DAY], ['morgue-orbrun-20260915-171136.txt', AFAR], ['morgue-orbrun-20260914-190808.txt', QUIT], ['morgue-orbrun-20260915-124742.txt', SMITED]]) {
      const m = parseMorgue(f, text)
      expect(m.stamp, f).toBe(morgueStamp(f))
      expect(m.score, f).toBeGreaterThanOrEqual(0)
      expect(m.xl, f).toBeGreaterThanOrEqual(1)
      expect(m.char, f).toMatch(/^[A-Z][A-Za-z][A-Z][A-Za-z]$/)
      expect(m.end, f).toMatch(/^[A-Z]/)
      expect(m.place, f).toMatch(/^D:\d+$/)
      expect(m.turns, f).toBeGreaterThanOrEqual(0)
      expect(m.version, f).toMatch(/^(trunk|0\.\d+)$/)
      expect(m.wiz, f).toBe(false)
    }
  })

  it('reads a death, without its damage, and the place it happened on a line of its own', () => {
    expect(parseMorgue('morgue-orbrun-20260915-155745.txt', SLAIN)).toEqual({
      file: 'morgue-orbrun-20260915-155745.txt',
      stamp: '20260915-155745',
      score: 545,
      xl: 7,
      char: 'VSEn',
      began: 'Vine Stalker Enchanter',
      title: 'the Covert',
      god: '',
      end: 'Slain by a gnoll',
      place: 'D:4',
      turns: 2296,
      version: 'trunk',
      wiz: false,
    })
    // the damage on the death's own line, and a death the day after the game began
    const later = parseMorgue('morgue-orbrun-20260916-000707.txt', NEXT_DAY)
    expect([later.end, later.place]).toEqual(['Slain by Natasha', 'D:2'])
    expect(parseMorgue('x', AFAR).end).toBe('Killed from afar by an orc wizard')
    expect(parseMorgue('x', SMITED).end).toBe('Killed by divine providence')
  })

  it('reads a quit, whose place is on its own line, and a game played on this device', () => {
    const quit = parseMorgue('morgue-orbrun-20260914-190808.txt', QUIT)
    expect([quit.score, quit.end, quit.place, quit.char]).toEqual([0, 'Quit the game', 'D:1', 'GnRe'])
    // this device's engine writes its morgue as a server's does
    const here = parseMorgue('morgue-orbrun-20261025-161159.txt', head('0.34.1-4-g0e95e087e2', ['0 orbrun the Shield-Bearer (level 1, 19/19 HPs)', at('Began as a Minotaur Fighter on Oct 25, 2026.'), at('Quit the game on level 1 of the Dungeon.'), at('The game lasted 00:00:00 (0 turns).')]))
    expect([here.score, here.end, here.place, here.char, here.version, here.title]).toEqual([0, 'Quit the game', 'D:1', 'MiFi', '0.34', 'the Shield-Bearer'])
  })

  it('reads a god, a win, a wizard and places off the main dungeon, as crawl words them (hiscores.cc)', () => {
    const head = (lines: string[]) => parseMorgue('morgue-kai-20261001-101010.txt', [' Dungeon Crawl Stone Soup version 0.34.1 (webtiles) character file.', '', ...lines, ''].join('\n'))
    const won = head([
      '1845630 kai the Conqueror (level 27, 250/250 HPs)',
      '             Began as a Deep Elf Air Elementalist on Sept 1, 2026.',
      '             Was the Champion of Vehumet.',
      '             Escaped with the Orb',
      '             ... and 15 runes on Sept 9, 2026!',
      '             The game lasted 10:01:02 (98765 turns).',
    ])
    expect([won.score, won.char, won.god, won.end, won.place, won.version]).toEqual([1845630, 'DEAE', 'Vehumet', 'Escaped with the Orb', '', '0.34'])
    const abyss = head(['12 kai the Stick-Twirler (level 2, -1/20 HPs) *WIZ*', '             Began as a Red Draconian Monk on Sept 1, 2026.', '             Was a Plaything of Xom.', '             Slain by a jackal', '             ... on level 3 of the Abyss.', '             The game lasted 00:01:02 (98 turns).'])
    expect([abyss.char, abyss.god, abyss.place, abyss.wiz]).toEqual(['DrMo', 'Xom', 'Abyss:3', true])
    const temple = head(['3 kai the Mendicant (level 1, 0/12 HPs)', '             Began as a Human Wanderer on Sept 1, 2026.', '             Was a Follower of Trog.', '             Slain by a kobold', '             ... in the Ecumenical Temple (a temple of all gods).', '             The game lasted 00:01:02 (98 turns).'])
    expect([temple.char, temple.god, temple.place]).toEqual(['HuWn', 'Trog', 'Temple'])
  })

  it('says nothing but its name for a file that is not a morgue (an error page)', () => {
    const m = parseMorgue('morgue-orbrun-20260915-155745.txt', '<html><body>502 Bad Gateway</body></html>')
    expect([m.stamp, m.score, m.char, m.end]).toEqual(['20260915-155745', null, '', ''])
  })
})

describe('the lobby’s words for a character and a place', () => {
  it('abbreviates a species and background as the lobby does', () => {
    expect(charOf('Vine Stalker Enchanter')).toBe('VSEn')
    expect(charOf('Minotaur Fighter')).toBe('MiFi')
    expect(charOf('Mountain Dwarf Hedge Wizard')).toBe('MDHW')
    expect(charOf('Deep Elf Conjurer')).toBe('DECj')
    expect(charOf('Grey Draconian Forgewright')).toBe('DrFw')
    expect(charOf('Gnoll Reaver')).toBe('GnRe')
    expect(charOf('Demigod Air Elementalist')).toBe('DgAE')
    expect(charOf('Coglin Gladiator')).toBe('CoGl')
  })

  it('names a place as the Place column does', () => {
    expect(placeOf('on level 4 of the Dungeon')).toBe('D:4')
    expect(placeOf('on level 2 of the Lair of Beasts')).toBe('Lair:2')
    expect(placeOf('on level 5 of the Realm of Zot')).toBe('Zot:5')
    expect(placeOf('in the Vestibule of Hell')).toBe('Hell')
    expect(placeOf('in Pandemonium')).toBe('Pan')
    expect(placeOf('on level 3 of Gehenna')).toBe('Geh:3')
    expect(placeOf('in a bazaar')).toBe('Bazaar')
    expect(placeOf('Slain by a rat')).toBeNull()
  })

  it('says the day, and the year when it is not this one', () => {
    const now = new Date(2026, 9, 25)
    expect(morgueDate('20260915-155745', now)).toBe('Sep 15')
    expect(morgueDate('20251231-235959', now)).toBe('Dec 31, 2025')
  })
})

describe('an account’s morgues on a server', () => {
  // the morgues' names, as the proxy lists a morgue directory (gamedata-proxy.ts)
  const listing = ['morgue-orbrun-20260914-190808.txt', 'morgue-orbrun-20260920-193823.txt', 'morgue-orbrun-20260915-155745.txt'].join('\n')

  it('lists the directory a game’s end named, newest first', async () => {
    setMorgueDir('cdi', 'orbrun', '/crawl/morgue/orbrun/')
    const fetched = vi.fn(async (_url: string) => new Response(listing))
    vi.stubGlobal('fetch', fetched)
    const got = await serverMorgues(cdi, 'orbrun')
    expect(fetched).toHaveBeenCalledWith('/morgue-proxy/crawl.dcss.io/crawl/morgue/orbrun/', expect.anything())
    expect(got?.dir).toBe('/crawl/morgue/orbrun/')
    expect(got?.files).toHaveLength(3)
    expect(got?.files[0]).toBe('morgue-orbrun-20260920-193823.txt')
    expect(got?.files.at(-1)).toBe('morgue-orbrun-20260914-190808.txt')
  })

  it('tries the layouts servers ship with until one lists, and remembers it; none listing is no list', async () => {
    const fetched = vi.fn(async (url: string) => new Response(url.includes('/morgue/orbrun/') && !url.includes('/crawl/') ? listing : 'no', { status: url.includes('/crawl/') ? 404 : 200 }))
    vi.stubGlobal('fetch', fetched)
    expect((await serverMorgues(cdi, 'orbrun'))?.dir).toBe('/morgue/orbrun/')
    expect(getMorgueDir('cdi', 'orbrun')).toBe('/morgue/orbrun/')
    store.clear()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not a listing', { status: 404 })))
    expect(await serverMorgues(cdi, 'orbrun')).toBeNull()
  })

  it('reads a head with a Range once, and keeps what it says: a morgue never changes', async () => {
    const text = SLAIN.slice(0, 2048)
    const fetched = vi.fn(async (_url: string, _init?: RequestInit) => new Response(text, { status: 206 }))
    vi.stubGlobal('fetch', fetched)
    const a = await serverMorgueHead(cdi, '/crawl/morgue/orbrun/', 'morgue-orbrun-20260915-155745.txt')
    expect(a.score).toBe(545)
    expect(fetched).toHaveBeenCalledWith('/morgue-proxy/crawl.dcss.io/crawl/morgue/orbrun/morgue-orbrun-20260915-155745.txt', expect.objectContaining({ headers: { Range: 'bytes=0-2047' } }))
    const b = await serverMorgueHead(cdi, '/crawl/morgue/orbrun/', 'morgue-orbrun-20260915-155745.txt')
    expect(b).toEqual(a)
    expect(fetched).toHaveBeenCalledTimes(1)
    // an answer that is not a morgue is not kept: it is asked again another time
    fetched.mockImplementation(async () => new Response('<html>busy</html>'))
    await serverMorgueHead(cdi, '/crawl/morgue/orbrun/', 'morgue-orbrun-20260916-000707.txt')
    await serverMorgueHead(cdi, '/crawl/morgue/orbrun/', 'morgue-orbrun-20260916-000707.txt')
    expect(fetched).toHaveBeenCalledTimes(3)
  })
})
