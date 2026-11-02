/**
 * The front screen in a terminal, as the browser's (menu.ts `showHome`):
 * a place of the front room's (room/places.ts, the next of the cycle each
 * start) standing still behind it in the view's own glyphs, facing a way of
 * its own, under the place's tinted veil (styles.css `.room-veil`) and the
 * shade the menu casts; over it, at the left, the logo in the view's glyphs,
 * the lede and a word from Xom, and the rows: a version's saved game to
 * continue, or a new game where there is none, the player, Settings and
 * Quit; the focused row's hint under them, the rows on the foot as a
 * terminal program has them and the logo and lede in the middle of what is
 * above, as the browser's float there; and the version in the corner.
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
const ORB = path.join(APP, 'public/orb.png')
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
/** the longest name a character takes (offline server `profileName`) */
const NAME_MAX = 20
/** the blank lines between the head and the rows at the least, as the browser's head stands apart from them */
const HEAD_GAP = 2
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

/** Art as RGBA, cut to its ink: the word of the logo, or a screen's title, a few pixels to each of the view's dots. */
export interface Logo {
  rgba: Uint8Array
  w: number
  h: number
  /** where its ink lies by the type it was set in, in pixels: the size it was set at, the ink's left from the pen's start, its foot below the baseline */
  metrics?: { em: number; left: number; base: number }
}

/**
 * The logo as the browser's front sets it (styles.css `.home-list .brand .head .place`): the Orb of Zot's own tile
 * (public/orb.png) before the name in the wordmark's face (`loadTitle`), laid out and shaded as the page does it
 * (`lockup`).
 */
export interface LogoArt {
  /** crawl's tile, ORB_TEXELS a side, RGBA */
  tile: Uint8Array
  word: Logo
}

/** the orb's sides, in dots: crawl's tile a texel to a dot, and two */
const ORB_SIZES = [32, 16]
/** the orb's tile, a side in texels */
const ORB_TEXELS = 32
/** the page's lockup, in ems of its font (styles.css `.place::before`): the orb's side, the air after it, how far below the baseline it sits */
const ORB_EM = 0.71
const ORB_GAP_EM = 0.16
const ORB_DROP_EM = 0.055
/** the page's font size, in pixels (7.5rem): what its shadows' pixels are of */
const PAGE_EM = 120
/**
 * What the page casts round the orb and under the name, in its pixels (styles.css): the orb's `drop-shadow`s, each
 * cast from what the one before left (its gold glow, its purple one, the black under it), and the name's
 * `text-shadow`; `dev`, the blur's deviation. A text-shadow's is half its blur radius, as the spec has it; a
 * drop-shadow's, as Chrome draws it, the radius itself (measured off the page: its glow reaches twice as far as half
 * would).
 */
interface Shadow {
  dy: number
  dev: number
  rgb: RGB
  a: number
}
const ORB_SHADOWS: Shadow[] = [
  { dy: 0, dev: 8, rgb: [185, 120, 31], a: 0.75 },
  { dy: 0, dev: 18, rgb: [139, 63, 176], a: 0.45 },
  { dy: 2, dev: 8, rgb: [0, 0, 0], a: 1 },
]
const WORD_SHADOW: Shadow = { dy: 2, dev: 12, rgb: [0, 0, 0], a: 1 }
/** how far a shadow is drawn out, in its deviations: past it, less than a hundredth of it is left */
const SHADOW_REACH = 3
/** how much of a dot the orb or the name must cover for its cell to be drawn as glyphs: less, and the cell is the room's, shaded */
const LOGO_INK = 0.2
/** how much of a dot the name's ink must cover for the dot to be inked: the name is cut sharp on the dots */
const WORD_CUT = 0.5
/** how much a shadow must lay on a dot for a plain cell of the room's to be drawn as glyphs, to show it by the dot */
const LOGO_GLOW = 0.04

/** The logo, set once: the orb's tile and the name cut to its ink. Null where either cannot be read. */
export async function loadLogo(): Promise<LogoArt | null> {
  try {
    const { default: sharp } = await import('sharp')
    const tile = new Uint8Array(await sharp(ORB).resize(ORB_TEXELS, ORB_TEXELS, { kernel: 'nearest' }).ensureAlpha().raw().toBuffer())
    const word = await loadTitle('Orbrun')
    return word && { tile, word }
  } catch {
    return null
  }
}

/** How the logo stands in cells: the orb `dots` a side, its cells, and all of it, `rows` tall. `sy`, `aspect`: as `fitLogo` was given them. */
export interface LogoFit {
  dots: number
  rows: number
  orbCols: number
  cols: number
  sy: number
  aspect: number
}

/** the share of the screen's width the logo takes, as the browser's does of its window: it grows to its larger size there */
export const LOGO_SHARE = 0.4

/**
 * The page's em in dots, across and down, for an orb `dots` a side: its texels on the dots, as tall as it is wide in
 * dots (so a little taller than wide on a cell more than twice as tall as wide), the em by its height.
 */
function emOf(dots: number, sy: number, aspect: number) {
  const down = dots / ORB_EM
  return { x: (down * 2 * aspect) / sy, y: down }
}

/** where the name's ink starts and ends across, in dots from the orb's left */
function wordSpan(word: Logo, ex: number, dots: number) {
  const m = word.metrics!
  const x0 = dots + ORB_GAP_EM * ex + (m.left / m.em) * ex
  return { x0, x1: x0 + (word.w / m.em) * ex }
}

/**
 * The logo in at most `width` cells across and `most` rows down: the orb at its larger size (ORB_SIZES) where that
 * is within `want` cells (the browser's share of the screen, LOGO_SHARE), else its smaller; the name in the page's
 * proportion to it. `sy`: the mosaic's dots down a cell; `aspect`: a cell's height over its width. Null where not
 * even the smaller fits.
 */
export function fitLogo(logo: LogoArt, width: number, want: number, most: number, sy: number, aspect: number): LogoFit | null {
  const sizes = ORB_SIZES.map((dots) => {
    const rows = Math.ceil(dots / sy)
    const { x1 } = wordSpan(logo.word, emOf(dots, sy, aspect).x, dots)
    return { dots, rows, orbCols: dots / 2, cols: Math.ceil(x1 / 2), sy, aspect }
  })
  const fits = sizes.filter((f) => f.cols <= width && f.rows <= most)
  return fits.find((f) => f.cols <= want) ?? fits[fits.length - 1] ?? null
}

/**
 * The logo laid out in the mosaic's dots as the page draws it, its shadows round it: `cols` x `rows` cells from
 * (`x`, `y`) cells off the fit's top-left, the shadows reaching past it; each dot what the page lays on what is
 * behind it (premultiplied RGBA, 0 to 1), and how much of it the orb or the name themselves cover.
 */
export interface Lockup {
  x: number
  y: number
  cols: number
  rows: number
  sy: number
  rgba: Float32Array
  ink: Float32Array
}

/**
 * The logo as the page sets it, in dots: the orb's tile a texel to a dot (or two to one, the smaller), the name its
 * ink's proportion and place by the page's lockup (`.place::before`: the orb 0.71em a side, 0.16em before the name,
 * 0.055em under its baseline), a dot inked where the ink covers most of it (WORD_CUT); then the page's shadows, each blurred from
 * what casts it and laid under it (ORB_SHADOWS, WORD_SHADOW), the name over the orb's.
 */
export function lockup(logo: LogoArt, fit: LogoFit): Lockup {
  const { dots, sy, aspect } = fit
  const em = emOf(dots, sy, aspect)
  const dev = (s: Shadow) => ({ x: (s.dev / PAGE_EM) * em.x, y: (s.dev / PAGE_EM) * em.y })
  const reach = Math.max(...[...ORB_SHADOWS, WORD_SHADOW].map((s) => SHADOW_REACH * dev(s).y + (s.dy / PAGE_EM) * em.y))
  const mx = Math.ceil((reach * em.x) / em.y / 2), my = Math.ceil(reach / sy)
  const cols = fit.cols + 2 * mx, rows = fit.rows + 2 * my
  const W = cols * 2, H = rows * sy
  const ox = mx * 2, oy = my * sy + Math.floor((fit.rows * sy - dots) / 2)

  // the orb: its texels on the dots, or each dot the mean of the two by two it covers
  const orb = new Float32Array(W * H * 4)
  const k = ORB_TEXELS / dots
  for (let y = 0; y < dots; y++)
    for (let x = 0; x < dots; x++) {
      const o = ((oy + y) * W + ox + x) * 4
      for (let j = 0; j < k; j++)
        for (let i = 0; i < k; i++) {
          const t = ((y * k + j) * ORB_TEXELS + x * k + i) * 4, a = logo.tile[t + 3] / 255 / (k * k)
          for (let c = 0; c < 3; c++) orb[o + c] += (logo.tile[t + c] / 255) * a
          orb[o + 3] += a
        }
    }
  // the name: each of its pixels shared among the dots it overlaps, by how much of each it covers
  const word = logo.word, m = word.metrics!
  const { x0, x1 } = wordSpan(word, em.x, dots)
  const base = oy + dots - ORB_DROP_EM * em.y
  const y1 = base + (m.base / m.em) * em.y, y0 = y1 - (word.h / m.em) * em.y
  const cover = new Float32Array(W * H)
  /** the dots a pixel from `a` to `b` (in dots) overlaps, and how much of each */
  const spans = (a: number, b: number) => {
    const out: [number, number][] = []
    for (let d = Math.floor(a); d < b; d++) out.push([d, Math.min(b, d + 1) - Math.max(a, d)])
    return out
  }
  const sx = (x1 - x0) / word.w, sy_ = (y1 - y0) / word.h
  const across = Array.from({ length: word.w }, (_, x) => spans(ox + x0 + x * sx, ox + x0 + (x + 1) * sx))
  for (let y = 0; y < word.h; y++) {
    const down = spans(y0 + y * sy_, y0 + (y + 1) * sy_)
    for (let x = 0; x < word.w; x++) {
      const a = word.rgba[(y * word.w + x) * 4 + 3] / 255
      if (!a) continue
      for (const [dy, wy] of down) if (dy >= 0 && dy < H) for (const [dx, wx] of across[x]) cover[dy * W + dx] += a * wx * wy
    }
  }
  // cut sharp on the dots: a dot is the ink's where it covers most of it, else none of it, so the letters' edges
  // fall on the dots (its shadow is still cast from the smooth ink, as the page casts it)
  const smooth = cover.slice()
  for (let i = 0; i < W * H; i++) cover[i] = cover[i] >= WORD_CUT ? 1 : 0
  const ink = new Float32Array(W * H)
  for (let i = 0; i < W * H; i++) ink[i] = Math.max(orb[i * 4 + 3], Math.min(1, cover[i]))

  /** what a shadow lays under `alpha`: it blurred, moved down, in the shadow's colour */
  const cast = (alpha: Float32Array, s: Shadow) => {
    const d = dev(s)
    const a = blur(alpha, W, H, d.x, d.y, (s.dy / PAGE_EM) * em.y)
    return (i: number) => a[i] * s.a
  }
  /** `over` laid on the shadow `s` casts from it, in place */
  const under = (over: Float32Array, alpha: Float32Array, s: Shadow) => {
    const sa = cast(alpha, s)
    for (let i = 0; i < W * H; i++) {
      const a = sa(i), keep = 1 - over[i * 4 + 3]
      for (let c = 0; c < 3; c++) over[i * 4 + c] += (s.rgb[c] / 255) * a * keep
      over[i * 4 + 3] += a * keep
    }
  }
  for (const s of ORB_SHADOWS) under(orb, Float32Array.from({ length: W * H }, (_, i) => orb[i * 4 + 3]), s)
  const name = new Float32Array(W * H * 4)
  for (let i = 0; i < W * H; i++) {
    const a = Math.min(1, cover[i])
    for (let c = 0; c < 3; c++) name[i * 4 + c] = (INK[c] / 255) * a
    name[i * 4 + 3] = a
  }
  under(name, smooth.map((v) => Math.min(1, v)), WORD_SHADOW)
  // the name over the orb's shadows, as the page paints its text after the orb before it
  const rgba = new Float32Array(W * H * 4)
  for (let i = 0; i < W * H; i++) {
    const keep = 1 - name[i * 4 + 3]
    for (let c = 0; c < 4; c++) rgba[i * 4 + c] = name[i * 4 + c] + orb[i * 4 + c] * keep
  }
  return { x: -mx, y: -my, cols, rows, sy, rgba, ink }
}

/** `a` (`w` x `h`) blurred, a Gaussian of deviation `dx` across and `dy` down, and moved `down` (all in its pixels). */
function blur(a: Float32Array, w: number, h: number, dx: number, dy: number, down: number): Float32Array {
  const kernel = (d: number, shift: number) => {
    const r = Math.ceil(SHADOW_REACH * d + Math.abs(shift))
    const ks = Float32Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r - shift) ** 2) / (2 * d * d)))
    const sum = ks.reduce((s, v) => s + v, 0)
    return { r, ks: ks.map((v) => v / sum) }
  }
  const pass = (src: Float32Array, n: number, len: number, step: number, line: number, { r, ks }: { r: number; ks: Float32Array }) => {
    const out = new Float32Array(src.length)
    for (let l = 0; l < n; l++)
      for (let p = 0; p < len; p++) {
        let s = 0
        for (let q = -r; q <= r; q++) {
          const at = p - q
          if (at >= 0 && at < len) s += src[l * line + at * step] * ks[q + r]
        }
        out[l * line + p * step] = s
      }
    return out
  }
  return pass(pass(a, h, w, 1, w, kernel(dx, 0)), w, h, w, 1, kernel(dy, down))
}

/** A cell of the logo: two of its colours and the dots of the first (as `CrispCell`'s); or a shade to lay on the room's cell, premultiplied (0xRRGGBB, 0 to 1). */
export type LogoCell = { mask: number; fg: number; bg: number } | { shade: number; a: number }

/**
 * The lockup as cells over the room, `room(col, row)` the colour behind each (0xRRGGBB, cells from the lockup's
 * top-left): a cell the orb or the name covers is its dots laid on the room, then the two colours and the glyph that
 * leave the least between them and the dots (the pair of its dots' colours that does, then each the mean of the dots
 * it takes); so is a cell the shadows reach where the room's
 * is `plain` (one colour), so a glow fades by dots, not cells; one where the room's has glyphs, a shade laid on it,
 * so they stay; null for a cell with nothing.
 */
export function logoCells(lk: Lockup, room: (col: number, row: number) => number, plain?: (col: number, row: number) => boolean): (LogoCell | null)[] {
  const { cols, rows, sy, rgba, ink } = lk, W = cols * 2
  const apart = (a: number[], b: number[]) => 0.3 * (a[0] - b[0]) ** 2 + 0.59 * (a[1] - b[1]) ** 2 + 0.11 * (a[2] - b[2]) ** 2
  const out: (LogoCell | null)[] = []
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const idx: number[] = []
      for (let j = 0; j < sy; j++) for (let i = 0; i < 2; i++) idx.push((r * sy + j) * W + c * 2 + i)
      const inked = idx.some((i) => ink[i] >= LOGO_INK)
      if (!inked && !(plain?.(c, r) && idx.some((i) => rgba[i * 4 + 3] >= LOGO_GLOW))) {
        let pr = 0, pg = 0, pb = 0, pa = 0
        for (const i of idx) {
          pr += rgba[i * 4]
          pg += rgba[i * 4 + 1]
          pb += rgba[i * 4 + 2]
          pa += rgba[i * 4 + 3]
        }
        const n = idx.length
        if (pa / n < 1 / 255) out.push(null)
        else out.push({ shade: (Math.round((pr / n) * 255) << 16) | (Math.round((pg / n) * 255) << 8) | Math.round((pb / n) * 255), a: pa / n })
        continue
      }
      const u = room(c, r), under = [(u >> 16) & 255, (u >> 8) & 255, u & 255]
      const ds = idx.map((i) => [0, 1, 2].map((ch) => rgba[i * 4 + ch] * 255 + under[ch] * (1 - rgba[i * 4 + 3])))
      // the pair of its dots' colours that leaves the least between them and the dots
      let best = { e: Infinity, mask: 0 }
      for (let a = 0; a < ds.length; a++)
        for (let b = a; b < ds.length; b++) {
          let e = 0, mask = 0
          ds.forEach((d, i) => {
            const ea = apart(d, ds[a]), eb = apart(d, ds[b])
            if (ea <= eb) mask |= 1 << i
            e += Math.min(ea, eb)
          })
          if (e < best.e) best = { e, mask }
        }
      // each colour the mean of the dots it takes
      const mean = (on: boolean) => {
        const sel = ds.filter((_, i) => !!(best.mask & (1 << i)) === on)
        if (!sel.length) return 0
        const m = [0, 1, 2].map((ch) => Math.round(sel.reduce((s, d) => s + d[ch], 0) / sel.length))
        return (m[0] << 16) | (m[1] << 8) | m[2]
      }
      const fg = mean(true), bg = mean(false)
      const all = (1 << ds.length) - 1
      out.push(best.mask === all ? { mask: all, fg, bg: fg } : { mask: best.mask, fg, bg })
    }
  return out
}

/** An RGBA image cut to its ink; null for none. */
function trimmed({ data, info }: { data: Buffer; info: { width: number; height: number } }): (Logo & { x0: number; y0: number }) | null {
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
  return { rgba, w, h, x0, y0 }
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
    const t = trimmed(await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true }))
    return t && { rgba: t.rgba, w: t.w, h: t.h, metrics: { em: size, left: t.x0 - pad, base: t.y0 + t.h - (pad + size) } }
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
   * The screen, as a terminal program lays one out: at the left, everything from INDENT in, the rows' marks there
   * too and their words after them, the rows on the foot and the head in the middle of what is above them; the
   * focused row's bar from the left edge. Its title's place first (the logo on the front, else its
   * title set in the font: `art`, which the client fills), then its words: on the room, shaded under them, or on a
   * bar (the focused row's). The version in the bottom right corner. `artRows`: how many rows the title's art takes
   * at a width, at most `most` rows; 0 for none.
   */
  layout(cols: number, rows: number, artRows: (width: number, most: number) => number): HomeLayout {
    const width = Math.max(1, Math.min(cols - INDENT - 1, 72))
    const pad: Span = { text: ' '.repeat(INDENT) }
    const sc = this.screen
    const lines: HomeLayout['lines'] = []
    // the head: the title's art (or its words), the lede, and Xom's word
    const lede: Line = [pad, { text: sc.lede, fg: INK_DIM }]
    const quote: Line | null = sc.id === 'home' ? [pad, { text: `“${this.splash}” — Xom`, fg: INK_DIM }] : null
    // the body, on the screen's foot: how the last game ended, the rows, and the focused row's hint
    const body: { line: Line; bar?: boolean }[] = []
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
    // the focused row's hint, wrapped to the words' width as the browser's message line wraps, in as many lines as
    // the screen's longest hint takes: the screen stands on its foot, and a hint of more lines would lift it all
    const hintOf = (r: Row) => wrap(typeof r.hint === 'function' ? r.hint() : r.hint, width)
    const hint = hintOf(sc.rows[this.focus])
    const hintRows = Math.max(hint.length, ...sc.rows.filter((r) => !r.heading).map((r) => hintOf(r).length))
    for (let i = 0; i < hintRows; i++) body.push({ line: i < hint.length ? [pad, { text: hint[i], fg: INK_DIM }] : [] })

    // the body stands on the foot, over the version's row; the head in the middle of what is above it, as the
    // browser's floats between the top and the rows, but never nearer them than HEAD_GAP
    const room = rows - 1
    const top = room - body.length
    // the head as much as the room above the rows holds, giving way as the screen grows shorter: Xom's word first,
    // then the lede, then the title's art at a smaller size (the logo's size the client's to choose, `fitLogo`; a
    // screen's title narrower, and so shorter), then the title in words, then nothing
    const space = top - HEAD_GAP
    const artW0 = sc.id === 'home' ? width : Math.min(width, Math.max(16, Math.round(cols * 0.25)), 36)
    const full = artRows(artW0, Infinity)
    /** the largest art in `most` rows: the width it is drawn at and its rows, else none */
    const shrunk = (most: number): [number, number] => {
      for (let w = artW0; w >= 8; w--) {
        const h = artRows(w, most)
        if (h && h <= most) return [w, h]
      }
      return [0, 0]
    }
    // the title at its sizes, largest first: its art as the client draws it, smaller, and in words
    type Title = { art: [number, number]; words: Line[] }
    const titles: Title[] = []
    if (full) titles.push({ art: [artW0, full], words: [] })
    const less = shrunk(full ? full - 1 : space)
    if (less[1]) titles.push({ art: less, words: [] })
    titles.push({ art: [0, 0], words: [[pad, { text: sc.title ?? 'Orbrun', fg: INK }]] })
    const [first, ...smaller] = titles
    // the title in words stands a line apart from the lede, as its art does
    const under = first.words.length ? [[] as Line] : []
    const heads: Title[] = [
      ...(quote ? [{ art: first.art, words: [...first.words, ...under, lede, quote] }] : []),
      { art: first.art, words: [...first.words, ...under, lede] },
      first,
      ...smaller,
    ]
    const tallOf = (h: Title) => h.art[1] + (h.art[1] && h.words.length ? 1 : 0) + h.words.length
    const chosen = heads.find((h) => tallOf(h) <= space) ?? { art: [0, 0] as [number, number], words: [] }
    const [artW, artH] = chosen.art
    const words = chosen.words
    const tall = tallOf(chosen)
    let y = Math.max(0, Math.min(Math.floor((top - tall) / 2), top - HEAD_GAP - tall))
    const art = artH ? { x: INDENT, y, cols: artW, rows: artH } : null
    y += artH ? artH + (words.length ? 1 : 0) : 0
    for (const t of words) lines.push({ y: y++, line: t })
    y = tall ? Math.max(y + HEAD_GAP, top) : top
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
