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
 * `pick(i, px, py)`, `frame(i)`, the renderer `r` and its `scene` (for a script that walks the player about). Nothing here depends on time: the attack lift is never
 * started, so every frame is a pure function of its pose.
 */
import { Render3d, type Render3dOptions } from '@orbrun/render-3d'
import { dirToYaw, type Camera, type Dir8 } from '@orbrun/scene'
import { HANDS, LENS, POSES, populate, type Pose } from './compare-scene'
import { antechamberScene } from '../src/room/scene'
import { loadRoomTiles } from '../src/room/tiles'

const canvas = document.getElementById('view') as HTMLCanvasElement
const tiles = await loadRoomTiles()
const { scene } = antechamberScene(tiles)
populate(scene)
scene.revision = 2
scene.layoutRevision = 2
const r = new Render3d({ ...LENS, viewmodel: true, motion: false })
r.mount(canvas)
r.setTiles(tiles)
r.setScene(scene)
r.setViewmodel(HANDS)

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

/**
 * Frames a pose may take to settle. A pose that rebuilt the level needs a
 * second frame, and one that stood a crowd needs as many as its budget takes
 * (`CROWD_BUDGET_MS`); this is the cap that keeps a renderer stuck reporting
 * work from hanging the capture.
 */
const SETTLE_MAX = 240

async function capture(): Promise<string[]> {
  fit()
  const out: string[] = []
  for (const p of POSES) {
    // Every pose is captured settled, as the game would show it once it has
    // stopped working: at least twice, since a pose that rebuilt the level
    // reads right only on the second, and then for as long as the renderer
    // says it still has work — the crowd fills in over several frames.
    frame(p)
    frame(p)
    for (let i = 0; i < SETTLE_MAX && r.animating; i++) frame(p)
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
w.scene = scene
w.frame = (i: number) => frame(POSES[i])
w.current = () => current
window.addEventListener('resize', fit)
fit()
frame(POSES[0])
w.__ready = true
