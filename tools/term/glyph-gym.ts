/**
 * A gym for the glyph view's monsters: each monster stood in an open room
 * at a ladder of distances, from filling the view to a speck, and drawn by
 * each variant of the renderer beside what the same view shows in true
 * pixels (8x16 a cell, its texels averaged), each panel cropped to the
 * monster. Writes a sheet per monster and prints how far each variant is
 * from the truth, seen from a step back (both blurred), panel by panel.
 *
 * `npm run term:gym -- [--monsters goblin,orc] [--variants a,b] [--out dir] [--cols 160 --rows 48] [--dist 1,2,4]`
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { loadGamedata } from '@orbrun/gamedata'
import { cellKey, REST_PITCH, type Camera, type SceneCell } from '@orbrun/scene'
import type { Pixels } from '@orbrun/render-term'
import { readScene, type PlaceFile } from '../../apps/orbrun/src/room/place-data'
import { RoomTiles } from '../../apps/orbrun/src/room/tiles'
import { CRAWL, GLYPH_DEFAULTS, GlyphView, type Art, type Cell, type GlyphViewOptions, type Thing } from './glyph/render'
import { warmGlyphs } from './glyph/font'
import { q } from './glyph/encode'
import { paint, warmText } from './glyph/paint'

const here = path.dirname(fileURLToPath(import.meta.url))
const placesDir = path.resolve(here, '../../apps/orbrun/public/room/places')
const engineDir = path.resolve(here, '../../engine/dist')

const argv = process.argv.slice(2)
const arg = (name: string, def: string) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : def
}
const CW = 8, CH = 16
const cols = Number(arg('cols', '160'))
const rows = Number(arg('rows', '48'))
const outDir = path.resolve(arg('out', 'gym-out'))
const placeId = arg('place', 'orc-mines')
const dists = arg('dist', '1,1.4,2,2.8,4,5.6,8,11,16,22').split(',').map(Number)
const monsterNames = arg('monsters', 'goblin').split(',')
/** the sheet scaled up this many times, its pixels kept square, to look at small panels closely */
const zoom = Number(arg('zoom', '1'))

/**
 * The renderer's variants by name, as options over its defaults
 * (render.ts GLYPH_DEFAULTS): the view as it was before the gym, the
 * defaults in each mosaic, and each of what the gym found taken away again.
 */
export const VARIANTS: Record<string, Partial<GlyphViewOptions>> = {
  base: { mosaic: 'sextant', encoder: 'dots', sampling: 'pick', standsOut: 0.12, stand: 40, dark: 0.7, chroma: 0, farTint: false },
  'base-oct': { mosaic: 'octant', encoder: 'dots', sampling: 'pick', standsOut: 0.12, stand: 40, dark: 0.7, chroma: 0, farTint: false },
  best: { mosaic: 'octant' },
  'best-s': { mosaic: 'sextant' },
  // a pixel a dot, each cell's dots split in two means, as before, from the new sampling
  dots: { encoder: 'dots' },
  // each pixel the texels under it averaged: muddy, and an eye lost
  area: { sampling: 'area' },
  // the texel under each pixel's middle: shimmers, and loses what is thin
  nearest: { sampling: 'nearest' },
  // nothing stands out: no eyes
  'no-features': { standsOut: 99 },
  // what stands out told in sRGB, not by its colour: a golem's red eye lost among its glints
  'srgb-features': { chroma: 0, standsOut: 0.8 },
  // the ink counted as the body: swollen, darker sprites far off
  'ink-as-body': { ink: 1 },
  // every glyph the fit may use, the slanted and the slim: shards and stray lines
  'all-glyphs': { fit: { ...GLYPH_DEFAULTS.fit, wedges: 'edges', slim: true } },
  // the old pick of a texel, its many "features" each swollen to a dot: bright and blotchy
  'old-pick': { sampling: 'pick', standsOut: 0.12, stand: 40, dark: 0.7, chroma: 0 },
  // the texels under a pixel averaged in linear light, as light adds up, not as an eye orders colours
  linear: { mean: 'linear' },
  'linear-s': { mosaic: 'sextant', mean: 'linear' },
  // far off, crawl's glyph on what is behind it, not on a cell of the thing's own colour
  'plain-far': { farTint: false },
}
const variantNames = arg('variants', 'base,best-s,base-oct,best').split(',')

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

// an open room: the place's own floor and wall, the monster at 0, -2 and the eye backing away from it down x = 0
const cells = [...scene.cells.values()]
const floor = cells.find((c) => c.kind === 'floor' && !c.occluder && !c.featureTile && !c.overlays?.length)!
const wall = cells.find((c) => c.occluder && c.wallTile != null && !c.faceTiles)!
scene.cells.clear()
for (let y = -8; y <= 40; y++)
  for (let x = -9; x <= 9; x++) {
    const edge = Math.abs(x) === 9 || y === -8 || y === 40
    const c: SceneCell = { ...(edge ? wall : floor), x, y, visibility: 'visible' }
    scene.cells.set(cellKey(x, y), c)
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
const defaults = { ...view.opts, labels: false }

/** where the monster stands on the screen at distance d, in cells: its middle, its floor, how tall and wide */
function footprint(d: number, size: number, reach: number) {
  const half = Math.tan((defaults.fov * Math.PI) / 360)
  const fyCell = cols / (2 * half * defaults.aspect)
  const horizon = rows / 2 + (Math.tan(REST_PITCH) * fyCell)
  const tall = (size * fyCell) / d
  const floorRow = horizon + (defaults.eye * fyCell) / d
  const wide = tall * defaults.aspect
  const c0 = Math.max(0, Math.floor(cols / 2 - wide / 2 - 2)), c1 = Math.min(cols, Math.ceil(cols / 2 + wide / 2 + 2))
  const r0 = Math.max(0, Math.floor(floorRow - tall * reach - 1.5)), r1 = Math.min(rows, Math.ceil(floorRow + 2))
  return { c0, c1, r0, r1 }
}

/** an RGB image cropped to cells c0..c1, r0..r1 */
function crop(img: Uint8Array, c0: number, c1: number, r0: number, r1: number) {
  const W = cols * CW, w = (c1 - c0) * CW, h = (r1 - r0) * CH
  const out = new Uint8Array(w * h * 3)
  for (let y = 0; y < h; y++) out.set(img.subarray(((r0 * CH + y) * W + c0 * CW) * 3, ((r0 * CH + y) * W + c1 * CW) * 3), y * w * 3)
  return { w, h, data: out }
}

/** the box where an image differs from its background, as width x height in pixels */
function bbox(img: { w: number; h: number; data: Uint8Array }, bg: { data: Uint8Array }) {
  let x0 = img.w, y0 = img.h, x1 = -1, y1 = -1
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      const i = (y * img.w + x) * 3
      if (Math.abs(img.data[i] - bg.data[i]) + Math.abs(img.data[i + 1] - bg.data[i + 1]) + Math.abs(img.data[i + 2] - bg.data[i + 2]) < 40) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  return `${x1 - x0 + 1}x${y1 - y0 + 1} at ${x0},${y0}`
}

/** how far two images are apart, both blurred as seen from a step back: RMS over the channels, 0..255 */
async function apart(a: { w: number; h: number; data: Uint8Array }, b: { w: number; h: number; data: Uint8Array }) {
  const blur = async (img: typeof a) => (await sharp(Buffer.from(img.data), { raw: { width: img.w, height: img.h, channels: 3 } }).blur(2).raw().toBuffer())
  const [x, y] = await Promise.all([blur(a), blur(b)])
  let s = 0
  for (let i = 0; i < x.length; i++) s += (x[i] - y[i]) ** 2
  return Math.sqrt(s / x.length)
}

fs.mkdirSync(outDir, { recursive: true })

/** `--time [--at 4]`: how long each variant takes to draw a frame, the monster at 4 (or --at) */
if (argv.includes('--time')) {
  const art = mons(monsterNames[0])
  view.things = [{ x: 0, y: -2, art, glyph: 'g', colour: CRAWL[7], size: 0.95, name: 'x', alive: true }]
  const y = -2 + Number(arg('at', '4'))
  const cam: Camera = { x: 0, y, eyeX: 0, eyeY: y, yaw: 0.3, pitch: REST_PITCH, facing: 0 }
  for (const vn of variantNames) {
    view.opts = { ...defaults, ...VARIANTS[vn] }
    view.render(cam, cols, rows)
    const t0 = performance.now()
    const n = 5
    for (let i = 0; i < n; i++) view.render(cam, cols, rows)
    console.log(`${vn.padEnd(16)} ${((performance.now() - t0) / n).toFixed(1)} ms a frame, ${cols}x${rows}`)
  }
  process.exit(0)
}

/**
 * `--motion lateral|depth --at d --steps n`: the monster glides a cell
 * sideways (or toward the eye) in n steps, and each variant is scored by how
 * much more it changes from one step to the next than the truth does, seen
 * from a step back: shimmer. A strip of the frames goes to <out>/motion-<name>.png.
 */
if (argv.includes('--motion')) {
  const kind = arg('motion', 'lateral')
  const at = Number(arg('at', '8'))
  const steps = Number(arg('steps', '12'))
  const blurOf = async (img: { w: number; h: number; data: Uint8Array }) =>
    new Float32Array(await sharp(Buffer.from(img.data), { raw: { width: img.w, height: img.h, channels: 3 } }).blur(1.5).raw().toBuffer())
  console.log(`\nshimmer (${kind} at ${at}): ${'variant'.padEnd(16)} per monster, mean`)
  const shimmer: Record<string, number[]> = {}
  for (const name of monsterNames) {
    const art = mons(name)
    const g = GLYPHS[name] ?? ['?', 7]
    const reach = 1 + Math.max(0, -Math.min(0, ...art.map((a) => a.rect.oy))) / 32
    const fp0 = footprint(kind === 'depth' ? at - 1 : at, 0.95, reach)
    const fp = kind === 'turn' ? { c0: 0, c1: cols, r0: 0, r1: rows } : { ...fp0, c0: Math.max(0, fp0.c0 - 4), c1: Math.min(cols, fp0.c1 + 4) }
    const frames: Record<string, { w: number; h: number; data: Uint8Array }[]> = { truth: [] }
    for (let k = 0; k <= steps; k++) {
      const f = k / steps
      const monster: Thing = { x: kind === 'lateral' ? f - 0.5 : 0, y: -2, art, glyph: g[0], colour: CRAWL[g[1]], size: 0.95, name, alive: true }
      const d = kind === 'depth' ? at - f : at
      const cam: Camera = { x: 0, y: Math.round(-2 + d), eyeX: 0, eyeY: -2 + d, yaw: kind === 'turn' ? 0.3 + f * 0.06 : 0, pitch: REST_PITCH, facing: 0 }
      view.things = [monster]
      view.opts = { ...defaults }
      const r = view.raster(cam, cols * CW, rows * CH, CW, CH, { sampling: 'area', allSprites: true })
      const truth = new Uint8Array(r.pix.length)
      for (let i = 0; i < truth.length; i++) truth[i] = q(r.pix[i])
      frames.truth.push(crop(truth, fp.c0, fp.c1, fp.r0, fp.r1))
      for (const vn of variantNames) {
        view.opts = { ...defaults, ...VARIANTS[vn] }
        const cellsOut = view.render(cam, cols, rows)
        await warmText(cellsOut, CW, CH)
        ;(frames[vn] ??= []).push(crop(paint(cellsOut, cols, rows, CW, CH), fp.c0, fp.c1, fp.r0, fp.r1))
      }
    }
    const tb = await Promise.all(frames.truth.map(blurOf))
    for (const vn of variantNames) {
      const vb = await Promise.all(frames[vn].map(blurOf))
      let e = 0, n = 0
      for (let k = 1; k <= steps; k++)
        for (let i = 0; i < vb[k].length; i++) {
          e += Math.abs(vb[k][i] - vb[k - 1][i] - (tb[k][i] - tb[k - 1][i]))
          n++
        }
      ;(shimmer[vn] ??= []).push(e / n)
    }
    // the strip: a row a variant, a frame a column
    const rowsOf = ['truth', ...variantNames]
    const { w, h } = frames.truth[0]
    const comp = rowsOf.flatMap((vn, ri) => frames[vn].map((img, k) => ({ input: Buffer.from(img.data), raw: { width: w, height: h, channels: 3 as const }, left: k * (w + 4), top: ri * (h + 4) })))
    const W = (steps + 1) * (w + 4), H = rowsOf.length * (h + 4)
    const strip = await sharp({ create: { width: W, height: H, channels: 3, background: '#202020' } }).composite(comp).png().toBuffer()
    await sharp(strip).resize({ width: W * zoom, kernel: 'nearest' }).png().toFile(path.join(outDir, `motion-${name.replace(/ /g, '-')}.png`))
  }
  for (const vn of variantNames) {
    const v = shimmer[vn]
    console.log(`  ${vn.padEnd(18)} ${v.map((x) => x.toFixed(2).padStart(6)).join('')}  ${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2)}`)
  }
  process.exit(0)
}
const scores: Record<string, number[]> = {}
for (const name of monsterNames) {
  const art = mons(name)
  if (!art.length) {
    console.error(`no tile for ${name}`)
    continue
  }
  const g = GLYPHS[name] ?? ['?', 7]
  const monster: Thing = { x: 0, y: -2, art, glyph: g[0], colour: CRAWL[g[1]], size: 0.95, name, alive: true }
  view.things = [monster]
  const reach = 1 + Math.max(0, -Math.min(0, ...art.map((a) => a.rect.oy))) / 32
  const panels: { col: number; row: number; w: number; h: number; data: Uint8Array }[] = []
  const labels: string[] = ['truth', ...variantNames]
  for (const [di, d] of dists.entries()) {
    const cam: Camera = { x: 0, y: Math.round(-2 + d), eyeX: 0, eyeY: -2 + d, yaw: 0, pitch: REST_PITCH, facing: 0 }
    const fp = footprint(d, monster.size, reach)
    // the truth: the same view in pixels, 8x16 a cell, every sprite drawn
    view.opts = { ...defaults }
    const r = view.raster(cam, cols * CW, rows * CH, CW, CH, { sampling: 'area', allSprites: true })
    const truth = new Uint8Array(r.pix.length)
    for (let i = 0; i < truth.length; i++) truth[i] = q(r.pix[i])
    const t = crop(truth, fp.c0, fp.c1, fp.r0, fp.r1)
    panels.push({ col: di, row: 0, ...t })
    // the same views with no monster, to find how much of each it covers
    view.things = []
    const rb = view.raster(cam, cols * CW, rows * CH, CW, CH, { sampling: 'area', allSprites: true })
    const tb = new Uint8Array(rb.pix.length)
    for (let i = 0; i < tb.length; i++) tb[i] = q(rb.pix[i])
    const tBox = bbox(t, crop(tb, fp.c0, fp.c1, fp.r0, fp.r1))
    view.things = [monster]
    if (argv.includes('--sizes')) console.log(`${name} ${d} truth ${tBox}`)
    for (const [vi, vn] of variantNames.entries()) {
      view.opts = { ...defaults, ...VARIANTS[vn] }
      const cellsOut: Cell[] = view.render(cam, cols, rows)
      await warmText(cellsOut, CW, CH)
      const img = crop(paint(cellsOut, cols, rows, CW, CH), fp.c0, fp.c1, fp.r0, fp.r1)
      panels.push({ col: di, row: vi + 1, ...img })
      if (argv.includes('--sizes')) {
        view.things = []
        const bgCells = view.render(cam, cols, rows)
        view.things = [monster]
        await warmText(bgCells, CW, CH)
        console.log(`${name} ${d} ${vn} ${bbox(img, crop(paint(bgCells, cols, rows, CW, CH), fp.c0, fp.c1, fp.r0, fp.r1))}`)
      }
      const e = await apart(img, t)
      ;(scores[vn] ??= []).push(e)
    }
  }
  // the sheet: a column a distance, a row a variant, the truth on top; or, with --across, the other way round
  if (argv.includes('--across')) for (const p of panels) [p.col, p.row] = [p.row, p.col]
  const colNames = argv.includes('--across') ? labels : dists.map(String)
  const rowNames = argv.includes('--across') ? dists.map(String) : labels
  const colW = colNames.map((_, di) => Math.max(...panels.filter((p) => p.col === di).map((p) => p.w)))
  const rowH = rowNames.map((_, ri) => Math.max(...panels.filter((p) => p.row === ri).map((p) => p.h)))
  const GAP = 6, LEFT = argv.includes('--across') ? 40 : 110
  const W = LEFT + colW.reduce((a, b) => a + b + GAP, 0)
  const H = rowH.reduce((a, b) => a + b + GAP, 0) + 20
  const colX = colW.map((_, i) => LEFT + colW.slice(0, i).reduce((a, b) => a + b + GAP, 0))
  const rowY = rowH.map((_, i) => 20 + rowH.slice(0, i).reduce((a, b) => a + b + GAP, 0))
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#202020"/>`
  rowNames.forEach((l, i) => (svg += `<text x="4" y="${rowY[i] + 14}" font-family="Menlo" font-size="12" fill="#ddd">${esc(l)}</text>`))
  colNames.forEach((d, i) => (svg += `<text x="${colX[i]}" y="14" font-family="Menlo" font-size="11" fill="#ddd">${esc(d)}</text>`))
  svg += '</svg>'
  const composites = panels.map((p) => ({
    input: Buffer.from(p.data),
    raw: { width: p.w, height: p.h, channels: 3 as const },
    left: colX[p.col],
    top: rowY[p.row],
  }))
  const out = path.join(outDir, `${name.replace(/ /g, '-')}.png`)
  const sheet = await sharp(Buffer.from(svg)).composite(composites).png().toBuffer()
  await sharp(sheet).resize({ width: W * zoom, kernel: 'nearest' }).png().toFile(out)
  console.log(out)
}

// how far from the truth, by distance, each variant: the mean over the monsters
const nm = monsterNames.length
console.log(`\n${'variant'.padEnd(16)}${dists.map((d) => String(d).padStart(6)).join('')}  mean`)
for (const vn of variantNames) {
  const s = scores[vn] ?? []
  const byD = dists.map((_, di) => {
    let t = 0
    for (let m = 0; m < nm; m++) t += s[m * dists.length + di] ?? 0
    return t / nm
  })
  console.log(`${vn.padEnd(16)}${byD.map((v) => v.toFixed(1).padStart(6)).join('')}  ${(byD.reduce((a, b) => a + b, 0) / byD.length).toFixed(2)}`)
}
