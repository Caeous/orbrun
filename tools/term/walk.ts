/**
 * Walk a real level in this terminal with @orbrun/render-term, no browser:
 * `npm run term:walk [place]`, a place of the front room's
 * (apps/orbrun/public/room/places: lair-grove, abyss, zot-4, necropolis…).
 * Arrows (or WASD) step and turn, `b` spins the view twice to measure the
 * frame rate, `q` quits. FPS=<n> caps the frames a second (120 by default).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { RenderTerm, type Pixels } from '@orbrun/render-term'
import { cellKey, REST_PITCH, type Camera, type Dir8 } from '@orbrun/scene'
import { readScene, type PlaceFile } from '../../apps/orbrun/src/room/place-data'
import { RoomTiles } from '../../apps/orbrun/src/room/tiles'
// @ts-expect-error: plain JS, shared with the browser bridge
import { BLOCKS, Screen, blockCells, cellsWithText } from './frame.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const placesDir = path.resolve(here, '../../apps/orbrun/public/room/places')
const placeId = process.argv[2] || 'lair-grove'
const CAP = Number(process.env.FPS || 120)
/** the block characters the view is drawn in (`BLOCKS`): ORBRUN_TERM_BLOCKS, else quadrants */
const KIND = (process.env.ORBRUN_TERM_BLOCKS ?? 'quadrant') as keyof typeof BLOCKS
/** how long a step and a 45° turn take, seconds */
const STEP_S = 0.16
const TURN_S = 0.12

const file = JSON.parse(fs.readFileSync(path.join(placesDir, `${placeId}.json`), 'utf8')) as PlaceFile
const { data, info } = await sharp(path.join(placesDir, `${placeId}.png`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const atlas: Pixels = { width: info.width, height: info.height, data }
const tiles = RoomTiles.fromPlace(file, undefined)
const scene = readScene(file.scene)

const r = new RenderTerm()
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
out.write('\x1b[?1049h\x1b[?25l\x1b[2J')

let cols = out.columns || 80
let rows = out.rows || 24
let screen = new Screen(cols, rows, 0)
let buf = new Uint8Array(cols * BLOCKS[KIND].sx * rows * BLOCKS[KIND].sy * 3)
out.on('resize', () => {
  cols = out.columns
  rows = out.rows
  screen = new Screen(cols, rows, 0)
  buf = new Uint8Array(cols * BLOCKS[KIND].sx * rows * BLOCKS[KIND].sy * 3)
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
    bench = { frames: 0, renderMs: 0, start: performance.now() }
    wake()
  }
})

function quit() {
  out.write('\x1b[0m\x1b[2J\x1b[?25h\x1b[?1049l')
  if (lastBench) out.write(lastBench + '\n')
  process.exit(0)
}

// frames: drawn only while something moves, as fast as the cap allows
let bench: { frames: number; renderMs: number; start: number } | null = null
let lastBench = ''
let running = false
let last = performance.now()
let fpsWindow: number[] = []
let renderMs = 0

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

  const { sx, sy } = BLOCKS[KIND]
  const w = cols * sx
  const h = rows * sy
  const t0 = performance.now()
  // a pixel a dot of the cell's block character, in a cell twice as tall as it is wide
  r.render(cam, w, h, buf, ((Number(process.env.ORBRUN_TERM_CELL_ASPECT) || 2) * sx) / sy)
  renderMs = performance.now() - t0
  const pic = blockCells(buf, w, h, 3, cols, rows, KIND)
  fpsWindow.push(now)
  fpsWindow = fpsWindow.filter((t) => now - t < 1000)
  const status = `${file.place}  ${fpsWindow.length} fps  render ${renderMs.toFixed(1)} ms  ${cols}x${rows}  arrows walk and turn  b spins  q quits`
  const text = [[0, 0, status.length, 230, 230, 230, [[0, status]]]]
  await new Promise<void>((done) => out.write(screen.update(cellsWithText(pic, text, cols, rows)), () => done()))

  if (bench) {
    bench.frames++
    bench.renderMs += renderMs
    if (spin <= 0) {
      const secs = (performance.now() - bench.start) / 1000
      lastBench = `spin at ${cols}x${rows}: ${(bench.frames / secs).toFixed(0)} fps on screen, render ${(bench.renderMs / bench.frames).toFixed(2)} ms a frame`
      bench = null
    }
  }
  const moving = cam.eyeX !== cam.x || cam.eyeY !== cam.y || cam.yaw !== goalYaw || spin > 0
  if (!moving) {
    running = false
    return
  }
  const wait = Math.max(0, 1000 / CAP - (performance.now() - now))
  setTimeout(frame, wait)
}

wake()
