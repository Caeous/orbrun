/**
 * A gym for the glyph view's monsters, seen as the game sees them: the
 * game's lens (game/view.ts `gameLens`: its field of view the height's,
 * 85° as the terminal's Auto is, across as wide as the terminal makes the
 * view), its eye height and pitch, its options (`GAME_GLYPH`), at each
 * terminal size asked for, in an open room of a place's own floor and wall.
 *
 * `rest` (the default): the eye at rest, on a cell's middle facing north or
 * north-east, and a monster on each cell in view out to `--reach` cells
 * (5); each variant against the truth (the same view in true pixels, 8x16 a
 * cell, its texels averaged, every sprite at its true size and place):
 * how far apart seen from a step back, and how far its height, foot and
 * middle are from the truth's. A sheet of the poses straight ahead and on
 * the diagonal goes to <out>/<monster>.png.
 *
 * `--motion`: what the game moves, a frame at a time: a monster gliding a
 * cell across, toward, and on the diagonal, the eye stepping toward it and
 * aside, and turning a heading. Each variant is scored by how much the
 * monster changes from frame to frame besides moving (its picture against
 * the last moved to where it moved, the least it differs), and how often its
 * height changes, and changes back. A strip goes to <out>/motion-<scenario>.png.
 *
 * What it stands: `--monsters` at each of `--heights`; or `--sample N`
 * monsters evenly through the bestiary and `--items N` items, to find what
 * holds for almost everything, not one goblin: each variant's median and
 * worst tenth, the subjects it does worst on, and those it does better or
 * worse on than the first variant. `--poses N` of the poses at rest, evenly.
 * `--shard i/n` stands every n-th from the i-th, for n processes at once,
 * each writing what it found to <out>/results-*.json; `--merge` reports
 * them as one. `--hands`: the hands as the game holds them.
 *
 * `npm run term:gym -- [--monsters goblin,ogre | --sample 40 --items 8] [--heights 0.4,0.55,0.85] [--term 160x48,120x36] [--variants before,game] [--motion] [--shard 0/4] [--merge]`
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { loadGamedata } from '@orbrun/gamedata'
import { cellKey, dirToYaw, REST_PITCH, type Camera, type Dir8, type SceneCell } from '@orbrun/scene'
import { VM_SHIELD_REST, VM_SIZE, VM_WEAPON_REST, WALL_INSET } from '@orbrun/world'
import type { Pixels } from '@orbrun/render-term'
import { readScene, type PlaceFile } from '../../apps/orbrun/src/room/place-data'
import { RoomTiles } from '../../apps/orbrun/src/room/tiles'
import { CRAWL, GLYPH_DEFAULTS, GlyphView, type Art, type GlyphViewOptions, type RGB, type Thing } from './glyph/render'
import { GAME_GLYPH, gameLens, shownCamera } from './game/view'
import { warmGlyphs } from './glyph/font'
import { oklab, q } from './glyph/encode'
import { paint, warmText } from './glyph/paint'

const here = path.dirname(fileURLToPath(import.meta.url))
const placesDir = path.resolve(here, '../../apps/orbrun/public/room/places')
const engineDir = path.resolve(here, '../../engine/dist')

const argv = process.argv.slice(2)
const arg = (name: string, def: string) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : def
}
const list = (name: string, def: string) => arg(name, def).split(',').filter(Boolean)
/** a cell painted, as a terminal of a 16-pixel font draws it */
const CW = 8, CH = 16
const outDir = path.resolve(arg('out', 'gym-out'))
const placeId = arg('place', 'orc-mines')
const terms = list('term', '160x48').map((t) => t.split('x').map(Number) as [number, number])
const aspect = Number(arg('aspect', '2'))
/** the game's lens: the terminal's Auto field of view (settings-rows.ts `fovOf`), its eye height, its pitch at rest */
const fov = Number(arg('fov', '85'))
const eye = Number(arg('eye', '0.6'))
const monsterNames = list('monsters', 'goblin')
/** how tall it stands, in cells: monsters 0.4 to 0.85 by their hit points (scene-webtiles `monsterHeight`), an item 0.3 */
const heights = list('heights', '0.4,0.55,0.85').map(Number)
const zoom = Number(arg('zoom', '1'))
/** how far out the poses at rest go, in cells */
const reach = Number(arg('reach', '5'))

/** The view's variants by name, as options over its defaults (render.ts GLYPH_DEFAULTS). */
export const VARIANTS: Record<string, Partial<GlyphViewOptions>> = {
  // as the game drew it before `steady`: near, on the dots and read a dot at a time, its size and place as they fall
  before: { grid: true },
  // as the game draws it (game/view.ts GAME_GLYPH): steady on the cells, far off its texels averaged, every glyph tried
  game: GAME_GLYPH,
  // steady on the cells, its sampling and fit as the defaults' (the art's own colours, a few glyphs tried)
  steady: { grid: true, steady: 'cells' },
  // on whole cells from fewer or more dots tall than the game's (render.ts STEADY_CELLS, 32): steadier, or truer at rest
  'cells-16': { ...GAME_GLYPH, steadyCells: 16 },
  'cells-24': { ...GAME_GLYPH, steadyCells: 24 },
  'cells-48': { ...GAME_GLYPH, steadyCells: 48 },
  'cells-64': { ...GAME_GLYPH, steadyCells: 64 },
  // how near the cells can come: each cell fitted against the truth's own picture (its texels averaged), every glyph tried, its colours any (not the art's own), a step back counted: too slow for the game, the ceiling for fitting ahead
  ceiling: { grid: true, steady: 'cells', sampling: 'area', fit: { ...GLYPH_DEFAULTS.fit, medoid: false, blur: 1, tries: 0 } },
  // far off, its texels averaged, then each the art's own colour nearest that (its whole palette), every glyph tried in the colours the pixels have: the art's hues kept
  'far-palette': { grid: true, steady: 'cells', farSampling: 'palette', snap: 'palette', standsOut: 99, fit: { ...GLYPH_DEFAULTS.fit, medoid: true, tries: 0 } },
  // the game's, far off each averaged pixel drawn only halfway toward the art's own colour, or not at all
  'snap-0.5': { ...GAME_GLYPH, farSnap: 0.5 },
  'snap-0': { ...GAME_GLYPH, farSnap: 0 },
  // the game's, every glyph tried for a cell: a touch closer, twice as slow
  'tries-all': { ...GAME_GLYPH, fit: { ...GAME_GLYPH.fit, tries: 0 } },
  'far-own-1.2': { grid: true, steady: 'cells', farSampling: 'area', farChroma: 1.2, fit: { ...GLYPH_DEFAULTS.fit, medoid: true, tries: 0 } },
  // steady, far off its texels averaged, every glyph tried, but each colour the art's own (as the pixels have it)
  'far-area-own': { grid: true, steady: 'cells', farSampling: 'area', fit: { ...GLYPH_DEFAULTS.fit, medoid: true, tries: 0 } },
  // steady, far off its texels averaged, the defaults' fit: how much is the averaging
  'far-area': { grid: true, steady: 'cells', farSampling: 'area' },
  // far off, its texels averaged, made more colourful by as much, every glyph tried in any two colours: closest to the truth from a step back, but a blend of yellow and grey is brown
  'far-any-1.2': { grid: true, steady: 'cells', farSampling: 'area', farChroma: 1.2, fit: { ...GLYPH_DEFAULTS.fit, medoid: false, blur: 1, tries: 0 } },
  // steady, the defaults' sampling, every glyph tried and any colours: how much is the fit
  'fit-all': { grid: true, steady: 'cells', fit: { ...GLYPH_DEFAULTS.fit, medoid: false, blur: 1, tries: 0 } },
  // the truth's pixels near and far (texels averaged, near too, which blurs what should be crisp)
  'area-fit': { ...GAME_GLYPH, sampling: 'area' },
  // steady on the dots: its size whole dots, its foot and middle on them
  dots: { ...GAME_GLYPH, steady: true },
  // near, read on the coarsest of a cell's grids its texels fill
  'game-cells': { grid: 'cells' },
}
const variantNames = list('variants', 'before,game')

/** crawl's glyph and colour for a monster, by name */
const GLYPHS: Record<string, [string, number]> = {
  goblin: ['g', 7], hobgoblin: ['g', 6], orc: ['o', 12], 'orc warrior': ['o', 14], ogre: ['O', 6], quokka: ['r', 15], rat: ['r', 6],
  jackal: ['j', 6], kobold: ['K', 6], yak: ['Y', 6], troll: ['T', 6], 'black bear': ['U', 8], adder: ['S', 2], bat: ['b', 8],
  'fire dragon': ['D', 4], 'royal jelly': ['J', 14], hydra: ['D', 2], phantom: ['W', 1], 'orb of fire': ['*', 12], cyclops: ['C', 6],
  'wolf spider': ['s', 5], butterfly: ['y', 10], centaur: ['c', 6], 'iron golem': ['8', 11], 'eye of devastation': ['e', 14],
  'unseen horror': ['X', 13], tengu: ['q', 14], mummy: ['M', 7], wraith: ['W', 8], balrug: ['&', 4], elephant: ['Y', 8],
}

const readPixels = async (file: string): Promise<Pixels> => {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, data }
}

const file = JSON.parse(fs.readFileSync(path.join(placesDir, `${placeId}.json`), 'utf8')) as PlaceFile
const atlas = await readPixels(path.join(placesDir, `${placeId}.png`))
const tiles = RoomTiles.fromPlace(file, undefined)
const scene = readScene(file.scene)

// an open room of the place's own floor and wall, the eye at (0, 0)
const cells = [...scene.cells.values()]
const floor = cells.find((c) => c.kind === 'floor' && !c.occluder && !c.featureTile && !c.overlays?.length)!
const wall = cells.find((c) => c.occluder && c.wallTile != null && !c.faceTiles)!
scene.cells.clear()
const ROOM = 16
for (let y = -ROOM; y <= ROOM; y++)
  for (let x = -ROOM; x <= ROOM; x++) {
    const edge = Math.abs(x) === ROOM || Math.abs(y) === ROOM
    scene.cells.set(cellKey(x, y), { ...(edge ? wall : floor), x, y, visibility: 'visible' } as SceneCell)
  }
scene.billboards = []

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
await warmGlyphs(Object.values(GLYPHS).map((g) => g[0]))

const view = new GlyphView(tiles, (name) => (tiles.atlasNames().includes(name) ? atlas : undefined))
view.setScene(scene)

/** the view's options as the game sets them for a terminal `cols` x `rows`, with a variant's over them */
function lens(cols: number, rows: number, variant: Partial<GlyphViewOptions> = {}) {
  const o: GlyphViewOptions = { ...GLYPH_DEFAULTS, ...variant }
  gameLens(o, cols, rows, aspect, fov, eye, WALL_INSET)
  view.opts = o
}

const camAt = (x: number, y: number, yaw: number, facing: Dir8 = 0): Camera => ({ x: Math.round(x), y: Math.round(y), eyeX: x, eyeY: y, yaw, pitch: REST_PITCH, facing })

type Img = { w: number; h: number; data: Uint8Array }

/** the view painted as a terminal paints it, `cols` x `rows` cells */
async function cellsImg(cam: Camera, cols: number, rows: number): Promise<Img> {
  const out = view.render(cam, cols, rows)
  await warmText(out, CW, CH)
  return { w: cols * CW, h: rows * CH, data: paint(out, cols, rows, CW, CH) }
}

/** the truth: the same view in true pixels, a cell 8x16, every sprite at its true size and place, its texels averaged */
function truthImg(cam: Camera, cols: number, rows: number): Img {
  const r = view.raster(cam, cols * CW, rows * CH, CW, CH, { sampling: 'area', allSprites: true, exact: true })
  const data = new Uint8Array(r.pix.length)
  for (let i = 0; i < data.length; i++) data[i] = q(r.pix[i])
  return { w: cols * CW, h: rows * CH, data }
}

/** where an image differs from what is behind it (the same with no monster): each pixel 1 or 0, and its box */
function maskOf(img: Img, bg: Img) {
  const m = new Uint8Array(img.w * img.h)
  let x0 = img.w, y0 = img.h, x1 = -1, y1 = -1
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      const p = y * img.w + x, i = p * 3
      if (Math.abs(img.data[i] - bg.data[i]) + Math.abs(img.data[i + 1] - bg.data[i + 1]) + Math.abs(img.data[i + 2] - bg.data[i + 2]) < 40) continue
      m[p] = 1
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  return { m, box: x1 < 0 ? null : { x0, y0, x1, y1 } }
}
type Box = { x0: number; y0: number; x1: number; y1: number }

function crop(img: Img, b: Box): Img {
  const x0 = Math.max(0, b.x0), y0 = Math.max(0, b.y0), x1 = Math.min(img.w - 1, b.x1), y1 = Math.min(img.h - 1, b.y1)
  const w = x1 - x0 + 1, h = y1 - y0 + 1
  const out = new Uint8Array(w * h * 3)
  for (let y = 0; y < h; y++) out.set(img.data.subarray(((y0 + y) * img.w + x0) * 3, ((y0 + y) * img.w + x1 + 1) * 3), y * w * 3)
  return { w, h, data: out }
}

/** how far two images are apart, both blurred as seen from a step back: RMS over the channels, 0..255 */
async function apart(a: Img, b: Img) {
  const blur = async (img: Img) => await sharp(Buffer.from(img.data), { raw: { width: img.w, height: img.h, channels: 3 } }).blur(2).raw().toBuffer()
  const [x, y] = await Promise.all([blur(a), blur(b)])
  let s = 0
  for (let i = 0; i < x.length; i++) s += (x[i] - y[i]) ** 2
  return Math.sqrt(s / x.length)
}

/**
 * How far a picture is from the truth's, wherever it lies within a cell of
 * where the truth's does (up to a dot across and two down, as the cells move
 * it): both blurred as seen from a step back, the least RMS over those moves.
 */
async function looks(a: Img, b: Img, sigma = 2) {
  const blur = async (img: Img) => new Float32Array(await sharp(Buffer.from(img.data), { raw: { width: img.w, height: img.h, channels: 3 } }).blur(sigma).raw().toBuffer())
  const [x, y] = await Promise.all([blur(a), blur(b)])
  const { w, h } = a
  let best = Infinity
  for (let sy = -8; sy <= 8; sy += 2)
    for (let sx = -4; sx <= 4; sx += 2) {
      let s = 0, n = 0
      for (let j = 8; j < h - 8; j++)
        for (let i = 4; i < w - 4; i++) {
          const o = (j * w + i) * 3, p = ((j + sy) * w + i + sx) * 3
          for (let k = 0; k < 3; k++) s += (x[p + k] - y[o + k]) ** 2
          n += 3
        }
      best = Math.min(best, Math.sqrt(s / n))
    }
  return best
}

/** how colourful what an image shows of something is (`m`, where it shows it): the mean of each pixel's brightest channel less its dimmest, 0..255 */
function colourful(img: Img, m: Uint8Array) {
  let s = 0, n = 0
  for (let p = 0; p < m.length; p++) {
    if (!m[p]) continue
    const r = img.data[p * 3], g = img.data[p * 3 + 1], b = img.data[p * 3 + 2]
    s += Math.max(r, g, b) - Math.min(r, g, b)
    n++
  }
  return n ? s / n : 0
}

/** the mean colour of what an image shows of something (`m`), in OKLab, its lightness and its two hues scaled to 0..100 */
function meanLab(img: Img, m: Uint8Array): [number, number, number] {
  let r = 0, g = 0, b = 0, n = 0
  const lin = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  for (let p = 0; p < m.length; p++) {
    if (!m[p]) continue
    r += lin(img.data[p * 3])
    g += lin(img.data[p * 3 + 1])
    b += lin(img.data[p * 3 + 2])
    n++
  }
  if (!n) return [0, 0, 0]
  const o = new Float32Array(3)
  oklab(r / n, g / n, b / n, o, 0)
  return [o[0] * 100, o[1] * 100, o[2] * 100]
}

const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN)
const pad = (s: string | number, n: number) => String(s).padStart(n)

/** a sheet of panels: a column each, a row each, labelled */
async function sheet(out: string, colNames: string[], rowNames: string[], panels: { col: number; row: number; img: Img }[]) {
  const colW = colNames.map((_, c) => Math.max(1, ...panels.filter((p) => p.col === c).map((p) => p.img.w)))
  const rowH = rowNames.map((_, r) => Math.max(1, ...panels.filter((p) => p.row === r).map((p) => p.img.h)))
  const GAP = 6, LEFT = 90
  const W = LEFT + colW.reduce((a, b) => a + b + GAP, 0), H = rowH.reduce((a, b) => a + b + GAP, 0) + 20
  const colX = colW.map((_, i) => LEFT + colW.slice(0, i).reduce((a, b) => a + b + GAP, 0))
  const rowY = rowH.map((_, i) => 20 + rowH.slice(0, i).reduce((a, b) => a + b + GAP, 0))
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#202020"/>`
  rowNames.forEach((l, i) => (svg += `<text x="4" y="${rowY[i] + 14}" font-family="Menlo" font-size="12" fill="#ddd">${esc(l)}</text>`))
  colNames.forEach((d, i) => (svg += `<text x="${colX[i]}" y="14" font-family="Menlo" font-size="11" fill="#ddd">${esc(d)}</text>`))
  svg += '</svg>'
  const comp = panels.map((p) => ({ input: Buffer.from(p.img.data), raw: { width: p.img.w, height: p.img.h, channels: 3 as const }, left: colX[p.col], top: rowY[p.row] }))
  const png = await sharp(Buffer.from(svg)).composite(comp).png().toBuffer()
  await sharp(png).resize({ width: W * zoom, kernel: 'nearest' }).png().toFile(out)
  console.log(out)
}

fs.mkdirSync(outDir, { recursive: true })

/** something the gym stands in the room: its art, how tall it stands, and whether it lives */
interface Subject {
  name: string
  art: Art[]
  size: number
  alive: boolean
  glyph: string
  colour: RGB
}

const thingOf = (s: Subject, x: number, y: number): Thing => ({ x, y, art: s.art, glyph: s.glyph, colour: s.colour, size: s.size, name: s.alive ? s.name : undefined, alive: s.alive })
const monsterAt = (name: string, art: Art[], x: number, y: number, size: number): Thing => {
  const g = GLYPHS[name] ?? ['?', 7]
  return { x, y, art, glyph: g[0], colour: CRAWL[g[1]], size, name, alive: true }
}

/** a tile of an atlas's by its name, as art */
function tileArt(atlasName: 'player' | 'main', name: string): Art[] {
  const idx = atlasName === 'player' ? gd.player : gd.main
  const id = idx.id(name)
  const rect = id != null ? gd.tile(id, atlasName) : undefined
  const px = rect && (gd.atlas(rect.atlas) as unknown as Pixels | undefined)
  return rect && px ? [{ px, rect }] : []
}

/** `n` of `all`, evenly through it, the first and the last among them */
const evenly = <T,>(all: T[], n: number): T[] => (n >= all.length ? all : Array.from({ length: n }, (_, i) => all[Math.round((i * (all.length - 1)) / Math.max(1, n - 1))]))

/**
 * What the gym stands: `--sample N` monsters evenly through the bestiary
 * (every MONS_ tile, one each), each a height of `--heights` in turn kept
 * no taller than its art, as scene-webtiles `monsterHeight` keeps a tiny
 * sprite small; `--items N` items through the items' tiles, 0.3 tall
 * (scene-webtiles ITEM_HEIGHT); else `--monsters` at each height.
 */
function subjects(): Subject[] {
  const out: Subject[] = []
  const sample = Number(arg('sample', '0')), items = Number(arg('items', '0'))
  if (sample) {
    const ex = gd.modules.player.exports
    const seen = new Set<unknown>()
    const names = Object.keys(ex).filter((k) => k.startsWith('MONS_') && !/TENTACLE|SEGMENT|_GEH_|_LARGE$/.test(k) && typeof ex[k] === 'number' && !seen.has(ex[k]) && seen.add(ex[k])).sort()
    evenly(names, sample).forEach((k, i) => {
      const art = tileArt('player', k)
      if (!art.length) return
      const name = k.slice(5).toLowerCase().replace(/_/g, ' ')
      const g = GLYPHS[name] ?? ['?', 7]
      const size = Math.min(heights[i % heights.length], Math.max(0.3, (art[0].rect.h / 32) * 0.95))
      out.push({ name, art, size, alive: true, glyph: g[0], colour: CRAWL[g[1]] })
    })
  }
  if (items) {
    const ex = gd.modules.main.exports
    const names = Object.keys(ex).filter((k) => /^(WPN|ARM|POT|SCR|RING|AMU|WAND|BOOK|STAFF|ROD|MISC|FOOD|GOLD)_/.test(k) && typeof ex[k] === 'number').sort()
    for (const k of evenly(names, items)) {
      const art = tileArt('main', k)
      if (art.length) out.push({ name: k.toLowerCase(), art, size: 0.3, alive: false, glyph: ')', colour: CRAWL[7] })
    }
  }
  // `--item FOOD_CHUNK,POT_...`: those items by their tiles' names
  for (const k of list('item', '')) {
    const art = tileArt('main', k)
    if (art.length) out.push({ name: k.toLowerCase(), art, size: 0.3, alive: false, glyph: ')', colour: CRAWL[7] })
    else console.error(`no tile for ${k}`)
  }
  if (!sample && !items && !list('item', '').length)
    for (const name of monsterNames) {
      const art = mons(name)
      if (!art.length) console.error(`no tile for ${name}`)
      else for (const size of heights) out.push({ name, art, size, alive: true, glyph: (GLYPHS[name] ?? ['?'])[0], colour: CRAWL[(GLYPHS[name] ?? ['?', 7])[1]] })
    }
  // `--shard i/n`: every n-th of them from the i-th, for a gym on n processes (`--merge` joins what they found)
  const [si, sn] = arg('shard', '0/1').split('/').map(Number)
  return out.filter((_, i) => i % sn === si)
}

/** the cells something stands on in view from the eye at (0, 0) facing `facing`, out to `reach`: as offsets, nearest first; `--poses N` of them evenly */
function posesFor(facing: Dir8, cols: number, rows: number) {
  const yaw = dirToYaw(facing)
  const dx = Math.sin(yaw), dy = -Math.cos(yaw)
  lens(cols, rows)
  const half = Math.tan((view.opts.fov * Math.PI) / 360)
  const out: [number, number][] = []
  for (let y = -reach; y <= reach; y++)
    for (let x = -reach; x <= reach; x++) {
      const depth = x * dx + y * dy, across = x * -dy + y * dx
      if (depth < 0.9 || Math.hypot(x, y) > reach || Math.abs(across) / depth > half * 0.92) continue
      out.push([x, y])
    }
  out.sort((a, b) => Math.hypot(...a) - Math.hypot(...b))
  return evenly(out, Number(arg('poses', '999')))
}

/** a pose at rest, scored */
interface RestRecord { v: string; s: string; size: number; term: string; d: number; apart: number; looks: number; sharp?: number; colour?: number; tint?: number; h?: number; foot?: number; mid?: number }
/** a move, scored */
interface MotionRecord { v: string; s: string; size: number; term: string; kind: string; at: number; besides: number; resizes: number; back: number; uneven?: number; ux?: number; uy?: number; uh?: number }

const median = (v: number[]) => {
  if (!v.length) return NaN
  const a = [...v].sort((x, y) => x - y)
  return a[Math.floor(a.length / 2)]
}
const pct = (v: number[], p: number) => {
  if (!v.length) return NaN
  const a = [...v].sort((x, y) => x - y)
  return a[Math.min(a.length - 1, Math.floor(a.length * p))]
}
const groupBy = <T,>(xs: T[], key: (x: T) => string | number) => {
  const m = new Map<string | number, T[]>()
  for (const x of xs) (m.get(key(x)) ?? m.set(key(x), []).get(key(x))!).push(x)
  return m
}

/** what the poses at rest found: each variant's spread, by distance, and the subjects it does worst on and where it differs most from the first variant */
function reportRest(rs: RestRecord[]) {
  const vs = [...new Set(rs.map((r) => r.v))]
  const subjectsN = new Set(rs.map((r) => r.s)).size
  console.log(`\nat rest: ${subjectsN} subjects, ${[...new Set(rs.map((r) => r.term))].join(', ')}, fov ${fov}`)
  console.log(`${'variant'.padEnd(14)}${pad('looks', 8)}${pad('median', 8)}${pad('p90', 7)}${pad('sharp', 8)}${pad('colour', 8)}${pad('tint', 7)}${pad('apart', 8)}${pad('height', 8)}${pad('foot', 7)}${pad('middle', 8)}`)
  console.log('  (looks: like the truth within a cell, from a step back; sharp: the same close up; colour: how much more colourful than the truth, less is washed out; tint: how far its mean colour is from the truth\'s, OKLab x100; apart: at its place; height, foot, middle: dots off)')
  for (const v of vs) {
    const r = rs.filter((x) => x.v === v), l = r.map((x) => x.looks)
    const f = (k: 'h' | 'foot' | 'mid') => mean(r.map((x) => x[k]).filter((x): x is number => x !== undefined)).toFixed(2)
    const g = (k: 'sharp' | 'colour' | 'tint') => mean(r.map((x) => x[k]).filter((x): x is number => x !== undefined)).toFixed(2)
    console.log(`${v.padEnd(14)}${pad(mean(l).toFixed(2), 8)}${pad(median(l).toFixed(2), 8)}${pad(pct(l, 0.9).toFixed(1), 7)}${pad(g('sharp'), 8)}${pad(g('colour'), 8)}${pad(g('tint'), 7)}${pad(mean(r.map((x) => x.apart)).toFixed(2), 8)}${pad(f('h'), 8)}${pad(f('foot'), 7)}${pad(f('mid'), 8)}`)
  }
  const ds = [...new Set(rs.map((r) => r.d))].sort((a, b) => a - b)
  for (const k of ['looks', 'sharp', 'colour', 'tint'] as const) {
    console.log(`${k} by how far\n${'variant'.padEnd(14)}${ds.map((d) => pad(d, 7)).join('')}`)
    for (const v of vs) console.log(`${v.padEnd(14)}${ds.map((d) => pad(mean(rs.filter((x) => x.v === v && x.d === d).map((x) => x[k] ?? NaN)).toFixed(1), 7)).join('')}`)
  }
  const last = vs[vs.length - 1], first = vs[0]
  const bySubject = groupBy(rs, (r) => r.s)
  const per = [...bySubject].map(([s, r]) => ({ s, last: mean(r.filter((x) => x.v === last).map((x) => x.looks)), first: mean(r.filter((x) => x.v === first).map((x) => x.looks)) }))
  const show = (title: string, xs: typeof per) => console.log(`${title}\n${xs.map((x) => `  ${String(x.s).padEnd(28)}${pad(x.first.toFixed(1), 7)}${pad(x.last.toFixed(1), 7)}`).join('\n')}`)
  show(`worst for ${last} (looks: ${first}, ${last})`, [...per].sort((a, b) => b.last - a.last).slice(0, 8))
  if (first !== last) {
    show(`${last} worse than ${first} most`, [...per].sort((a, b) => b.last - b.first - (a.last - a.first)).slice(0, 6))
    show(`${last} better than ${first} most`, [...per].sort((a, b) => a.last - a.first - (b.last - b.first)).slice(0, 6))
    const better = per.filter((x) => x.last < x.first - 0.5).length, worse = per.filter((x) => x.last > x.first + 0.5).length
    console.log(`${last} against ${first}, by subject: better ${better}, worse ${worse}, the same ${per.length - better - worse}`)
  }
}

/** what the moves found: each variant's mean by kind of move, and the subjects it changes most on besides moving */
function reportMotion(ms: MotionRecord[]) {
  const vs = [...new Set(ms.map((r) => r.v))]
  const kinds = [...new Set(ms.map((r) => r.kind))]
  console.log(`\nmoving: ${new Set(ms.map((r) => r.s)).size} subjects, ${[...new Set(ms.map((r) => r.term))].join(', ')}: besides moving (0..255, the mean a frame), how unevenly it moves (dots off the truth's step, a frame), resizes and changes of mind (a move)`)
  console.log(`${'variant'.padEnd(14)}${kinds.map((k) => pad(k, 22)).join('')}${pad('all', 8)}${pad('p90', 7)}`)
  for (const v of vs) {
    const r = ms.filter((x) => x.v === v)
    const row = kinds.map((k) => {
      const m = r.filter((x) => x.kind === k)
      return pad(`${mean(m.map((x) => x.besides)).toFixed(1)} ${mean(m.map((x) => x.uneven ?? NaN)).toFixed(2)} ${mean(m.map((x) => x.resizes)).toFixed(1)} ${mean(m.map((x) => x.back)).toFixed(1)}`, 22)
    })
    console.log(`${v.padEnd(14)}${row.join('')}${pad(mean(r.map((x) => x.besides)).toFixed(2), 8)}${pad(pct(r.map((x) => x.besides), 0.9).toFixed(1), 7)}`)
  }
  console.log(`how unevenly, by what: across, the foot, the height (dots a frame)\n${'variant'.padEnd(14)}${kinds.map((k) => pad(k, 22)).join('')}`)
  for (const v of vs) console.log(`${v.padEnd(14)}${kinds.map((k) => { const m = ms.filter((x) => x.v === v && x.kind === k); return pad(`${mean(m.map((x) => x.ux ?? NaN)).toFixed(2)} ${mean(m.map((x) => x.uy ?? NaN)).toFixed(2)} ${mean(m.map((x) => x.uh ?? NaN)).toFixed(2)}`, 22) }).join('')}`)
  const last = vs[vs.length - 1]
  const per = [...groupBy(ms.filter((x) => x.v === last), (r) => r.s)].map(([s, r]) => ({ s, b: mean(r.map((x) => x.besides)) })).sort((a, b) => b.b - a.b)
  console.log(`changes most besides moving, ${last}\n${per.slice(0, 8).map((x) => `  ${String(x.s).padEnd(28)}${pad(x.b.toFixed(2), 7)}`).join('\n')}`)
}

const shardName = arg('shard', '0/1').replace('/', 'of')

/** `--merge`: what every shard's gym found (results-*.json in --out), reported as one */
if (argv.includes('--merge')) {
  const files = fs.readdirSync(outDir).filter((f) => /^results-(rest|motion)-.*\.json$/.test(f))
  const rest = files.filter((f) => f.includes('-rest-')).flatMap((f) => JSON.parse(fs.readFileSync(path.join(outDir, f), 'utf8')) as RestRecord[])
  const mot = files.filter((f) => f.includes('-motion-')).flatMap((f) => JSON.parse(fs.readFileSync(path.join(outDir, f), 'utf8')) as MotionRecord[])
  if (rest.length) reportRest(rest)
  if (mot.length) reportMotion(mot)
  process.exit(0)
}

/**
 * `--hands [--wield HAND1_AXE_DOUBLE --shield HAND2_BUCKLER]`: the hands as
 * the game holds them (game/view.ts `hands`), the weapon turned about and the
 * shield as drawn, at each terminal size, a monster two cells off: the truth,
 * then each variant, the view whole.
 */
if (argv.includes('--hands')) {
  const tile = (name: string, mirror = false): Art[] => {
    const id = gd.player.id(name)
    const rect = id != null ? gd.tile(id, 'player') : undefined
    const px = rect && (gd.atlas(rect.atlas) as unknown as Pixels | undefined)
    return rect && px ? [{ px, rect, mirror }] : []
  }
  const hand = (art: Art[], x: number, y: number): Thing => ({ x: 0, y: 0, art, glyph: '', colour: CRAWL[7], size: 1, hand: { x, y, size: VM_SIZE, fit: true } })
  const wield = tile(arg('wield', 'HAND1_AXE_DOUBLE'), true), shield = tile(arg('shield', 'HAND2_BUCKLER'))
  for (const [cols, rows] of terms) {
    // `--stand x,y`: where the monster stands, to stand it behind a hand
    const [mx, my] = arg('stand', '0,-2').split(',').map(Number)
    const things = [monsterAt(monsterNames[0], mons(monsterNames[0]), mx, my, heights[0]), hand(wield, VM_WEAPON_REST.x, VM_WEAPON_REST.y), hand(shield, VM_SHIELD_REST.x, VM_SHIELD_REST.y)]
    const cam = camAt(0, 0, 0)
    view.things = things
    lens(cols, rows)
    const panels = [{ col: 0, row: 0, img: truthImg(cam, cols, rows) }]
    for (const [vi, vn] of variantNames.entries()) {
      lens(cols, rows, VARIANTS[vn])
      view.things = things
      panels.push({ col: 0, row: vi + 1, img: await cellsImg(cam, cols, rows) })
    }
    await sheet(path.join(outDir, `hands-${cols}x${rows}.png`), [`${cols}x${rows}`], ['truth', ...variantNames], panels)
    // `--hands-move`: the hands as the eye turns and steps, a frame at a time, the game's options: each frame's hand cells beside the first's, and how many of the cells under the hands' boxes change
    if (argv.includes('--hands-move')) {
      const n = 8
      const poses = Array.from({ length: n + 1 }, (_, k) => camAt(0, -k / n, (k / n) * 0.6))
      lens(cols, rows, GAME_GLYPH)
      view.things = things
      const shots: Img[] = []
      const raw: string[][] = []
      const covered: Uint8Array[] = []
      const handPx: Uint8Array[] = []
      const front: string[][] = []
      const anyHand: Uint8Array[] = []
      for (const c of poses) {
        // which cells the hands cover whole, from the pixels they are drawn from
        const r = view.raster(c, cols * 4, rows * 8, 4, 8)
        const cov = new Uint8Array(cols * rows), some = new Uint8Array(cols * rows)
        for (let cy = 0; cy < rows; cy++)
          for (let cx = 0; cx < cols; cx++) {
            if (cy >= rows / 2) for (let j = 0; j < 8; j++) for (let i = 0; i < 4; i++) if (r.thing[(cy * 8 + j) * cols * 4 + cx * 4 + i] >= 0.5) some[cy * cols + cx] = 1
            let all = 1
            for (let j = 0; j < 8 && all; j++) for (let i = 0; i < 4; i++) if (r.thing[(cy * 8 + j) * cols * 4 + cx * 4 + i] < 0.999) (all = 0)
            cov[cy * cols + cx] = all && cy >= rows / 2 ? 1 : 0
          }
        covered.push(cov)
        anyHand.push(some)
        const out = view.render(c, cols, rows)
        await warmText(out, CW, CH)
        raw.push(out.map((o) => `${o.ch}|${o.fg}|${o.bg}`))
        front.push(out.map((o) => (o.ch === ' ' ? ' ' : `${o.ch}|${o.fg}`)))
        // the painted pixels the hands cover, as finely as they are painted
        const fine = view.raster(c, cols * CW, rows * CH, CW, CH)
        handPx.push(Uint8Array.from(fine.thing, (v, i) => (v >= 0.999 && i >= (fine.W * fine.H) / 2 ? 1 : 0)))
        shots.push({ w: cols * CW, h: rows * CH, data: paint(out, cols, rows, CW, CH) })
      }
      // the cells of each hand's art's box (render.ts `handCells`), and those of them inside it by a cell, which only the hand covers
      const hc = (view as unknown as { handCells: [number, number, number, number][] }).handCells
      const box = { x0: Math.min(...hc.map((h) => h[0])) * CW, y0: Math.min(...hc.map((h) => h[2])) * CH, x1: Math.min(cols, Math.max(...hc.map((h) => h[1])) + 1) * CW - 1, y1: Math.min(rows, Math.max(...hc.map((h) => h[3])) + 1) * CH - 1 }
      for (let k = 1; k <= n; k++) {
        let edge = 0, inner = 0, all = 0, allIn = 0
        for (const [c0, c1, q0, q1] of hc)
          for (let r = q0; r <= Math.min(rows - 1, q1); r++)
            for (let c = c0; c <= Math.min(cols - 1, c1); c++) {
              const i = r * cols + c, inside = r > q0 && r < q1 && c > c0 && c < c1
              const ch = raw[k][i] !== raw[0][i]
              if (inside) (allIn++, ch && inner++)
              else (all++, ch && edge++)
            }
        // the hands' own: a cell's glyph and foreground, what the hands are drawn in there (its background what is behind them)
        let fronts = 0, withHand = 0
        for (const [c0, c1, q0, q1] of hc)
          for (let r = q0; r <= Math.min(rows - 1, q1); r++)
            for (let c = c0; c <= Math.min(cols - 1, c1); c++) {
              const i = r * cols + c
              if (anyHand[0][i] && anyHand[k][i]) (withHand++, front[k][i] !== front[0][i] && fronts++)
            }
        console.log(`  frame ${k}: ${fronts} of the ${withHand} cells with something of the hands in them changed glyph or foreground`)
        let whole = 0, wholeCh = 0
        const ex: string[] = []
        for (let i = 0; i < cols * rows; i++)
          if (covered[0][i] && covered[k][i]) {
            whole++
            if (raw[k][i] !== raw[0][i]) (wholeCh++, ex.length < 3 && ex.push(`${raw[0][i]} -> ${raw[k][i]}`))
          }
        let px = 0, pxCh = 0
        for (let p = 0; p < handPx[0].length; p++)
          if (handPx[0][p] && handPx[k][p]) {
            px++
            const a0 = shots[0].data, ak = shots[k].data
            if (Math.abs(a0[p * 3] - ak[p * 3]) + Math.abs(a0[p * 3 + 1] - ak[p * 3 + 1]) + Math.abs(a0[p * 3 + 2] - ak[p * 3 + 2]) > 6) pxCh++
          }
        console.log(`  frame ${k}: ${pxCh} of ${px} painted pixels of the hands changed colour (${((100 * pxCh) / px).toFixed(1)}%)`)
        console.log(`  frame ${k}: of the hands' cells, ${inner} of ${allIn} inside and ${edge} of ${all} on their edges differ from the first frame's; of those the hands cover whole, ${wholeCh} of ${whole}${ex.length ? ': ' + ex.join('; ') : ''}`)
      }
      // each frame's cells round the hands, painted, a row each
      const around = { x0: box.x0 - CW * 2, y0: box.y0 - CH, x1: box.x1 + CW * 2, y1: box.y1 }
      await sheet(path.join(outDir, `hands-move-${cols}x${rows}.png`), ['the hands'], shots.map((_, k) => String(k)), shots.map((img, k) => ({ col: 0, row: k, img: crop(img, around) })))
    }
  }
  process.exit(0)
}

/**
 * `--view-turn [--with goblin]`: the whole view as the eye turns a heading,
 * a frame at a time: how much each variant's view changes from frame to
 * frame by more or less than the truth's does (both seen from a step back),
 * the walls and floor and what stands in it all; and the same where nothing
 * stands but the walls and floor.
 */
if (argv.includes('--view-turn')) {
  const steps = Number(arg('steps', '12'))
  const subject = arg('with', '')
  for (const [cols, rows] of terms) {
    const blurred = async (img: Img) => new Float32Array(await sharp(Buffer.from(img.data), { raw: { width: img.w, height: img.h, channels: 3 } }).blur(1.5).raw().toBuffer())
    const frames: Record<string, Float32Array[]> = {}
    for (let k = 0; k <= steps; k++) {
      const cam = camAt(0, 0, ((k / steps) * Math.PI) / 4)
      view.things = subject ? [monsterAt(subject, mons(subject), 1, -2, 0.55), monsterAt(subject, mons(subject), -1, -4, 0.55)] : []
      lens(cols, rows)
      ;(frames.truth ??= []).push(await blurred(truthImg(cam, cols, rows)))
      for (const vn of variantNames) {
        lens(cols, rows, VARIANTS[vn])
        ;(frames[vn] ??= []).push(await blurred(await cellsImg(cam, cols, rows)))
      }
    }
    // `--turn-steps 12,6,3,1`: the turn shown at only so many headings, each held until the next: how much the view flickers beyond the truth over the whole turn, each heading it is drawn at against the last
    for (const n of list('turn-steps', '').map(Number)) {
      const at = [...new Set(Array.from({ length: steps + 1 }, (_, k) => Math.round((k / steps) * n) * Math.round(steps / n)))].map((k) => Math.min(steps, k))
      const at2 = [...new Set(Array.from({ length: n + 1 }, (_, i) => Math.round((i * steps) / n)))]
      void at
      for (const vn of variantNames) {
        const f = frames[vn], t = frames.truth
        let total = 0
        for (let i = 1; i < at2.length; i++) {
          const a = at2[i - 1], b = at2[i]
          let e = 0
          for (let p = 0; p < f[b].length; p++) e += Math.abs(f[b][p] - f[a][p] - (t[b][p] - t[a][p]))
          total += e / f[b].length
        }
        console.log(`  ${n} headings, ${vn.padEnd(10)} flicker over the turn ${total.toFixed(1)}, ${at2.length - 1} frames drawn`)
      }
    }
    const t = frames.truth
    console.log(`${cols}x${rows}, turning a heading in ${steps} frames${subject ? `, two ${subject}s in view` : ', nothing standing'}: the view's change a frame beyond the truth's (0..255)`)
    for (const vn of variantNames) {
      const f = frames[vn]
      let e = 0, n = 0
      for (let k = 1; k <= steps; k++) for (let i = 0; i < f[k].length; i++) (e += Math.abs(f[k][i] - f[k - 1][i] - (t[k][i] - t[k - 1][i]))), n++
      console.log(`  ${vn.padEnd(14)}${(e / n).toFixed(2)}`)
    }
  }
  process.exit(0)
}

/**
 * `--turn-ease`: a heading's turn as the game eases it (app camera.ts: at
 * TURN_RATE a second, at 60 frames a second, done within 0.002 of the
 * heading), drawn each frame as the camera has it, or as the terminal shows
 * it (game/view.ts `shownCamera`): how many frames are drawn, how many of
 * them in the last two degrees, and how much the view flickers beyond the
 * truth over the whole turn, frame drawn against frame drawn.
 */
if (argv.includes('--turn-ease')) {
  const RATE = 16, FPS = 60, goal = Math.PI / 4
  const yaws: number[] = [0]
  for (let y = 0; Math.abs(goal - y) > 0.002; ) yaws.push((y += (goal - y) * -Math.expm1(-RATE / FPS)))
  yaws.push(goal)
  const subject = arg('with', 'goblin')
  for (const [cols, rows] of terms) {
    lens(cols, rows)
    const things = [monsterAt(subject, mons(subject), 1, -2, 0.55), monsterAt(subject, mons(subject), -1, -4, 0.55)]
    const blurred = async (img: Img) => new Float32Array(await sharp(Buffer.from(img.data), { raw: { width: img.w, height: img.h, channels: 3 } }).blur(1.5).raw().toBuffer())
    for (const how of ['every frame', 'shown']) {
      const cams = yaws.map((yaw) => {
        const c: Camera = { x: 0, y: 0, eyeX: 0, eyeY: 0, yaw, pitch: REST_PITCH, facing: 1 }
        return how === 'shown' ? shownCamera(c, cols, rows, aspect, fov) : c
      })
      // the frames drawn: each a yaw unlike the last's
      const drawn = cams.filter((c, i) => i === 0 || c.yaw !== cams[i - 1].yaw)
      if (argv.includes('--time')) {
        // how long each frame drawn takes, the first of the turn first: the old view's options, then the game's, each from cold
        for (const [name, o] of [['before', VARIANTS.before], ['game', GAME_GLYPH]] as const) {
          const v2 = new GlyphView(tiles, (n) => (tiles.atlasNames().includes(n) ? atlas : undefined))
          v2.setScene(scene)
          const oo: GlyphViewOptions = { ...GLYPH_DEFAULTS, ...o }
          gameLens(oo, cols, rows, aspect, fov, eye, WALL_INSET)
          v2.opts = oo
          v2.things = things
          v2.render(cams[0], cols, rows)
          const ms = drawn.slice(1).map((c) => {
            const t0 = performance.now()
            v2.render(c, cols, rows)
            return performance.now() - t0
          })
          console.log(`  ${how} ${name.padEnd(7)} ms a frame: ${ms.map((m) => m.toFixed(0)).join(' ')}`)
        }
        continue
      }
      const tail = drawn.filter((c) => goal - c.yaw < (2 * Math.PI) / 180 && c.yaw !== goal).length
      let total = 0, prev: Float32Array | null = null, prevT: Float32Array | null = null
      for (const c of drawn) {
        view.things = things
        lens(cols, rows)
        const t = await blurred(truthImg(c, cols, rows))
        lens(cols, rows, GAME_GLYPH)
        view.things = things
        const f = await blurred(await cellsImg(c, cols, rows))
        if (prev && prevT) {
          let e = 0
          for (let p = 0; p < f.length; p++) e += Math.abs(f[p] - prev[p] - (t[p] - prevT[p]))
          total += e / f.length
        }
        prev = f
        prevT = t
      }
      console.log(`${cols}x${rows} ${how.padEnd(12)} ${yaws.length} frames of easing, ${drawn.length} drawn, ${tail} of them in the last 2°; flicker over the turn ${total.toFixed(1)}`)
    }
  }
  process.exit(0)
}

const subs = subjects()
/** the sheets of poses and moves: for a few subjects, or with --sheets */
const sheets = argv.includes('--sheets') || subs.length <= 6

if (!argv.includes('--motion')) {
  // the eye at rest: how far each variant is from the truth, its height, its foot and its middle
  const records: RestRecord[] = []
  for (const [cols, rows] of terms)
    for (const sub of subs) {
      const panels: { col: number; row: number; img: Img }[] = []
      const sheetPoses: string[] = []
      for (const facing of [0, 1] as Dir8[]) {
        const poses = posesFor(facing, cols, rows)
        const cam = camAt(0, 0, dirToYaw(facing), facing)
        lens(cols, rows)
        view.things = []
        const truthBg = truthImg(cam, cols, rows)
        const cellBg: Record<string, Img> = {}
        for (const vn of variantNames) {
          lens(cols, rows, VARIANTS[vn])
          cellBg[vn] = await cellsImg(cam, cols, rows)
        }
        for (const [x, y] of poses) {
          const thing = thingOf(sub, x, y)
          lens(cols, rows)
          view.things = [thing]
          const truth = truthImg(cam, cols, rows)
          const tm = maskOf(truth, truthBg)
          if (!tm.box) continue
          const b = tm.box
          const around = { x0: b.x0 - CW, y0: b.y0 - CH, x1: b.x1 + CW, y1: b.y1 + CH }
          // the poses for the sheet: straight ahead, and those on the diagonal ahead
          const ahead = sheets && (facing === 0 ? x === 0 : x === -y)
          if (ahead) {
            sheetPoses.push(`${facing ? 'NE' : 'N'} ${Math.hypot(x, y).toFixed(1)}`)
            panels.push({ col: sheetPoses.length - 1, row: 0, img: crop(truth, around) })
          }
          for (const [vi, vn] of variantNames.entries()) {
            lens(cols, rows, VARIANTS[vn])
            view.things = [thing]
            const img = await cellsImg(cam, cols, rows)
            const vm = maskOf(img, cellBg[vn])
            const r: RestRecord = { v: vn, s: sub.name, size: sub.size, term: `${cols}x${rows}`, d: Math.round(Math.hypot(x, y)), apart: await apart(crop(img, around), crop(truth, around)), looks: await looks(crop(img, around), crop(truth, around)), sharp: await looks(crop(img, around), crop(truth, around), 0.7), colour: colourful(img, vm.m) - colourful(truth, tm.m), tint: Math.hypot(...meanLab(img, vm.m).map((v, i) => v - meanLab(truth, tm.m)[i])) }
            if (vm.box) {
              const v = vm.box
              // in a cell's dots: a dot 4 x 4 of the painted pixels
              r.h = Math.abs(v.y1 - v.y0 - (b.y1 - b.y0)) / 4
              r.foot = Math.abs(v.y1 - b.y1) / 4
              r.mid = Math.abs((v.x0 + v.x1) / 2 - (b.x0 + b.x1) / 2) / 4
            }
            records.push(r)
            if (ahead) panels.push({ col: sheetPoses.length - 1, row: vi + 1, img: crop(img, around) })
          }
        }
      }
      if (sheets) await sheet(path.join(outDir, `${sub.name.replace(/ /g, '-')}-${sub.size}-${cols}x${rows}.png`), sheetPoses, ['truth', ...variantNames], panels)
    }
  fs.writeFileSync(path.join(outDir, `results-rest-${shardName}.json`), JSON.stringify(records))
  reportRest(records)
  process.exit(0)
}

/**
 * What the game moves, a frame at a time: the monster's place and the eye's
 * at f, 0..1 along the move, the eye facing `facing` and turned `yaw`.
 */
interface Scenario {
  name: string
  frames: (f: number) => { mx: number; my: number; ex: number; ey: number; yaw: number }
}
const steps = Number(arg('steps', '32'))
const at = list('at', '1,2,3').map(Number)
const kindsAsked = list('kinds', '')
const scenarios: Scenario[] = at.flatMap((d): Scenario[] => [
  { name: `glide-across-${d}`, frames: (f: number) => ({ mx: -1 + f, my: -d, ex: 0, ey: 0, yaw: 0 }) },
  { name: `glide-toward-${d}`, frames: (f: number) => ({ mx: 0, my: -d - 1 + f, ex: 0, ey: 0, yaw: 0 }) },
  { name: `glide-diagonal-${d}`, frames: (f: number) => ({ mx: -1 + f, my: -d - 1 + f, ex: 0, ey: 0, yaw: 0 }) },
  { name: `step-toward-${d}`, frames: (f: number) => ({ mx: 0, my: -d - 1, ex: 0, ey: -f, yaw: 0 }) },
  { name: `step-aside-${d}`, frames: (f: number) => ({ mx: 0, my: -d, ex: f, ey: 0, yaw: 0 }) },
  { name: `turn-${d}`, frames: (f: number) => ({ mx: 1, my: -d, ex: 0, ey: 0, yaw: (f * Math.PI) / 4 }) },
]).filter((sc) => !kindsAsked.length || kindsAsked.includes(sc.name.replace(/-[\d.]+$/, '')))

/**
 * How much `b` differs from `a` besides having moved: the least, over the
 * moves of a few pixels round `shift` (where the truth moved), of the mean
 * difference over where either shows the monster, 0..255.
 */
function besidesMoving(a: Img, am: Uint8Array, b: Img, bm: Uint8Array, box: Box, shift: [number, number]) {
  let best = Infinity
  const R = 10
  for (let sy = shift[1] - R; sy <= shift[1] + R; sy++)
    for (let sx = shift[0] - R; sx <= shift[0] + R; sx++) {
      let e = 0, n = 0
      for (let y = box.y0; y <= box.y1; y += 2) {
        const ay = y - sy
        if (ay < 0 || ay >= a.h) continue
        for (let x = box.x0; x <= box.x1; x += 2) {
          const ax = x - sx
          if (ax < 0 || ax >= a.w) continue
          const p = y * b.w + x, o = ay * a.w + ax
          if (!bm[p] && !am[o]) continue
          e += Math.abs(b.data[p * 3] - a.data[o * 3]) + Math.abs(b.data[p * 3 + 1] - a.data[o * 3 + 1]) + Math.abs(b.data[p * 3 + 2] - a.data[o * 3 + 2])
          n++
        }
      }
      if (n && e / n / 3 < best) best = e / n / 3
    }
  return Number.isFinite(best) ? best : 0
}

const records: MotionRecord[] = []
const rowsOf = ['truth', ...variantNames]
for (const [cols, rows] of terms)
  for (const sub of subs)
    for (const sc of scenarios) {
      const frames: Record<string, { img: Img; mask: Uint8Array; box: Box | null }[]> = {}
      for (let k = 0; k <= steps; k++) {
        const p = sc.frames(k / steps)
        const cam = camAt(p.ex, p.ey, p.yaw)
        const thing = thingOf(sub, p.mx, p.my)
        for (const vn of rowsOf) {
          lens(cols, rows, vn === 'truth' ? {} : VARIANTS[vn])
          const draw = vn === 'truth' ? async () => truthImg(cam, cols, rows) : () => cellsImg(cam, cols, rows)
          view.things = []
          const bg = await draw()
          view.things = [thing]
          const img = await draw()
          const { m, box } = maskOf(img, bg)
          ;(frames[vn] ??= []).push({ img, mask: m, box })
        }
      }
      // where the truth's monster moved, frame to frame: its middle and its foot
      const tb = frames.truth.map((f) => f.box)
      const all = rowsOf.flatMap((vn) => frames[vn].map((f) => f.box)).filter((b): b is Box => !!b)
      if (!all.length) continue
      const union = { x0: Math.min(...all.map((b) => b.x0)) - 8, y0: Math.min(...all.map((b) => b.y0)) - 8, x1: Math.max(...all.map((b) => b.x1)) + 8, y1: Math.max(...all.map((b) => b.y1)) + 8 }
      for (const vn of rowsOf) {
        const fs_ = frames[vn]
        let resizes = 0, back = 0, lastDir = 0
        const besides: number[] = []
        // how unevenly it moves: frame to frame, how much its middle, foot and height change by more or less than the truth's, in dots
        let uneven = 0, unevenN = 0, ux = 0, uy = 0, uh = 0
        for (let k = 1; k <= steps; k++) {
          const a = fs_[k - 1], b = fs_[k], ta = tb[k - 1], tbk = tb[k]
          const shift: [number, number] = ta && tbk ? [Math.round((tbk.x0 + tbk.x1 - ta.x0 - ta.x1) / 2), tbk.y1 - ta.y1] : [0, 0]
          besides.push(besidesMoving(a.img, a.mask, b.img, b.mask, union, shift))
          if (a.box && b.box && ta && tbk) {
            const mid = (x: Box) => (x.x0 + x.x1) / 2, tall = (x: Box) => x.y1 - x.y0
            const dx = Math.abs(mid(b.box) - mid(a.box) - (mid(tbk) - mid(ta))) / 4, dy = Math.abs(b.box.y1 - a.box.y1 - (tbk.y1 - ta.y1)) / 4, dh = Math.abs(tall(b.box) - tall(a.box) - (tall(tbk) - tall(ta))) / 4
            uneven += dx + dy + dh
            ux += dx
            uy += dy
            uh += dh
            unevenN++
          }
          if (a.box && b.box) {
            const dh = b.box.y1 - b.box.y0 - (a.box.y1 - a.box.y0)
            if (dh) {
              resizes++
              const dir = Math.sign(dh)
              if (lastDir && dir !== lastDir) back++
              lastDir = dir
            }
          }
        }
        records.push({ v: vn, s: sub.name, size: sub.size, term: `${cols}x${rows}`, kind: sc.name.replace(/-[\d.]+$/, ''), at: Number(sc.name.match(/-([\d.]+)$/)![1]), besides: mean(besides), resizes, back, uneven: unevenN ? uneven / unevenN : 0, ux: ux / (unevenN || 1), uy: uy / (unevenN || 1), uh: uh / (unevenN || 1) })
      }
      if (sheets && subs.length === 1 && terms.length === 1) {
        const panels = rowsOf.flatMap((vn, r) => frames[vn].map((f, k) => ({ col: k, row: r, img: crop(f.img, union) })))
        await sheet(path.join(outDir, `motion-${sc.name}.png`), frames.truth.map((_, k) => String(k)), rowsOf, panels)
      }
    }
fs.writeFileSync(path.join(outDir, `results-motion-${shardName}.json`), JSON.stringify(records))
reportMotion(records)
