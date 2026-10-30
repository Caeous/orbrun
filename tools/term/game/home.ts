/**
 * The front screen in a terminal, as the browser's (menu.ts `showHome`):
 * a place of the front room's (room/places.ts, the next of the cycle each
 * start) standing still behind it in the view's own glyphs, facing a way of
 * its own, under the place's tinted veil (styles.css `.room-veil`) and the
 * shade the menu casts; over it, at the left, the logo in the view's glyphs,
 * the lede and a word from Xom, and the rows: a version's saved game to
 * continue, or a new game where there is none, the player, Settings and
 * Quit; the focused row's hint under them, all at the bottom left as a
 * terminal program has it, and the version in the corner.
 *
 * As in the browser, an account is its character: crawl plays it by the
 * account's name, one character to a version, and a second character is a
 * second account.
 *
 * Its other screens are the browser's that mean something offline in a
 * terminal, over the same room: Settings (settings-rows.ts, the rows the
 * terminal draws by), Accounts (the players whose saves are kept here) and
 * an account's own (play as it, or delete it and its saves).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { REST_PITCH, type Camera, type Dir8, type Scene, type TileSource } from '@orbrun/scene'
import type { OfflineChannel } from '@orbrun/offline'
import { readScene, type PlaceFile } from '../../../apps/orbrun/src/room/place-data'
import { RoomTiles } from '../../../apps/orbrun/src/room/tiles'
import { nextHomePlace, type Tint } from '../../../apps/orbrun/src/room/places'
import { pickSplash } from '../../../apps/orbrun/src/splash'
import { getSettings, saveSettings, type Settings } from '../../../apps/orbrun/src/servers'
import { SETTING_ROWS, fovOf, rowHint, rowOff, settingGroups, settingValue, type SettingRow } from '../../../apps/orbrun/src/settings-rows'
import type { KeyLike } from '../../../apps/orbrun/src/keys'
import type { SavedCharacter } from './engine'
import { PALETTE, type Line, type RGB, type Span } from './text'

const here = path.dirname(fileURLToPath(import.meta.url))
const APP = path.resolve(here, '../../../apps/orbrun')
const PLACES = path.join(APP, 'public/room/places')
const LOGO = path.resolve(here, '../../../assets/logo.svg')
const TITLE_FONT = path.resolve(here, '../../../assets/fonts/GrenzeGotisch-Bold.ttf')
/** Orbrun's version, as the browser's corner shows it */
export const VERSION = (JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8')) as { version: string }).version

/** styles.css's ink and gold */
const INK: RGB = [0xe9, 0xe2, 0xd0]
const INK_DIM: RGB = [0x9d, 0x94, 0x83]
const GOLD: RGB = [0xd8, 0xb4, 0x5f]
const GOLD_BRIGHT: RGB = [0xf3, 0xd9, 0x8a]
const GREY = PALETTE[8]
/** the ground of the focused row's bar, the gold laid over at its left (styles.css `.menu li.focused`) */
const BAR_GROUND: RGB = [12, 11, 14]
/** what the logo's glyphs are laid on where it is clear: the veil's dark (styles.css `.room-veil`) */
export const LOGO_GROUND = 0x07070b
/** the longest name a character takes (offline server `profileName`) */
const NAME_MAX = 20
/** the screen's words stand this far in from the left edge, the rows' marks with them and their words a mark further */
const INDENT = 3

// ---- the room

/** A place of the front room's, as the view draws it: its tiles, its scene, and the eye in it. */
export interface Room {
  place: string
  tint: Tint
  tiles: TileSource
  scene: Scene
  camera: Camera
}

/** The next place of the cycle (room/places.ts `nextHomePlace`), facing a way of its own; null where it cannot be read, and the menu stands on the dark. */
export async function loadRoom(): Promise<Room | null> {
  const entry = nextHomePlace()
  try {
    const file = JSON.parse(fs.readFileSync(path.join(PLACES, `${entry.id}.json`), 'utf8')) as PlaceFile
    const { default: sharp } = await import('sharp')
    const { data, info } = await sharp(path.join(PLACES, `${entry.id}.png`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    // the place's atlas as a bitmap the view reads (env.ts `RgbaBitmap`)
    const image = { width: info.width, height: info.height, rgba: new Uint8Array(data.buffer, data.byteOffset, data.length) }
    const tiles = RoomTiles.fromPlace(file, image as unknown as TexImageSource)
    const yaw = Math.random() * Math.PI * 2
    const facing = (Math.round(yaw / (Math.PI / 4)) & 7) as Dir8
    const { x, y } = file.eye
    return { place: entry.id, tint: entry.tint, tiles, scene: readScene(file.scene), camera: { x, y, eyeX: x, eyeY: y, yaw, pitch: REST_PITCH, facing } }
  } catch {
    return null
  }
}

/** each tint's middle (styles.css `.room-veil[data-tint]`): its colour and how much of it */
const TINTS: Record<Tint, [number, number, number, number]> = {
  depths: [30, 18, 12, 0.45],
  lair: [26, 30, 8, 0.45],
  dungeon: [12, 22, 14, 0.5],
  abyss: [18, 12, 34, 0.4],
  shoals: [10, 22, 30, 0.45],
  zot: [30, 10, 26, 0.45],
  spider: [22, 16, 26, 0.5],
}
const VEIL_DARK: RGB = [7, 7, 11]
/** how dark the menu's shade is at the left edge, and how far across it reaches (styles.css `.home-actions::before`) */
const SHADE_LEFT = 0.55
const SHADE_REACH = 0.65

/**
 * What lies over the room at (`fx`, `fy`), each 0..1 across and down: the
 * place's veil (dark at the top, its tint through the middle, darker at the
 * foot), then the shade the menu casts from the left. A colour and how much
 * of it, applied as `veiled` does.
 */
export function veilAt(tint: Tint, fx: number, fy: number): [number, number, number, number] {
  const [tr, tg, tb, ta] = TINTS[tint]
  const stops: [number, number, number, number, number][] = [
    [0, ...VEIL_DARK, 0.7],
    [0.3, tr, tg, tb, ta],
    [0.7, tr, tg, tb, ta],
    [1, ...VEIL_DARK, 0.85],
  ]
  let i = 0
  while (i < stops.length - 2 && fy > stops[i + 1][0]) i++
  const [p0, p1] = [stops[i], stops[i + 1]]
  const t = Math.min(1, Math.max(0, (fy - p0[0]) / (p1[0] - p0[0])))
  const mix = (k: number) => p0[k] + (p1[k] - p0[k]) * t
  let [r, g, b, a] = [mix(1), mix(2), mix(3), mix(4)]
  // the shade over it, toward black: what is seen through both
  const s = SHADE_LEFT * Math.max(0, 1 - fx / SHADE_REACH)
  r *= 1 - s
  g *= 1 - s
  b *= 1 - s
  a = 1 - (1 - a) * (1 - s)
  return [r, g, b, a]
}

/** A packed colour (0xRRGGBB) under a veil (`veilAt`). */
export function veiled(c: number, v: [number, number, number, number]): number {
  const k = 1 - v[3]
  const r = ((c >> 16) & 255) * k + v[0] * v[3], g = ((c >> 8) & 255) * k + v[1] * v[3], b = (c & 255) * k + v[2] * v[3]
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)
}

// ---- the logo

/** The logo (assets/logo.svg), its card left off, cut to its ink: RGBA, a few pixels to each of the view's dots. */
export interface Logo {
  rgba: Uint8Array
  w: number
  h: number
}

/** The logo, set once: the orb and the word, with their glow and shadow, on nothing. Null where it cannot be read. */
export async function loadLogo(): Promise<Logo | null> {
  try {
    const { default: sharp } = await import('sharp')
    // the card the logo stands on in a page is the screen here: the room shows round the word; and no glow or shadow,
    // which in cells would only blur the edges the dots are cut on (`crisp`)
    const svg = fs.readFileSync(LOGO, 'utf8').replace(/<rect [^>]*\/>/, '').replace(/ filter="url\(#\w+\)"/g, '')
    return trimmed(await sharp(Buffer.from(svg), { density: 288 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true }))
  } catch {
    return null
  }
}

/** An RGBA image cut to its ink; null for none. */
function trimmed({ data, info }: { data: Buffer; info: { width: number; height: number } }): Logo | null {
  const W = info.width, H = info.height
  let x0 = W, y0 = H, x1 = -1, y1 = -1
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (data[(y * W + x) * 4 + 3] > 24) {
        x0 = Math.min(x0, x)
        x1 = Math.max(x1, x)
        y0 = Math.min(y0, y)
        y1 = Math.max(y1, y)
      }
  if (x1 < 0) return null
  const w = x1 - x0 + 1, h = y1 - y0 + 1
  const rgba = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) rgba.set(data.subarray(((y0 + y) * W + x0) * 4, ((y0 + y) * W + x1 + 1) * 4), y * w * 4)
  return { rgba, w, h }
}

/**
 * A screen's title as the browser sets it (styles.css `h1.place`): Grenze Gotisch Bold in the ink, as outlines glyph by glyph with the font's kerning (tools/build/brand.mjs `outline`). Null where
 * it cannot be set.
 */
export async function loadTitle(text: string): Promise<Logo | null> {
  try {
    // @ts-expect-error: opentype.js has no types (tools/build/brand.mjs reads it as plain JS)
    const { parse } = await import('opentype.js')
    const { default: sharp } = await import('sharp')
    const buf = fs.readFileSync(TITLE_FONT)
    const font = parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)
    const size = 200, k = size / font.unitsPerEm
    let x = 0, d = '', prev: unknown = null
    for (const ch of text) {
      const g = font.charToGlyph(ch)
      if (prev) x += font.getKerningValue(prev, g) * k
      d += g.getPath(x, 0, size).toPathData(2)
      x += (g.advanceWidth ?? 0) * k
      prev = g
    }
    const pad = 24, W = Math.ceil(x + 2 * pad), H = Math.ceil(size * 1.3 + 2 * pad)
    const ink = `#${INK.map((c) => c.toString(16).padStart(2, '0')).join('')}`
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><path transform="translate(${pad} ${pad + size})" fill="${ink}" d="${d}"/></svg>`
    return trimmed(await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true }))
  } catch {
    return null
  }
}

/** A cell of art drawn crisp: its dots (bit row * 2 + col, as shapes.ts numbers them), all of them or not, and the colour that inks them (0xRRGGBB). */
export interface CrispCell {
  mask: number
  full: boolean
  rgb: number
}

/**
 * Art as `cols` x `rows` cells of the mosaic (`sx` x `sy` dots a cell), cut sharp rather than shaded: a dot is inked
 * where the art covers most of it, in the colour of what inks the cell, and the rest of the cell is left to what is
 * behind it (the room), so the letters' edges fall on the dots with nothing round them. Null where a cell has none.
 */
export function crisp(art: Logo, cols: number, rows: number, sx: number, sy: number): (CrispCell | null)[] {
  const W = cols * sx, H = rows * sy
  const cover = new Float32Array(W * H)
  const sums = new Float64Array(cols * rows * 4)
  for (let y = 0; y < art.h; y++)
    for (let x = 0; x < art.w; x++) {
      const i = (y * art.w + x) * 4, a = art.rgba[i + 3] / 255
      if (!a) continue
      const dx = Math.floor((x * W) / art.w), dy = Math.floor((y * H) / art.h)
      cover[dy * W + dx] += a
      const c = (Math.floor(dy / sy) * cols + Math.floor(dx / sx)) * 4
      sums[c] += art.rgba[i] * a
      sums[c + 1] += art.rgba[i + 1] * a
      sums[c + 2] += art.rgba[i + 2] * a
      sums[c + 3] += a
    }
  const per = (art.w / W) * (art.h / H)
  const all = (1 << (sx * sy)) - 1
  const out: (CrispCell | null)[] = []
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      let mask = 0
      for (let j = 0; j < sy; j++)
        for (let i = 0; i < sx; i++) if (cover[(r * sy + j) * W + c * sx + i] / per >= 0.45) mask |= 1 << (j * 2 + i)
      const k = (r * cols + c) * 4, n = sums[k + 3]
      out.push(mask ? { mask, full: mask === all, rgb: (Math.round(sums[k] / n) << 16) | (Math.round(sums[k + 1] / n) << 8) | Math.round(sums[k + 2] / n) } : null)
    }
  return out
}


// ---- the menu

/** What the front screen asks of the client: the player whose saves these are, what is saved, and what it does. */
export interface HomeHost {
  player(): string
  /** the versions built, the newest release first, and the player's character saved in each */
  games(): HomeGame[]
  /** the players with saves on this device, and the one playing */
  accounts(): string[]
  /** forget a player and every game saved as them */
  remove(name: string): void
  /** a setting changed: shown at once, on the room behind */
  changed(): void
}

export interface HomeGame {
  ch: OfflineChannel
  save: SavedCharacter | null
}

/** What the menu asks the client to do: play a game, play as another player, or leave. */
export type HomeAction = { kind: 'play'; ch: OfflineChannel } | { kind: 'switch'; name: string } | { kind: 'quit' } | null

/** A row of a screen, as the browser's (menu.ts `Row`). */
interface Row {
  /** what the screen remembers its cursor by */
  id: string
  label: string
  marker: string
  sub?: string
  hint: string | (() => string)
  /** a setting's value, read at the right */
  value?: () => string
  /** does nothing now: drawn dim, its hint saying why */
  off?: () => boolean
  /** Enter (or Space) on it */
  take?: () => HomeAction | void
  /** left and right on it */
  adjust?: (d: number) => void
  /** a name typed into it, given to `named` on Enter */
  named?: (name: string) => HomeAction | void
  /** a group's heading: words, and no stop for the cursor */
  heading?: boolean
}

interface Screen {
  id: 'home' | 'settings' | 'accounts' | 'account'
  /** its title, set in the font; none for the front, which has the logo */
  title: string | null
  lede: string
  rows: Row[]
  /** Escape: the screen it came from */
  back?: () => void
}

/**
 * A setting's value as its row reads it (settings-rows.ts `settingValue`), but an Auto in the terminal's terms: the
 * browser's asks the page whether it is a phone held upright, which a terminal never is.
 */
function valueOf(r: SettingRow, s: Settings): string {
  if (r.key === 'fov' && !s.fov) return `Auto (${fovOf(s, false, false)}°)`
  if (r.key === 'minimapTiles' && !s.minimapTiles) return 'Auto (fits the terminal)'
  return settingValue(r, s)
}

/** the settings the terminal draws by (client.ts, view.ts): the rest are the browser's own */
const TERM_SETTINGS = new Set(['eyeHeight', 'restPitch', 'fov', 'viewmodel', 'exploreDelay', 'leftRightKeys', 'minimapTiles'])

export class Home {
  readonly splash = pickSplash()
  private screen!: Screen
  private focus = 0
  /** each screen's cursor, by its row's id, as the browser keeps them (menu.ts `marks`) */
  private marks = new Map<string, string>()
  /** a name being typed into the focused row */
  private typing: string | null = null
  /** an account's Delete, pressed once */
  private confirming = false

  /** `why`: how the last game ended, said on the front; `last`: the version last played, focused there. */
  constructor(
    private host: HomeHost,
    private why: string | null,
    last?: OfflineChannel,
  ) {
    if (last) this.marks.set('home', `play:${last.id}`)
    this.showHome()
  }

  /** the screen on show: which, for the client's title */
  get title(): string | null {
    return this.screen.title
  }

  showHome() {
    const rows: Row[] = []
    const player = this.host.player()
    // a version's row as the browser words it (menu.ts `saveOf`): its character less the name, which is the account's
    for (const g of this.host.games()) {
      const label = g.ch.label
      const play = (): HomeAction => ({ kind: 'play', ch: g.ch })
      if (g.save) rows.push({ id: `play:${g.ch.id}`, label: `Continue ${label}`, marker: '>', sub: g.save.desc.startsWith(`${player}, `) ? g.save.desc.slice(player.length + 2) : g.save.desc, hint: 'Down the stairs to your game.', take: play })
      else rows.push({ id: `play:${g.ch.id}`, label: `Play ${label}`, marker: '>', hint: `A new character in ${label}, on this device.`, take: play })
    }
    rows.push({ id: 'account', label: player, marker: '#', hint: 'Switch accounts, add one, or remove one.', take: () => this.showAccounts() })
    rows.push({ id: 'settings', label: 'Settings', marker: '?', hint: 'Camera, controls, the HUD: kept on this device.', take: () => this.showSettings() })
    rows.push({ id: 'quit', label: 'Quit', marker: '<', hint: 'Close Orbrun. Your games are kept on this device.', take: () => ({ kind: 'quit' }) })
    this.show({ id: 'home', title: null, lede: 'An unofficial first-person client for Dungeon Crawl Stone Soup.', rows })
  }

  private showSettings() {
    const rows: Row[] = [this.backRow(() => this.showHome())]
    const s = () => getSettings()
    for (const g of settingGroups(SETTING_ROWS.filter((r) => TERM_SETTINGS.has(r.key)))) {
      rows.push({ id: `group:${g.group}`, label: g.group, marker: '', hint: '', heading: true })
      for (const r of g.rows)
        rows.push({
          id: `set:${r.key}`,
          label: r.label,
          marker: '',
          hint: () => rowHint(r, s()),
          value: () => valueOf(r, s()),
          off: () => rowOff(r, s()),
          adjust: (d) => this.adjust(r, d),
          take: () => this.adjust(r, 1),
        })
    }
    this.show({ id: 'settings', title: 'Settings', lede: 'They are kept on this device.', rows, back: () => this.showHome() })
  }

  private showAccounts() {
    const player = this.host.player()
    const rows: Row[] = [this.backRow(() => this.showHome())]
    for (const name of this.host.accounts())
      rows.push({ id: `account:${name}`, label: name, marker: '#', sub: name === player ? 'in use' : undefined, hint: name === player ? 'The account you play as.' : `Play as ${name}, or remove it.`, take: () => this.showAccount(name) })
    rows.push({
      id: 'add',
      label: 'Add an offline account',
      marker: '+',
      sub: 'on this device',
      hint: () => (this.typing === null ? 'A new account on this device, its games its own.' : this.host.accounts().includes(this.typing) ? `${this.typing} is here already: Enter plays as it.` : 'Letters, digits, - and _. Enter adds it and plays as it; Escape goes back.'),
      named: (name) => this.switchTo(name),
    })
    this.show({ id: 'accounts', title: 'Accounts', lede: 'The accounts on this device.', rows, back: () => this.showHome() }, `account:${player}`)
  }

  private showAccount(name: string) {
    const inUse = name === this.host.player()
    const rows: Row[] = [
      this.backRow(() => this.showAccounts()),
      { id: 'play-as', label: `Play as ${name}`, marker: '>', sub: inUse ? 'in use' : undefined, hint: inUse ? 'The account you play as.' : `Its games on the front screen, and new ones saved as ${name}.`, take: () => this.switchTo(name) },
      {
        id: 'delete',
        label: 'Delete',
        marker: 'x',
        hint: () => (inUse ? 'In use: play as another account first.' : this.confirming ? `Press again: ${name} and every game saved as ${name} are gone for good.` : `${name}, and every game saved as ${name}.`),
        off: () => inUse,
        take: () => {
          if (!this.confirming) return void (this.confirming = true)
          this.host.remove(name)
          this.showAccounts()
        },
      },
    ]
    this.show({ id: 'account', title: name, lede: 'An offline account, on this device.', rows, back: () => this.showAccounts() })
  }

  /** play as `name`: the client changes over, and the front shows that player's games */
  private switchTo(name: string): HomeAction {
    this.marks.delete('home')
    return { kind: 'switch', name }
  }

  private backRow(back: () => void): Row {
    return { id: 'back', label: 'Back', marker: '<', hint: 'Back to where you were.', take: back }
  }

  /** `s` on show, its cursor where it was last, else on `first`, else on its first row but Back */
  private show(s: Screen, first?: string) {
    if (this.screen) {
      const at = this.screen.rows[this.focus]
      if (at) this.marks.set(this.screen.id, at.id)
      // the report is the front's first sight after a game, and gone once the player has moved on
      if (s.id !== 'home' || this.screen.id !== 'home') this.why = null
    }
    this.screen = s
    this.typing = null
    this.confirming = false
    const at = [this.marks.get(s.id), first].map((id) => s.rows.findIndex((r) => r.id === id)).find((i) => i >= 0)
    this.focus = at ?? Math.max(0, s.rows.findIndex((r) => !r.heading && r.id !== 'back'))
  }

  /** a setting a step along its values, saved, and shown at once */
  private adjust(r: SettingRow, d: number) {
    const s = getSettings()
    if (rowOff(r, s)) return
    const values = r.values as readonly unknown[]
    const i = values.indexOf(s[r.key])
    ;(s as unknown as Record<string, unknown>)[r.key] = values[((((i < 0 ? 0 : i) + d) % values.length) + values.length) % values.length]
    saveSettings(s)
    this.host.changed()
  }

  /** A key: up and down (or k and j) move, left and right change a setting, Enter or Space takes the row, Escape goes back; while a name is typed, the name's. */
  key(k: KeyLike): HomeAction {
    const rows = this.screen.rows
    const row = rows[this.focus]
    if (this.typing !== null && row.named) {
      if (k.key === 'Escape') this.typing = null
      else if (k.key === 'Backspace') this.typing = this.typing.slice(0, -1)
      else if (k.key === 'Enter') return this.typing ? (row.named(this.typing) ?? null) : null
      else if (/^[A-Za-z0-9_-]$/.test(k.key) && !k.ctrlKey && !k.altKey) {
        if (this.typing.length < NAME_MAX) this.typing += k.key
      } else if (k.key === 'ArrowUp' || k.key === 'ArrowDown') {
        this.typing = null
        return this.key(k)
      }
      return null
    }
    const step = (d: number) => {
      let i = this.focus
      do i = (i + d + rows.length) % rows.length
      while (rows[i].heading && i !== this.focus)
      this.focus = i
      this.confirming = false
    }
    if (k.key === 'ArrowUp' || k.key === 'k') step(-1)
    else if (k.key === 'ArrowDown' || k.key === 'j') step(1)
    else if ((k.key === 'ArrowLeft' || k.key === 'h') && row.adjust) row.adjust(-1)
    else if ((k.key === 'ArrowRight' || k.key === 'l') && row.adjust) row.adjust(1)
    else if (k.key === 'Escape') this.screen.back?.()
    else if (k.key === 'q' && this.screen.id === 'home') return { kind: 'quit' }
    else if (k.key === 'Enter' || k.key === ' ') {
      if (row.off?.()) return null
      if (row.named) this.typing = ''
      else return row.take?.() ?? null
    }
    return null
  }

  /**
   * The screen, as a terminal program lays one out: at the bottom left, everything from INDENT in, the rows' marks
   * there too and their words after them; the focused row's bar from the left edge. Its title's place first (the logo on the front, else its
   * title set in the font: `art`, which the client fills), then its words: on the room, shaded under them, or on a
   * bar (the focused row's). The version in the bottom right corner. `artRows`: how many rows the title's art takes
   * at a width, 0 for none.
   */
  layout(cols: number, rows: number, artRows: (width: number) => number): HomeLayout {
    const width = Math.max(1, Math.min(cols - INDENT - 1, 72))
    const pad: Span = { text: ' '.repeat(INDENT) }
    const sc = this.screen
    const lines: HomeLayout['lines'] = []
    const body: { line: Line; bar?: boolean }[] = []
    body.push({ line: [pad, { text: sc.lede, fg: INK_DIM }] })
    if (sc.id === 'home') body.push({ line: [pad, { text: `“${this.splash}” — Xom`, fg: INK_DIM }] })
    // the head stands apart from the rows, as the browser's floats above them
    body.push({ line: [] }, { line: [] })
    if (this.why && sc.id === 'home') body.push({ line: [pad, { text: this.why, fg: GOLD_BRIGHT }] }, { line: [] })
    const labelW = Math.max(0, ...sc.rows.filter((r) => r.value).map((r) => r.label.length))
    sc.rows.forEach((r, i) => {
      if (r.heading) {
        if (i > 1) body.push({ line: [] })
        body.push({ line: [pad, { text: r.label.toUpperCase(), fg: GOLD }] })
        return
      }
      const on = i === this.focus
      const off = r.off?.() ?? false
      const ink = off ? GREY : on ? GOLD_BRIGHT : INK
      const mark = { text: (on ? '@' : r.marker || ' ').padEnd(INDENT), fg: on ? GOLD_BRIGHT : GREY }
      let label: Line
      if (on && this.typing !== null) label = [{ text: 'Name: ', fg: ink }, { text: this.typing, fg: PALETTE[15] }, { text: ' ', bg: INK }]
      else if (r.value) {
        const v = r.value()
        label = [{ text: r.label.padEnd(labelW + 3), fg: ink }, ...(on && !off ? [{ text: `‹ ${v} ›`, fg: GOLD_BRIGHT }] : [{ text: `  ${v}`, fg: off ? GREY : INK_DIM }])]
      } else label = [{ text: r.id === 'delete' && this.confirming ? 'Delete all?' : r.label, fg: ink }]
      body.push({ line: [pad, mark, ...label], bar: on })
      if (r.sub && !(on && this.typing !== null)) body.push({ line: [pad, pad, { text: r.sub, fg: INK_DIM }], bar: on })
    })
    body.push({ line: [] })
    // the focused row's hint, wrapped to the words' width as the browser's message line wraps
    const row = sc.rows[this.focus]
    for (const l of wrap(typeof row.hint === 'function' ? row.hint() : row.hint, width)) body.push({ line: [pad, { text: l, fg: INK_DIM }] })

    // the title's art: the logo as wide as the browser's title is of its column, a screen's title smaller; none where
    // the screen is too short for it and the rows, and the title in words instead
    let artW = sc.id === 'home' ? Math.min(width, Math.max(24, Math.round(cols * 0.4)), 60) : Math.min(width, Math.max(16, Math.round(cols * 0.25)), 36)
    let artH = artRows(artW)
    // the bottom row is the version's
    const room = rows - 1
    if (body.length + artH + 1 > room) artW = artH = 0
    const title: Line[] = artH ? [] : [[pad, { text: sc.title ?? 'Orbrun', fg: INK }], []]
    const height = artH + (artH ? 1 : 0) + title.length + body.length
    let y = Math.max(0, room - height)
    const art = artH ? { x: INDENT, y, cols: artW, rows: artH } : null
    y += artH ? artH + 1 : 0
    for (const t of title) lines.push({ y: y++, line: t })
    for (const b of body) lines.push({ y: y++, ...b })
    const version = { x: cols - 1 - VERSION.length, y: rows - 1, line: [{ text: VERSION, fg: GREY }] as Line }
    return { width: width + INDENT, art, lines, version, bar: { x: 0, width: width + INDENT } }
  }
}

export interface HomeLayout {
  /** how wide the lines may be, from the left edge */
  width: number
  /** where the title's art stands, in cells; null for the title in words */
  art: { x: number; y: number; cols: number; rows: number } | null
  lines: { y: number; line: Line; bar?: boolean }[]
  version: { x: number; y: number; line: Line }
  /** the focused row's bar: from the left edge, across the words */
  bar: { x: number; width: number }
}

/** `text` in lines of at most `width`, broken between words */
function wrap(text: string, width: number): string[] {
  const out: string[] = []
  let line = ''
  for (const w of text.split(' ')) {
    if (line && line.length + 1 + w.length > width) {
      out.push(line)
      line = w
    } else line = line ? `${line} ${w}` : w
  }
  return [...out, line]
}

/** The focused row's bar at `t` (0 at its left, 1 at its right): gold a fifth over its ground at the left, fading (styles.css `.menu li.focused`). */
export function barAt(t: number): RGB {
  const a = 0.2 * Math.max(0, 1 - t)
  return BAR_GROUND.map((c, i) => Math.round(c * (1 - a) + GOLD[i] * a)) as RGB
}
