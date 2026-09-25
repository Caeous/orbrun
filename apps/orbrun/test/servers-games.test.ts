// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  addAccount,
  characterOf,
  describeCharacter,
  describePlace,
  gameTitle,
  getChosenAccount,
  getGames,
  getLast,
  findServer,
  getToken,
  listAccounts,
  listServers,
  loginState,
  removeAccount,
  sameAccount,
  setChosenAccount,
  setGames,
  setLast,
  setToken,
  type Account,
} from '../src/servers'
import { gameLinkRows } from '@orbrun/webtiles'

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

/**
 * Offline accounts are profiles on this device: stored like any account, as
 * many as the device likes, and none listed until one is added.
 */
describe('offline profiles', () => {
  beforeEach(() => {
    store.clear()
    vi.stubEnv('MODE', 'development')
  })
  afterEach(() => vi.unstubAllEnvs())

  const sam: Account = { serverId: 'offline', username: 'Sam' }

  it('lists no profile until one is added, and never offers this device in the server list', () => {
    expect(listAccounts()).toEqual([])
    addAccount({ serverId: 'cdi', username: 'orbrun' })
    expect(listAccounts()).toEqual([{ serverId: 'cdi', username: 'orbrun' }])
    expect(listServers().some((s) => s.offline)).toBe(false)
    expect(findServer('offline')?.offline).toBe(true)
  })

  it('keeps added profiles like accounts', () => {
    addAccount(sam)
    addAccount({ serverId: 'offline', username: 'Ann' })
    expect(listAccounts()).toEqual([sam, { serverId: 'offline', username: 'Ann' }])
    removeAccount(sam)
    expect(listAccounts()).toEqual([{ serverId: 'offline', username: 'Ann' }])
    removeAccount({ serverId: 'offline', username: 'ann' })
    expect(listAccounts()).toEqual([])
  })

  it('lists the account picked last first, and the never-picked after in the order they were added', () => {
    const ann: Account = { serverId: 'offline', username: 'Ann' }
    const orbrun: Account = { serverId: 'cdi', username: 'orbrun' }
    addAccount(orbrun)
    addAccount(sam)
    addAccount(ann)
    expect(listAccounts()).toEqual([orbrun, sam, ann])
    setChosenAccount(sam, 1000)
    setChosenAccount(ann, 2000)
    expect(listAccounts()).toEqual([ann, sam, orbrun])
    setChosenAccount(sam, 3000)
    expect(listAccounts()).toEqual([sam, ann, orbrun])
    // forgotten with the account: added again, it is new
    removeAccount(sam)
    addAccount(sam)
    expect(listAccounts()).toEqual([ann, orbrun, sam])
  })

  it('stays chosen by its own name', () => {
    addAccount(sam)
    setChosenAccount(sam)
    expect(getChosenAccount()).toEqual(sam)
  })

  it('logs in with no stored token', () => {
    expect(loginState(sam, null)).toBe('pending')
    expect(loginState({ serverId: 'cdi', username: 'orbrun' }, null)).toBe('out')
  })

  it('is not offered where no engine is served', () => {
    addAccount(sam)
    setChosenAccount(sam)
    vi.stubEnv('MODE', 'test')
    expect(listAccounts()).toEqual([])
    expect(findServer('offline')).toBeNull()
    expect(getChosenAccount()).toBeNull()
  })
})

/**
 * The home screen's 'Play 0.34' and 'Play trunk' entries come from the game
 * list the server's lobby sent last time (`set_game_links`), kept per server
 * so they are there before the connection is up.
 */
describe('cached game list', () => {
  beforeEach(() => store.clear())

  it('is empty until a lobby has sent one', () => {
    expect(getGames('cdi')).toBeNull()
  })

  it('is kept per server and splits into the lobby rows', () => {
    setGames('cdi', [
      { id: 'dcss-web-trunk', label: 'DCSS trunk' },
      { id: 'dcss-web-0.34', label: 'DCSS 0.34' },
      { id: 'dcss-web-0.33', label: 'DCSS 0.33' },
    ])
    setGames('cao', [{ id: 'dcss-web-trunk', label: 'trunk' }])
    const rows = gameLinkRows(getGames('cdi')!)
    expect(rows.latestVersion).toBe('0.34')
    expect(rows.latest.map((g) => g.id)).toEqual(['dcss-web-0.34'])
    expect(rows.trunk.map((g) => g.id)).toEqual(['dcss-web-trunk'])
    expect(getGames('cao')).toEqual([{ id: 'dcss-web-trunk', label: 'trunk' }])
  })

  it('keeps id, label and the save the lobby reported, nothing else', () => {
    setGames('cdi', [
      { id: 'g', label: 'G', extra: 1 } as never,
      { id: 't', label: 'T', save: 'orbruntest, a level 3 Minotaur Berserker of Trog' },
      { id: 'f', label: 'F', save: 'slot full', disabled: true },
    ])
    expect(getGames('cdi')).toEqual([
      { id: 'g', label: 'G' },
      { id: 't', label: 'T', save: 'orbruntest, a level 3 Minotaur Berserker of Trog' },
      { id: 'f', label: 'F', save: 'slot full', disabled: true },
    ])
  })
})

/**
 * The home screen's Continue names the character from the lobby roster's own line, the way the stats screen's
 * first lines do. The entry below is a real one, recorded from CDI on 2026-09-09 for the test account's open
 * trunk game.
 */
describe('characterOf', () => {
  const entry = { username: 'orbrun', game_id: 'dcss-git', xl: '2', char: 'VSIE', place: 'D:2', turn: '1312', title: 'Chiller' }

  it('reads the roster line the way Continue speaks a character', () => {
    const c = characterOf(entry)
    expect(c).toEqual({ name: 'orbrun', title: 'the Chiller', species: 'VSIE', god: '', xl: 2, place: 'D', depth: 2 })
    expect(describeCharacter(c)).toBe('orbrun the Chiller, VSIE XL2')
    expect(describePlace(c)).toBe('D:2')
  })

  it('says only what the line says, never what this device saw last', () => {
    // the same account plays from any browser: a character this device remembers can already be dead, and
    // borrowing their species or god would dress the live line in someone who is gone
    expect(characterOf({ ...entry, god: 'Xom' }).god).toBe('Xom')
    expect(characterOf({ username: 'orbrun', game_id: 'dcss-git' })).toEqual({ name: 'orbrun', title: '', species: '', god: '', xl: 0, place: '', depth: 0 })
  })

  it('takes a branch without a depth bare, and stands without a line the roster has not filled', () => {
    expect(characterOf({ username: 'orbrun', place: 'Zot' })).toEqual({ name: 'orbrun', title: '', species: '', god: '', xl: 0, place: 'Zot', depth: 0 })
    expect(characterOf({ username: 'orbrun', place: 'Abyss:3' })).toMatchObject({ place: 'Abyss', depth: 3 })
  })
})

describe('describeCharacter', () => {
  it('reads name, title, species and XL; the place is a line of its own', () => {
    const c = { name: 'Dwarfsong', title: 'the Severer', species: 'Mountain Dwarf', xl: 12, place: 'Snake Pit', depth: 2 }
    expect(describeCharacter(c)).toBe('Dwarfsong the Severer, Mountain Dwarf XL12')
    expect(describePlace(c)).toBe('Snake Pit:2')
  })

  it('keeps a title that carries its own comma against the name, and a branch without depth bare', () => {
    const c = { name: 'Orbrun', title: ', Champion of Xom', species: 'Minotaur', xl: 27, place: 'Zot', depth: 0 }
    expect(describeCharacter(c)).toBe('Orbrun, Champion of Xom, Minotaur XL27')
    expect(describePlace(c)).toBe('Zot')
  })

  it('leaves out what the game has not said yet', () => {
    const c = { name: 'Orbrun', title: '', species: '', xl: 0, place: '', depth: 0 }
    expect(describeCharacter(c)).toBe('Orbrun')
    expect(describePlace(c)).toBe('')
  })
})

/** The tab's title in a game: the player and their title, the species, then the site after a dash. */
describe('gameTitle', () => {
  it('names the player, the species and the site, a dash before the site', () => {
    const c = { name: 'orbrun', title: 'the Chiller', species: 'Vine Stalker', xl: 12, place: 'Snake Pit', depth: 2 }
    expect(gameTitle(c, 'Orbrun')).toBe('orbrun the Chiller | Vine Stalker - Orbrun')
  })

  it('names the god after the species, as the HUD does', () => {
    const c = { name: 'orbrun', title: 'the Ruinous', species: 'Deep Elf', god: 'Vehumet', xl: 12, place: 'Snake Pit', depth: 2 }
    expect(gameTitle(c, 'Orbrun')).toBe('orbrun the Ruinous | Deep Elf of Vehumet - Orbrun')
  })

  it('leaves out what the game has not said yet', () => {
    const c = { name: 'orbrun', title: '', species: '', xl: 0, place: '', depth: 0 }
    expect(gameTitle(c, 'Orbrun')).toBe('orbrun - Orbrun')
  })
})
