import { beforeEach, describe, expect, it } from 'vitest'
import type { OfflineChannel } from '@orbrun/offline'
import type { KeyLike } from '../../../apps/orbrun/src/keys'
import { installNode } from '../game/env'
import { Home, fitLogo, loadLogo, loadTitle, lockup, logoCells, veilAt, veiled, type HomeGame, type HomeHost, type LogoCell } from '../game/home'
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

  it('stands its head (the art, the lede, Xom\'s word) in the middle between the top and the rows, two lines clear of them at the least', () => {
    const h = new Home(host([{ ch: STABLE, save: null }]).h, null)
    for (const rows of [40, 24, 14]) {
      const L = h.layout(80, rows, () => 4)
      const yOf = (word: string) => L.lines.find((l) => l.line.some((s) => s.text.includes(word)))!.y
      const first = yOf('Play DCSS')
      // the head's lines: the art's, and the words over the rows
      const said = L.lines.filter((l) => l.y < first && l.line.some((s) => s.text.trim())).map((l) => l.y)
      const ys = [...said, ...(L.art ? [L.art.y, L.art.y + L.art.rows - 1] : [])]
      if (!ys.length) continue
      const headTop = Math.min(...ys), headFoot = Math.max(...ys)
      expect(first - headFoot).toBeGreaterThanOrEqual(3)
      if (rows === 40) expect(Math.abs(headTop - (first - 1 - headFoot))).toBeLessThanOrEqual(1)
    }
  })

  it('gives its head up as the screen grows shorter: Xom\'s word, then the lede, then the art smaller, then the title in words, then all of it', () => {
    const h = new Home(host([{ ch: STABLE, save: null }]).h, null)
    // art 8 rows at its full width, 4 narrower
    const art = (w: number, most: number) => (w >= 60 ? 8 : 4) <= most ? (w >= 60 ? 8 : 4) : 0
    const head = (rows: number) => {
      const L = h.layout(80, rows, art)
      const said = L.lines.map((l) => l.line.map((s) => s.text).join(''))
      return [L.art?.rows ?? 0, said.some((t) => t.includes('Orbrun')), said.some((t) => t.includes('unofficial')), said.some((t) => t.includes('Xom'))]
    }
    // the body: Play, the account, Settings, Quit, a blank and the hint, over the version's row: 6 + 1 rows
    const body = 7, gap = 2
    expect(head(body + gap + 8 + 1 + 2)).toEqual([8, false, true, true])
    expect(head(body + gap + 8 + 1 + 1)).toEqual([8, false, true, false])
    expect(head(body + gap + 8)).toEqual([8, false, false, false])
    expect(head(body + gap + 7)).toEqual([4, false, false, false])
    expect(head(body + gap + 3)).toEqual([0, true, false, false])
    expect(head(body + gap)).toEqual([0, false, false, false])
    // with no art to draw, the title in words over the lede and Xom's word
    expect(h.layout(80, 40, () => 0).lines.map((l) => l.line.map((s) => s.text).join('')).filter((t) => t.trim()).slice(0, 3).map((t) => t.trim().slice(0, 8))).toEqual(['Orbrun', 'An unoff', '“' + (h.splash.slice(0, 7))])
  })

  it('keeps its rows where they are as the cursor moves onto a row whose hint takes more lines', () => {
    const h = new Home(host([{ ch: STABLE, save: { name: 'Ada', desc: 'Ada' } }]).h, null)
    const at = () => h.layout(40, 40, () => 0).lines.find((l) => l.line.some((s) => s.text.includes('Quit')))!.y
    const before = at()
    press(h, 'ArrowDown')
    expect(at()).toBe(before)
    press(h, 'ArrowDown')
    expect(at()).toBe(before)
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

  it('sets the logo\'s word and a screen\'s title, wider than tall, and the orb\'s tile', async () => {
    const logo = await loadLogo()
    for (const art of [logo?.word, await loadTitle('Settings')]) {
      expect(art).toBeTruthy()
      expect(art!.w).toBeGreaterThan(art!.h)
    }
    expect(logo!.tile).toHaveLength(32 * 32 * 4)
  })

  it('sizes the logo: the larger orb in the browser\'s share of the screen, else the smaller in the words\' width', async () => {
    const logo = (await loadLogo())!
    const big = fitLogo(logo, 200, 200, 40, 4, 2)!, small = fitLogo(logo, 200, big.cols - 1, 40, 4, 2)!
    expect([big.dots, big.rows, big.orbCols]).toEqual([32, 8, 16])
    expect([small.dots, small.rows, small.orbCols]).toEqual([16, 4, 8])
    expect(fitLogo(logo, 200, 200, 7, 4, 2)!.dots).toBe(16)
    expect(fitLogo(logo, small.cols - 1, 0, 40, 4, 2)).toBeNull()
    // a terminal's cells taller than two to one, an 80-column screen's share of it too narrow: the smaller, in the words' width
    expect(fitLogo(logo, 72, 32, 40, 4, 2.4)!.dots).toBe(16)
  })

  const glyph = (c: LogoCell | null | undefined) => (c && 'mask' in c ? c : null)
  const lum = (v: number) => 0.3 * (v >> 16) + 0.59 * ((v >> 8) & 255) + 0.11 * (v & 255)

  it('lays the logo out as the page does: the name as tall as the orb, and its shadows reaching past both', async () => {
    const logo = (await loadLogo())!
    const f = fitLogo(logo, 200, 200, 40, 4, 2)!
    const lk = lockup(logo, f)
    expect(lk.x).toBeLessThan(0)
    expect(lk.y).toBeLessThan(0)
    const W = lk.cols * 2, top = -lk.y * 4, left = -lk.x * 2
    // the rows the name's ink is on: the orb's, or as good as (the page sets the orb's core as tall as the O)
    const inked = (x0: number, x1: number) => {
      const rs: number[] = []
      for (let y = 0; y < lk.rows * 4; y++) for (let x = x0; x < x1; x++) if (lk.ink[y * W + x] > 0.5) rs.push(y)
      return [Math.min(...rs) - top, Math.max(...rs) - top]
    }
    const [o0, o1] = inked(left, left + f.dots), [w0, w1] = inked(left + f.dots + 2, left + f.cols * 2)
    expect(Math.abs(w0 - o0)).toBeLessThanOrEqual(2)
    expect(Math.abs(w1 - o1)).toBeLessThanOrEqual(2)
    // the orb's glow is seen left of it, and the name's shadow under it
    expect(lk.rgba[((top + 16) * W + left - 2) * 4 + 3]).toBeGreaterThan(0.1)
    expect(lk.rgba[((top + 33) * W + left + 60) * 4 + 3]).toBeGreaterThan(0.05)
  })

  it('draws the orb as the page does: its ball\'s colour in the middle, its glow on the room round it', async () => {
    const logo = (await loadLogo())!
    const f = fitLogo(logo, 200, 200, 40, 4, 2)!
    const lk = lockup(logo, f)
    const lit = 0x506070
    const cells = logoCells(lk, () => lit)
    expect(cells).toHaveLength(lk.cols * lk.rows)
    const at = (c: number, r: number) => cells[(r - lk.y) * lk.cols + c - lk.x]
    // the middle is the ball: magenta, red over green
    const mid = glyph(at(7, 3))!
    expect(mid.fg >> 16).toBeGreaterThan((mid.fg >> 8) & 255)
    // left of the orb, a room's cell with glyphs is shaded, not drawn over: the glow, gold, red over blue
    const glow = at(-1, 4)!
    expect('shade' in glow).toBe(true)
    if ('shade' in glow) expect(glow.shade >> 16).toBeGreaterThan(glow.shade & 255)
    // a plain one is drawn by the dot instead, so the glow fades within the cell
    expect(glyph(logoCells(lk, () => lit, () => true)[(4 - lk.y) * lk.cols - 1 - lk.x])).not.toBeNull()
  })

  it('cuts the name sharp on the dots: its cells inked in the ink itself, never a blend of it and the room', async () => {
    const logo = (await loadLogo())!
    const f = fitLogo(logo, 200, 0, 40, 4, 2)!
    expect(f.dots).toBe(16)
    const lk = lockup(logo, f)
    const ink = 0xe9e2d0
    // the name's cells, right of the orb and its glow: each has the ink, and its other colour is the room, shaded
    const cells = logoCells(lk, () => 0x101018)
    const name: { mask: number; fg: number; bg: number }[] = []
    for (let r = 0; r < lk.rows; r++) for (let c = -lk.x + f.orbCols + 3; c < lk.cols; c++) { const g = glyph(cells[r * lk.cols + c]); if (g) name.push(g) }
    expect(name.length).toBeGreaterThan(20)
    for (const g of name) expect([g.fg, g.bg]).toContain(ink)
    for (const g of name) for (const v of [g.fg, g.bg]) if (v !== ink) expect(lum(v)).toBeLessThan(lum(0x101018) + 4)
  })

  it('veils the room darker at the top and foot than through the middle, and darker at the left under the menu', () => {
    const at = (fx: number, fy: number) => veiled(0xffffff, veilAt('lair', fx, fy)) & 255
    expect(at(1, 0)).toBeLessThan(at(1, 0.5))
    expect(at(1, 1)).toBeLessThan(at(1, 0.5))
    expect(at(0, 0.5)).toBeLessThan(at(1, 0.5))
  })
})
