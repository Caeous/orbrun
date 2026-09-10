// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  addAccount,
  characterOf,
  describeCharacter,
  describePlace,
  gameTitle,
  getCharacter,
  getChosenAccount,
  getGames,
  getLast,
  getToken,
  listAccounts,
  loginState,
  removeAccount,
  sameAccount,
  setCharacter,
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
 * The home screen's Continue names the character the game last described
 * (`player`: name, title, species, xl, place, depth), the way the stats
 * screen's first lines and the lobby roster's spoken line do.
 */
/** The character a lobby roster line stands for, as recorded from CDI on 2026-09-09 for the test account's open trunk game. */
describe('characterOf', () => {
  const entry = { username: 'caeo', game_id: 'dcss-git', xl: '2', char: 'VSIE', place: 'D:2', turn: '1312', title: 'Chiller' }

  it('reads the roster line the way Continue speaks a character', () => {
    const c = characterOf(entry)
    expect(c).toEqual({ name: 'caeo', title: 'the Chiller', species: 'VSIE', god: '', xl: 2, place: 'D', depth: 2 })
    expect(describeCharacter(c)).toBe('caeo the Chiller, VSIE XL2')
    expect(describePlace(c)).toBe('D:2')
  })

  it('keeps the fuller species this device saw in the game when it is the same character, and takes the roster’s level and place', () => {
    const stored = { name: 'caeo', title: 'the Sneak', species: 'Vine Stalker', god: 'Vehumet', xl: 1, place: 'Dungeon', depth: 1 }
    expect(characterOf(entry, stored)).toEqual({ name: 'caeo', title: 'the Chiller', species: 'Vine Stalker', god: 'Vehumet', xl: 2, place: 'D', depth: 2 })
    expect(characterOf({ ...entry, god: 'Xom' }, stored).god).toBe('Xom')
    expect(characterOf(entry, { ...stored, name: 'other' }).species).toBe('VSIE')
  })

  it('takes a branch without a depth bare, and stands without a line the roster has not filled', () => {
    expect(characterOf({ username: 'caeo', place: 'Zot' })).toEqual({ name: 'caeo', title: '', species: '', god: '', xl: 0, place: 'Zot', depth: 0 })
    expect(characterOf({ username: 'caeo', place: 'Abyss:3' })).toMatchObject({ place: 'Abyss', depth: 3 })
  })
})

describe('describeCharacter', () => {
  it('reads name, title, species and XL; the place is a line of its own', () => {
    const c = { name: 'KorlenTP', title: 'the Severer', species: 'Mountain Dwarf', xl: 12, place: 'Snake Pit', depth: 2 }
    expect(describeCharacter(c)).toBe('KorlenTP the Severer, Mountain Dwarf XL12')
    expect(describePlace(c)).toBe('Snake Pit:2')
  })

  it('keeps a title that carries its own comma against the name, and a branch without depth bare', () => {
    const c = { name: 'Caeo', title: ', Champion of Xom', species: 'Minotaur', xl: 27, place: 'Zot', depth: 0 }
    expect(describeCharacter(c)).toBe('Caeo, Champion of Xom, Minotaur XL27')
    expect(describePlace(c)).toBe('Zot')
  })

  it('leaves out what the game has not said yet', () => {
    const c = { name: 'Caeo', title: '', species: '', xl: 0, place: '', depth: 0 }
    expect(describeCharacter(c)).toBe('Caeo')
    expect(describePlace(c)).toBe('')
  })
})

/** The tab's title in a game: the player and their title, the species, then the site. */
describe('gameTitle', () => {
  it('names the player, the species and the site, pipes between', () => {
    const c = { name: 'caeo', title: 'the Chiller', species: 'Vine Stalker', xl: 12, place: 'Snake Pit', depth: 2 }
    expect(gameTitle(c, 'Orbrun')).toBe('caeo the Chiller | Vine Stalker | Orbrun')
  })

  it('names the god after the species, as the HUD does', () => {
    const c = { name: 'caeo', title: 'the Ruinous', species: 'Deep Elf', god: 'Vehumet', xl: 12, place: 'Snake Pit', depth: 2 }
    expect(gameTitle(c, 'Orbrun')).toBe('caeo the Ruinous | Deep Elf of Vehumet | Orbrun')
  })

  it('leaves out what the game has not said yet', () => {
    const c = { name: 'caeo', title: '', species: '', xl: 0, place: '', depth: 0 }
    expect(gameTitle(c, 'Orbrun')).toBe('caeo | Orbrun')
  })
})
