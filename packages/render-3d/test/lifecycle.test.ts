import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { Render3d, type RenderStats } from '../src/index.js'
import { cellKey, emptyScene, makeCamera, type Scene, type TileRect, type TileSource } from '@orbrun/scene'

/**
 * Resource ownership: what the renderer makes, the renderer releases —
 * explicitly, on `destroy`, on a new tileset, and as sprites come and go —
 * and what it holds across a run of transitions stays bounded. Counted by
 * three.js's own `dispose` events on every geometry, material and texture
 * the scene graph and the fields reference, not by timings.
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
  three: THREE.Scene
  billboardGroup: THREE.Group
  levelGroup: THREE.Group
  records: Map<string, unknown>
  shadeTex: THREE.Texture | null
  flashTex: THREE.Texture | null
  depthTarget: THREE.WebGLRenderTarget | null
  atlases: Map<string, unknown>
  atlas(name: string): { mask?: Uint8Array | null }
  billboardCrowd: { meshes(): THREE.Mesh[] }
}

function stubbed(): { r: Render3d; g: Guts } {
  const r = new Render3d({ viewmodel: false, motion: false })
  const g = r as unknown as Guts
  let target: unknown = null
  g.renderer = {
    render: () => {},
    getDrawingBufferSize: (v: THREE.Vector2) => v.set(64, 32),
    getRenderTarget: () => target,
    setRenderTarget: (t: unknown) => void (target = t),
    clear: () => {},
    clearDepth: () => {},
    autoClear: true,
    dispose: () => {},
  }
  r.setTiles(tiles)
  const mask = new Uint8Array(16 * 16)
  for (const [x, y] of [[5, 9], [6, 9], [5, 10], [6, 10]]) mask[y * 16 + x] = 1
  g.atlas('main').mask = mask
  return { r, g }
}

/** A 12x12 room with `n` monsters spread through it, one at (9, 9) behind a pillar for a ghost. */
function room(n: number, seed = 0): Scene {
  const s = emptyScene()
  s.revision = s.layoutRevision = 1
  s.bounds = { left: 0, top: 0, right: 11, bottom: 11 }
  s.playerOnLevel = true
  s.player = { x: 2, y: 2 }
  for (let y = 0; y < 12; y++)
    for (let x = 0; x < 12; x++) {
      const wall = x === 0 || y === 0 || x === 11 || y === 11 || (x === 8 && y === 9)
      s.cells.set(cellKey(x, y), { x, y, kind: wall ? 'wall' : 'floor', visibility: 'visible', occluder: wall, floorTile: 0, wallTile: wall ? 1 : undefined, flags: { water: false, lava: false, excluded: false, travelTrail: false, newStair: false, cursor: false, outOfRange: false, magicMapped: false } })
    }
  for (let i = 0; i < n; i++) {
    const x = 1 + ((i * 7 + seed) % 10), y = 1 + ((i * 3 + seed) % 10)
    if (x === 2 && y === 2) continue
    s.billboards.push({ x, y, tile: 1, kind: i % 3 ? 'monster' : 'item', height: 0.8, attitude: 'hostile' })
  }
  return s
}

/** Every geometry, material and texture the given groups (the whole scene by default) and the fields reference right now, with dispose listeners on. */
function track(g: Guts, roots: THREE.Object3D[] = [g.three]) {
  const geometry = new Set<THREE.BufferGeometry>()
  const material = new Set<THREE.Material>()
  const texture = new Set<THREE.Texture>()
  for (const root of roots) root.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.geometry) geometry.add(m.geometry)
    if (m.material) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      material.add(mat)
      const map = (mat as THREE.MeshBasicMaterial).map
      if (map) texture.add(map)
    }
  })
  for (const t of [g.shadeTex, g.flashTex]) if (t) texture.add(t)
  // counted per object: a material shared by two paths may hear `dispose` twice, and that is not a leak
  const gone = { geometry: new Set<unknown>(), material: new Set<unknown>(), texture: new Set<unknown>() }
  for (const x of geometry) x.addEventListener('dispose', () => gone.geometry.add(x))
  for (const x of material) x.addEventListener('dispose', () => gone.material.add(x))
  for (const x of texture) x.addEventListener('dispose', () => gone.texture.add(x))
  return {
    tracked: { geometry: geometry.size, material: material.size, texture: texture.size },
    get disposed() {
      return { geometry: gone.geometry.size, material: gone.material.size, texture: gone.texture.size }
    },
  }
}

describe('resource ownership', () => {
  it('disposes every geometry, material and texture it made on destroy, and survives a second destroy', () => {
    const { r, g } = stubbed()
    r.setCamera(makeCamera(2, 2))
    r.setScene(room(12))
    r.setCursor({ x: 8, y: 4, mode: 'target' })
    r.render()
    const t = track(g)
    expect(t.tracked.geometry).toBeGreaterThan(3)
    expect(t.tracked.texture).toBe(3) // the atlas, the shade and flash fields
    r.destroy()
    expect(t.disposed.geometry).toBe(t.tracked.geometry)
    expect(t.disposed.material).toBe(t.tracked.material)
    expect(t.disposed.texture).toBe(t.tracked.texture)
    expect(g.records.size).toBe(0)
    expect(g.atlases.size).toBe(0)
    expect(g.shadeTex).toBeNull()
    expect(g.flashTex).toBeNull()
    expect(g.depthTarget).toBeNull()
    // the level and the crowd are empty; the overlay keeps the cursor's meshes, whose geometry is gone
    expect(g.levelGroup.children).toHaveLength(0)
    expect(g.billboardGroup.children).toHaveLength(0)
    r.destroy()
  })

  it('releases the old atlas, its materials and every sprite on a new tileset', () => {
    const { r, g } = stubbed()
    r.setCamera(makeCamera(2, 2))
    r.setScene(room(12))
    r.render()
    // the level and the crowd: the cursor's own meshes in the overlay are the renderer's for life, not the atlas's
    const t = track(g, [g.levelGroup, g.billboardGroup])
    const geometries = t.tracked.geometry
    r.setTiles(tiles)
    // the atlas texture and its materials, the level and the crowd; the fields stay (they are the level's size, not the atlas's)
    expect(t.disposed.texture).toBe(1)
    expect(t.disposed.material).toBeGreaterThan(0)
    expect(t.disposed.geometry).toBeGreaterThan(0)
    expect(g.records.size).toBe(0)
    expect(g.billboardCrowd.meshes()).toHaveLength(0)
    // level geometry is rebuilt on the next frame, and only then
    expect(t.disposed.geometry).toBeLessThan(geometries)
    g.atlas('main').mask = new Uint8Array(16 * 16).fill(1)
    r.render()
    expect(t.disposed.geometry).toBe(geometries)
  })

  it('releases a sprite\'s geometry and its own material as it leaves, and holds a bounded crowd across churn', () => {
    const { r, g } = stubbed()
    r.setCamera(makeCamera(2, 2))
    const first = room(12)
    first.billboards.push({ x: 5, y: 5, tile: 1, kind: 'monster', height: 1, attitude: 'hostile', alpha: 0.5 })
    r.setScene(first)
    r.render()
    const own = g.billboardGroup.children.filter((c) => !(c as THREE.Mesh).isMesh).flatMap((h) => h.children).filter((c) => c.userData.ownMaterial) as THREE.Mesh[]
    expect(own.length).toBeGreaterThan(0)
    let disposedOwn = 0
    for (const m of own) (m.material as THREE.Material).addEventListener('dispose', () => disposedOwn++)
    // a run of turns: monsters shuffle every frame, the translucent one leaves
    let meshesAfter = 0
    for (let i = 1; i <= 30; i++) {
      const s = room(12, i)
      s.revision = i + 1
      r.setScene(s)
      r.render()
      meshesAfter = g.billboardCrowd.meshes().length
    }
    expect(disposedOwn).toBe(own.length)
    // the crowd stays the size of one room's worth of chunks and batches, not thirty
    expect(meshesAfter).toBeLessThan(16)
    expect(g.records.size).toBeLessThanOrEqual(12)
    expect(g.stats.spriteDrops).toBeGreaterThan(0)
    // and a chunk that outgrew its buffers replaced them once, not on every frame
    expect(g.stats.chunkAllocs).toBeLessThan(g.stats.chunkBakes)
  })

  it('plateaus across repeated map transitions: the same scene handed back builds nothing', () => {
    const { r, g } = stubbed()
    r.setCamera(makeCamera(2, 2))
    const s = room(12)
    r.setScene(s)
    r.render()
    const meshes = g.billboardCrowd.meshes().length
    const built = g.stats.spriteBuilds
    for (let i = 0; i < 10; i++) {
      s.revision++
      r.setScene(s)
      r.render()
    }
    expect(g.billboardCrowd.meshes().length).toBe(meshes)
    expect(g.stats.spriteBuilds).toBe(built)
    expect(g.stats.chunkAllocs).toBeLessThanOrEqual(meshes)
  })
})
