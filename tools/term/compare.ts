/**
 * render-term against render-3d: the comparison bed's poses
 * (apps/orbrun/testbed/compare-scene.ts), each drawn by render-term beside
 * render-3d's own frame of it shrunk to the same size, with the mean
 * difference per pose. render-3d's frames come from
 * `node tools/build/render-compare.mjs capture <dir>` (its `desktop` frames).
 *
 *   npm run term:compare -- <render-3d dir> <out.png> [width]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { RenderTerm } from '@orbrun/render-term'
import type { Camera } from '@orbrun/scene'
import { HANDS, LENS, POSES, populate } from '../../apps/orbrun/testbed/compare-scene'
import { antechamberScene } from '../../apps/orbrun/src/room/scene'
import { RoomTiles, type RoomAtlasJson } from '../../apps/orbrun/src/room/tiles'

const here = path.dirname(fileURLToPath(import.meta.url))
const room = path.resolve(here, '../../apps/orbrun/public/room')
const [ref, outFile, wArg] = process.argv.slice(2)
if (!ref || !outFile) {
  console.error('usage: npm run term:compare -- <render-3d dir> <out.png> [width]')
  process.exit(1)
}
const W = Number(wArg) || 320
const H = Math.round((W * 800) / 1280)

const json = JSON.parse(fs.readFileSync(path.join(room, 'atlas.json'), 'utf8')) as RoomAtlasJson
const { data, info } = await sharp(path.join(room, 'atlas.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const tiles = new RoomTiles(json, undefined)
const { scene } = antechamberScene(tiles)
populate(scene)
scene.revision = 2
scene.layoutRevision = 2
const r = new RenderTerm(LENS)
r.setTiles(tiles, (name) => (name === 'room' ? { width: info.width, height: info.height, data } : undefined))
r.setScene(scene)
r.setViewmodel(HANDS)

const dir = fs.existsSync(path.join(ref, 'desktop')) ? path.join(ref, 'desktop') : ref
const rows: Buffer[] = []
const buf = new Uint8Array(W * H * 3)
for (const [i, p] of POSES.entries()) {
  r.setOptions({ viewmodel: p.hands ?? true })
  r.setCursor(p.cursor ?? null)
  const cam: Camera = { x: p.x, y: p.y, eyeX: p.x, eyeY: p.y, yaw: p.yaw, pitch: p.pitch, facing: 0 }
  r.render(cam, W, H, buf)
  const t0 = performance.now()
  for (let k = 0; k < 10; k++) r.render(cam, W, H, buf)
  const ms = (performance.now() - t0) / 10
  const mine = Buffer.from(buf)
  const file = path.join(dir, `${String(i).padStart(2, '0')}-${p.name}.png`)
  // render-3d's frame shrunk as a terminal would show it: each pixel the mean of those it covers
  const theirs = await sharp(file).removeAlpha().resize(W, H, { kernel: 'cubic', fit: 'fill' }).raw().toBuffer()
  let diff = 0
  for (let j = 0; j < mine.length; j++) diff += Math.abs(mine[j] - theirs[j])
  console.log(`${p.name.padEnd(18)} mean diff ${(diff / mine.length).toFixed(1).padStart(5)}   ${ms.toFixed(2)} ms`)
  const label = Buffer.from(`<svg width="${W * 2 + 8}" height="16"><text x="2" y="12" font-family="monospace" font-size="12" fill="#ccc">${p.name}: render-term | render-3d</text></svg>`)
  rows.push(
    await sharp({ create: { width: W * 2 + 8, height: H + 16, channels: 3, background: '#222' } })
      .composite([
        { input: label, left: 0, top: 0 },
        { input: await sharp(mine, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer(), left: 0, top: 16 },
        { input: await sharp(theirs, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer(), left: W + 8, top: 16 },
      ])
      .png()
      .toBuffer(),
  )
}
const rh = H + 16
await sharp({ create: { width: W * 2 + 8, height: rh * rows.length, channels: 3, background: '#222' } })
  .composite(rows.map((input, i) => ({ input, left: 0, top: i * rh })))
  .png()
  .toFile(outFile)
console.log(`wrote ${outFile}`)
