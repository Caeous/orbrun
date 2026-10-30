/**
 * A frame of a place of the front room's as the terminal's view draws it, as
 * a PNG, to look at without a terminal: `npm run term:snap -- [place]
 * [out.png]`. SNAP_COLS x SNAP_ROWS cells (140 x 45) of 8 x 16 pixels,
 * SNAP_TURN eighths of a turn from where the place's eye faces, SNAP_STEP
 * cells forward.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { RenderTerm, type Pixels } from '@orbrun/render-term'
import { REST_PITCH, type Camera, type Dir8 } from '@orbrun/scene'
import { readScene, type PlaceFile } from '../../apps/orbrun/src/room/place-data'
import { RoomTiles } from '../../apps/orbrun/src/room/tiles'

const CELL_W = 8
const CELL_H = 16
const here = path.dirname(fileURLToPath(import.meta.url))
const placesDir = path.resolve(here, '../../apps/orbrun/public/room/places')
const placeId = process.argv[2] || 'lair-grove'
const outFile = process.argv[3] || `${placeId}.png`
const cols = Number(process.env.SNAP_COLS) || 140
const rows = Number(process.env.SNAP_ROWS) || 45

const file = JSON.parse(fs.readFileSync(path.join(placesDir, `${placeId}.json`), 'utf8')) as PlaceFile
const { data, info } = await sharp(path.join(placesDir, `${placeId}.png`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const atlas: Pixels = { width: info.width, height: info.height, data }
const tiles = RoomTiles.fromPlace(file, undefined)

const yaw = file.eye.yaw + (Number(process.env.SNAP_TURN) || 0) * (Math.PI / 4)
const step = Number(process.env.SNAP_STEP) || 0
const x = file.eye.x + Math.round(Math.sin(yaw)) * step, y = file.eye.y + Math.round(-Math.cos(yaw)) * step
const cam: Camera = { x, y, eyeX: x, eyeY: y, yaw, pitch: REST_PITCH, facing: (Math.round(yaw / (Math.PI / 4)) & 7) as Dir8 }

const r = new RenderTerm({ fov: 80 })
r.setTiles(tiles, (name) => (tiles.atlasNames().includes(name) ? atlas : undefined))
r.setScene(readScene(file.scene))
const W = cols * CELL_W, H = rows * CELL_H
const px = new Uint8Array(W * H * 3)
const t0 = performance.now()
r.render(cam, W, H, px)
const ms = performance.now() - t0
await sharp(Buffer.from(px), { raw: { width: W, height: H, channels: 3 } }).png().toFile(outFile)
console.log(`${file.place} ${W}x${H}: ${ms.toFixed(0)} ms -> ${outFile}`)
