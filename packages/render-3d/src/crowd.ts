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
  /** Vertices a bake found already in place and left alone: neither written nor uploaded again. */
  keptVertices: number
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
  /**
   * What the last write put in each slot of the buffers, in order: the part and everything its
   * bytes were computed from. A write compares each part against the slot it lands in and
   * skips the ones already there, so a bake that changed one holder of the chunk writes
   * and uploads that holder's span and the spans the change shifted, not the whole chunk.
   */
  slots: Slot[]
}

/** One part as it was last written: its identity, its inputs and where in the buffers it went. */
interface Slot {
  mesh: THREE.Mesh
  geometry: THREE.BufferGeometry
  /** The attribute objects and their versions, in the batch's name order, then the index's. */
  attributes: THREE.BufferAttribute[]
  versions: number[]
  /** The mesh's own transform and the holder's place, as numbers. */
  px: number
  py: number
  pz: number
  qx: number
  qy: number
  qz: number
  qw: number
  sx: number
  sy: number
  sz: number
  ax: number
  ay: number
  az: number
  /** Vertex and index offsets and counts. */
  vo: number
  io: number
  n: number
  ni: number
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

  /** Mark every chunk for the next bake: its holders are ordered again from where the eye stands then. */
  invalidate(): void {
    for (const c of this.chunks.values()) c.dirty = true
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
    const b: Batch = { mesh, renderOrder: g.renderOrder, names, sizes, capacity, indexCapacity, slots: [] }
    c.batches.set(key, b)
    return b
  }

  /**
   * Write the batch's parts into its buffers, and hand the written ranges to the GPU.
   *
   * A part whose slot already holds it, computed from the same inputs (`Slot`), is left as
   * it is: its bytes would come out the same. What is written is the parts that are new,
   * changed, or moved to another offset because a part before them grew, shrank or went;
   * only those spans go to the GPU. The buffers end up byte for byte what a full write
   * would have left, so nothing drawn can tell the two apart.
   */
  private write(b: Batch, g: Gathered, c: Chunk): void {
    const geo = b.mesh.geometry
    const out: Record<string, Float32Array> = {}
    const attrs: THREE.BufferAttribute[] = []
    for (const n of b.names) {
      const a = geo.getAttribute(n) as THREE.BufferAttribute
      attrs.push(a)
      out[n] = a.array as Float32Array
    }
    const anchorAttr = geo.getAttribute('anchor') as THREE.BufferAttribute
    const anchor = anchorAttr.array as Float32Array
    const indexAttr = geo.index!
    const index = indexAttr.array as Uint16Array | Uint32Array
    const v = this.v
    const slots = b.slots
    const next: Slot[] = []
    // the vertex and index spans written this time, as [start, end) pairs, in order
    const vSpans: number[] = []
    const iSpans: number[] = []
    let vo = 0, io = 0
    let kept = 0
    for (let k = 0; k < g.parts.length; k++) {
      const { mesh, anchor: at } = g.parts[k]
      const src = mesh.geometry
      const n = src.getAttribute('position').count
      const idx = src.index!.array
      const ni = idx.length
      const q = mesh.quaternion, p = mesh.position, sc = mesh.scale
      const was = slots[k]
      let same =
        was !== undefined && was.mesh === mesh && was.geometry === src && was.vo === vo && was.io === io && was.n === n && was.ni === ni &&
        was.px === p.x && was.py === p.y && was.pz === p.z && was.qx === q.x && was.qy === q.y && was.qz === q.z && was.qw === q.w &&
        was.sx === sc.x && was.sy === sc.y && was.sz === sc.z && was.ax === at.x && was.ay === at.y && was.az === at.z
      const parts: THREE.BufferAttribute[] = []
      const versions: number[] = []
      for (let i = 0; i < b.names.length; i++) {
        const a = src.getAttribute(b.names[i]) as THREE.BufferAttribute
        parts.push(a)
        versions.push(a.version)
        if (same && (was!.attributes[i] !== a || was!.versions[i] !== a.version)) same = false
      }
      parts.push(src.index!)
      versions.push(src.index!.version)
      if (same && (was!.attributes[b.names.length] !== src.index! || was!.versions[b.names.length] !== src.index!.version)) same = false
      if (same) {
        next.push(was!)
        kept += n
        vo += n
        io += ni
        continue
      }
      mesh.updateMatrix()
      const plain = mesh.rotation.x === 0 && mesh.rotation.y === 0 && mesh.rotation.z === 0 && sc.x === 1 && sc.y === 1 && sc.z === 1
      for (let i = 0; i < b.names.length; i++) {
        const name = b.names[i]
        const a = parts[i]
        const dst = out[name]
        if (name === 'position') {
          const s = a.array as Float32Array
          for (let j = 0; j < n; j++) {
            if (plain) {
              dst[(vo + j) * 3] = s[j * 3] + p.x
              dst[(vo + j) * 3 + 1] = s[j * 3 + 1] + p.y
              dst[(vo + j) * 3 + 2] = s[j * 3 + 2] + p.z
            } else {
              v.fromBufferAttribute(a, j).applyMatrix4(mesh.matrix)
              dst[(vo + j) * 3] = v.x
              dst[(vo + j) * 3 + 1] = v.y
              dst[(vo + j) * 3 + 2] = v.z
            }
          }
        } else dst.set(a.array as Float32Array, vo * b.sizes[name])
      }
      for (let j = 0; j < n; j++) {
        anchor[(vo + j) * 3] = at.x
        anchor[(vo + j) * 3 + 1] = at.y
        anchor[(vo + j) * 3 + 2] = at.z
      }
      for (let j = 0; j < ni; j++) index[io + j] = idx[j] + vo
      // extend the last span where this part follows it, else open a new one
      if (vSpans.length && vSpans[vSpans.length - 1] === vo) vSpans[vSpans.length - 1] = vo + n
      else vSpans.push(vo, vo + n)
      if (iSpans.length && iSpans[iSpans.length - 1] === io) iSpans[iSpans.length - 1] = io + ni
      else iSpans.push(io, io + ni)
      next.push({
        mesh, geometry: src, attributes: parts, versions,
        px: p.x, py: p.y, pz: p.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w, sx: sc.x, sy: sc.y, sz: sc.z,
        ax: at.x, ay: at.y, az: at.z, vo, io, n, ni,
      })
      vo += n
      io += ni
    }
    b.slots = next
    this.stats.bakedVertices += vo - kept
    this.stats.keptVertices += kept
    // the spans join any still waiting from an earlier write: the renderer clears them once uploaded
    if (vSpans.length) {
      for (const a of [...attrs, anchorAttr]) {
        for (let i = 0; i < vSpans.length; i += 2) a.addUpdateRange(vSpans[i] * a.itemSize, (vSpans[i + 1] - vSpans[i]) * a.itemSize)
        a.needsUpdate = true
      }
    }
    if (iSpans.length) {
      for (let i = 0; i < iSpans.length; i += 2) indexAttr.addUpdateRange(iSpans[i], iSpans[i + 1] - iSpans[i])
      indexAttr.needsUpdate = true
    }
    geo.setDrawRange(0, io)
  }
}
