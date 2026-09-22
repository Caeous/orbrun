import { cellKey, cellLayoutEquals, keyToXY, type CellKey, type Rect, type Scene, type SceneCell, type TileRect } from '@orbrun/scene'
import type { FootprintOptions } from './footprint.js'
import { LevelGrid, sameKeys, type FootprintEntry } from './grid.js'

/**
 * The level's geometry (rendering-3d.md II.1, inset walls), built in chunks
 * of `LEVEL_CHUNK` cells a side into plain typed arrays, with no GL in sight:
 * the renderer turns a chunk's arrays into buffers, and the tests read them
 * as they are.
 *
 * World mapping: cell (x, y) -> world (x, 0, y), north is -z, wall height 1.
 * A cell's geometry reads its neighbours out of the grid, not out of the
 * chunk, so a chunk's faces are the very faces a whole-level build puts
 * there, and a step that reveals a few cells rebuilds the chunks those cells
 * reach into (`LEVEL_REACH`) and leaves the rest standing.
 */

/** Cells a side of a level chunk. */
export const LEVEL_CHUNK = 16
/**
 * How far a cell's geometry reaches into its neighbours, in cells: the
 * footprint rule reads a neighbour's own footprint to hide what it covers,
 * which reads one cell further, and what counts as wall for the rule reads
 * one further still (`framedDoors`).
 */
export const LEVEL_REACH = 3
/** Faces toward east and west are lit a shade darker than those facing north and south, so a corner reads. */
export const SIDE_SHADE = 0.82
/** The lid's shade. */
export const LID_SHADE = 0.75
/**
 * How far a tile's uv rect is inset, in texels, so a sample never reaches the
 * neighbouring tile in the atlas.
 */
export const UV_INSET = 0.25

const DIAGONALS: [number, number][] = [[-1, -1], [1, -1], [-1, 1], [1, 1]]

export interface UVRect {
  u0: number
  v0: number
  u1: number
  v1: number
}

/** A tile ready to draw: its rect, the atlas it lives in, and its uvs there. */
export interface TileDraw {
  r: TileRect
  atlas: string
  uv: UVRect
}

export type Tint = { r: number; g: number; b: number }

/** What a mesher is given to build with, beyond the scene. */
export interface MeshContext {
  /** A tile's rect, atlas and uvs, or null where the source has none. */
  tileOf(id: number): TileDraw | null
  fo: FootprintOptions
  chamfer: number
}

/** One mesh's worth of a chunk: which material it wears and its vertex streams. */
export interface ChunkGeometry {
  /** `level` is the alpha-tested masonry and floors, `decal` the blended marks over them, `void` the black of never-seen space. */
  kind: 'level' | 'decal' | 'void'
  atlas: string
  position: Float32Array
  uv: Float32Array
  color: Float32Array
  /** Per vertex, the cell whose light it takes from the shade map. */
  cell: Float32Array
  /** 1 on a wall face, whose back side is culled. */
  cut: Float32Array
  index: Uint16Array | Uint32Array
}

/** A typed array that grows as it is pushed to. */
class Stream<T extends Float32Array | Uint32Array> {
  length = 0
  constructor(public array: T) {}
  private room(n: number): T {
    let a = this.array
    if (this.length + n > a.length) {
      let size = a.length * 2
      while (size < this.length + n) size *= 2
      const next = new (a.constructor as new (n: number) => T)(size)
      next.set(a)
      this.array = a = next
    }
    return a
  }
  push2(x: number, y: number): void {
    const a = this.room(2)
    const i = this.length
    a[i] = x
    a[i + 1] = y
    this.length = i + 2
  }
  push3(x: number, y: number, z: number): void {
    const a = this.room(3)
    const i = this.length
    a[i] = x
    a[i + 1] = y
    a[i + 2] = z
    this.length = i + 3
  }
  push1(x: number): void {
    const a = this.room(1)
    a[this.length++] = x
  }
  take(): T {
    return this.array.slice(0, this.length) as T
  }
}

/** The four corner uvs of a quad in point order: the first point takes (u0, v1). */
function quadUVs(uv: UVRect): [number, number][] {
  return [
    [uv.u0, uv.v1],
    [uv.u1, uv.v1],
    [uv.u1, uv.v0],
    [uv.u0, uv.v0],
  ]
}

/** Triangulate a convex horizontal polygon as a fan from its first point, keeping its winding. Every polygon here is a quad or a triangle padded to one. */
function fan(n: number): number[][] {
  const out: number[][] = []
  for (let i = 1; i + 1 < n; i++) out.push([0, i, i + 1])
  return out
}

/** Gathers one mesh's vertices. */
class GeoBuilder {
  private positions = new Stream(new Float32Array(3 * 256))
  private uvs = new Stream(new Float32Array(2 * 256))
  private colors = new Stream(new Float32Array(3 * 256))
  private cut = new Stream(new Float32Array(256))
  private cells = new Stream(new Float32Array(2 * 256))
  private indices = new Stream(new Uint32Array(6 * 128))
  private cx = 0
  private cz = 0
  at(x: number, z: number): this {
    this.cx = x
    this.cz = z
    return this
  }
  quad(p: [number, number, number][], uv: UVRect, shade: number, tint: Tint, cut = false) {
    this.poly(p, quadUVs(uv), shade, tint, cut)
  }
  poly(p: [number, number, number][], uv: [number, number][], shade: number, tint: Tint, cut = false) {
    const base = this.positions.length / 3
    const n = p.length
    const c = cut ? 1 : 0
    const r = shade * tint.r, g = shade * tint.g, b = shade * tint.b
    for (let i = 0; i < n; i++) {
      const q = p[i]
      this.positions.push3(q[0], q[1], q[2])
      this.cut.push1(c)
      this.cells.push2(this.cx, this.cz)
      this.uvs.push2(uv[i][0], uv[i][1])
      this.colors.push3(r, g, b)
    }
    if (n === 4) {
      this.indices.push3(base, base + 1, base + 2)
      this.indices.push3(base, base + 2, base + 3)
    } else for (const [a, b, c] of fan(n)) this.indices.push3(base + a, base + b, base + c)
  }
  build(kind: ChunkGeometry['kind'], atlas: string): ChunkGeometry | null {
    if (this.indices.length === 0) return null
    const idx = this.indices.take()
    let wide = false
    for (let i = idx.length - 1; i >= 0; --i) if (idx[i] >= 65535) { wide = true; break }
    return {
      kind,
      atlas,
      position: this.positions.take(),
      uv: this.uvs.take(),
      color: this.colors.take(),
      cell: this.cells.take(),
      cut: this.cut.take(),
      index: wide ? idx : new Uint16Array(idx),
    }
  }
}

/** The parts of `a` no cell of `b` covers, as up to four rectangles. */
export function rectMinus(a: Rect, b: Rect): Rect[] {
  if (a.right < a.left || a.bottom < a.top) return []
  if (b.right < b.left || b.bottom < b.top) return [a]
  const out: Rect[] = []
  if (a.left < b.left) out.push({ left: a.left, right: Math.min(a.right, b.left - 1), top: a.top, bottom: a.bottom })
  if (a.right > b.right) out.push({ left: Math.max(a.left, b.right + 1), right: a.right, top: a.top, bottom: a.bottom })
  const l = Math.max(a.left, b.left), r = Math.min(a.right, b.right)
  if (l <= r) {
    if (a.top < b.top) out.push({ left: l, right: r, top: a.top, bottom: Math.min(a.bottom, b.top - 1) })
    if (a.bottom > b.bottom) out.push({ left: l, right: r, top: Math.max(a.top, b.bottom + 1), bottom: a.bottom })
  }
  return out.filter((q) => q.right >= q.left && q.bottom >= q.top)
}

/** What every chunk of one build shares. */
interface Build {
  grid: LevelGrid
  scene: Scene
  tint: Tint
  ctx: MeshContext
  memo: Map<number, FootprintEntry>
  ceilingOf(c: SceneCell | undefined): TileDraw | null
  stands(c: SceneCell): boolean
}

/** Work counters the readout and the tests read. */
export interface LevelStats {
  /** Level geometry builds: a layout change, whether it touched one chunk or every one. */
  levelBuilds: number
  /** Chunks built: what a build really costs. */
  levelChunkBuilds: number
  /** Milliseconds working out what to build, and building it. */
  lvlSetMs: number
  lvlChunkMs: number
}

/**
 * Keeps the level's chunks across builds and works out which to rebuild:
 * only the chunks the cells changed since the last build reach into, unless
 * something every chunk is built under changed (the tint, the lid, the sky,
 * the tiles, the options), when every chunk is.
 */
export class LevelMesher {
  /** Each standing chunk's geometry, as last built. */
  readonly chunks = new Map<number, ChunkGeometry[]>()
  private builtCells = new Map<CellKey, SceneCell>()
  private builtRange: Rect | null = null
  private builtGlobals = ''
  private builtOccupied = new Set<CellKey>()
  private full = true
  /** Chunks a build ran out of budget for, nearest the player first, with the build they belong to. */
  private pending: { chunks: number[]; build: Build } | null = null
  /** The counters this mesher adds to; the renderer hands it its own, so a frame's readout is one object. */
  readonly stats: LevelStats
  private now: () => number

  constructor(now: () => number = () => performance.now(), stats: LevelStats = { levelBuilds: 0, levelChunkBuilds: 0, lvlSetMs: 0, lvlChunkMs: 0 }) {
    this.now = now
    this.stats = stats
  }

  /** The next build is a whole one: new tiles, new options. */
  invalidate(): void {
    this.full = true
  }

  /** Every chunk down and what they were built from forgotten. */
  clear(): { dropped: number[] } {
    const dropped = [...this.chunks.keys()]
    this.chunks.clear()
    this.pending = null
    this.builtCells.clear()
    this.builtRange = null
    this.builtOccupied = new Set()
    this.full = true
    return { dropped }
  }

  get hasPending(): boolean {
    return this.pending !== null
  }

  /** Whether `grid`'s occupied features differ from the ones the chunks were built under. */
  occupiedChanged(grid: LevelGrid): boolean {
    return !sameKeys(grid.occupied, this.builtOccupied)
  }

  /**
   * Build for `scene`: the chunks the change reaches, nearest the player
   * first, up to `budgetMs` (the first always); what is left is finished by
   * `continue_`. Returns the chunks touched, built and dropped alike.
   */
  update(grid: LevelGrid, ctx: MeshContext, budgetMs = Infinity): number[] {
    const t0 = this.now()
    this.stats.levelBuilds++
    const scene = grid.scene
    const tint = scene.level.tint
    const levelCeiling = scene.level.ceilingTile !== null ? ctx.tileOf(scene.level.ceilingTile) : null
    const ceilingCache = new Map<number, TileDraw | null>()
    const ceilingOf = (c: SceneCell | undefined) => {
      if (scene.level.sky !== 'none') return null
      if (!c || c.ceilingTile === undefined) return levelCeiling
      let t = ceilingCache.get(c.ceilingTile)
      if (t === undefined) ceilingCache.set(c.ceilingTile, (t = ctx.tileOf(c.ceilingTile)))
      return t
    }
    const stands = (c: SceneCell) => c.stance === 'upright' && !grid.occupied.has(cellKey(c.x, c.y))
    const build: Build = { grid, scene, tint, ctx, memo: new Map(), ceilingOf, stands }
    const range = grid.range
    const globals = `${tint.r},${tint.g},${tint.b}|${scene.level.ceilingTile}|${scene.level.sky}|${ctx.fo.inset}|${ctx.chamfer}`
    const full = this.full || !this.builtRange || globals !== this.builtGlobals
    this.full = false
    this.builtGlobals = globals
    const chunks = new Set<number>()
    const markRect = (r: Rect) => {
      if (r.right < r.left || r.bottom < r.top) return
      for (let cz = Math.floor((r.top - LEVEL_REACH) / LEVEL_CHUNK); cz <= Math.floor((r.bottom + LEVEL_REACH) / LEVEL_CHUNK); cz++)
        for (let cx = Math.floor((r.left - LEVEL_REACH) / LEVEL_CHUNK); cx <= Math.floor((r.right + LEVEL_REACH) / LEVEL_CHUNK); cx++)
          chunks.add(cellKey(cx, cz))
    }
    const markKey = (k: CellKey) => {
      const { x, y } = keyToXY(k)
      markRect({ left: x, right: x, top: y, bottom: y })
    }
    const changed: CellKey[] = []
    const gone: CellKey[] = []
    if (full) {
      for (const ck of this.chunks.keys()) chunks.add(ck)
      for (let cz = Math.floor(range.top / LEVEL_CHUNK); cz <= Math.floor(range.bottom / LEVEL_CHUNK); cz++)
        for (let cx = Math.floor(range.left / LEVEL_CHUNK); cx <= Math.floor(range.right / LEVEL_CHUNK); cx++) chunks.add(cellKey(cx, cz))
    } else {
      for (const [k, cell] of scene.cells) {
        const had = this.builtCells.get(k)
        if (!had || !cellLayoutEquals(had, cell)) changed.push(k)
      }
      for (const k of this.builtCells.keys()) if (!scene.cells.has(k)) gone.push(k)
      for (const k of changed) markKey(k)
      for (const k of gone) markKey(k)
      for (const k of grid.occupied) if (!this.builtOccupied.has(k)) markKey(k)
      for (const k of this.builtOccupied) if (!grid.occupied.has(k)) markKey(k)
      for (const r of rectMinus(range, this.builtRange!)) markRect(r)
      for (const r of rectMinus(this.builtRange!, range)) markRect(r)
    }
    if (full) {
      this.builtCells.clear()
      for (const [k, cell] of scene.cells) this.builtCells.set(k, cell)
    } else {
      for (const k of gone) this.builtCells.delete(k)
      for (const k of changed) this.builtCells.set(k, scene.cells.get(k)!)
    }
    this.builtOccupied = grid.occupied
    this.builtRange = range
    const order = [...chunks]
    if (order.length > 1) {
      const pcx = scene.player.x / LEVEL_CHUNK
      const pcz = scene.player.y / LEVEL_CHUNK
      const near = new Map<number, number>()
      for (const ck of order) {
        const { x, y } = keyToXY(ck as CellKey)
        near.set(ck, (x - pcx) * (x - pcx) + (y - pcz) * (y - pcz))
      }
      order.sort((a, b) => near.get(a)! - near.get(b)!)
    }
    this.stats.lvlSetMs += this.now() - t0
    const t1 = this.now()
    const left = this.buildChunks(order, build, t1, budgetMs)
    this.stats.lvlChunkMs += this.now() - t1
    this.pending = left.length ? { chunks: left, build } : null
    return order.slice(0, order.length - left.length)
  }

  /** Carry on with the chunks a build ran out of budget for; the chunks built this call. */
  continue_(budgetMs: number): number[] {
    const p = this.pending
    if (!p) return []
    const t = this.now()
    const left = this.buildChunks(p.chunks, p.build, t, budgetMs)
    this.stats.lvlChunkMs += this.now() - t
    this.pending = left.length ? { chunks: left, build: p.build } : null
    return p.chunks.slice(0, p.chunks.length - left.length)
  }

  private buildChunks(order: number[], build: Build, t0: number, budgetMs: number): number[] {
    const slice = Number.isFinite(budgetMs)
    for (let i = 0; i < order.length; i++) {
      if (slice && i > 0 && this.now() - t0 > budgetMs) return order.slice(i)
      this.buildChunk(order[i], build)
    }
    return []
  }

  private buildChunk(ck: number, b: Build) {
    this.chunks.delete(ck)
    const { grid, tint, ctx, memo, ceilingOf, stands } = b
    const { tileOf, fo } = ctx
    const range = grid.range
    const c0 = keyToXY(ck)
    const x0 = Math.max(range.left, c0.x * LEVEL_CHUNK)
    const x1 = Math.min(range.right, c0.x * LEVEL_CHUNK + LEVEL_CHUNK - 1)
    const z0 = Math.max(range.top, c0.y * LEVEL_CHUNK)
    const z1 = Math.min(range.bottom, c0.y * LEVEL_CHUNK + LEVEL_CHUNK - 1)
    if (x1 < x0 || z1 < z0) return
    this.stats.levelChunkBuilds++
    const builders = new Map<string, GeoBuilder>()
    const decalBuilders = new Map<string, GeoBuilder>()
    const voids = new GeoBuilder()
    const get = (name: string) => {
      let g = builders.get(name)
      if (!g) builders.set(name, (g = new GeoBuilder()))
      return g
    }
    const getDecal = (name: string, cell: SceneCell, id: number) => {
      if (!cell.translucent?.includes(id)) return get(name)
      let g = decalBuilders.get(name)
      if (!g) decalBuilders.set(name, (g = new GeoBuilder()))
      return g
    }
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t
    type Dir = 'n' | 's' | 'w' | 'e'
    for (let y = z0; y <= z1; y++) {
      for (let x = x0; x <= x1; x++) {
        const cell = grid.cell(x, y)
        const solid = grid.isSolid(x, y)
        const n = grid.cell(x, y - 1)
        const s = grid.cell(x, y + 1)
        const w = grid.cell(x - 1, y)
        const e = grid.cell(x + 1, y)
        if (!solid && cell) {
          const ft = tileOf(cell.floorTile)
          if (ft) get(ft.atlas).at(x, y).quad([[x, 0, y + 1], [x + 1, 0, y + 1], [x + 1, 0, y], [x, 0, y]], ft.uv, 1, tint)
          const decal = (id: number, lift: number) => {
            const ot = tileOf(id)
            if (!ot) return
            const c = ot.r.cell
            const dx0 = x + ot.r.ox / c, dx1 = x + (ot.r.ox + ot.r.w) / c
            const dz0 = y + ot.r.oy / c, dz1 = y + (ot.r.oy + ot.r.h) / c
            getDecal(ot.atlas, cell, id).at(x, y).quad([[dx0, lift, dz1], [dx1, lift, dz1], [dx1, lift, dz0], [dx0, lift, dz0]], ot.uv, 1, tint)
          }
          if (cell.underlays) for (const o of cell.underlays) decal(o, 0.002)
          if (cell.featureTile !== undefined && !stands(cell)) decal(cell.featureTile, 0.004)
          if (cell.overlays) for (const o of cell.overlays) if (!cell.wallShadows?.includes(o) && !cell.shorelines?.includes(o)) decal(o, 0.006)
          if (cell.icons) for (const o of cell.icons) decal(o, 0.008)
          const ceiling = ceilingOf(cell)
          if (ceiling) get(ceiling.atlas).at(x, y).quad([[x, 1, y], [x + 1, 1, y], [x + 1, 1, y + 1], [x, 1, y + 1]], ceiling.uv, LID_SHADE, tint)
          continue
        }
        const isVoid = grid.isVoid(x, y)
        const openN = !grid.isSolid(x, y - 1)
        const openS = !grid.isSolid(x, y + 1)
        const openW = !grid.isSolid(x - 1, y)
        const openE = !grid.isSolid(x + 1, y)
        if (isVoid && !(openN || openS || openW || openE) && DIAGONALS.every(([dx, dz]) => grid.isSolid(x + dx, y + dz))) continue
        const { fp, rect } = grid.footprintAt(x, y, fo, memo)
        if (!rect || fp.poly.length === 0) continue
        const wt = !isVoid && cell?.wallTile !== undefined ? tileOf(cell.wallTile) : null
        const black = isVoid || !wt
        const acrossKey: Record<Dir, CellKey> = { n: cellKey(x, y - 1), s: cellKey(x, y + 1), w: cellKey(x - 1, y), e: cellKey(x + 1, y) }
        const facePoints = (d: Dir, t0: number, t1: number, depth: number, y0: number, y1 = 1): [number, number, number][] => {
          switch (d) {
            case 'n': { const z = y + depth; return [[x + t1, y0, z], [x + t0, y0, z], [x + t0, y1, z], [x + t1, y1, z]] }
            case 's': { const z = y + 1 - depth; return [[x + t0, y0, z], [x + t1, y0, z], [x + t1, y1, z], [x + t0, y1, z]] }
            case 'w': { const px = x + depth; return [[px, y0, y + t0], [px, y0, y + t1], [px, y1, y + t1], [px, y1, y + t0]] }
            case 'e': { const px = x + 1 - depth; return [[px, y0, y + t1], [px, y0, y + t0], [px, y1, y + t0], [px, y1, y + t1]] }
          }
        }
        const faceU = (d: Dir, uv: { u0: number; u1: number }, t0: number, t1: number) =>
          d === 'n' || d === 'e'
            ? { u0: lerp(uv.u0, uv.u1, 1 - t1), u1: lerp(uv.u0, uv.u1, 1 - t0) }
            : { u0: lerp(uv.u0, uv.u1, t0), u1: lerp(uv.u0, uv.u1, t1) }
        const maxNotch = Math.min(rect.x1 - rect.x0, rect.z1 - rect.z0) / 2
        const notch = ctx.chamfer > 0 && maxNotch > 1e-6
        const cornerOn = [notch && openN && openW, notch && openN && openE, notch && openS && openW, notch && openS && openE]
        const cornerPt = (i: number): [number, number] => [i & 1 ? rect.x1 : rect.x0, i >> 1 ? rect.z1 : rect.z0]
        const Nv: [number, number, number, number] = [0, 0, 0, 0]
        for (let i = 0; i < 4; i++) if (cornerOn[i]) Nv[i] = Math.min(ctx.chamfer, maxNotch)
        const emitFace = (d: Dir, t0: number, t1: number, depth: number, y0: number) => {
          const p = facePoints(d, t0, t1, depth, y0)
          const faceShade = d === 'n' || d === 's' ? 1 : SIDE_SHADE
          if (black || !wt) {
            voids.quad(p, { u0: 0, v0: 0, u1: 1, v1: 1 }, 0, { r: 0, g: 0, b: 0 })
            return
          }
          const uv = { ...wt.uv, ...faceU(d, wt.uv, t0, t1) }
          uv.v1 = wt.uv.v1 - (wt.uv.v1 - wt.uv.v0) * y0
          get(wt.atlas).at(x, y).quad(p, uv, faceShade, tint, true)
          if (cell?.wallOverlays) {
            const nx = d === 'w' ? -0.003 : d === 'e' ? 0.003 : 0
            const nz = d === 'n' ? -0.003 : d === 's' ? 0.003 : 0
            const flip = d === 'n' || d === 'e'
            for (const o of cell.wallOverlays) {
              const ot = tileOf(o)
              if (!ot) continue
              const c = ot.r.cell
              const fx0 = ot.r.ox / c, fx1 = (ot.r.ox + ot.r.w) / c
              const fy0 = 1 - (ot.r.oy + ot.r.h) / c, fy1 = 1 - ot.r.oy / c
              const tA = Math.max(t0, flip ? 1 - fx1 : fx0), tB = Math.min(t1, flip ? 1 - fx0 : fx1)
              const yA = Math.max(y0, fy0), yB = Math.min(1, fy1)
              if (tB - tA < 1e-6 || yB - yA < 1e-6) continue
              const fu = (tx: number) => lerp(ot.uv.u0, ot.uv.u1, (tx - fx0) / (fx1 - fx0))
              const fv = (wy: number) => lerp(ot.uv.v0, ot.uv.v1, (1 - wy - ot.r.oy / c) / (ot.r.h / c))
              const ouv = { u0: fu(flip ? 1 - tB : tA), u1: fu(flip ? 1 - tA : tB), v0: fv(yB), v1: fv(yA) }
              const pd = facePoints(d, tA, tB, depth, yA, yB).map(([px, py, pz]) => [px + nx, py, pz + nz] as [number, number, number])
              getDecal(ot.atlas, cell, o).at(x, y).quad(pd, ouv, faceShade, tint, true)
            }
          }
        }
        for (const f of fp.faces) {
          const d: Dir = f.nz < -0.5 ? 'n' : f.nz > 0.5 ? 's' : f.nx < -0.5 ? 'w' : 'e'
          const horizontal = d === 'n' || d === 's'
          let t0 = horizontal ? Math.min(f.a[0], f.b[0]) : Math.min(f.a[1], f.b[1])
          let t1 = horizontal ? Math.max(f.a[0], f.b[0]) : Math.max(f.a[1], f.b[1])
          const depth = d === 'n' ? f.a[1] : d === 's' ? 1 - f.a[1] : d === 'w' ? f.a[0] : 1 - f.a[0]
          // a boundary the neighbour's body covers shows nothing between two walls; across a framed door it is the reveal
          if (f.covered && !grid.framed.has(acrossKey[d])) continue
          for (let i = 0; i < 4; i++) {
            if (!cornerOn[i] || Nv[i] === 0) continue
            const [cx, cz] = cornerPt(i)
            if (horizontal ? Math.abs(cz - f.a[1]) > 1e-9 : Math.abs(cx - f.a[0]) > 1e-9) continue
            const at = horizontal ? cx : cz
            if (Math.abs(at - t0) < 1e-9) t0 = Math.min(t1, t0 + Nv[i])
            else if (Math.abs(at - t1) < 1e-9) t1 = Math.max(t0, t1 - Nv[i])
          }
          emitFace(d, t0, t1, depth, 0)
        }
        const floorUV = (uv: UVRect, fx: number, fz: number): [number, number] => [lerp(uv.u0, uv.u1, fx), lerp(uv.v0, uv.v1, fz)]
        const ceilUV = (uv: UVRect, fx: number, fz: number): [number, number] => [lerp(uv.u0, uv.u1, fx), lerp(uv.v1, uv.v0, fz)]
        const flat = (gb: GeoBuilder, py: number, pts: [number, number][], uvOf: (fx: number, fz: number) => [number, number], up: boolean, sh: number) => {
          const q = up ? pts : [...pts].reverse()
          gb.poly(
            q.map(([fx, fz]) => [x + fx, py, y + fz] as [number, number, number]),
            q.map(([fx, fz]) => uvOf(fx, fz)),
            sh,
            tint,
          )
        }
        const patch = (pts: [number, number][], other: SceneCell | undefined) => {
          const lx = other ? other.x : x, lz = other ? other.y : y
          const ft = other && other.floorTile !== undefined ? tileOf(other.floorTile) : null
          if (ft) flat(get(ft.atlas).at(lx, lz), 0, pts, (fx, fz) => floorUV(ft.uv, fx, fz), true, 1)
          const ceiling = ceilingOf(other)
          if (ceiling) flat(get(ceiling.atlas).at(lx, lz), 1, pts, (fx, fz) => ceilUV(ceiling.uv, fx, fz), false, LID_SHADE)
        }
        const { x0: bx0, x1: bx1, z0: bz0, z1: bz1, t } = rect
        if (openN) patch([[0, bz0], [1, bz0], [1, 0], [0, 0]], n)
        if (openS) patch([[0, 1], [1, 1], [1, bz1], [0, bz1]], s)
        if (openW) patch([[0, bz1], [bx0, bz1], [bx0, bz0], [0, bz0]], w)
        if (openE) patch([[bx1, bz1], [1, bz1], [1, bz0], [bx1, bz0]], e)
        const diag = (i: number) => grid.cell(x + (i & 1 ? 1 : -1), y + (i >> 1 ? 1 : -1))
        if (rect.cut[0]) patch([[0, t], [t, t], [t, 0], [0, 0]], diag(0))
        if (rect.cut[1]) patch([[1 - t, t], [1, t], [1, 0], [1 - t, 0]], diag(1))
        if (rect.cut[2]) patch([[0, 1], [t, 1], [t, 1 - t], [0, 1 - t]], diag(2))
        if (rect.cut[3]) patch([[1 - t, 1], [1, 1], [1, 1 - t], [1 - t, 1 - t]], diag(3))
        for (let i = 0; i < 4; i++) {
          if (!cornerOn[i] || Nv[i] === 0) continue
          const N = Nv[i]
          const [cx, cz] = cornerPt(i)
          const sx = i & 1 ? -1 : 1, sz = i >> 1 ? -1 : 1
          const A: [number, number] = [cx + sx * N, cz]
          const Bp: [number, number] = [cx, cz + sz * N]
          const C: [number, number] = [cx, cz]
          const [p0, p1] = (i & 1) === i >> 1 ? [A, Bp] : [Bp, A]
          const ch: [number, number, number][] = [
            [x + p0[0], 0, y + p0[1]],
            [x + p1[0], 0, y + p1[1]],
            [x + p1[0], 1, y + p1[1]],
            [x + p0[0], 1, y + p0[1]],
          ]
          const chShade = (1 + SIDE_SHADE) / 2
          const nsDir: Dir = i >> 1 ? 's' : 'n'
          const u = black || !wt ? null : faceU(nsDir, wt.uv, Math.min(C[0], A[0]), Math.max(C[0], A[0]))
          if (black || !wt || !u) {
            voids.quad(ch, { u0: 0, v0: 0, u1: 1, v1: 1 }, 0, { r: 0, g: 0, b: 0 })
          } else {
            get(wt.atlas).at(x, y).quad(ch, { ...wt.uv, ...u }, chShade, tint, true)
          }
          const tri: [number, number][] = (i & 1) === i >> 1 ? [C, A, Bp, Bp] : [C, Bp, A, A]
          patch(tri, i >> 1 ? s : n)
        }
      }
    }
    const out: ChunkGeometry[] = []
    for (const [name, gb] of builders) {
      const g = gb.build('level', name)
      if (g) out.push(g)
    }
    for (const [name, gb] of decalBuilders) {
      const g = gb.build('decal', name)
      if (g) out.push(g)
    }
    const vg = voids.build('void', '')
    if (vg) out.push(vg)
    if (out.length) this.chunks.set(ck, out)
  }
}

/** The inset uvs of a tile in an atlas of the given size (`UV_INSET`). */
export function uvFor(rect: TileRect, aw: number, ah: number): UVRect {
  const e = UV_INSET
  return {
    u0: (rect.sx + e) / aw,
    v0: (rect.sy + e) / ah,
    u1: (rect.sx + rect.w - e) / aw,
    v1: (rect.sy + rect.h - e) / ah,
  }
}
