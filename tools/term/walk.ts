/**
 * Walk a real level in this terminal with @orbrun/render-term, no browser:
 * `npm run term:walk [place]`, a place of the front room's
 * (apps/orbrun/public/room/places: lair-grove, abyss, zot-4, necropolis…).
 * Arrows (or WASD) step and turn, `b` spins the view twice to measure the
 * frame rate, `q` quits. FPS=<n> caps the frames a second (120 by default).
 *
 * The view is a kitty graphics image, as the game draws it (game/client.ts),
 * a pixel a point of an 8x16 cell (ORBRUN_TERM_CELL_PX "w,h" for another),
 * times ORBRUN_TERM_SCALE, ORBRUN_TERM_MOTION_SCALE (0.5) of each side while
 * the view moves and whole once it stops, handed over as a temporary file (ORBRUN_TERM_FILES=0
 * to send it compressed, as over SSH).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import type { Pixels } from '@orbrun/render-term'
import { cellKey, REST_PITCH, type Camera, type Dir8 } from '@orbrun/scene'
import { readScene, type PlaceFile } from '../../apps/orbrun/src/room/place-data'
import { RoomTiles } from '../../apps/orbrun/src/room/tiles'
// @ts-expect-error: plain JS
import { DELETE_IMAGES, kittyFile, kittyImage, kittyTempPath, synced } from './frame.mjs'
import { TermRaster } from './raster'

const here = path.dirname(fileURLToPath(import.meta.url))
const placesDir = path.resolve(here, '../../apps/orbrun/public/room/places')
const placeId = process.argv[2] || 'lair-grove'
const CAP = Number(process.env.FPS || 120)
/** how long a step and a 45° turn take, seconds */
const STEP_S = 0.16
const TURN_S = 0.12
const [CELL_W, CELL_H] = (process.env.ORBRUN_TERM_CELL_PX || '8,16').split(',').map(Number)
const SCALE = Number(process.env.ORBRUN_TERM_SCALE) || 1
const MOTION_SCALE = Number(process.env.ORBRUN_TERM_MOTION_SCALE) || 0.5
/** the pixels a cell is drawn in: fewer while the view moves */
const cellPixels = (moving: boolean) => {
  const s = SCALE * (moving ? MOTION_SCALE : 1)
  return { SX: Math.max(1, Math.round(CELL_W * s)), SY: Math.max(1, Math.round(CELL_H * s)) }
}
const FILES = process.env.ORBRUN_TERM_FILES !== '0'
let fileCount = 0

const file = JSON.parse(fs.readFileSync(path.join(placesDir, `${placeId}.json`), 'utf8')) as PlaceFile
const { data, info } = await sharp(path.join(placesDir, `${placeId}.png`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const atlas: Pixels = { width: info.width, height: info.height, data }
const tiles = RoomTiles.fromPlace(file, undefined)
const scene = readScene(file.scene)

const r = new TermRaster()
r.setTiles(tiles, (name) => (tiles.atlasNames().includes(name) ? atlas : undefined))
r.setScene(scene)

// the eye: where it is now, and where it is going
const facing0 = Math.round(file.eye.yaw / (Math.PI / 4)) & 7
const cam: Camera = { x: file.eye.x, y: file.eye.y, eyeX: file.eye.x, eyeY: file.eye.y, yaw: file.eye.yaw, pitch: REST_PITCH, facing: facing0 as Dir8 }
let goalYaw = cam.yaw
let spin = 0

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
  out.write('\x1b[0m\x1b[2J')
  wake()
})

const walkable = (x: number, y: number) => {
  const c = scene.cells.get(cellKey(x, y))
  return !!c && !c.occluder && c.kind !== 'wall'
}

function step(dir: 1 | -1) {
  // along the way the view faces, to the nearest of the eight
  const a = Math.round(goalYaw / (Math.PI / 4)) * (Math.PI / 4)
  const dx = Math.round(Math.sin(a)) * dir
  const dy = Math.round(-Math.cos(a)) * dir
  if (walkable(cam.x + dx, cam.y + dy)) {
    cam.x += dx
    cam.y += dy
  }
  wake()
}

function turn(by: number) {
  goalYaw += by * (Math.PI / 4)
  wake()
}

input.on('data', (d: Buffer) => {
  const s = d.toString()
  if (s === 'q' || s === '\x03' || s === '\x1c') return quit()
  if (s === '\x1b[A' || s === 'w') step(1)
  else if (s === '\x1b[B' || s === 's') step(-1)
  else if (s === '\x1b[D' || s === 'a') turn(-1)
  else if (s === '\x1b[C' || s === 'd') turn(1)
  else if (s === 'b') {
    spin = 4 * Math.PI
    bench = { frames: 0, renderMs: 0, sendMs: 0, kb: 0, start: performance.now() }
    wake()
  }
})

function quit() {
  out.write(DELETE_IMAGES + '\x1b[0m\x1b[2J\x1b[?25h\x1b[?1049l')
  if (lastBench) out.write(lastBench + '\n')
  process.exit(0)
}

// frames: drawn only while something moves, as fast as the cap allows
let bench: { frames: number; renderMs: number; sendMs: number; kb: number; start: number } | null = null
let lastBench = ''
let running = false
let last = performance.now()
let fpsWindow: number[] = []
let sent = Promise.resolve()

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
  // ease the eye toward its cell and the view toward its yaw, at the game's pace
  const move = dt / STEP_S
  const ex = cam.x - cam.eyeX
  const ey = cam.y - cam.eyeY
  const dist = Math.hypot(ex, ey)
  if (dist <= move) {
    cam.eyeX = cam.x
    cam.eyeY = cam.y
  } else {
    cam.eyeX += (ex / dist) * move
    cam.eyeY += (ey / dist) * move
  }
  if (spin > 0) {
    const by = Math.min(spin, dt * Math.PI)
    spin -= by
    cam.yaw += by
    goalYaw += by
  } else {
    const turnBy = (dt / TURN_S) * (Math.PI / 4)
    const dy = goalYaw - cam.yaw
    cam.yaw = Math.abs(dy) <= turnBy ? goalYaw : cam.yaw + Math.sign(dy) * turnBy
  }

  // the view under the status line, in fewer pixels while it moves, whole on the frame it stops
  const moving = cam.eyeX !== cam.x || cam.eyeY !== cam.y || cam.yaw !== goalYaw || spin > 0
  const { SX, SY } = cellPixels(moving)
  const t0 = performance.now()
  const at = { cols, rows: rows - 1 }
  const w = at.cols * SX, h = at.rows * SY
  const px = await r.draw(cam, w, h, { pixelAspect: (CELL_H / CELL_W) * (SX / SY) })
  const renderMs = performance.now() - t0
  if (at.cols !== cols || at.rows !== rows - 1) return void setTimeout(frame, 0)
  const t1 = performance.now()
  let image: string
  if (FILES) {
    const file = kittyTempPath(fileCount++)
    await fs.promises.writeFile(file, px.subarray(0, w * h * 3))
    image = kittyFile(1, file, w, h, at.cols, at.rows, -1)
  } else image = kittyImage(1, px, w, h, at.cols, at.rows, -1, 3)
  const sendMs = performance.now() - t1
  fpsWindow.push(now)
  fpsWindow = fpsWindow.filter((t) => now - t < 1000)
  const status = `${file.place}  ${w}x${h}  ${fpsWindow.length} fps  render ${renderMs.toFixed(1)} ms  compress ${sendMs.toFixed(1)} ms  ${(image.length / 1024).toFixed(0)} KB  arrows walk and turn  b spins  q quits`
  const update = synced(`\x1b[0m\x1b[2;1H${image}\x1b[1;1H\x1b[0m${status.slice(0, cols)}\x1b[K`)
  // after the frame before it, which the terminal may still be taking in while this one was drawn
  await sent
  sent = new Promise<void>((done) => out.write(update, () => done()))

  if (bench) {
    bench.frames++
    bench.renderMs += renderMs
    bench.sendMs += sendMs
    bench.kb += image.length / 1024
    if (spin <= 0) {
      const secs = (performance.now() - bench.start) / 1000
      const n = bench.frames
      lastBench = `spin at ${cols}x${rows} (${w}x${h} px): ${(n / secs).toFixed(0)} fps on screen, render ${(bench.renderMs / n).toFixed(2)} ms, compress ${(bench.sendMs / n).toFixed(2)} ms, ${(bench.kb / n).toFixed(0)} KB a frame`
      bench = null
    }
  }
  if (!moving) {
    running = false
    return
  }
  const wait = Math.max(0, 1000 / CAP - (performance.now() - now))
  setTimeout(frame, wait)
}

wake()
