/**
 * A prototype: the view as terminal cells, crawl's tiles mapped onto a grid
 * cast column by column and drawn two square pixels a cell in half blocks,
 * with crawl's glyphs naming what is too far to make out (glyph/render.ts).
 * `npm run term:glyph [place]` walks a place of the front room's
 * (lair-grove, orc-mines, elven-halls, vaults, zot-4…) with a few monsters
 * set down in it from crawl's own tiles (engine/dist/gamedata), as places
 * keep none; arrows (or WASD) step and turn, `m` moves the monsters back in
 * front of you, `g` draws them as their letters instead, `x` draws in
 * sextants or octants, `q` quits.
 * `npm run term:glyph -- [place] --snap out.png [cols rows]` writes a frame
 * as a PNG instead, its block glyphs drawn exactly; `--bench [cols rows
 * frames]` times frames as the eye spins and walks (README.md).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { loadGamedata } from '@orbrun/gamedata'
import { cellKey, REST_PITCH, type Billboard, type Camera, type Dir8, type SceneCell } from '@orbrun/scene'
import type { Pixels } from '@orbrun/render-term'
import { readScene, type PlaceFile } from '../../apps/orbrun/src/room/place-data'
import { RoomTiles } from '../../apps/orbrun/src/room/tiles'
import { framedDoors } from '@orbrun/render-3d/grid'
import { CRAWL, toAnsi, type Art, type Cell, type RGB, type Thing } from './glyph/render'
import { GlyphThreads } from './glyph/threads'
import { INVERSE } from './glyph/shapes'
import { warmGlyphs } from './glyph/font'
import { paint, warmText } from './glyph/paint'

const here = path.dirname(fileURLToPath(import.meta.url))
const placesDir = path.resolve(here, '../../apps/orbrun/public/room/places')
const engineDir = path.resolve(here, '../../engine/dist')
const args = process.argv.slice(2)
const snapAt = args.indexOf('--snap')
const snap = snapAt >= 0 ? args.splice(snapAt, 4).slice(1) : null
const benchAt = args.indexOf('--bench')
const bench = benchAt >= 0 ? args.splice(benchAt, 4).slice(1) : null
const placeId = args[0] || 'lair-grove'
/** a frame written whole or not at all (frame.mjs `synced`) */
const SYNC_ON = Buffer.from('\x1b[?2026h')
const SYNC_OFF = '\x1b[?2026l'
const STEP_S = 0.12
const TURN_S = 0.1

const readPixels = async (file: string): Promise<Pixels> => {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, data }
}
const file = JSON.parse(fs.readFileSync(path.join(placesDir, `${placeId}.json`), 'utf8')) as PlaceFile
const atlas = await readPixels(path.join(placesDir, `${placeId}.png`))
const tiles = RoomTiles.fromPlace(file, undefined)
const scene = readScene(file.scene)
// the view on threads (ORBRUN_TERM_THREADS, 0 for none); `view` the same on this one, for a still frame
const threads = new GlyphThreads(tiles, (name) => (tiles.atlasNames().includes(name) ? atlas : undefined))
threads.setScene(scene)
const view = threads.view
if (process.env.ORBRUN_TERM_BLOCKS === 'sextant') view.opts.mosaic = 'sextant'
// GLYPH_OPTS='{"wallInset":0.375}': other options than the gym's best, here as in the bench
Object.assign(view.opts, JSON.parse(process.env.GLYPH_OPTS || '{}'))

// crawl's own tiles, for the monsters a place keeps none of
const version = fs.readdirSync(path.join(engineDir, 'gamedata'))[0]
const gd = await loadGamedata({
  base: engineDir,
  version,
  io: {
    fetchText: async (url) => fs.promises.readFile(url, 'utf8'),
    loadImage: async (url) => (await readPixels(url)) as unknown as TexImageSource,
  },
})
const mons = (name: string): Art[] => {
  const id = gd.player.id(`MONS_${name.toUpperCase().replace(/ /g, '_')}`)
  const rect = id != null ? gd.tile(id, 'player') : undefined
  const px = rect && (gd.atlas(rect.atlas) as unknown as Pixels | undefined)
  return rect && px ? [{ px, rect }] : []
}

/** crawl's glyph and colour for a monster, by name; a few for the prototype */
const MONSTERS: Record<string, [string, number]> = {
  goblin: ['g', 7], hobgoblin: ['g', 6], orc: ['o', 12], 'orc warrior': ['o', 14], ogre: ['O', 6], quokka: ['r', 15], rat: ['r', 6],
  jackal: ['j', 6], kobold: ['K', 6], yak: ['Y', 6], troll: ['T', 6], 'black bear': ['U', 8], adder: ['S', 2], plant: ['P', 10],
  fungus: ['f', 7], bush: ['P', 6], gnoll: ['g', 14],
}
/** what names an upright feature too far to make out */
const featureGlyph = (c: SceneCell): [string, RGB] | null => {
  const f = c.feature
  if (!f) return null
  if (f.type === 'stairs' || f.type === 'hatch') return [f.dir === 'down' ? '>' : '<', CRAWL[f.type === 'hatch' ? 6 : f.branch ? 14 : 15]]
  if (f.type === 'fountain') return ['{', CRAWL[9]]
  if (f.type === 'altar') return ['_', CRAWL[15]]
  if (f.type === 'shop') return ['0', CRAWL[14]]
  if (f.type === 'portal') return ['Ω', CRAWL[13]]
  return null
}

const walkable = (x: number, y: number) => {
  const c = scene.cells.get(cellKey(x, y))
  return !!c && !c.occluder && c.kind !== 'wall' && !(c.feature?.type === 'other' && c.feature.name === 'tree')
}

const facing0 = (Math.round(file.eye.yaw / (Math.PI / 4)) & 7) as Dir8
const cam: Camera = { x: file.eye.x, y: file.eye.y, eyeX: file.eye.x, eyeY: file.eye.y, yaw: (facing0 * Math.PI) / 4, pitch: REST_PITCH, facing: facing0 }
let goalYaw = cam.yaw

// what stands in the place: its upright features, and its plants and fungi
const fixtures: Thing[] = []
// a door in its doorway is the level's where walls stand back (glyph/render.ts `doors`), not a sprite facing the eye
const framed = view.opts.wallInset ? framedDoors(scene) : new Map()
for (const c of scene.cells.values()) {
  if (c.featureTile == null || c.stance !== 'upright' || c.occluder || framed.has(cellKey(c.x, c.y))) continue
  const art = view.art(c.featureTile)
  if (!art) continue
  const g = featureGlyph(c)
  fixtures.push({ x: c.x, y: c.y, art: [art], glyph: g?.[0] ?? '', colour: g?.[1] ?? CRAWL[7], size: 1 })
}
const scenery = scene.billboards.flatMap((b: Billboard): Thing[] => {
  const art = (b.layers?.map((l) => l.tile) ?? [b.tile]).map((t) => view.art(t)).filter((a): a is Art => !!a)
  return art.length ? [{ x: b.x, y: b.y, art, glyph: '', colour: CRAWL[7], size: b.height }] : []
})

/** a few monsters on the open ground ahead, near and far */
let monsters: Thing[] = []
function placeMonsters() {
  const cast = ['goblin', 'quokka', 'orc', 'ogre', 'yak', 'troll', 'jackal', 'adder']
  const a = Math.round(goalYaw / (Math.PI / 4)) * (Math.PI / 4)
  const fx = Math.round(Math.sin(a))
  const fy = Math.round(-Math.cos(a))
  monsters = []
  const taken = new Set<number>()
  const spots: [number, number, number][] = [[2, 0, 0], [4, -1, 1], [3, 2, 2], [6, 1, 3], [9, -2, 4], [13, 0, 5], [7, -3, 6], [18, 1, 7]]
  for (const [ahead, side, who] of spots) {
    for (let tries = 0; tries < 6; tries++) {
      const s = side + (tries & 1 ? 1 : -1) * Math.ceil(tries / 2)
      const x = cam.x + fx * ahead - fy * s
      const y = cam.y + fy * ahead + fx * s
      if (!walkable(x, y) || taken.has(cellKey(x, y))) continue
      taken.add(cellKey(x, y))
      const m = MONSTERS[cast[who]]
      monsters.push({ x, y, art: mons(cast[who]), glyph: m[0], colour: CRAWL[m[1]], size: 0.95, name: cast[who], alive: true })
      break
    }
  }
}
placeMonsters()
await warmGlyphs(Object.values(MONSTERS).map((m) => m[0]))
const things = () => [...fixtures, ...scenery, ...monsters]

if (snap) {
  const [outPath, c = '160', r = '48'] = snap
  // SNAP_EYE=x,y,dir: the eye on that cell facing that way (0 north, clockwise in eighths), the monsters where they were
  if (process.env.SNAP_EYE) {
    const [x, y, d] = process.env.SNAP_EYE.split(',').map(Number)
    Object.assign(cam, { x, y, eyeX: x, eyeY: y, yaw: (d * Math.PI) / 4, facing: d })
  }
  // SNAP_BACK=<n>: the eye that many cells back, the monsters where they were, to see them farther off
  for (let n = Number(process.env.SNAP_BACK) || 0; n > 0; n--) {
    const dx = -Math.round(Math.sin(cam.yaw)), dy = Math.round(Math.cos(cam.yaw))
    if (!walkable(cam.x + dx, cam.y + dy)) break
    cam.x = cam.eyeX = cam.x + dx
    cam.y = cam.eyeY = cam.y + dy
  }
  view.things = things()
  const cols = Number(c), rows = Number(r)
  const cells = view.render(cam, cols, rows)
  await writePng(cells, cols, rows, outPath)
  process.exit(0)
}

/** A terminal's screen, as far as the view's output moves on it: the cursor, truecolour, and glyphs. */
class Screen {
  cells = new Map<string, string>()
  check(ansi: Uint8Array, cells: Int32Array, cols: number, rows: number, top: number): boolean {
    const s = Buffer.from(ansi).toString('utf8')
    let r = 0, c = 0, fg = '', bg = ''
    for (let i = 0; i < s.length; ) {
      if (s[i] === '\x1b') {
        const m = /^\x1b\[([0-9;]*)([A-Za-z])/.exec(s.slice(i, i + 64))!
        const ps = m[1].split(';').map(Number)
        if (m[2] === 'H') (r = ps[0] - top), (c = ps[1] - 1)
        else if (m[2] === 'm')
          for (let k = 0; k < ps.length; k++)
            if (ps[k] === 0) fg = bg = ''
            else if (ps[k] === 48) (bg = ps.slice(k + 2, k + 5).join(';')), (k += 4)
            else if (ps[k] === 38) (fg = ps.slice(k + 2, k + 5).join(';')), (k += 4)
        i += m[0].length
        continue
      }
      const cp = s.codePointAt(i)!
      this.cells.set(`${r},${c}`, Screen.looks(cp, fg, bg))
      c++
      i += cp > 0xffff ? 2 : 1
    }
    const rgb = (v: number) => `${v >> 16};${(v >> 8) & 255};${v & 255}`
    for (let k = 0; k < cols * rows; k++) {
      const want = Screen.looks(cells[k * 3], rgb(cells[k * 3 + 1]), rgb(cells[k * 3 + 2]))
      if (this.cells.get(`${Math.floor(k / cols)},${k % cols}`) !== want) return false
    }
    return true
  }
  /** how a cell looks: a space and a full block as their one colour, a glyph and its inverse alike */
  static looks(cp: number, fg: string, bg: string) {
    if (cp === 32) return `solid ${bg}`
    if (cp === 0x2588) return `solid ${fg}`
    const inv = INVERSE.get(cp)
    return inv !== undefined && inv < cp ? `${inv}|${fg}|${bg}` : `${cp}|${bg}|${fg}`
  }
}

if (bench) {
  // a full turn, then back and forth a cell along the way the eye faces, the monsters where they were set down
  const [c = '200', r = '55', n = '120'] = bench
  const cols = Number(c), rows = Number(r), FRAMES = Number(n)
  const home = { x: cam.eyeX, y: cam.eyeY, yaw: cam.yaw }
  view.things = things()
  const pose = (i: number) => {
    cam.yaw = home.yaw + (i / FRAMES) * 2 * Math.PI
    const s = Math.sin((i / FRAMES) * 4 * Math.PI) * 1.5
    cam.eyeX = home.x + Math.sin(home.yaw) * s
    cam.eyeY = home.y - Math.cos(home.yaw) * s
  }
  // GLYPH_BANDS=<n>: in that many bands on this thread, to tell bands draw the same; GLYPH_LOCAL=1: whole on this thread, as before threads
  const B = Number(process.env.GLYPH_BANDS) || 0
  const local = B > 0 || !!process.env.GLYPH_LOCAL
  threads.things = view.things
  for (let i = 0; i < 10; i++) pose(i), local ? view.render(cam, cols, rows) : await threads.frame(cam, cols, rows, 2)
  threads.redraw()
  let hash = 0x811c9dc5
  const mix = (v: number) => (hash = Math.imul(hash ^ v, 16777619))
  let ms = 0, ansiMs = 0, bytes = 0
  const each: number[] = []
  let shownB: Cell[] | null = null
  const screen = new Screen()
  // BENCH_GAP=<ms>: that long between frames, as a terminal's frame rate leaves the threads idle between them
  const gap = Number(process.env.BENCH_GAP) || 0
  for (let i = 0; i < FRAMES; i++) {
    pose(i)
    // BENCH_MOVE=1: the monsters a cell aside from halfway, to tell the threads see them move
    if (process.env.BENCH_MOVE && i === FRAMES >> 1) {
      monsters = monsters.map((m) => ({ ...m, x: m.x + 1 }))
      view.things = threads.things = things()
    }
    if (gap) await new Promise((r) => setTimeout(r, gap))
    const t0 = performance.now()
    if (!local) {
      const ansi = await threads.frame(cam, cols, rows, 2)
      each.push(performance.now() - t0)
      ms += performance.now() - t0
      bytes += ansi.length
      for (const v of threads.cells) mix(v)
      // GLYPH_ANSI_CHECK=1: the output played on a screen, which must then show the cells
      if (process.env.GLYPH_ANSI_CHECK && !screen.check(ansi, threads.cells, cols, rows, 2)) throw new Error(`frame ${i}: the screen is not the cells`)
      continue
    }
    const p = view.prepare(cam, cols, rows)
    const cells = B ? Array.from({ length: B }, (_, b) => view.band(p, Math.floor((rows * b) / B), Math.floor((rows * (b + 1)) / B))).flat() : view.render(cam, cols, rows)
    const t1 = performance.now()
    const ansi = toAnsi(cells, cols, rows, 2, shownB)
    const t2 = performance.now()
    shownB = cells
    ms += t1 - t0
    each.push(t2 - t0)
    ansiMs += t2 - t1
    bytes += ansi.length
    for (const o of cells) {
      mix(o.ch.codePointAt(0)!)
      mix((o.fg[0] << 16) | (o.fg[1] << 8) | o.fg[2])
      mix((o.bg[0] << 16) | (o.bg[1] << 8) | o.bg[2])
    }
  }
  each.sort((a, b) => a - b)
  const at = (q: number) => each[Math.min(FRAMES - 1, Math.floor(q * FRAMES))].toFixed(2)
  console.log(`${placeId.padEnd(12)} ${cols}x${rows}  render ${(ms / FRAMES).toFixed(2)} ms  ansi ${(ansiMs / FRAMES).toFixed(2)} ms  (a frame: median ${at(0.5)}, p90 ${at(0.9)} ms)  ${(bytes / FRAMES / 1024).toFixed(0)} KB  hash ${(hash >>> 0).toString(16)}`)
  process.exit(0)
}

const out = process.stdout
const input = process.stdin
input.setRawMode?.(true)
input.resume()
out.write('\x1b[?1049h\x1b[?25l\x1b[0m\x1b[2J')
let cols = out.columns || 80
let rows = out.rows || 24
out.on('resize', () => {
  cols = out.columns
  rows = out.rows
  threads.redraw()
  out.write('\x1b[0m\x1b[2J')
  wake()
})

function step(dir: 1 | -1) {
  const a = Math.round(goalYaw / (Math.PI / 4)) * (Math.PI / 4)
  const dx = Math.round(Math.sin(a)) * dir
  const dy = Math.round(-Math.cos(a)) * dir
  if (walkable(cam.x + dx, cam.y + dy) && !monsters.some((m) => m.x === cam.x + dx && m.y === cam.y + dy)) {
    cam.x += dx
    cam.y += dy
  }
  wake()
}

input.on('data', (d: Buffer) => {
  const s = d.toString()
  if (s === 'q' || s === '\x03' || s === '\x1c') return quit()
  if (s === '\x1b[A' || s === 'w') step(1)
  else if (s === '\x1b[B' || s === 's') step(-1)
  else if (s === '\x1b[D' || s === 'a') (goalYaw -= Math.PI / 4), wake()
  else if (s === '\x1b[C' || s === 'd') (goalYaw += Math.PI / 4), wake()
  else if (s === 'm') placeMonsters(), wake()
  else if (s === 'g') (view.opts.letters = !view.opts.letters), wake()
  else if (s === 'x') (view.opts.mosaic = view.opts.mosaic === 'octant' ? 'sextant' : 'octant'), wake()
})

function quit() {
  out.write('\x1b[0m\x1b[2J\x1b[?25h\x1b[?1049l')
  process.exit(0)
}

let running = false
let last = performance.now()
let fpsWindow: number[] = []
function wake() {
  if (!running) {
    running = true
    last = performance.now()
    setImmediate(frame)
  }
}

async function frame() {
  const now = performance.now()
  const dt = Math.min(0.1, (now - last) / 1000)
  last = now
  const move = dt / STEP_S
  const ex = cam.x - cam.eyeX, ey = cam.y - cam.eyeY
  const dist = Math.hypot(ex, ey)
  if (dist <= move) (cam.eyeX = cam.x), (cam.eyeY = cam.y)
  else (cam.eyeX += (ex / dist) * move), (cam.eyeY += (ey / dist) * move)
  const turnBy = (dt / TURN_S) * (Math.PI / 4)
  const dy = goalYaw - cam.yaw
  cam.yaw = Math.abs(dy) <= turnBy ? goalYaw : cam.yaw + Math.sign(dy) * turnBy

  const t0 = performance.now()
  threads.things = things()
  // only what changed since the frame on the screen
  const ansi = await threads.frame(cam, cols, rows - 1, 2)
  const ms = performance.now() - t0
  fpsWindow.push(now)
  fpsWindow = fpsWindow.filter((t) => now - t < 1000)
  const status = ` ${file.place}  ${cols}x${rows - 1} cells  ${fpsWindow.length} fps  ${ms.toFixed(1)} ms  ${(ansi.length / 1024).toFixed(0)} KB   arrows walk and turn · m monsters · g ${view.opts.letters ? 'sprites' : 'letters'} · x ${view.opts.mosaic === 'octant' ? 'sextants' : 'octants'} · q quits`
  out.write(Buffer.concat([SYNC_ON, ansi, Buffer.from(`\x1b[1;1H\x1b[0m\x1b[2m${status.slice(0, cols)}\x1b[K\x1b[0m${SYNC_OFF}`)]))
  const moving = cam.eyeX !== cam.x || cam.eyeY !== cam.y || cam.yaw !== goalYaw
  if (!moving) {
    running = false
    return
  }
  setTimeout(frame, Math.max(0, 1000 / 60 - (performance.now() - now)))
}
wake()

/** The cells as a PNG, 8x16 a cell, the block glyphs drawn as the terminal draws them. */
async function writePng(cells: Cell[], cols: number, rows: number, outPath: string) {
  await warmText(cells, 8, 16)
  const rgb = paint(cells, cols, rows, 8, 16)
  await sharp(Buffer.from(rgb), { raw: { width: cols * 8, height: rows * 16, channels: 3 } }).png().toFile(outPath)
}
