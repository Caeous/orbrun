import * as THREE from 'three'
import { Render3d, type Render3dOptions, type RenderStats } from '../src/index.js'
import type { LevelGrid } from '../src/grid.js'
import type { LevelMesher } from '../src/level-mesh.js'
import type { SpriteInstance, SpritePass } from '../src/sprites.js'
import type { Scene, TileSource } from '@orbrun/scene'

/**
 * The bed the renderer's own tests stand on: a Render3d whose WebGL is a
 * stub, and the reads its insides are pinned through.
 *
 * The renderer draws standing things as instances (sprites.ts), so what a
 * test looks at is either the instance list it worked out or the instance
 * buffers it wrote — the very floats the GPU is handed. The level is the
 * mesher's typed arrays (level-mesh.ts). Nothing here touches GL.
 */

/** One instance as it stands in a batch's buffers, in `SPRITE_ATTRS` order. */
export interface WrittenInstance {
  anchor: number[]
  quad: number[]
  z: number[]
  texel: number[]
  color: number[]
  misc: number[]
  cell: number[]
}

/** An instanced draw: `Batch` in index.ts, as much of it as a test reads. */
export interface BatchGuts {
  geometry: THREE.InstancedBufferGeometry
  mesh: THREE.Mesh
  readonly size: number
}

/** An atlas entry: index.ts `AtlasEntry`, as much of it as a test reads. */
export interface AtlasGuts {
  name: string
  texture: THREE.Texture
  dist: THREE.DataTexture | null
  peeled: boolean | 'failed'
  uniforms: Record<string, THREE.IUniform>
  level: THREE.RawShaderMaterial
  decal: THREE.RawShaderMaterial
  sprite: Record<SpritePass, THREE.RawShaderMaterial>
}

/** The renderer's insides the tests read. */
export interface Guts {
  stats: RenderStats
  renderer: unknown
  three: THREE.Scene
  cam: THREE.PerspectiveCamera
  mesher: LevelMesher
  grid: LevelGrid | null
  levelMeshes: Map<number, THREE.Mesh[]>
  batches: Map<string, BatchGuts>
  shadowBatch: BatchGuts
  crowd: SpriteInstance[]
  fixtures: SpriteInstance[]
  shadows: { x: number; y: number; r: number; moverId?: number }[]
  ghostCount: number
  atlases: Map<string, AtlasGuts>
  atlas(name: string): AtlasGuts | null
  shadeTex: THREE.DataTexture | null
  flashTex: THREE.DataTexture | null
  fieldUniforms: {
    shadeMap: { value: THREE.Texture | null }
    flashMap: { value: THREE.Texture | null }
    fieldOrigin: { value: THREE.Vector2 }
    fieldSize: { value: THREE.Vector2 }
  }
  rebuildLevel(scene: Scene, grid: LevelGrid): void
  updateFields(scene: Scene): void
  writeInstances(eye: { x: number; y: number }, now: number): void
}

/** How many times the stub was asked to draw: the depth pass, the frame, the blit, the hands. */
export interface Bed {
  r: Render3d
  g: Guts
  readonly draws: number
}

/** A renderer whose WebGL is a stub: `render` draws nothing, and the rest of what a frame asks of it is inert. */
export function stubbed(opts: Render3dOptions = {}, tiles?: TileSource): Bed {
  const r = new Render3d({ viewmodel: false, motion: false, ...opts })
  const g = r as unknown as Guts
  const state = { draws: 0 }
  let target: unknown = null
  g.renderer = {
    render: () => void state.draws++,
    getDrawingBufferSize: (v: THREE.Vector2) => v.set(64, 32),
    getRenderTarget: () => target,
    setRenderTarget: (t: unknown) => void (target = t),
    setClearColor: () => {},
    clear: () => {},
    clearDepth: () => {},
    autoClear: true,
    dispose: () => {},
    setPixelRatio: () => {},
    setSize: () => {},
    compileAsync: async () => {},
  }
  if (tiles) {
    r.setTiles(tiles)
    peel(g)
  }
  return { r, g, get draws() { return state.draws } }
}

/**
 * Stand in for the peel: node has no canvas to read an atlas back through,
 * so nothing would ever be written. The distance field stays empty, which
 * only the shader reads.
 */
export function peel(g: Guts, ...names: string[]): void {
  for (const name of names.length ? names : ['main']) {
    const a = g.atlas(name)
    if (a) a.peeled = true
  }
}

/**
 * Draw frames until the level is whole: a build is sliced across frames to a
 * budget (`LEVEL_BUDGET_MS`), so a test that counts chunk builds has to let
 * the first one finish before it starts counting.
 */
export function settle({ r, g }: Bed, now?: number): void {
  for (let i = 0; i < 64 && g.mesher.hasPending; i++) r.render(now)
}

/** Every instance a batch holds, read back out of its buffers. */
export function written(g: Guts, atlas: string, pass: SpritePass): WrittenInstance[] {
  const b = g.batches.get(`${atlas}|${pass}`)
  if (!b) return []
  const read = (name: string, i: number) => {
    const a = b.geometry.getAttribute(name) as THREE.InstancedBufferAttribute
    return Array.from(a.array.slice(i * a.itemSize, (i + 1) * a.itemSize))
  }
  const out: WrittenInstance[] = []
  for (let i = 0; i < b.geometry.instanceCount; i++)
    out.push({ anchor: read('iAnchor', i), quad: read('iQuad', i), z: read('iZ', i), texel: read('iTexel', i), color: read('iColor', i), misc: read('iMisc', i), cell: read('iCell', i) })
  return out
}

/** The shadow discs written this frame, as [x, z, radius]. */
export function shadowsWritten(g: Guts): number[][] {
  const b = g.shadowBatch
  const anchor = b.geometry.getAttribute('iAnchor') as THREE.InstancedBufferAttribute
  const scale = b.geometry.getAttribute('iScale') as THREE.InstancedBufferAttribute
  const out: number[][] = []
  for (let i = 0; i < b.geometry.instanceCount; i++) out.push([anchor.getX(i), anchor.getZ(i), scale.getX(i)])
  return out
}
