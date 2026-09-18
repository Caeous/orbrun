/**
 * Renderer comparison bed (docs/custom-renderer-plan.md, step 0): the
 * antechamber with a crowd stood in it, shot from a fixed list of poses that
 * between them exercise everything the renderer draws — corridor depth, a
 * wall at a grazing angle, the open door plane, standing features, every
 * ghost kind, badges and bars, the cursor ring and tile, the flash field,
 * decals, the hands and third person. `tools/build/render-compare.mjs` runs
 * it headless, saves the frames and diffs two runs pixel by pixel.
 *
 * On `window`: `poses` (their names), `capture()` (one PNG data URL per
 * pose), `frameTimes()` (per pose: mean `render()` CPU time over a run of
 * steady frames paced on animation frames, draw calls per frame, and the
 * renderer's work counters),
 * `pick(i, px, py)`, `frame(i)` and the renderer `r`. Nothing here depends on time: the attack lift is never
 * started, so every frame is a pure function of its pose.
 */
import { Render3d, type Render3dOptions } from '@orbrun/render-3d'
import { cellKey, dirToYaw, type Billboard, type Camera, type Dir8, type Scene, type SceneCell, type SceneCursor, type Viewmodel } from '@orbrun/scene'
import { antechamberScene } from '../src/room/scene'
import { loadRoomTiles } from '../src/room/tiles'

// tiles of the packed room atlas (public/room/atlas.json) that stand in for the game's art
const T = {
  statue: 2823,
  tree: 2668,
  deadTree: 2690,
  potion: 4274,
  scroll: 4124,
  gold: 4631,
  lantern: 4519,
  lotus: 7114,
  bush: 7109,
  fungus: 7189,
  toadstool: 7187,
  plant: 7090,
  web: 3003,
  arch: 2820,
  gravestone: 2883,
  fountain: 3243,
  shallow: 991,
}

interface Pose {
  name: string
  /** eye cell and heading; the eased eye stands on the cell */
  x: number
  y: number
  yaw: number
  pitch: number
  cursor?: SceneCursor | null
  hands?: boolean
}

const deg = (d: number) => (d * Math.PI) / 180

/** The poses. The eye's own cell is (11, 5) facing north; the stairs are at (11, 1) in a recess between the statues at (10, 2) and (12, 2). */
const POSES: Pose[] = [
  { name: 'hall-north', x: 11, y: 5, yaw: 0, pitch: deg(-5) },
  { name: 'corridor-east', x: 6, y: 7, yaw: deg(90), pitch: deg(-3) },
  { name: 'wall-grazing', x: 9, y: 3, yaw: deg(-70), pitch: 0 },
  { name: 'door-head-on', x: 8, y: 5, yaw: deg(180), pitch: deg(-6) },
  { name: 'door-angled', x: 11, y: 6, yaw: deg(225), pitch: deg(-4) },
  { name: 'statues-close', x: 11, y: 3, yaw: 0, pitch: deg(-2) },
  { name: 'ghosts-recess', x: 13, y: 4, yaw: deg(-30), pitch: deg(-4) },
  { name: 'remembered-wood', x: 7, y: 4, yaw: deg(-90), pitch: deg(-4) },
  { name: 'cursor-ring', x: 11, y: 5, yaw: 0, pitch: deg(-12), cursor: { x: 11, y: 3, mode: 'target' } },
  { name: 'cursor-tile', x: 11, y: 5, yaw: 0, pitch: deg(-12), cursor: { x: 11, y: 3, mode: 'examine', tile: T.web } },
  { name: 'cursor-map', x: 11, y: 5, yaw: deg(45), pitch: deg(-12), cursor: { x: 13, y: 3, mode: 'map' } },
  { name: 'cursor-on-sprite', x: 11, y: 5, yaw: deg(-45), pitch: deg(-8), cursor: { x: 9, y: 3, mode: 'target' } },
  { name: 'flash-pool', x: 12, y: 6, yaw: deg(60), pitch: deg(-8) },
  { name: 'floor-decals', x: 11, y: 5, yaw: deg(180), pitch: deg(-30) },
  { name: 'lid-up', x: 11, y: 5, yaw: deg(135), pitch: deg(20) },
  { name: 'hands-off', x: 11, y: 5, yaw: deg(-135), pitch: deg(-5), hands: false },
  { name: 'wood-edge', x: 3, y: 5, yaw: deg(-120), pitch: deg(-2) },
]

/** The crowd, the decals, the flash, the remembered corner and the open door, laid over the compiled room. */
function populate(scene: Scene) {
  const cell = (x: number, y: number) => scene.cells.get(cellKey(x, y))!
  const mons = (x: number, y: number, tile: number, extra: Partial<Billboard> = {}): Billboard => ({ x, y, tile, kind: 'monster', height: 1, attitude: 'hostile', ...extra })
  const item = (x: number, y: number, tile: number, extra: Partial<Billboard> = {}): Billboard => ({ x, y, tile, kind: 'item', height: 0.6, ...extra })
  scene.billboards.push(
    // the hall
    mons(11, 3, T.statue, { statusIcons: [{ tile: T.gold, ox: 20, oy: 0 }, { tile: T.scroll, ox: 0, oy: 0, at: 'top' }] }),
    mons(9, 3, T.tree, { height: 0.9, layers: [{ tile: T.plant }, { tile: T.potion, ox: 8, oy: 8 }, { tile: T.scroll, ymax: 20 }] }),
    mons(14, 6, T.deadTree, { alpha: 0.5 }),
    item(10, 4, T.potion),
    item(12, 5, T.gold),
    item(8, 6, T.lantern, { height: 0.7 }),
    { x: 10, y: 5, tile: T.potion, kind: 'projectile', height: 0.5 },
    { x: 13, y: 6, tile: T.web, kind: 'cloud', height: 1 },
    // behind the recess walls: ghosts of what is in view
    mons(9, 1, T.fungus, { statusIcons: [{ tile: T.gold, ox: 20, oy: 20 }] }),
    mons(13, 1, T.toadstool),
    item(14, 1, T.scroll),
    // the remembered wood: ghosts of memory
    mons(2, 2, T.bush),
    item(3, 3, T.gold),
    mons(1, 6, T.lotus, { height: 0.8 }),
    // the doll, for third person
    { x: 11, y: 5, tile: T.statue, kind: 'player', height: 1, layers: [{ tile: T.statue }, { tile: T.potion, ox: 10, oy: 4 }] },
  )
  // remembered knowledge in the west
  for (let y = 1; y <= 7; y++) for (let x = 1; x <= 4; x++) cell(x, y).visibility = 'remembered'
  // a flash over the pool
  for (let y = 3; y <= 6; y++) for (let x = 13; x <= 16; x++) cell(x, y).flash = { r: 60, g: 90, b: 255, a: 80 + (x - 13) * 40 }
  // decals: underlays, overlays, icons, a wall decal, some of them blended
  cell(11, 6).underlays = [T.shallow]
  cell(11, 6).overlays = [T.gold]
  cell(12, 6).icons = [T.web]
  cell(10, 6).overlays = [T.web]
  cell(10, 6).translucent = [T.web]
  cell(11, 0).wallOverlays = [T.web]
  cell(12, 0).wallOverlays = [T.web]
  cell(12, 0).translucent = [T.web]
  // an open door in the bookcase run: the stone arch's tile hangs in the doorway
  const door = cell(8, 8)
  door.kind = 'floor'
  door.occluder = false
  door.wallTile = undefined
  door.wallStyle = undefined
  door.floorTile = cell(8, 7).floorTile
  door.featureTile = T.arch
  door.feature = { type: 'door', state: 'open' }
  door.stance = 'upright'
  door.label = 'open door'
  // a fixture something stands on lies flat (occupiedFeatures): a gravestone under an item
  const grave = cell(12, 7) as SceneCell
  grave.featureTile = T.gravestone
  grave.feature = { type: 'other', name: 'gravestone' }
  grave.stance = 'upright'
  scene.billboards.push(item(12, 7, T.scroll))
  scene.player = { x: 11, y: 5 }
}

const canvas = document.getElementById('view') as HTMLCanvasElement
const tiles = await loadRoomTiles()
const { scene } = antechamberScene(tiles)
populate(scene)
scene.revision = 2
scene.layoutRevision = 2
const r = new Render3d({ fov: 80, eyeHeight: 0.65, viewmodel: true, motion: false })
r.mount(canvas)
r.setTiles(tiles)
r.setScene(scene)
const hands: Viewmodel = { weapon: { layers: [{ tile: T.scroll }], name: 'scroll' }, offhand: { layers: [{ tile: T.potion }], name: 'HAND2_potion' } }
r.setViewmodel(hands)

// draw calls per frame, counted on the context the renderer draws with
let draws = 0
const gl = canvas.getContext('webgl2') as WebGL2RenderingContext | null
if (gl)
  for (const k of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced'] as const) {
    const f = gl[k] as (...a: unknown[]) => unknown
    ;(gl as unknown as Record<string, unknown>)[k] = function (this: unknown, ...a: unknown[]) {
      draws++
      return f.apply(this, a)
    }
  }

function fit() {
  const w = window.innerWidth || 1
  const h = window.innerHeight || 1
  r.resize(w, h, 1)
}

let current = ''
let optsKey = ''
function apply(p: Pose) {
  const opts: Render3dOptions = { viewmodel: p.hands ?? true }
  // options are set only when they change: setting them rebuilds the level, and a steady frame must not
  const key = JSON.stringify(opts)
  if (key !== optsKey) {
    optsKey = key
    r.setOptions(opts)
  }
  const cam: Camera = { x: p.x, y: p.y, eyeX: p.x, eyeY: p.y, yaw: p.yaw, pitch: p.pitch, facing: 0 }
  cam.facing = nearestDir(p.yaw)
  r.setCamera(cam)
  r.setCursor(p.cursor ?? null)
  current = p.name
}

/** the facing nearest the yaw, as the game keeps them together */
function nearestDir(yaw: number) {
  let best = 0, bd = Infinity
  for (let d = 0; d < 8; d++) {
    const dy = Math.abs(Math.atan2(Math.sin(yaw - dirToYaw(d as Dir8)), Math.cos(yaw - dirToYaw(d as Dir8))))
    if (dy < bd) { bd = dy; best = d }
  }
  return best as Dir8
}

function frame(p: Pose) {
  apply(p)
  draws = 0
  const t0 = performance.now()
  r.render()
  return { ms: performance.now() - t0, draws }
}

async function capture(): Promise<string[]> {
  fit()
  const out: string[] = []
  for (const p of POSES) {
    frame(p)
    // twice: a pose that rebuilt the level (third person) is captured settled, as the game would show it
    frame(p)
    out.push(canvas.toDataURL('image/png'))
  }
  return out
}

/**
 * Per pose: the mean `render()` time over `runs` steady frames, the draw calls
 * of the last, and the work counters. The frames are paced on animation
 * frames as the game paces them: run back to back, a renderer that issues its
 * GL calls faster than the GPU process drains them stalls on the command
 * buffer every few frames, and the stall is what gets timed, not the frame.
 * (The clock is coarse too, so one frame's time says little; the mean over
 * the run is the number.)
 */
async function frameTimes(runs = 60) {
  fit()
  const tick = () => new Promise<void>((res) => requestAnimationFrame(() => res()))
  const out: { name: string; ms: number; draws: number; stats: Record<string, number> }[] = []
  for (const p of POSES) {
    for (let i = 0; i < 5; i++) {
      frame(p)
      await tick()
    }
    let d = 0
    let total = 0
    for (let i = 0; i < runs; i++) {
      await tick()
      const f = frame(p)
      total += f.ms
      d = f.draws
    }
    out.push({ name: p.name, ms: +(total / runs).toFixed(3), draws: d, stats: { ...(r.stats as unknown as Record<string, number>) } })
  }
  return out
}

function pick(i: number, px: number, py: number) {
  fit()
  frame(POSES[i])
  return r.pick(px, py)
}

const w = window as unknown as Record<string, unknown>
w.poses = POSES.map((p) => p.name)
w.capture = capture
w.frameTimes = frameTimes
w.pick = pick
w.r = r
w.frame = (i: number) => frame(POSES[i])
w.current = () => current
window.addEventListener('resize', fit)
fit()
frame(POSES[0])
w.__ready = true
