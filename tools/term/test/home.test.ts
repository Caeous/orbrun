import { beforeEach, describe, expect, it } from 'vitest'
import type { OfflineChannel } from '@orbrun/offline'
import type { KeyLike } from '../../../apps/orbrun/src/keys'
import { installNode } from '../game/env'
import { Home, loadLogo, loadTitle, veilAt, veiled, type HomeGame, type HomeHost } from '../game/home'
import { getSettings } from '../../../apps/orbrun/src/servers'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ch = (v: string): OfflineChannel => ({ id: `offline-${v}`, label: `DCSS ${v}`, commit: 'c', build: 'b', gamedata: 'g', saveDir: `/crawl-${v}` })
const STABLE = ch('0.34')
const TRUNK = ch('trunk')
const key = (k: string): KeyLike => ({ key: k, code: '', keyCode: 0, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false })
const press = (h: Home, ...keys: string[]) => keys.map((k) => h.key(key(k))).filter(Boolean).pop() ?? null
/** the screen's lines as words */
const text = (h: Home) => h.layout(80, 40, () => 0).lines.map((l) => l.line.map((s) => s.text).join(''))
/** the rows' words, the focused one marked by the @ */
const words = (h: Home) => text(h).filter((t) => /^ {3}[@>+<?#x] {2}\S/.test(t)).map((t) => t.trim())

/** a host with `games` saved as Ada, and the accounts and settings changes it was told of */
function host(games: HomeGame[], accounts = ['Ada']) {
  const told = { removed: [] as string[], changed: 0 }
  const h: HomeHost = { player: () => 'Ada', games: () => games, accounts: () => accounts, remove: (n) => told.removed.push(n), changed: () => told.changed++ }
  return { h, told }
}

beforeEach(() => {
  installNode(fs.mkdtempSync(path.join(os.tmpdir(), 'orbrun-home-')))
})

describe('the front screen', () => {
  it('offers each version: Continue for the account\'s character, as the browser words it, Play where none is saved; then the account, Settings and Quit', () => {
    const h = new Home(host([{ ch: STABLE, save: { name: 'Ada', desc: 'Ada, a level 3 Minotaur Berserker' } }, { ch: TRUNK, save: null }]).h, null)
    expect(words(h)).toEqual(['@  Continue DCSS 0.34', '>  Play DCSS trunk', '#  Ada', '?  Settings', '<  Quit'])
    expect(text(h)).toContain('      a level 3 Minotaur Berserker')
  })

  it('plays a version, continuing or new as it has a save, and leaves', () => {
    const h = new Home(host([{ ch: STABLE, save: { name: 'Ada', desc: 'Ada' } }, { ch: TRUNK, save: null }]).h, null)
    expect(press(h, 'Enter')).toEqual({ kind: 'play', ch: STABLE })
    expect(press(h, 'ArrowDown', 'Enter')).toEqual({ kind: 'play', ch: TRUNK })
    expect(press(h, 'ArrowDown', 'ArrowDown', 'ArrowDown', 'Enter')).toEqual({ kind: 'quit' })
    expect(press(h, 'q')).toEqual({ kind: 'quit' })
  })

  it('focuses the version last played when it comes back, and says how the game ended', () => {
    const h = new Home(host([{ ch: STABLE, save: { name: 'Ada', desc: 'Ada' } }, { ch: TRUNK, save: null }]).h, 'Your game is saved.', TRUNK)
    expect(words(h)[1]).toBe('@  Play DCSS trunk')
    expect(text(h)).toContain('   Your game is saved.')
  })

  it('stands at the bottom left: its marks in line with its words, its last line over the version\'s row', () => {
    const h = new Home(host([{ ch: STABLE, save: null }]).h, null)
    const L = h.layout(80, 40, () => 0)
    const last = Math.max(...L.lines.map((l) => l.y))
    expect(last).toBe(38)
    expect(L.version.y).toBe(39)
    expect(text(h).filter((t) => /^ {3}[@>+<?#] /.test(t)).length).toBe(4)
    expect(text(h).some((t) => t.startsWith('   An unofficial'))).toBe(true)
  })

  it('changes a setting with left and right, saved and shown at once, and goes back with Escape', () => {
    const { h, told } = host([{ ch: STABLE, save: null }])
    const home = new Home(h, null)
    press(home, 'ArrowDown', 'ArrowDown', 'Enter')
    expect(text(home)).toContain('   VIEW')
    const before = getSettings().eyeHeight
    press(home, 'ArrowRight')
    expect(getSettings().eyeHeight).toBeGreaterThan(before)
    expect(told.changed).toBe(1)
    press(home, 'Escape')
    expect(words(home)).toContain('@  Settings')
  })

  it('plays as another account, adds one by name, and deletes one only on a second press and never the one in use', () => {
    const { h, told } = host([{ ch: STABLE, save: null }], ['Ada', 'Bo'])
    const home = new Home(h, null)
    press(home, 'ArrowDown', 'Enter')
    expect(words(home)).toEqual(['<  Back', '@  Ada', '#  Bo', '+  Add an offline account'])
    // Ada is in use: no deleting it
    press(home, 'Enter', 'ArrowDown', 'ArrowDown', 'Enter', 'Enter')
    expect(told.removed).toEqual([])
    press(home, 'Escape', 'ArrowDown', 'Enter')
    expect(press(home, 'ArrowDown')).toBeNull()
    expect(press(home, 'Enter')).toEqual({ kind: 'switch', name: 'Bo' })
    press(home, 'ArrowDown', 'Enter')
    expect(told.removed).toEqual([])
    expect(text(home).some((t) => t.includes('Delete all?'))).toBe(true)
    press(home, 'Enter')
    expect(told.removed).toEqual(['Bo'])
    // the account list again, and a new one added by its name
    expect(press(home, 'ArrowDown', 'Enter', 'C', 'y', 'Enter')).toEqual({ kind: 'switch', name: 'Cy' })
  })

  it('sets the logo and a screen\'s title, wider than tall', async () => {
    for (const art of [await loadLogo(), await loadTitle('Settings')]) {
      expect(art).not.toBeNull()
      expect(art!.w).toBeGreaterThan(art!.h)
    }
  })

  it('veils the room darker at the top and foot than through the middle, and darker at the left under the menu', () => {
    const at = (fx: number, fy: number) => veiled(0xffffff, veilAt('lair', fx, fy)) & 255
    expect(at(1, 0)).toBeLessThan(at(1, 0.5))
    expect(at(1, 1)).toBeLessThan(at(1, 0.5))
    expect(at(0, 0.5)).toBeLessThan(at(1, 0.5))
  })
})
