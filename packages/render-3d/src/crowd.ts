import * as THREE from 'three'

/**
 * The baked crowd (rendering-3d.md's "merge billboards" lever, `Render3d.bakeStanding`).
 *
 * A standing sprite is built as a holder of meshes — body, hull, ghost, ring,
 * shadow — in its own frame, and three.js would pay for every one twice a
 * frame (the depth pass and the frame): a matrix, a cull, a sort slot and a
 * draw call. The crowd merges them into a few meshes per chunk of the level.
 *
 * Each mesh's vertices go in as they are, in the sprite's own frame (the
 * holder's yaw left out), with the holder's place as an `anchor` attribute;
 * the merged materials turn every sprite to the eye about its anchor in the
 * vertex shader (`STAND_VERT`), exactly as `render` turns the holders, so
 * nothing in how a sprite is built, lit or inked changes and the holders stay
 * what the builders and their tests see.
 *
 * Unlike a single merged mesh, the crowd is kept in chunks of CHUNK×CHUNK
 * cells, each with its own meshes:
 *
 * - A holder that changes touches only its chunk; the other chunks' buffers
 *   are neither rebuilt nor uploaded again.
 * - A chunk's buffers are kept and written in place as long as they have the
 *   room, so a re-bake allocates nothing and uploads only what it wrote.
 * - Every chunk mesh stands at the origin with absolute anchors, exactly as
 *   the one merged mesh did (so every vertex lands on the very same
 *   floating-point place), and carries a bounding sphere, in world units,
 *   that covers every place a sprite of the chunk can reach turned to any
 *   yaw; three.js then culls the chunks the frustum cannot see. The blended
 *   batches (ghosts, shadows, sprites) are ordered back to front by chunk
 *   each frame (`order`), the way the holders were sorted for one mesh.
 *
 * Holders are taken back to front from the eye within a chunk, so the blended
 * sprites and ghosts within a mesh draw in the order three.js sorted them
 * into as objects.
 */

/** Chunk side, in cells. */
export const CHUNK = 16
/**
 * How far from its anchor any vertex of a standing sprite can stand, in
 * cells, across the ground: half a tile at full height, a status badge's
 * shift, a doll part's offset and the selected shell's growth all fit in
 * a cell, so this covers them turned to any yaw.
 */
const SPRITE_REACH = 1.25
/** The highest and lowest any vertex of a standing sprite stands, in cells: a full-height tile lifted as a projectile is, and the shadow disc on the floor. */
const SPRITE_TOP = 1.5
const SPRITE_BOTTOM = -0.25
/** Room a chunk's buffers are given past what a bake needs, so a sprite or two arriving later fits without a new buffer. */
const HEADROOM = 1.25
/** Indices are 16-bit while the buffer's vertices fit. */
const WIDE_INDEX = 65535

/** Work counters the test bed and the regression tests read; rendering never does. */
export interface CrowdStats {
  /** Chunks baked (their buffers written and uploaded). */
  chunkBakes: number
  /** Chunk buffers allocated: a first bake, or one that outgrew its room. */
  chunkAllocs: number
  /** Vertices written into chunk buffers. */
  bakedVertices: number
}

interface Batch {
  mesh: THREE.Mesh
  /** The draw order the batch's parts asked for; `order` nudges the mesh's from it. */
  renderOrder: number
  /** Attribute names and item sizes this batch carries, from its first part; `anchor` is added. */
  names: string[]
  sizes: Record<string, number>
  /** Vertices and indices the buffers have room for. */
  capacity: number
  indexCapacity: number
}

interface Chunk {
  cx: number
  cz: number
  /** The chunk's middle, in cells: what the blended batches are ordered by. */
  centre: THREE.Vector3
  /** The sphere the chunk's meshes wear this bake, in world units: round the holders standing, out to any sprite's reach. */
  sphere: THREE.Sphere
  holders: Set<THREE.Object3D>
  dirty: boolean
  /** One mesh per material, draw order and layer, keyed so; kept across bakes. */
  batches: Map<string, Batch>
}

interface Part {
  mesh: THREE.Mesh
  anchor: THREE.Vector3
}

interface Gathered {
  material: THREE.Material
  renderOrder: number
  layers: number
  parts: Part[]
  verts: number
  indices: number
}

export class Crowd {
  private chunks = new Map<string, Chunk>()
  private v = new THREE.Vector3()
  constructor(
    private group: THREE.Group,
    /** The `MERGED` twin of a holder mesh's material, or undefined where it has none (then the holder cannot be baked). */
    private twin: (m: THREE.Material) => THREE.Material | undefined,
    private stats: CrowdStats,
  ) {}

  /**
   * The sphere a chunk's meshes wear, in the mesh's own frame: round the
   * cells its holders stand on, out to the furthest any of their vertices can
   * reach turned to any yaw, from the floor to the tallest sprite. Never
   * smaller than the crowd's reach, so an empty chunk still has a sphere.
   */
  private fit(c: Chunk): void {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
    for (const h of c.holders) {
      x0 = Math.min(x0, h.position.x)
      x1 = Math.max(x1, h.position.x)
      z0 = Math.min(z0, h.position.z)
      z1 = Math.max(z1, h.position.z)
    }
    if (x0 > x1) x0 = x1 = c.centre.x, z0 = z1 = c.centre.z
    const half = Math.hypot(x1 - x0, z1 - z0) / 2 + SPRITE_REACH
    c.sphere.center.set((x0 + x1) / 2, (SPRITE_TOP + SPRITE_BOTTOM) / 2, (z0 + z1) / 2)
    c.sphere.radius = Math.hypot(half, (SPRITE_TOP - SPRITE_BOTTOM) / 2)
    for (const b of c.batches.values()) b.mesh.geometry.boundingSphere!.copy(c.sphere)
  }

  /** Whether a holder can be baked: every child a mesh with an index, wearing a material that has a merged twin and is not its own. */
  mergeable(h: THREE.Object3D): boolean {
    if (!h.children.length) return false
    for (const c of h.children) {
      const m = c as THREE.Mesh
      if (!m.geometry || !m.geometry.index || m.userData.ownMaterial || !this.twin(m.material as THREE.Material)) return false
    }
    return true
  }

  /** Put a holder standing on cell (x, y) in the crowd; its chunk is baked on the next `bake`. */
  add(h: THREE.Object3D, x: number, y: number): void {
    const cx = Math.floor(x / CHUNK) * CHUNK
    const cz = Math.floor(y / CHUNK) * CHUNK
    const key = `${cx},${cz}`
    let c = this.chunks.get(key)
    if (!c) this.chunks.set(key, (c = { cx, cz, centre: new THREE.Vector3(cx + CHUNK / 2, 0, cz + CHUNK / 2), sphere: new THREE.Sphere(), holders: new Set(), dirty: true, batches: new Map() }))
    c.holders.add(h)
    c.dirty = true
    h.userData.chunk = key
  }

  /** Take a holder out of the crowd; its chunk is baked again on the next `bake`. */
  remove(h: THREE.Object3D): void {
    const key = h.userData.chunk as string | undefined
    if (key === undefined) return
    delete h.userData.chunk
    const c = this.chunks.get(key)
    if (!c) return
    c.holders.delete(h)
    c.dirty = true
  }

  /** Whether anything waits to be baked. */
  get dirty(): boolean {
    for (const c of this.chunks.values()) if (c.dirty) return true
    return false
  }

  /** Bake every chunk that changed since the last bake, its holders taken back to front from `eye`. */
  bake(eye: { x: number; y: number }): void {
    for (const [key, c] of this.chunks) {
      if (!c.dirty) continue
      this.bakeChunk(c, eye)
      if (!c.holders.size && !c.batches.size) this.chunks.delete(key)
    }
  }

  /**
   * Order the blended batches back to front by their chunk's distance from
   * `eye`, within the draw order each asked for: a nudge under a thousandth
   * per cell, far smaller than the step between orders, so ghosts stay under
   * shadows and shadows under sprites, and among the ghosts the far chunk
   * draws first. Opaque batches keep their order as asked: three.js groups
   * those by material, and a nudge would only break that grouping.
   */
  order(eye: { x: number; y: number }): void {
    for (const c of this.chunks.values()) {
      const d = Math.hypot(c.centre.x - eye.x - 0.5, c.centre.z - eye.y - 0.5)
      const nudge = -Math.min(0.5, d * 1e-3)
      for (const b of c.batches.values()) if ((b.mesh.material as THREE.Material).transparent) b.mesh.renderOrder = b.renderOrder + nudge
    }
  }

  /** Every mesh the crowd has baked. */
  meshes(): THREE.Mesh[] {
    const out: THREE.Mesh[] = []
    for (const c of this.chunks.values()) for (const b of c.batches.values()) out.push(b.mesh)
    return out
  }

  /** Release every mesh and buffer; the holders are their owners' to dispose. */
  clear(): void {
    for (const c of this.chunks.values()) {
      for (const b of c.batches.values()) {
        this.group.remove(b.mesh)
        b.mesh.geometry.dispose()
      }
      for (const h of c.holders) delete h.userData.chunk
    }
    this.chunks.clear()
  }

  private bakeChunk(c: Chunk, eye: { x: number; y: number }): void {
    c.dirty = false
    this.stats.chunkBakes++
    this.fit(c)
    const far = (h: THREE.Object3D) => (h.position.x - eye.x - 0.5) ** 2 + (h.position.z - eye.y - 0.5) ** 2
    const holders = [...c.holders].sort((a, b) => far(b) - far(a))
    const gathered = new Map<string, Gathered>()
    for (const h of holders) {
      if (h.parent === this.group) this.group.remove(h)
      for (const child of h.children) {
        const m = child as THREE.Mesh
        const material = this.twin(m.material as THREE.Material)!
        const key = `${material.uuid}|${m.renderOrder}|${m.layers.mask}`
        let g = gathered.get(key)
        if (!g) gathered.set(key, (g = { material, renderOrder: m.renderOrder, layers: m.layers.mask, parts: [], verts: 0, indices: 0 }))
        // the holder's yaw is the eye's, and the shader applies that; its place goes in as the anchor
        g.parts.push({ mesh: m, anchor: h.position })
        g.verts += m.geometry.getAttribute('position').count
        g.indices += m.geometry.index!.count
      }
    }
    for (const [key, g] of gathered) {
      let b = c.batches.get(key)
      if (!b || b.capacity < g.verts || b.indexCapacity < g.indices) b = this.allocate(c, key, b, g)
      this.write(b, g, c)
    }
    // a material the chunk no longer needs gives its buffer back
    for (const [key, b] of c.batches) {
      if (gathered.has(key)) continue
      this.group.remove(b.mesh)
      b.mesh.geometry.dispose()
      c.batches.delete(key)
    }
  }

  /** Buffers for a batch, with headroom; on an existing mesh, its geometry is replaced (the mesh keeps its place in the draw order). */
  private allocate(c: Chunk, key: string, had: Batch | undefined, g: Gathered): Batch {
    this.stats.chunkAllocs++
    const first = g.parts[0].mesh.geometry
    // the shadow disc has normals; nothing else does, and no merged material reads them
    const names = Object.keys(first.attributes).filter((n) => n !== 'normal')
    const sizes: Record<string, number> = {}
    for (const n of names) sizes[n] = first.getAttribute(n).itemSize
    const capacity = Math.ceil(g.verts * HEADROOM)
    const indexCapacity = Math.ceil(g.indices * HEADROOM)
    const geo = new THREE.BufferGeometry()
    for (const n of names) geo.setAttribute(n, new THREE.BufferAttribute(new Float32Array(capacity * sizes[n]), sizes[n]))
    geo.setAttribute('anchor', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3))
    geo.setIndex(new THREE.BufferAttribute(capacity > WIDE_INDEX ? new Uint32Array(indexCapacity) : new Uint16Array(indexCapacity), 1))
    // the vertices are in their sprites' own frames, so the geometry's own bounds say nothing about where they stand:
    // the sphere is the chunk's (`fit`), in world units since the mesh stands at the origin, and every sprite of
    // the chunk stays inside it however it turns
    geo.boundingSphere = c.sphere.clone()
    geo.boundingBox = null
    let mesh: THREE.Mesh
    if (had) {
      mesh = had.mesh
      mesh.geometry.dispose()
      mesh.geometry = geo
    } else {
      mesh = new THREE.Mesh(geo, g.material)
      mesh.renderOrder = g.renderOrder
      mesh.layers.mask = g.layers
      mesh.userData.baked = true
      mesh.userData.chunk = `${c.cx},${c.cz}`
      this.group.add(mesh)
    }
    const b: Batch = { mesh, renderOrder: g.renderOrder, names, sizes, capacity, indexCapacity }
    c.batches.set(key, b)
    return b
  }

  /** Write the batch's parts into its buffers, and hand the written ranges to the GPU. */
  private write(b: Batch, g: Gathered, c: Chunk): void {
    const geo = b.mesh.geometry
    const out: Record<string, Float32Array> = {}
    for (const n of b.names) out[n] = (geo.getAttribute(n) as THREE.BufferAttribute).array as Float32Array
    const anchor = (geo.getAttribute('anchor') as THREE.BufferAttribute).array as Float32Array
    const index = geo.index!.array as Uint16Array | Uint32Array
    const v = this.v
    let vo = 0, io = 0
    for (const { mesh, anchor: at } of g.parts) {
      const src = mesh.geometry
      const n = src.getAttribute('position').count
      mesh.updateMatrix()
      const plain = mesh.rotation.x === 0 && mesh.rotation.y === 0 && mesh.rotation.z === 0 && mesh.scale.x === 1 && mesh.scale.y === 1 && mesh.scale.z === 1
      for (const name of b.names) {
        const a = src.getAttribute(name) as THREE.BufferAttribute
        const dst = out[name]
        if (name === 'position') {
          const s = a.array as Float32Array
          const p = mesh.position
          for (let i = 0; i < n; i++) {
            if (plain) {
              dst[(vo + i) * 3] = s[i * 3] + p.x
              dst[(vo + i) * 3 + 1] = s[i * 3 + 1] + p.y
              dst[(vo + i) * 3 + 2] = s[i * 3 + 2] + p.z
            } else {
              v.fromBufferAttribute(a, i).applyMatrix4(mesh.matrix)
              dst[(vo + i) * 3] = v.x
              dst[(vo + i) * 3 + 1] = v.y
              dst[(vo + i) * 3 + 2] = v.z
            }
          }
        } else dst.set(a.array as Float32Array, vo * b.sizes[name])
      }
      for (let i = 0; i < n; i++) {
        anchor[(vo + i) * 3] = at.x
        anchor[(vo + i) * 3 + 1] = at.y
        anchor[(vo + i) * 3 + 2] = at.z
      }
      const idx = src.index!.array
      for (let i = 0; i < idx.length; i++) index[io + i] = idx[i] + vo
      vo += n
      io += idx.length
    }
    this.stats.bakedVertices += vo
    for (const n of [...b.names, 'anchor']) {
      const a = geo.getAttribute(n) as THREE.BufferAttribute
      a.clearUpdateRanges()
      a.addUpdateRange(0, vo * a.itemSize)
      a.needsUpdate = true
    }
    geo.index!.clearUpdateRanges()
    geo.index!.addUpdateRange(0, io)
    geo.index!.needsUpdate = true
    geo.setDrawRange(0, io)
  }
}
