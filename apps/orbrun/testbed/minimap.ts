/**
 * Minimap turn test bed (camera.ts MAP_TURNS_DIAGONAL experiment).
 *
 * The same scene through the same renderer twice: the shipped map, which
 * snaps its ground to the compass heading on the facing's left (camera
 * `gridFacingOf`), beside one whose ground stands the way the player faces on
 * all eight headings (camera `mapFacingOf`). The quarter map eases at the
 * app's MAP_TURN_RATE, a touch quicker than the view; the other makes the
 * view's own turn, so it takes the view's TURN_RATE and the two swing
 * together. The arrow over the player is where they look, so on a diagonal
 * the left map's arrow leans and the right map's stays up.
 *
 * What is painted on the ground — the features and highlights in the app,
 * the target cursor here — is turned back to the grid heading (renderer
 * `uprightYaw`), so it lies with the ground over the 45 degrees of a
 * diagonal. What stands in a cell is upright whatever the ground does: the
 * app's monsters and items, and the player's white mark here. The cursor
 * sits three cells along that same grid heading, which an aim's keys are
 * read against (camera `gridFacing`, quarters on both maps), so `k` reaches
 * the same cell either way. Colour blocks stand in for the tileset the app's
 * minimap has.
 *
 * Served by the app's dev server at /testbed/minimap.html; not part of the build.
 */
import { Render2d } from '@orbrun/render-2d'
import { DIR8_DX, DIR8_DY, cellKey, dirToYaw, emptyScene, makeCamera, type Dir8, type Scene, type SceneCell } from '@orbrun/scene'

/** the app's view easing, and the rate a ground standing on the facing turns at (camera.ts TURN_RATE) */
const TURN_RATE = 14
/** the app's minimap easing under quarter turns (camera.ts MAP_TURN_RATE) */
const MAP_TURN_RATE = 18
const CELL = 20

const LAYOUT = [
  '###########################################',
  '#.........#####...........#####...........#',
  '#.####.##.#####.#########.#####.#########.#',
  '#.#..#.##.......#.......#.......#.......#.#',
  '#.#..#.#########.#####.#########.#####.#..#',
  '#.#..#.........#.#...#.........#.#...#.#..#',
  '#.#..#########.#.#.#.#########.#.#.#.#.#..#',
  '#.#..........#.#.#.#.......#...#.#.#.#.#..#',
  '#.##########.#.#.#.#######.#.###.#.#.#.#..#',
  '#............#.#.#.......#.#.....#.#...#..#',
  '######.#######.#.#######.#.#######.#####..#',
  '#......#.......#.......#.#.......#........#',
  '#.######.#############.#.#######.##########',
  '#........#...........#.#.......#..........#',
  '#.########.#########.#.#######.#########..#',
  '#.#......#.#.......#.#.......#.#.......#..#',
  '#.#.####.#.#.#####.#.#######.#.#.#####.#..#',
  '#.#.#..#.#.#.#...#.......#...#.#.#...#.#..#',
  '#.#.#..#.#.#.#.#.#######.#.###.#.#.#.#.#..#',
  '#...#..#...#...#.......#.#.....#...#.#....#',
  '#####..#########.#####.#.#########.#.######',
  '#......#.......#.....#.#.........#.#......#',
  '#.######.#####.#####.#.#########.#.######.#',
  '#........#...#.....#.#.#.......#.#........#',
  '#########.#.#####.#.#.#.#.###.#.##########',
  '#.........#.....#.#.#.#.#.#.#.#...........#',
  '#.#############.#.#.#.#.#.#.#.#########...#',
  '#...............#...#...#...#.............#',
  '###########################################',
]

function cell(x: number, y: number, wall: boolean): SceneCell {
  return {
    x,
    y,
    kind: wall ? 'wall' : 'floor',
    visibility: 'visible',
    occluder: wall,
    floorTile: 1,
    wallTile: wall ? 2 : undefined,
    flags: { water: false, lava: false, excluded: false, travelTrail: false, newStair: false, cursor: false, outOfRange: false, magicMapped: false },
  }
}

function build(): Scene {
  const s = emptyScene()
  s.playerOnLevel = true
  for (let y = 0; y < LAYOUT.length; y++) {
    for (let x = 0; x < LAYOUT[y].length; x++) {
      const ch = LAYOUT[y][x]
      if (ch === ' ') continue
      s.cells.set(cellKey(x, y), cell(x, y, ch === '#'))
    }
  }
  s.bounds = { left: 0, top: 0, right: LAYOUT[0].length - 1, bottom: LAYOUT.length - 1 }
  s.player = { x: 21, y: 19 }
  return s
}

const scene = build()
const cam = makeCamera(scene.player.x, scene.player.y, 0)

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const canvases = { quarter: $<HTMLCanvasElement>('quarter'), all8: $<HTMLCanvasElement>('all8') }
const stats = $('stats')
const easeIn = $<HTMLInputElement>('ease')
const cursorIn = $<HTMLInputElement>('cursor')

/** the shipped rule: a diagonal reads the compass heading on its left */
const quarterFacing = (f: Dir8): Dir8 => ((f % 2 === 0 ? f : f - 1) as Dir8)

/** three cells along the grid heading the aim keys read against: where `k` puts the cursor */
function aimCell() {
  const g = quarterFacing(cam.facing)
  return { x: scene.player.x + DIR8_DX[g] * 3, y: scene.player.y + DIR8_DY[g] * 3, mode: 'target' as const }
}

const maps = {
  quarter: new Render2d({ mode: 'minimap', cellSize: CELL, follow: true, background: 'rgba(0,0,0,0)' }),
  all8: new Render2d({ mode: 'minimap', cellSize: CELL, follow: true, background: 'rgba(0,0,0,0)' }),
}
for (const k of ['quarter', 'all8'] as const) {
  const c = canvases[k]
  maps[k].mount(c)
  maps[k].resize(c.width, c.height, window.devicePixelRatio || 1)
  maps[k].setScene(scene)
  maps[k].setCamera(cam)
}

/** where each map's top points right now, in radians */
const up = { quarter: 0, all8: 0 }

function goal(k: 'quarter' | 'all8') {
  return dirToYaw(k === 'quarter' ? quarterFacing(cam.facing) : cam.facing)
}

function delta(from: number, to: number) {
  let d = to - from
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return d
}

/** the facing arrow: the player's heading as it lands on a map turned to `mapUp` */
function arrow(c: HTMLCanvasElement, mapUp: number) {
  const ctx = c.getContext('2d')!
  const a = cam.yaw - mapUp
  ctx.save()
  ctx.translate(c.width / 2, c.height / 2)
  ctx.rotate(a)
  ctx.fillStyle = '#ffcc44'
  ctx.beginPath()
  ctx.moveTo(0, -16)
  ctx.lineTo(7, 6)
  ctx.lineTo(0, 1)
  ctx.lineTo(-7, 6)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

const NAMES = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
let spinning = false

function draw() {
  for (const k of ['quarter', 'all8'] as const) {
    maps[k].setCursor(cursorIn.checked ? aimCell() : null)
    // what is painted on the ground is turned back to the grid heading (the
    // quarter map's own ground), so on a diagonal it lies with it
    maps[k].setOptions({ up: cam.facing, upYaw: up[k], uprightYaw: up.quarter })
    maps[k].render()
    arrow(canvases[k], up[k])
  }
  const deg = (r: number) => Math.round((((r * 180) / Math.PI) % 360 + 360) % 360)
  stats.textContent = `facing ${NAMES[cam.facing]} (${deg(cam.yaw)}°) · quarters up ${deg(up.quarter)}° · every heading up ${deg(up.all8)}°`
}

let last = performance.now()
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000)
  last = now
  let moved = false
  const yawGoal = dirToYaw(cam.facing)
  for (const [cur, set] of [
    [cam.yaw, (v: number) => (cam.yaw = v)],
  ] as const) {
    const d = delta(cur, yawGoal)
    if (Math.abs(d) > 0.002) {
      set(cur + d * (easeIn.checked ? Math.min(1, dt * TURN_RATE) : 1))
      moved = true
    } else set(yawGoal)
  }
  for (const k of ['quarter', 'all8'] as const) {
    const d = delta(up[k], goal(k))
    if (Math.abs(d) > 0.002) {
      // a ground on the facing makes the view's own turn, so it takes the
      // view's rate and the two swing as one; quarters keep the old, quicker one
      up[k] += d * (easeIn.checked ? Math.min(1, dt * (k === 'all8' ? TURN_RATE : MAP_TURN_RATE)) : 1)
      moved = true
    } else up[k] = goal(k)
  }
  if (moved) draw()
  // spin steps on to the next heading once the turn has settled, so each is seen
  if (spinning && !moved) setFacing((((cam.facing + 1) % 8) as Dir8))
  requestAnimationFrame(frame)
}

function setFacing(f: Dir8) {
  cam.facing = f
}

const facings = $('facings')
for (let f = 0; f < 8; f++) {
  const b = document.createElement('button')
  b.textContent = NAMES[f]
  b.onclick = () => {
    spinning = false
    setFacing(f as Dir8)
  }
  facings.append(b)
}
$('spin').onclick = () => {
  spinning = !spinning
  $('spin').classList.toggle('on', spinning)
}
window.addEventListener('keydown', (e) => {
  if (e.key === 'q' || e.key === 'Q') setFacing((((cam.facing + 7) % 8) as Dir8))
  if (e.key === 'e' || e.key === 'E') setFacing((((cam.facing + 1) % 8) as Dir8))
})

draw()
requestAnimationFrame(frame)
