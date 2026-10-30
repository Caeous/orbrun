/**
 * How fast the view is drawn and readied for the terminal, without one:
 * `npm run term:bench -- [place…]`. Each place is spun a full turn and walked
 * a few cells at BENCH_COLS x BENCH_ROWS cells (200 x 55) of 8 x 16 pixels
 * (ORBRUN_TERM_CELL_PX "w,h"), drawn on TermRaster's threads at
 * ORBRUN_TERM_SCALE, and each frame written as the file the terminal would
 * read and compressed as it would go over SSH. BENCH_HASH=1 prints a checksum
 * of what was drawn, BENCH_DUMP=<file> writes every frame to the file.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'
import sharp from 'sharp'
import type { Pixels } from '@orbrun/render-term'
import { REST_PITCH, type Camera, type Dir8 } from '@orbrun/scene'
import { readScene, type PlaceFile } from '../../apps/orbrun/src/room/place-data'
import { RoomTiles } from '../../apps/orbrun/src/room/tiles'
import { TermRaster } from './raster'

const here = path.dirname(fileURLToPath(import.meta.url))
const placesDir = path.resolve(here, '../../apps/orbrun/public/room/places')
const places = process.argv.slice(2).length ? process.argv.slice(2) : ['lair-grove', 'necropolis', 'vaults', 'zot-4']
const cols = Number(process.env.BENCH_COLS) || 200
const rows = Number(process.env.BENCH_ROWS) || 55
const [CELL_W, CELL_H] = (process.env.ORBRUN_TERM_CELL_PX || '8,16').split(',').map(Number)
const SCALE = Number(process.env.ORBRUN_TERM_SCALE) || 1
const FRAMES = Number(process.env.BENCH_FRAMES) || 120
const sx = Math.max(1, Math.round(CELL_W * SCALE)), sy = Math.max(1, Math.round(CELL_H * SCALE))
const W = cols * sx, H = rows * sy

const r = new TermRaster()
const total = { draw: 0, file: 0, zip: 0, kb: 0, n: 0 }
/** what was drawn, as a checksum (BENCH_HASH=1), to tell a faster renderer draws the same */
let hash = 0x811c9dc5
for (const placeId of places) {
  const file = JSON.parse(fs.readFileSync(path.join(placesDir, `${placeId}.json`), 'utf8')) as PlaceFile
  const { data, info } = await sharp(path.join(placesDir, `${placeId}.png`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const atlas: Pixels = { width: info.width, height: info.height, data }
  const tiles = RoomTiles.fromPlace(file, undefined)
  r.setTiles(tiles, (name) => (tiles.atlasNames().includes(name) ? atlas : undefined))
  r.setScene(readScene(file.scene))
  const cam: Camera = { x: file.eye.x, y: file.eye.y, eyeX: file.eye.x, eyeY: file.eye.y, yaw: file.eye.yaw, pitch: REST_PITCH, facing: 0 as Dir8 }
  // a warm-up frame: the atlases made, the workers' code compiled
  await r.draw(cam, W, H, { pixelAspect: (CELL_H / CELL_W) * (sx / sy) })
  const t = { draw: 0, file: 0, zip: 0, kb: 0 }
  for (let i = 0; i < FRAMES; i++) {
    // a full turn, then back and forth a cell along the way the eye faces
    cam.yaw = file.eye.yaw + (i / FRAMES) * 2 * Math.PI
    const step = Math.sin((i / FRAMES) * 4 * Math.PI) * 1.5
    cam.eyeX = file.eye.x + Math.sin(file.eye.yaw) * step
    cam.eyeY = file.eye.y - Math.cos(file.eye.yaw) * step
    const t0 = performance.now()
    const px = await r.draw(cam, W, H, { pixelAspect: (CELL_H / CELL_W) * (sx / sy) })
    const t1 = performance.now()
    if (process.env.BENCH_HASH) for (let j = 0; j < W * H * 3; j++) hash = Math.imul(hash ^ px[j], 16777619)
    if (process.env.BENCH_DUMP) fs.appendFileSync(process.env.BENCH_DUMP, px.subarray(0, W * H * 3))
    fs.writeFileSync('/tmp/orbrun-bench.rgb', px.subarray(0, W * H * 3))
    const t2 = performance.now()
    const z = deflateSync(Buffer.from(px.buffer, px.byteOffset, W * H * 3), { level: 1 })
    const t3 = performance.now()
    t.draw += t1 - t0
    t.file += t2 - t1
    t.zip += t3 - t2
    t.kb += (z.length * 4) / 3 / 1024
  }
  const f = (ms: number) => (ms / FRAMES).toFixed(2).padStart(6)
  console.log(`${placeId.padEnd(12)} ${W}x${H}  draw ${f(t.draw)} ms  file ${f(t.file)} ms  zip ${f(t.zip)} ms  ${(t.kb / FRAMES).toFixed(0).padStart(5)} KB`)
  total.draw += t.draw
  total.file += t.file
  total.zip += t.zip
  total.kb += t.kb
  total.n += FRAMES
}
const n = total.n
console.log(`${'all'.padEnd(12)} ${W}x${H}  draw ${(total.draw / n).toFixed(2).padStart(6)} ms  file ${(total.file / n).toFixed(2).padStart(6)} ms  zip ${(total.zip / n).toFixed(2).padStart(6)} ms  ${(total.kb / n).toFixed(0).padStart(5)} KB  (${(1000 / (total.draw / n)).toFixed(0)} draws/s)`)
if (process.env.BENCH_HASH) console.log(`hash ${(hash >>> 0).toString(16)}`)
fs.rmSync('/tmp/orbrun-bench.rgb', { force: true })
r.destroy()
process.exit(0)
