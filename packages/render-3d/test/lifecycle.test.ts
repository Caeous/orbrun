import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { settle, stubbed, type Guts } from './bed.js'
import { cellKey, emptyScene, makeCamera, type Scene, type TileRect, type TileSource } from '@orbrun/scene'

/**
 * Resource ownership: what the renderer makes, the renderer releases —
 * explicitly, on `destroy` and on a new tileset — and what it holds across a
 * run of transitions stays bounded. The crowd is instanced now, so a monster
 * coming or going allocates nothing of its own: what has to stay bounded is
 * the batches, the level's chunk meshes and the instance buffers behind them.
 * Counted by three.js's own `dispose` events, not by timings.
 */
const RECT: TileRect = { atlas: 'main', sx: 4, sy: 8, w: 4, h: 4, ox: 0, oy: 0, cell: 32 }
const tiles: TileSource = {
  tile: () => RECT,
  atlas: () => ({ width: 16, height: 16 }) as unknown as TexImageSource,
  atlasNames: () => ['main'],
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
      s.cells.set(cellKey(x, y), { x, y, kind: wall ? 'wall' : 'floor', visibility: 'visible', occluder: wall, floorTile: 0, wallTile: wall ? 1 : undefined })
    }
  for (let i = 0; i < n; i++) {
    const x = 1 + ((i * 7 + seed) % 10), y = 1 + ((i * 3 + seed) % 10)
    if (x === 2 && y === 2) continue
    s.billboards.push({ x, y, tile: 1, kind: i % 3 ? 'monster' : 'item', height: 0.8, attitude: 'hostile' })
  }
  return s
}

/**
 * Every geometry, material and texture the scene graph, the atlases and the
 * fields reference right now, with dispose listeners on. The renderer's
 * shaders are raw, so a material's textures hang off its uniforms.
 */
function track(g: Guts, roots: THREE.Object3D[] = [g.three]) {
  const geometry = new Set<THREE.BufferGeometry>()
  const material = new Set<THREE.Material>()
  const texture = new Set<THREE.Texture>()
  const wear = (mat: THREE.Material) => {
    material.add(mat)
    // the frame's own depth image belongs to the render target, which is disposed with it, not to the material that samples it
    for (const u of Object.values((mat as THREE.RawShaderMaterial).uniforms ?? {}))
      if ((u.value as THREE.Texture)?.isTexture && !(u.value as THREE.DepthTexture).isDepthTexture) texture.add(u.value as THREE.Texture)
  }
  for (const root of roots) root.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.geometry) geometry.add(m.geometry)
    if (m.material) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) wear(mat)
  })
  for (const a of g.atlases.values()) {
    texture.add(a.texture)
    for (const mat of [a.level, a.decal, ...Object.values(a.sprite)]) wear(mat)
  }
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
    const bed = stubbed({}, tiles)
    const { r, g } = bed
    r.setCamera(makeCamera(2, 2))
    r.setScene(room(12))
    r.setCursor({ x: 8, y: 4, mode: 'target' })
    r.render()
    settle(bed)
    const t = track(g)
    expect(t.tracked.geometry).toBeGreaterThan(3)
    expect(t.tracked.texture).toBe(3) // the atlas, the shade and flash fields
    r.destroy()
    expect(t.disposed.geometry).toBe(t.tracked.geometry)
    expect(t.disposed.material).toBe(t.tracked.material)
    expect(t.disposed.texture).toBe(t.tracked.texture)
    expect(g.atlases.size).toBe(0)
    expect(g.batches.size).toBe(0)
    expect(g.levelMeshes.size).toBe(0)
    expect(g.shadeTex).toBeNull()
    expect(g.flashTex).toBeNull()
    expect(g.depthTarget).toBeNull()
    r.destroy()
  })

  it('releases the old atlas, its materials and every batch on a new tileset', () => {
    const bed = stubbed({}, tiles)
    const { r, g } = bed
    r.setCamera(makeCamera(2, 2))
    r.setScene(room(12))
    r.render()
    settle(bed)
    const t = track(g)
    const geometries = t.tracked.geometry
    r.setTiles(tiles)
    // the atlas texture and its materials, the batches and the level's chunks; the fields stay (they are the level's size, not the atlas's)
    expect(t.disposed.texture).toBe(1)
    expect(t.disposed.material).toBeGreaterThan(0)
    expect(t.disposed.geometry).toBeGreaterThan(0)
    expect(t.disposed.geometry).toBeLessThan(geometries)
    expect(g.batches.size).toBe(0)
    expect(g.levelMeshes.size).toBe(0)
    expect(g.shadeTex).not.toBeNull()
    // and the next frame builds from the new atlas
    g.atlas('main')!.peeled = true
    r.render()
    expect(g.batches.size).toBeGreaterThan(0)
    r.destroy()
  })

  it('holds a bounded crowd across churn: the batches are the passes, not the monsters', () => {
    const bed = stubbed({}, tiles)
    const { r, g } = bed
    r.setCamera(makeCamera(2, 2))
    const first = room(12)
    first.billboards.push({ x: 5, y: 5, tile: 1, kind: 'monster', height: 1, attitude: 'hostile', alpha: 0.5 })
    r.setScene(first)
    r.render()
    settle(bed)
    const batches = g.batches.size
    const meshes = g.levelMeshes.size
    let made = 0
    for (const b of g.batches.values()) b.geometry.addEventListener('dispose', () => made++)
    // a run of turns: monsters shuffle every frame, the translucent one leaves
    for (let i = 1; i <= 30; i++) {
      const s = room(12, i)
      s.revision = i + 1
      r.setScene(s)
      r.render()
    }
    // one batch per atlas and pass, whatever the crowd, and never rebuilt: they grow in place
    expect(g.batches.size).toBe(batches)
    expect(g.batches.size).toBeLessThanOrEqual(5)
    expect(made).toBe(0)
    expect(g.levelMeshes.size).toBe(meshes)
    expect(g.stats.spriteWrites).toBeGreaterThan(0)
    r.destroy()
  })

  it('plateaus across repeated map transitions: the same scene handed back builds nothing', () => {
    const bed = stubbed({}, tiles)
    const { r, g } = bed
    r.setCamera(makeCamera(2, 2))
    const s = room(12)
    r.setScene(s)
    r.render()
    settle(bed)
    const meshes = g.levelMeshes.size
    const built = g.stats.levelChunkBuilds
    const fixtures = g.stats.fixtureBuilds
    for (let i = 0; i < 10; i++) {
      s.revision++
      r.setScene(s)
      r.render()
    }
    expect(g.levelMeshes.size).toBe(meshes)
    expect(g.stats.levelChunkBuilds).toBe(built)
    expect(g.stats.fixtureBuilds).toBe(fixtures)
    r.destroy()
  })
})
