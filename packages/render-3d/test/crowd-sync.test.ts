import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { Render3d, type RenderStats } from '../src/index.js'
import { cellKey, emptyScene, makeCamera, type Scene, type TileRect, type TileSource } from '@orbrun/scene'

/**
 * The crowd is synced against the scene, never rebuilt for a change that
 * leaves it standing (`syncBillboards`), and the selected shell follows the
 * cursor on its own (`syncSelection`). These pin what each kind of change
 * touches, by the renderer's own work counters and by the identity of the
 * baked buffers: no timings, so nothing here flakes.
 */
const RECT: TileRect = { atlas: 'main', sx: 4, sy: 8, w: 4, h: 4, ox: 0, oy: 0, cell: 32 }
const tiles: TileSource = {
  tile: () => RECT,
  atlas: () => ({ width: 16, height: 16 }) as unknown as TexImageSource,
  atlasNames: () => ['main'],
}

type Guts = {
  stats: RenderStats
  renderer: unknown
  billboardGroup: THREE.Group
  records: Map<string, unknown>
  selected: THREE.Object3D[]
  atlas(name: string): { mask?: Uint8Array | null }
  syncBillboards(s: Scene): boolean
  bakeStanding(g: THREE.Group, eye: { x: number; y: number }): void
  syncSelection(): void
  fixtures: Map<string, THREE.Object3D>
  levelGroup: THREE.Group
}

/** A renderer whose WebGL is a stub: `render` draws nothing, and the rest of what a frame asks of it is inert. */
function stubbed(): { r: Render3d; g: Guts; draws: number } {
  const r = new Render3d({ viewmodel: false, motion: false })
  const g = r as unknown as Guts
  const state = { draws: 0 }
  let target: unknown = null
  g.renderer = {
    render: () => void state.draws++,
    getDrawingBufferSize: (v: THREE.Vector2) => v.set(64, 32),
    getRenderTarget: () => target,
    setRenderTarget: (t: unknown) => void (target = t),
    clear: () => {},
    clearDepth: () => {},
    autoClear: true,
    dispose: () => {},
    setPixelRatio: () => {},
    setSize: () => {},
  }
  r.setTiles(tiles)
  // a 2x2 body in the middle of the 4x4 tile, so every sprite has a block, a hull and a shell
  const mask = new Uint8Array(16 * 16)
  for (const [x, y] of [[5, 9], [6, 9], [5, 10], [6, 10]]) mask[y * 16 + x] = 1
  g.atlas('main').mask = mask
  return { r, g, get draws() { return state.draws } }
}

/** A 20x20 room, the player at (2, 2), monsters at (5, 5), (6, 5) and far off at (18, 18) in the next chunk, an item at (5, 8). */
function room(): Scene {
  const s = emptyScene()
  s.revision = s.layoutRevision = 1
  s.bounds = { left: 0, top: 0, right: 19, bottom: 19 }
  s.playerOnLevel = true
  s.player = { x: 2, y: 2 }
  for (let y = 0; y < 20; y++)
    for (let x = 0; x < 20; x++) {
      const wall = x === 0 || y === 0 || x === 19 || y === 19
      s.cells.set(cellKey(x, y), { x, y, kind: wall ? 'wall' : 'floor', visibility: 'visible', occluder: wall, floorTile: 0, wallTile: wall ? 1 : undefined, flags: { water: false, lava: false, excluded: false, travelTrail: false, newStair: false, cursor: false, outOfRange: false, magicMapped: false } })
    }
  s.billboards = [
    { x: 5, y: 5, tile: 1, kind: 'monster', height: 1, attitude: 'hostile' },
    { x: 6, y: 5, tile: 1, kind: 'monster', height: 0.8, attitude: 'hostile' },
    { x: 18, y: 18, tile: 1, kind: 'monster', height: 1, attitude: 'hostile' },
    { x: 5, y: 8, tile: 1, kind: 'item', height: 0.6 },
  ]
  return s
}

const snapshot = (g: Guts) => ({ ...g.stats })
const baked = (g: Guts) => g.billboardGroup.children.filter((c) => c.userData.baked) as THREE.Mesh[]
/** Every baked buffer and its upload version: two frames with the same picture leave every version as it was. */
const versions = (g: Guts) => baked(g).map((m) => [m.geometry, ...Object.values(m.geometry.attributes).map((a) => (a as THREE.BufferAttribute).version), m.geometry.index!.version] as const)

function frame(r: Render3d, s: Scene) {
  r.setScene(s)
  r.render()
}

describe('the crowd across scenes', () => {
  it('leaves the crowd standing for a scene revision that carries the same billboards', () => {
    const { r, g } = stubbed()
    const s = room()
    r.setCamera(makeCamera(2, 2))
    frame(r, s)
    expect(g.stats.spriteBuilds).toBe(4)
    expect(g.stats.chunkBakes).toBeGreaterThan(0)
    const before = snapshot(g)
    const was = versions(g)
    s.revision++
    frame(r, s)
    s.revision++
    frame(r, s)
    const after = snapshot(g)
    expect([after.spriteBuilds, after.spriteDrops, after.chunkBakes, after.chunkAllocs, after.bakedVertices]).toEqual([before.spriteBuilds, before.spriteDrops, before.chunkBakes, before.chunkAllocs, before.bakedVertices])
    expect(versions(g)).toEqual(was)
    // the sync itself ran, and the fields were repainted, as every revision asks
    expect(after.crowdSyncs).toBe(before.crowdSyncs + 2)
  })

  it('rebuilds nothing when the player moves and relights the crowd', () => {
    const { r, g } = stubbed()
    const s = room()
    r.setCamera(makeCamera(2, 2))
    frame(r, s)
    const before = snapshot(g)
    const was = versions(g)
    s.player = { x: 3, y: 3 }
    s.revision++
    frame(r, s)
    const after = snapshot(g)
    expect([after.spriteBuilds, after.spriteDrops, after.chunkBakes]).toEqual([before.spriteBuilds, before.spriteDrops, before.chunkBakes])
    expect(versions(g)).toEqual(was)
    // the level stands as it was: a step is not a layout change
    expect(after.levelBuilds).toBe(before.levelBuilds)
    // the light moved with the player: the shade field is what carries it
    expect(after.fieldUpdates).toBe(before.fieldUpdates + 1)
  })

  it('rebuilds the level only when the player steps onto or off a standing feature', () => {
    const { r, g } = stubbed()
    const s = room()
    // a staircase at (4, 2), standing
    const stairs = s.cells.get(cellKey(4, 2))!
    stairs.featureTile = 2
    stairs.stance = 'upright'
    r.setCamera(makeCamera(2, 2))
    frame(r, s)
    const before = snapshot(g)
    // a step beside it: the level stands
    s.player = { x: 3, y: 2 }
    s.revision++
    frame(r, s)
    expect(g.stats.levelBuilds).toBe(before.levelBuilds)
    // a step onto it: the staircase lies down under the camera, which is a new level
    s.player = { x: 4, y: 2 }
    s.revision++
    frame(r, s)
    expect(g.stats.levelBuilds).toBe(before.levelBuilds + 1)
    // and off again: it stands back up
    s.player = { x: 5, y: 2 }
    s.revision++
    frame(r, s)
    expect(g.stats.levelBuilds).toBe(before.levelBuilds + 2)
  })

  it('rebuilds one sprite, and bakes only its chunks, when it moves', () => {
    const { r, g } = stubbed()
    const s = room()
    r.setCamera(makeCamera(2, 2))
    frame(r, s)
    const before = snapshot(g)
    const was = new Map(versions(g).map((v) => [v[0], v.slice(1)]))
    // the far monster steps within its own chunk
    s.billboards[2] = { ...s.billboards[2], x: 17 }
    s.revision++
    frame(r, s)
    const after = snapshot(g)
    expect(after.spriteBuilds).toBe(before.spriteBuilds + 1)
    expect(after.spriteDrops).toBe(before.spriteDrops + 1)
    // its chunk's meshes were written again; the other chunk's were not
    const touched = versions(g).filter((v) => JSON.stringify(was.get(v[0])) !== JSON.stringify(v.slice(1)))
    const untouched = versions(g).filter((v) => JSON.stringify(was.get(v[0])) === JSON.stringify(v.slice(1)))
    expect(touched.length).toBeGreaterThan(0)
    expect(untouched.length).toBeGreaterThan(0)
    for (const v of touched) expect(v[0].userData).toEqual({})
    const touchedChunks = new Set(touched.map((v) => baked(g).find((m) => m.geometry === v[0])!.userData.chunk))
    expect([...touchedChunks]).toEqual(['16,16'])
    // and nothing was allocated: the chunk's buffers had the room
    expect(after.chunkAllocs).toBe(before.chunkAllocs)
  })

  it('writes and uploads only the changed span of a chunk when one sprite of it moves', () => {
    const { r, g } = stubbed()
    const s = room()
    r.setCamera(makeCamera(2, 2))
    frame(r, s)
    const before = snapshot(g)
    // the second monster steps within the near chunk, which the other near monster and the item share
    s.billboards[1] = { ...s.billboards[1], y: 6 }
    s.revision++
    frame(r, s)
    const after = snapshot(g)
    expect(after.spriteBuilds).toBe(before.spriteBuilds + 1)
    expect(after.chunkBakes).toBe(before.chunkBakes + 1)
    // the sprites that stood still were left in place, not written again
    expect(after.keptVertices).toBeGreaterThan(before.keptVertices)
    expect(after.bakedVertices - before.bakedVertices).toBeLessThan(after.keptVertices - before.keptVertices)
    // the ranges handed to the GPU cover the rewritten spans, not the whole buffer
    const crowd = (g as unknown as { billboardCrowd: { chunks: Map<string, { dirty: boolean; batches: Map<string, { mesh: THREE.Mesh; slots: unknown[] }> }> } }).billboardCrowd
    const near = crowd.chunks.get('0,0')!
    let partial = 0
    for (const b of near.batches.values()) {
      const pos = b.mesh.geometry.getAttribute('position') as THREE.BufferAttribute
      const span = pos.updateRanges.reduce((n, u) => n + u.count, 0)
      if (span > 0 && span < b.mesh.geometry.drawRange.count * 3) partial++
    }
    expect(partial).toBeGreaterThan(0)
    // and the buffers hold byte for byte what a full write leaves
    const kept = new Map<THREE.Mesh, { arrays: ArrayLike<number>[]; count: number }>()
    for (const b of near.batches.values()) {
      const geo = b.mesh.geometry
      kept.set(b.mesh, { arrays: [...Object.values(geo.attributes).map((a) => (a as THREE.BufferAttribute).array.slice()), geo.index!.array.slice()], count: geo.drawRange.count })
      b.slots = []
    }
    near.dirty = true
    g.bakeStanding(g.billboardGroup, { x: 2, y: 2 })
    for (const b of near.batches.values()) {
      const geo = b.mesh.geometry
      const was = kept.get(b.mesh)!
      expect(geo.drawRange.count).toBe(was.count)
      const now = [...Object.values(geo.attributes).map((a) => (a as THREE.BufferAttribute).array), geo.index!.array]
      now.forEach((a, i) => expect(Array.from(a as ArrayLike<number>)).toEqual(Array.from(was.arrays[i])))
    }
  })
})

describe('the fixtures across layouts', () => {
  /** The room with a statue at (8, 8) and a fountain at (12, 12), both standing. */
  function furnished(): Scene {
    const s = room()
    for (const [x, y] of [[8, 8], [12, 12]]) {
      const c = s.cells.get(cellKey(x, y))!
      c.featureTile = 3
      c.feature = { type: 'other', name: 'statue' }
      c.stance = 'upright'
    }
    return s
  }

  it('leaves a fixture standing through a layout rebuild, and takes it down when the level no longer has it', () => {
    const { r, g } = stubbed()
    const s = furnished()
    r.setCamera(makeCamera(2, 2))
    frame(r, s)
    expect(g.fixtures.size).toBe(2)
    const stood = new Map(g.fixtures)
    const before = snapshot(g)
    // a wall becomes floor: the level's meshes are built again
    s.cells.get(cellKey(19, 10))!.kind = 'floor'
    s.revision++
    s.layoutRevision = s.revision
    frame(r, s)
    const after = snapshot(g)
    expect(after.levelBuilds).toBe(before.levelBuilds + 1)
    // the same holders stand, nothing of theirs was written or allocated again
    expect([...g.fixtures.entries()]).toEqual([...stood.entries()])
    expect(after.chunkAllocs).toBe(before.chunkAllocs)
    expect(after.bakedVertices).toBe(before.bakedVertices)
    expect(after.keptVertices).toBeGreaterThan(before.keptVertices)
    // the statue goes: its holder comes down, the fountain's stays
    const statue = s.cells.get(cellKey(8, 8))!
    statue.featureTile = undefined
    statue.feature = undefined
    statue.stance = undefined
    s.revision++
    s.layoutRevision = s.revision
    frame(r, s)
    expect(g.fixtures.size).toBe(1)
    const [key, holder] = [...g.fixtures][0]
    expect(key.startsWith('12,12|')).toBe(true)
    expect(stood.get(key)).toBe(holder)
    // and new tiles bring every fixture down, to be built from them
    r.setTiles(tiles)
    expect(g.fixtures.size).toBe(0)
    frame(r, s)
    expect(g.fixtures.size).toBe(1)
    expect(g.fixtures.get(key)).not.toBe(holder)
  })
})

describe('the cursor and the crowd', () => {
  it('moves between empty cells without touching the crowd', () => {
    const { r, g } = stubbed()
    const s = room()
    r.setCamera(makeCamera(2, 2))
    frame(r, s)
    const before = snapshot(g)
    const was = versions(g)
    for (let i = 0; i < 6; i++) {
      r.setCursor({ x: 10 + (i % 2), y: 3, mode: 'examine' })
      r.render()
    }
    r.setCursor(null)
    r.render()
    const after = snapshot(g)
    expect([after.spriteBuilds, after.spriteDrops, after.chunkBakes, after.crowdSyncs, after.selectionBuilds]).toEqual([before.spriteBuilds, before.spriteDrops, before.chunkBakes, before.crowdSyncs, 0])
    expect(versions(g)).toEqual(was)
    expect(g.selected).toHaveLength(0)
  })

  it('puts the shell up and takes it down beside the crowd, which stands as it was', () => {
    const { r, g } = stubbed()
    const s = room()
    r.setCamera(makeCamera(2, 2))
    frame(r, s)
    const before = snapshot(g)
    const was = versions(g)
    r.setCursor({ x: 5, y: 5, mode: 'target' })
    r.render()
    expect(g.selected).toHaveLength(1)
    expect(g.selected[0].position.toArray()).toEqual([5.5, 0, 5.5])
    expect(g.selected[0].children.every((c) => c.userData.shell)).toBe(true)
    expect(g.stats.selectionBuilds).toBe(1)
    // onto the next sprite, then off both
    r.setCursor({ x: 6, y: 5, mode: 'target' })
    r.render()
    expect(g.selected).toHaveLength(1)
    expect(g.selected[0].position.toArray()).toEqual([6.5, 0, 5.5])
    r.setCursor({ x: 7, y: 5, mode: 'target' })
    r.render()
    expect(g.selected).toHaveLength(0)
    const after = snapshot(g)
    expect([after.spriteBuilds, after.spriteDrops, after.chunkBakes, after.crowdSyncs]).toEqual([before.spriteBuilds, before.spriteDrops, before.chunkBakes, before.crowdSyncs])
    expect(versions(g)).toEqual(was)
    // the shell is turned to the eye with the holders, as the crowd is in its shader
    r.setCursor({ x: 5, y: 5, mode: 'target' })
    r.setCamera({ ...makeCamera(2, 2), yaw: 1.2 })
    r.render()
    expect(g.selected[0].rotation.y).toBeCloseTo(-1.2)
  })

  it('follows the selected sprite as it moves, and comes down with it', () => {
    const { r, g } = stubbed()
    const s = room()
    r.setCamera(makeCamera(2, 2))
    r.setCursor({ x: 5, y: 5, mode: 'target' })
    frame(r, s)
    expect(g.selected).toHaveLength(1)
    // the monster steps off the cursor's cell
    s.billboards[0] = { ...s.billboards[0], x: 4 }
    s.revision++
    frame(r, s)
    expect(g.selected).toHaveLength(0)
    // and the cursor follows it
    r.setCursor({ x: 4, y: 5, mode: 'target' })
    r.render()
    expect(g.selected).toHaveLength(1)
    expect(g.selected[0].position.toArray()).toEqual([4.5, 0, 5.5])
    // the monster dies: the shell goes with it
    s.billboards.splice(0, 1)
    s.revision++
    frame(r, s)
    expect(g.selected).toHaveLength(0)
    expect(g.records.size).toBe(3)
  })

  it('shells every sprite standing on the cell', () => {
    const { r, g } = stubbed()
    const s = room()
    s.billboards.push({ x: 5, y: 5, tile: 1, kind: 'projectile', height: 0.5 })
    r.setCamera(makeCamera(2, 2))
    r.setCursor({ x: 5, y: 5, mode: 'target' })
    frame(r, s)
    expect(g.selected).toHaveLength(2)
    expect(g.selected.map((h) => h.position.y).sort()).toEqual([0, 0.1])
  })

  it('leaves a translucent sprite, a cloud and a ghost without a shell', () => {
    const { r, g } = stubbed()
    const s = room()
    s.billboards = [
      { x: 5, y: 5, tile: 1, kind: 'monster', height: 1, attitude: 'hostile', alpha: 0.5 },
      { x: 5, y: 5, tile: 1, kind: 'cloud', height: 0.9 },
    ]
    r.setCamera(makeCamera(2, 2))
    r.setCursor({ x: 5, y: 5, mode: 'target' })
    frame(r, s)
    expect(g.selected).toHaveLength(0)
  })

  it('drops the selection and the crowd with the tiles, the map and the renderer', () => {
    const { r, g } = stubbed()
    const s = room()
    r.setCamera(makeCamera(2, 2))
    r.setCursor({ x: 5, y: 5, mode: 'target' })
    frame(r, s)
    expect(g.selected).toHaveLength(1)
    expect(g.records.size).toBe(4)
    // a new tileset: everything standing was built from the old atlases
    r.setTiles(tiles)
    expect(g.records.size).toBe(0)
    expect(g.billboardGroup.children).toHaveLength(0)
    g.atlas('main').mask = new Uint8Array(16 * 16).fill(1)
    s.revision++
    frame(r, s)
    expect(g.records.size).toBe(4)
    expect(g.selected).toHaveLength(1)
    // the map is cleared: an empty scene stands nothing
    const empty = emptyScene()
    empty.revision = s.revision + 1
    frame(r, empty)
    expect(g.records.size).toBe(0)
    expect(g.selected).toHaveLength(0)
    expect(baked(g)).toHaveLength(0)
    // and destroy leaves nothing, twice over
    frame(r, { ...s, revision: empty.revision + 1 })
    expect(g.records.size).toBe(4)
    r.destroy()
    expect(g.records.size).toBe(0)
    expect(g.selected).toHaveLength(0)
    expect(g.billboardGroup.children).toHaveLength(0)
    r.destroy()
  })
})
