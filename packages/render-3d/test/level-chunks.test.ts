import { describe, it, expect } from 'vitest'
import { LevelGrid } from '../src/grid.js'
import { LevelMesher, uvFor, type ChunkGeometry, type MeshContext } from '../src/level-mesh.js'
import { WALL_INSET } from '../src/index.js'
import { cellKey, emptyScene, type Billboard, type Scene, type SceneCell, type TileRect } from '@orbrun/scene'

/**
 * The level's geometry is built chunk by chunk, and a build after the first
 * rebuilds only the chunks the changed cells reach into (`LEVEL_REACH`).
 * What that must never do is leave a face behind or a face over: these walk a
 * level as a player does, revealing cells a step at a time, and check after
 * every step that the chunks hold exactly the triangles a mesher that has
 * just built the whole level holds.
 *
 * Triangles are compared as a multiset per material kind, not in order: which
 * chunk a face lands in, and so where in the frame it is drawn, is the point
 * of the change. The level's own faces are opaque and depth-tested, and the
 * blended decals never overlap one another (each is a patch of one cell), so
 * no order among them shows on the screen — which the pixel harness
 * (tools/build/render-compare.mjs) is what really pins.
 */

const RECT: TileRect = { atlas: 'main', sx: 0, sy: 0, w: 32, h: 32, ox: 0, oy: 0, cell: 32 }
const rectFor = (id: number): TileRect => ({ ...RECT, sx: (id % 2) * 32, sy: (id % 3) * 32 })

const ctx: MeshContext = {
  tileOf: (id) => {
    const r = rectFor(id)
    return { r, atlas: 'main', uv: uvFor(r, 128, 128) }
  },
  fo: { inset: WALL_INSET },
  chamfer: 1 / 32,
}

const W = 121
const H = 41
/** Where the walk stands at step `i`, and how far it sees. */
const walk = (i: number) => ({ x: 4 + i * 5, y: 6 + (i % 9) * 2 })
const SIGHT = 5

/** A deterministic pseudo-random level: walls, floors, a few doors and staircases. */
function terrain(x: number, y: number): 'wall' | 'floor' | 'door' | 'stairs' {
  if (x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1) return 'wall'
  const n = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1
  const r = n < 0 ? n + 1 : n
  if (r < 0.22) return 'wall'
  if (r < 0.25) return 'door'
  if (r < 0.27) return 'stairs'
  return 'floor'
}

function cellAt(x: number, y: number, lit: boolean): SceneCell {
  const t = terrain(x, y)
  const cell: SceneCell = {
    x,
    y,
    kind: t === 'wall' ? 'wall' : t === 'door' ? 'door' : 'floor',
    visibility: lit ? 'visible' : 'remembered',
    occluder: t === 'wall',
    floorTile: 2 + ((x + y) % 3),
    wallTile: t === 'wall' ? 1 + (x % 2) : undefined,
    featureTile: t === 'stairs' ? 5 : t === 'door' ? 6 : undefined,
    stance: t === 'stairs' ? 'upright' : t === 'door' ? 'decal' : undefined,
    feature: t === 'stairs' ? { type: 'stairs', dir: 'down' } : t === 'door' ? { type: 'door', state: 'open' } : undefined,
    // a decal or two on some floors, one of them the translucent exclusion mark
    overlays: t === 'floor' && (x + y) % 5 === 0 ? [7, 8] : undefined,
    translucent: t === 'floor' && (x + y) % 5 === 0 ? [8] : undefined,
    wallOverlays: t === 'wall' && x % 4 === 0 ? [9] : undefined,
    flags: { water: false, lava: false, excluded: false, travelTrail: false, newStair: false, cursor: false, outOfRange: false, magicMapped: false },
  }
  return cell
}

/** The level as the player knows it after `step` steps of a walk east along row `py`, sight `reach`. */
function seen(step: number, billboards: Billboard[] = []): Scene {
  const s = emptyScene()
  s.playerOnLevel = true
  s.player = walk(step)
  s.level.ceilingTile = 1
  let left = W, top = H, right = -1, bottom = -1
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // every cell the walk has been within sight of, so far
      let known = false
      let lit = false
      for (let i = 0; i <= step; i++) {
        const a = walk(i)
        if (Math.max(Math.abs(x - a.x), Math.abs(y - a.y)) > SIGHT) continue
        known = true
        lit = i === step
      }
      if (!known) continue
      s.cells.set(cellKey(x, y), cellAt(x, y, lit))
      left = Math.min(left, x); right = Math.max(right, x)
      top = Math.min(top, y); bottom = Math.max(bottom, y)
    }
  }
  s.bounds = { left, top, right, bottom }
  s.billboards = billboards
  return s
}

/** Every triangle of the level's chunks, by material kind, as comparable strings. */
function triangles(mesher: LevelMesher): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const parts of mesher.chunks.values()) {
    for (const g of parts) {
      const list = out.get(g.kind) || []
      const streams: [keyof ChunkGeometry, number][] = [['position', 3], ['uv', 2], ['color', 3], ['cut', 1], ['cell', 2]]
      for (let i = 0; i < g.index.length; i += 3) {
        const parts2: string[] = []
        for (let v = 0; v < 3; v++) {
          const j = g.index[i + v]
          for (const [name, size] of streams) {
            const a = g[name] as Float32Array
            for (let c = 0; c < size; c++) parts2.push(a[j * size + c].toFixed(6))
          }
        }
        list.push(parts2.join(' '))
      }
      out.set(g.kind, list)
    }
  }
  for (const list of out.values()) list.sort()
  return out
}

/** Build `scene` into `mesher`, whole or as the change reaches. */
function build(mesher: LevelMesher, scene: Scene): LevelMesher {
  mesher.update(new LevelGrid(scene), ctx)
  return mesher
}

const fresh = (scene: Scene) => build(new LevelMesher(() => 0), scene)

function expectSameGeometry(a: LevelMesher, b: LevelMesher, what: string) {
  const ta = triangles(a)
  const tb = triangles(b)
  expect([...ta.keys()].sort(), what).toEqual([...tb.keys()].sort())
  for (const [kind, list] of ta) expect(list, `${what}: ${kind}`).toEqual(tb.get(kind))
}

describe('a level built in chunks', () => {
  it('builds the same geometry a step at a time as it does all at once', () => {
    const walked = new LevelMesher(() => 0)
    for (let step = 0; step <= 20; step++) {
      const scene = seen(step)
      build(walked, scene)
      expectSameGeometry(walked, fresh(scene), `step ${step}`)
    }
  })

  it('leaves the chunks a step did not reach alone', () => {
    const walked = build(new LevelMesher(() => 0), seen(12))
    const whole = walked.stats.levelChunkBuilds
    walked.stats.levelChunkBuilds = 0
    build(walked, seen(13))
    expect(walked.stats.levelChunkBuilds).toBeGreaterThan(0)
    expect(walked.stats.levelChunkBuilds).toBeLessThan(whole / 2)
  })

  /**
   * The reach itself: one cell changed at each place across a chunk boundary,
   * which is where a face built from a neighbour two or three cells away goes
   * missing if the dirty mark does not travel far enough.
   */
  it('carries a single cell\'s change into every chunk its geometry reaches', () => {
    // round the chunk boundary at 16, in a level the walk has only just opened
    for (let x = 13; x <= 19; x++) {
      for (let y = 13; y <= 19; y++) {
        const before = seen(4)
        if (!before.cells.has(cellKey(x, y))) continue
        const walked = build(new LevelMesher(() => 0), before)
        const after = seen(4)
        const k = cellKey(x, y)
        const was = after.cells.get(k)!
        // a door opens into a wall, and a wall opens into floor: both move the footprints around them
        after.cells.set(k, { ...was, kind: was.occluder ? 'floor' : 'wall', occluder: !was.occluder, wallTile: was.occluder ? undefined : 1, featureTile: undefined, feature: undefined, stance: undefined })
        build(walked, after)
        expectSameGeometry(walked, fresh(after), `cell ${x},${y} changed`)
      }
    }
  })

  it('rebuilds a cell whose feature a monster has just stood on', () => {
    const scene = seen(20)
    // a staircase the walk has seen: a monster standing on it lays it flat (`occupiedFeatures`)
    const stair = [...scene.cells.values()].find((c) => c.stance === 'upright')!
    const walked = build(new LevelMesher(() => 0), scene)
    const on: Billboard[] = [{ x: stair.x, y: stair.y, tile: 9, kind: 'monster', height: 1, attitude: 'hostile' }]
    const next = seen(20, on)
    build(walked, next)
    expectSameGeometry(walked, fresh(next), 'monster on the stairs')
    build(walked, seen(20))
    expectSameGeometry(walked, fresh(seen(20)), 'monster gone')
  })

  it('rebuilds every chunk when the level changes under it', () => {
    const walked = build(new LevelMesher(() => 0), seen(20))
    // a new lid stands on no cell that carries it: every chunk is built again
    const lit = seen(20)
    lit.level.ceilingTile = 4
    build(walked, lit)
    expectSameGeometry(walked, fresh(lit), 'a new lid')
    const tinted = seen(20)
    tinted.level.tint = { r: 0.5, g: 0.6, b: 0.7 }
    build(walked, tinted)
    expectSameGeometry(walked, fresh(tinted), 'a new tint')
  })

  /**
   * A build the frame ran out of time for leaves the rest to `continue_`, and
   * what that finishes is the very geometry the whole build would have left.
   */
  it('finishes a build cut short by the frame\'s budget', () => {
    const scene = seen(20)
    let clock = 0
    const sliced = new LevelMesher(() => (clock += 10))
    sliced.update(new LevelGrid(scene), ctx, 4)
    expect(sliced.hasPending).toBe(true)
    while (sliced.hasPending) sliced.continue_(4)
    expectSameGeometry(sliced, fresh(scene), 'a build in slices')
  })
})
