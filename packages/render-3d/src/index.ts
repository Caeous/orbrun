import * as THREE from 'three'
import {
  cellKey,
  flashOf,
  getCell,
  shadeOf,
  type Billboard,
  type Camera,
  type CellKey,
  type HandItem,
  type MapRenderer,
  type Scene,
  type SceneCursor,
  type TileRect,
  type TileSource,
  type Viewmodel,
} from '@orbrun/scene'
import { VM_OFFWEAPON_REST, VM_SHIELD_REST, VM_SIZE, VM_WEAPON_REST, handsFootprint, type HandPose, type HandRect } from './hands.js'
import { LevelGrid } from './grid.js'
import { LevelMesher, uvFor, type ChunkGeometry, type LevelStats, type MeshContext, type TileDraw } from './level-mesh.js'
import { Movers, monsterId } from './motion.js'
import { distanceField, peelInk } from './peel.js'
import type { PeelReply, PeelRequest } from './peel.worker.js'
import {
  BLOCK_SHADE,
  MODE_FLASH_OVERRIDE,
  MODE_HULL_FRONT,
  MODE_THICK,
  crowdInstances,
  fixtureInstances,
  type SpriteInstance,
  type SpritePass,
} from './sprites.js'
import { BLIT_FRAG, BLIT_VERT, CURSOR_FRAG, CURSOR_VERT, FLAT_FRAG, LEVEL_FRAG, LEVEL_VERT, SHADOW_VERT, SPRITE_FRAG, SPRITE_VERT, VOID_FRAG } from './shaders.js'
import { bodyRect, sceneClassAt } from './footprint.js'

/**
 * @orbrun/render-3d
 *
 * First-person renderer of a Scene on three.js, used as a GL layer: raw
 * shaders (shaders.ts), a flat scene of a few dozen meshes, and instancing
 * for everything that stands. Depends only on @orbrun/scene and three.
 *
 * World mapping: cell (x, y) -> world (x, 0, y). North (-y) is -z. Wall
 * height is 1. The camera stands at eye height EYE by default.
 *
 * A frame: the level's chunks (level-mesh.ts), the fixtures and the crowd as
 * instances (sprites.ts), the shadows and the cursor, into a render target
 * with a depth texture; that image on the canvas; the ghosts over it, tested
 * against the depth image (II.4); the hands last, in their own overlay.
 */

export interface Render3dOptions {
  /** Field of view in degrees. */
  fov?: number
  /** How high the eye stands, in cells (0 is the floor, 1 the lid). Default EYE; clamped to EYE_MIN..EYE_MAX. */
  eyeHeight?: number
  /** Truncated corners (II.1): every convex wall corner is cut off by a diagonal face this far back along each edge, in cells. Default 1/32. */
  chamfer?: number
  /** Inset walls (II.1): how far the wall surface stands back from the floor, in cells, strictly under 0.5. Default WALL_INSET. */
  wallInset?: number
  /** Viewmodel (II.7): the wielded weapon and the off-hand item in the lower corners. On by default. */
  viewmodel?: boolean
  /** Attack cue and the monsters' glide. Off under the platform's reduced-motion preference. */
  motion?: boolean
}

const EYE = 0.65
const EYE_MIN = 0.25
const EYE_MAX = 0.9
/**
 * Inset walls (II.1): the wall surface stands this far back from the floor,
 * in cells (12 texels of 32), leaving a one-thick wall an 8-texel core and
 * a lone wall cell an 8-texel post.
 */
export const WALL_INSET = 12 / 32
/** Texel alpha at or above which a texel is opaque. */
const OPAQUE_ALPHA = 26
/** How long one frame may spend building level chunks, in milliseconds; the rest go out over the frames after. */
const LEVEL_BUDGET_MS = 4
/** Ghost fade: full strength until this many cells behind its occluder, then to nothing by the second. */
const GHOST_FADE_START = 5
const GHOST_FADE = 14
/** The same for anything the server currently shows, which is never allowed to disappear. */
const GHOST_FADE_VISIBLE_START = 8
const GHOST_FADE_VISIBLE = 30
const CURSOR_COLOUR = 0xff8800
const CURSOR_MAP_COLOUR = 0xffffff
const HULL_SEL_COLOUR = 0xffdd33
/** Viewmodel: the view is two units tall at the hands' depth; each icon is extruded VM_DEPTH texels and scaled so its opaque extent fills VM_FILL of VM_SIZE. */
const VM_DEPTH = 2
const VM_FILL = 0.9
const VM_FOV = 40
const VM_LIFT_S = 0.22
const VM_LIFT = 0.07
/**
 * The layer of everything that is not the level or its fixtures: the crowd,
 * the ghosts, the shadows, the cursor. The ghosts' depth image (II.4) is what
 * the depth pass sees, layer 0 alone: the masonry and the statues, trees and
 * doors standing in it — a monster behind any of those shows through. The
 * crowd is drawn after the ghosts, so a nearer monster covers a farther one's
 * ghost as it covers the monster itself.
 */
const LAYER_STANDING = 1

/** Work counters the test bed and the regression tests read. Rendering never does. */
export interface RenderStats extends LevelStats {
  /** Crowd instance lists written (a scene revision, a step under way, a cursor move). */
  crowdSyncs: number
  /** Sprite instances written into batches, all passes. */
  spriteWrites: number
  /** Fixture instance lists written (a layout change). */
  fixtureBuilds: number
  /** Shade and flash fields repainted. */
  fieldUpdates: number
}

interface AtlasEntry {
  name: string
  texture: THREE.Texture
  width: number
  height: number
  /** The distance field (peel.ts), as a texture; null until the atlas is peeled, or where its pixels cannot be read. */
  dist: THREE.DataTexture | null
  /** false until peeled; 'failed' where the pixels cannot be read (an atlas that is not an image, no 2D canvas). */
  peeled: boolean | 'failed'
  uniforms: { map: THREE.IUniform; distMap: THREE.IUniform; atlasSize: THREE.IUniform }
  level: THREE.RawShaderMaterial
  decal: THREE.RawShaderMaterial
  sprite: Record<SpritePass, THREE.RawShaderMaterial>
}

/** The instance attributes of a sprite batch, in the order `SPRITE_VERT` declares them, with their sizes. */
const SPRITE_ATTRS: [string, number][] = [['iAnchor', 3], ['iQuad', 4], ['iZ', 2], ['iTexel', 4], ['iColor', 4], ['iMisc', 4], ['iCell', 2]]

/** A unit cube on [0,1]^3, wound outward, for the sprite boxes. */
function unitBox(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1)
  g.translate(0.5, 0.5, 0.5)
  g.deleteAttribute('normal')
  g.deleteAttribute('uv')
  return g
}

/**
 * One instanced draw: a mesh over a shared base geometry with its own
 * instance buffers, grown as needed and written in place. `begin`, `push`
 * each instance, `end`.
 */
class Batch {
  readonly geometry: THREE.InstancedBufferGeometry
  readonly mesh: THREE.Mesh
  private capacity = 0
  private count = 0
  private arrays = new Map<string, Float32Array>()
  constructor(base: THREE.BufferGeometry, material: THREE.Material, private attrs: [string, number][], renderOrder = 0) {
    this.geometry = new THREE.InstancedBufferGeometry()
    this.geometry.setIndex(base.getIndex())
    this.geometry.setAttribute('position', base.getAttribute('position'))
    this.mesh = new THREE.Mesh(this.geometry, material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = renderOrder
    this.geometry.instanceCount = 0
    this.reserve(16)
  }
  private reserve(n: number) {
    if (n <= this.capacity) return
    let cap = Math.max(16, this.capacity)
    while (cap < n) cap *= 2
    for (const [name, size] of this.attrs) {
      const next = new Float32Array(cap * size)
      const old = this.arrays.get(name)
      if (old) next.set(old.subarray(0, this.count * size))
      this.arrays.set(name, next)
      const attr = new THREE.InstancedBufferAttribute(next, size)
      attr.setUsage(THREE.DynamicDrawUsage)
      this.geometry.setAttribute(name, attr)
    }
    // three caps an instanced draw at the first instance buffer it bound and never looks again: forget it, or a grown batch draws its first 16
    delete (this.geometry as { _maxInstanceCount?: number })._maxInstanceCount
    this.capacity = cap
  }
  begin() {
    this.count = 0
  }
  /** Write one instance from `values`, an array per attribute in `attrs` order. */
  push(values: ArrayLike<number>[]) {
    this.reserve(this.count + 1)
    for (let i = 0; i < this.attrs.length; i++) {
      const [name, size] = this.attrs[i]
      this.arrays.get(name)!.set(values[i], this.count * size)
    }
    this.count++
  }
  end() {
    this.geometry.instanceCount = this.count
    this.mesh.visible = this.count > 0
    for (const [name, size] of this.attrs) {
      const attr = this.geometry.getAttribute(name) as THREE.InstancedBufferAttribute
      attr.needsUpdate = true
      attr.addUpdateRange(0, this.count * size)
    }
  }
  get size() {
    return this.count
  }
  dispose() {
    this.geometry.dispose()
  }
}

/** A painted hand: its icon as a texture, its distance field, and where its opaque texels stand. */
interface Hand {
  texture: THREE.Texture
  dist: THREE.DataTexture
  material: THREE.RawShaderMaterial
  batch: Batch
  cell: number
  /** The quad the icon stands on in the hand's frame (`stand`'s `quad`), and the world size of one of its texels. */
  quad: [number, number, number, number]
  scale: number
}

export class Render3d implements MapRenderer {
  /** A frame profiler's mark (perf.ts in the app): names the stretch just done. Unset when nothing is measuring. */
  mark: ((name: string) => void) | null = null
  readonly stats: RenderStats = { levelBuilds: 0, levelChunkBuilds: 0, lvlSetMs: 0, lvlChunkMs: 0, crowdSyncs: 0, spriteWrites: 0, fixtureBuilds: 0, fieldUpdates: 0 }
  private renderer: THREE.WebGLRenderer | null = null
  private three = new THREE.Scene()
  private blitScene = new THREE.Scene()
  private cam = new THREE.PerspectiveCamera(75, 1, 0.05, 200)
  private tiles: TileSource | null = null
  private scene: Scene | null = null
  private camera: Camera | null = null
  private cursor: SceneCursor | null = null
  private opts: Required<Render3dOptions>
  private width = 1
  private height = 1
  private alive = true
  private atlases = new Map<string, AtlasEntry>()
  private box = unitBox()
  // ---- the level
  private mesher = new LevelMesher(() => nowSeconds() * 1000, this.stats)
  private levelMeshes = new Map<number, THREE.Mesh[]>()
  private grid: LevelGrid | null = null
  private builtRevision = -1
  private builtLayout = -1
  private builtTint = ''
  private voidMat: THREE.RawShaderMaterial
  // ---- the fields
  private shadeTex: THREE.DataTexture | null = null
  private flashTex: THREE.DataTexture | null = null
  private fieldUniforms = {
    shadeMap: { value: null as THREE.Texture | null },
    flashMap: { value: null as THREE.Texture | null },
    fieldOrigin: { value: new THREE.Vector2(0, 0) },
    fieldSize: { value: new THREE.Vector2(1, 1) },
  }
  private standUniforms = { standYaw: { value: 0 } }
  private spriteUniforms = {
    shellColor: { value: new THREE.Color(HULL_SEL_COLOUR) },
    modelInverse: { value: new THREE.Matrix4() },
    flashOverride: { value: new THREE.Vector4(0, 0, 0, 0) },
  }
  private ghostUniforms = {
    sceneDepth: { value: null as THREE.Texture | null },
    resolution: { value: new THREE.Vector2(1, 1) },
    cameraNear: { value: 0.05 },
    cameraFar: { value: 200 },
  }
  // ---- what stands
  private fixtures: SpriteInstance[] = []
  private crowd: SpriteInstance[] = []
  private shadows: { x: number; y: number; r: number; moverId?: number }[] = []
  private batches = new Map<string, Batch>()
  private shadowBatch: Batch
  private shadowMat: THREE.RawShaderMaterial
  private crowdRevision = -1
  private crowdSelection = ''
  private movers = new Movers()
  private motionRevision = -1
  private ghostCount = 0
  // ---- the frame
  private target: THREE.WebGLRenderTarget | null = null
  /** The depth of the level and its fixtures, for the ghost pass. */
  private depthTarget: THREE.WebGLRenderTarget | null = null
  private blitMat: THREE.RawShaderMaterial
  private bufferSize = new THREE.Vector2()
  // ---- the cursor
  private cursorMesh: THREE.Mesh
  private cursorTileMesh: THREE.Mesh
  private cursorMat: THREE.RawShaderMaterial
  private cursorTileMat: THREE.RawShaderMaterial
  // ---- the hands
  private viewmodel: Viewmodel | null = null
  private vmKey = ''
  private vmScene = new THREE.Scene()
  private vmCam = new THREE.PerspectiveCamera(VM_FOV, 1, 0.1, 20)
  private hands: { weapon: Hand | null; offhand: Hand | null } = { weapon: null, offhand: null }
  private handCache = new Map<string, Hand | null>()
  private vmLift = NaN
  private lift = NaN
  // ---- the peel
  private peelWorker: Worker | null | undefined = undefined
  private peelId = 0

  constructor(opts: Render3dOptions = {}) {
    this.opts = {
      fov: opts.fov ?? 85,
      eyeHeight: opts.eyeHeight ?? EYE,
      chamfer: opts.chamfer ?? 1 / 32,
      wallInset: opts.wallInset ?? WALL_INSET,
      viewmodel: opts.viewmodel ?? true,
      motion: opts.motion ?? true,
    }
    this.cam.fov = this.opts.fov
    this.cam.rotation.order = 'YXZ'
    this.cam.layers.enable(LAYER_STANDING)
    this.voidMat = this.raw(LEVEL_VERT, VOID_FRAG, {}, { side: THREE.DoubleSide })
    this.shadowMat = this.raw(SHADOW_VERT, FLAT_FRAG, { color: { value: new THREE.Vector4(0, 0, 0, 0.35) } }, { transparent: true, depthWrite: false })
    const disc = new THREE.CircleGeometry(0.22, 16)
    disc.deleteAttribute('normal')
    disc.deleteAttribute('uv')
    this.shadowBatch = new Batch(disc, this.shadowMat, [['iAnchor', 3], ['iScale', 1]], 0)
    this.shadowBatch.mesh.layers.set(LAYER_STANDING)
    this.three.add(this.shadowBatch.mesh)
    this.cursorMat = this.raw(CURSOR_VERT, CURSOR_FRAG, { color: { value: new THREE.Vector4(1, 0.53, 0, 0.95) }, uvRect: { value: new THREE.Vector4(0, 0, 1, 1) } }, { transparent: true, depthTest: false, depthWrite: false })
    this.cursorTileMat = this.raw(
      CURSOR_VERT,
      CURSOR_FRAG,
      { color: { value: new THREE.Vector4(1, 1, 1, 1) }, uvRect: { value: new THREE.Vector4(0, 0, 1, 1) }, map: { value: null } },
      { transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide },
      { TILE: '' },
    )
    const ring = new THREE.RingGeometry(0.34, 0.46, 4)
    ring.rotateX(-Math.PI / 2)
    this.cursorMesh = new THREE.Mesh(ring, this.cursorMat)
    this.cursorMesh.renderOrder = 0.5
    this.cursorMesh.visible = false
    this.cursorMesh.layers.set(LAYER_STANDING)
    const cq = new THREE.PlaneGeometry(1, 1)
    cq.rotateX(Math.PI / 2)
    this.cursorTileMesh = new THREE.Mesh(cq, this.cursorTileMat)
    this.cursorTileMesh.renderOrder = 0.5
    this.cursorTileMesh.visible = false
    this.cursorTileMesh.layers.set(LAYER_STANDING)
    this.three.add(this.cursorMesh, this.cursorTileMesh)
    this.blitMat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: BLIT_VERT, fragmentShader: BLIT_FRAG, uniforms: { map: { value: null } }, depthTest: false, depthWrite: false })
    const tri = new THREE.BufferGeometry()
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
    const blit = new THREE.Mesh(tri, this.blitMat)
    blit.frustumCulled = false
    this.blitScene.add(blit)
    this.vmCam.position.z = 1 / Math.tan((VM_FOV * Math.PI) / 360)
  }

  mount(target: HTMLCanvasElement | OffscreenCanvas): void {
    this.renderer = new THREE.WebGLRenderer({ canvas: target as HTMLCanvasElement, antialias: false, alpha: false })
    this.renderer.autoClear = false
    this.renderer.setClearColor(0x000000, 1)
  }

  // ------------------------------------------------------------- materials

  /**
   * A material on the renderer's own shaders. Every one encodes to sRGB as it
   * writes (`OUT_SRGB`): the frame's target holds encoded values like the
   * canvas, so the blended things — shadows, decals, clouds, ghosts — blend
   * exactly as they blend on the canvas, and the blit is a copy.
   */
  private raw(vert: string, frag: string, uniforms: Record<string, THREE.IUniform>, extra: THREE.ShaderMaterialParameters = {}, defines: Record<string, string> = {}): THREE.RawShaderMaterial {
    return new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: vert, fragmentShader: frag, uniforms, defines: { OUT_SRGB: '', ...defines }, ...extra })
  }

  private atlas(name: string): AtlasEntry | null {
    let a = this.atlases.get(name)
    if (a) return a
    const img = this.tiles?.atlas(name)
    if (!img) return null
    const tex = new THREE.Texture(img as HTMLImageElement)
    tex.magFilter = THREE.NearestFilter
    tex.minFilter = THREE.NearestFilter
    tex.generateMipmaps = false
    tex.colorSpace = THREE.SRGBColorSpace
    tex.flipY = false
    tex.needsUpdate = true
    const w = (img as { width: number }).width
    const h = (img as { height: number }).height
    const uniforms = { map: { value: tex }, distMap: { value: null as THREE.Texture | null }, atlasSize: { value: new THREE.Vector2(w, h) } }
    const fu = this.fieldUniforms
    const level = this.raw(LEVEL_VERT, LEVEL_FRAG, { map: uniforms.map, alphaTest: { value: 0.5 }, opacity: { value: 1 }, ...fu }, { side: THREE.DoubleSide })
    const decal = this.raw(LEVEL_VERT, LEVEL_FRAG, { map: uniforms.map, alphaTest: { value: 0.02 }, opacity: { value: 1 }, ...fu }, { side: THREE.DoubleSide, transparent: true, depthWrite: false })
    const su = { ...uniforms, ...fu, ...this.standUniforms, ...this.spriteUniforms }
    const ghost = (fadeStart: number, fadeRange: number) =>
      this.raw(SPRITE_VERT, SPRITE_FRAG, { ...su, ...this.ghostUniforms, fadeStart: { value: fadeStart }, fadeRange: { value: fadeRange } }, { transparent: true, depthTest: false, depthWrite: false }, { GHOST: '' })
    // the crowd is flagged transparent so three draws it after the ghosts (by render order), depth-tested and written as before
    a = {
      name,
      texture: tex,
      width: w,
      height: h,
      dist: null,
      peeled: false,
      uniforms,
      level,
      decal,
      sprite: {
        fixture: this.raw(SPRITE_VERT, SPRITE_FRAG, su),
        opaque: this.raw(SPRITE_VERT, SPRITE_FRAG, su, { transparent: true, depthWrite: true }),
        blend: this.raw(SPRITE_VERT, SPRITE_FRAG, su, { transparent: true, depthWrite: false }),
        ghostVisible: ghost(GHOST_FADE_VISIBLE_START, GHOST_FADE_VISIBLE),
        ghostRemembered: ghost(GHOST_FADE_START, GHOST_FADE),
      },
    }
    this.atlases.set(name, a)
    return a
  }

  private dropAtlases() {
    for (const a of this.atlases.values()) {
      a.texture.dispose()
      a.dist?.dispose()
      a.level.dispose()
      a.decal.dispose()
      for (const m of Object.values(a.sprite)) m.dispose()
    }
    this.atlases.clear()
    for (const b of this.batches.values()) {
      b.mesh.parent?.remove(b.mesh)
      b.dispose()
    }
    this.batches.clear()
    this.ghostCount = 0
  }

  // ------------------------------------------------------------------ peel

  /**
   * Peel the ink off the atlas and upload its distance field (peel.ts), in
   * the frame: the fallback for an atlas `warmAtlases` did not reach. Reading
   * a whole sheet back is the best part of a second on a Steam Deck, so the
   * host is expected to warm the sprite atlases while its loading screen is up.
   */
  private peelNow(a: AtlasEntry): void {
    if (a.peeled) return
    a.peeled = 'failed'
    const img = a.texture.image as TexImageSource | undefined
    if (!img) return
    try {
      const canvas = makeCanvas(a.width, a.height)
      if (!canvas) return
      const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null
      if (!ctx) return
      ctx.drawImage(img as CanvasImageSource, 0, 0)
      const image = ctx.getImageData(0, 0, a.width, a.height)
      const mask = peelInk(image.data, a.width, a.height, OPAQUE_ALPHA, this.tiles?.spriteRects?.(a.name))
      ctx.putImageData(image, 0, 0)
      this.installPeeled(a, canvas, distanceField(mask, a.width, a.height))
    } catch {
      /* the pixels cannot be read: the sprites of this atlas stay unbuilt */
    }
  }

  private installPeeled(a: AtlasEntry, image: TexImageSource, dist: Uint8Array) {
    a.texture.image = image
    a.texture.needsUpdate = true
    const t = new THREE.DataTexture(dist, a.width, a.height, THREE.RedFormat, THREE.UnsignedByteType)
    t.magFilter = THREE.NearestFilter
    t.minFilter = THREE.NearestFilter
    t.generateMipmaps = false
    t.unpackAlignment = 1
    t.flipY = false
    t.needsUpdate = true
    a.dist = t
    a.uniforms.distMap.value = t
    a.peeled = true
  }

  /**
   * Peel every sprite atlas now, in a worker, rather than leaving each to the
   * frame that first draws a sprite of it. A host calls it while its loading
   * screen is up, and need not wait for it.
   */
  async warmAtlases(): Promise<void> {
    const tiles = this.tiles
    if (!tiles || !this.alive) return
    for (const name of tiles.spriteAtlases?.() ?? []) {
      const a = this.atlas(name)
      if (!a || a.peeled) continue
      const img = a.texture.image as TexImageSource | undefined
      if (!img) continue
      const done = await this.peelInWorker(a, img).catch(() => false)
      if (this.tiles !== tiles || !this.alive) return
      if (!done) this.peelNow(a)
    }
  }

  private async peelInWorker(a: AtlasEntry, img: TexImageSource): Promise<boolean> {
    if (typeof Worker === 'undefined' || typeof createImageBitmap === 'undefined' || typeof OffscreenCanvas === 'undefined') return false
    const worker = this.peeler()
    if (!worker) return false
    const bitmap = await createImageBitmap(img as ImageBitmapSource)
    const id = ++this.peelId
    const reply = await new Promise<PeelReply>((resolve) => {
      const onMessage = (e: MessageEvent<PeelReply>) => {
        if (e.data.id !== id) return
        worker.removeEventListener('message', onMessage)
        resolve(e.data)
      }
      worker.addEventListener('message', onMessage)
      const req: PeelRequest = { id, bitmap, width: a.width, height: a.height, alphaMin: OPAQUE_ALPHA, sprites: this.tiles?.spriteRects?.(a.name) }
      worker.postMessage(req, [bitmap])
    })
    if (!reply.data || !reply.dist) return false
    if (a.peeled || !this.atlases.has(a.name)) return true
    const canvas = makeCanvas(a.width, a.height)
    const ctx = canvas?.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null
    if (!canvas || !ctx) return false
    ctx.putImageData(new ImageData(new Uint8ClampedArray(reply.data as ArrayBuffer), a.width, a.height), 0, 0)
    this.installPeeled(a, canvas as unknown as TexImageSource, new Uint8Array(reply.dist))
    return true
  }

  private peeler(): Worker | null {
    if (this.peelWorker !== undefined) return this.peelWorker
    try {
      this.peelWorker = new Worker(new URL('./peel.worker.js', import.meta.url), { type: 'module' })
    } catch {
      this.peelWorker = null
    }
    return this.peelWorker
  }

  /** Compile every program before the first frame needs it, so entering a level pays for none of them. */
  async warmShaders(): Promise<void> {
    const r = this.renderer
    if (!r || !this.alive) return
    const first = this.atlases.values().next().value ?? this.atlas(this.tiles?.atlasNames()[0] ?? '')
    const warm = new THREE.Scene()
    const mats: THREE.Material[] = [this.voidMat, this.shadowMat, this.cursorMat, this.cursorTileMat, this.blitMat]
    if (first) mats.push(first.level, first.decal, ...Object.values(first.sprite))
    const plain = new THREE.BufferGeometry()
    plain.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3))
    plain.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(6), 2))
    plain.setAttribute('color', new THREE.BufferAttribute(new Float32Array(9), 3))
    plain.setAttribute('cell', new THREE.BufferAttribute(new Float32Array(6), 2))
    plain.setAttribute('cut', new THREE.BufferAttribute(new Float32Array(3), 1))
    for (const m of mats) {
      const mesh = new THREE.Mesh(plain, m)
      mesh.visible = false
      warm.add(mesh)
    }
    await r.compileAsync(warm, this.cam)
    plain.dispose()
  }

  // ------------------------------------------------------------ the scene

  setOptions(opts: Render3dOptions) {
    if (opts.motion === false && this.opts.motion) {
      this.resetMotion()
      this.vmLift = NaN
    }
    Object.assign(this.opts, opts)
    this.cam.fov = this.opts.fov
    this.cam.updateProjectionMatrix()
    this.mesher.invalidate()
    this.builtRevision = -1
    this.builtLayout = -1
  }

  setTiles(tiles: TileSource): void {
    this.tiles = tiles
    this.dropAtlases()
    for (const h of this.handCache.values()) this.dropHand(h)
    this.handCache.clear()
    this.hands = { weapon: null, offhand: null }
    this.vmKey = ''
    this.clearLevel()
    this.builtRevision = -1
    this.builtLayout = -1
    this.crowdRevision = -1
  }

  setScene(scene: Scene, now = nowSeconds()): void {
    this.scene = scene
    this.trackMotion(now)
  }

  resetMotion(): void {
    this.movers.clear()
    this.motionRevision = -1
    this.crowdRevision = -1
  }

  private trackMotion(now: number): void {
    const scene = this.scene
    if (!scene || !this.opts.motion || scene.revision === this.motionRevision) return
    this.movers.track(scene.billboards, now)
    this.motionRevision = scene.revision
  }

  /** The same cell-space position the sprite will occupy in render(now). */
  monsterPosition(b: Billboard, now: number): { x: number; y: number } {
    const offset = this.opts.motion ? this.movers.offset(monsterId(b), now) : null
    return { x: b.x + (offset?.x ?? 0), y: b.y + (offset?.y ?? 0) }
  }

  setCamera(cam: Camera): void {
    this.camera = cam
  }

  setCursor(cursor: SceneCursor | null): void {
    this.cursor = cursor
  }

  setViewmodel(vm: Viewmodel | null): void {
    this.viewmodel = vm
    const key = vm ? JSON.stringify([vm.weapon?.layers, vm.offhand?.layers]) : ''
    if (key !== this.vmKey) {
      this.vmKey = key
      this.hands = { weapon: null, offhand: null }
    }
  }

  attack(): void {
    if (!this.opts.motion) return
    this.vmLift = nowSeconds()
  }

  /** True while something is still moving, so the host keeps rendering frames. */
  get animating(): boolean {
    return !Number.isNaN(this.vmLift) || this.movers.active || this.mesher.hasPending
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    if (this.renderer) {
      this.renderer.setPixelRatio(dpr)
      this.renderer.setSize(this.width, this.height, false)
    }
    this.cam.aspect = this.width / this.height
    this.cam.updateProjectionMatrix()
    this.vmCam.aspect = this.cam.aspect
    this.vmCam.updateProjectionMatrix()
  }

  destroy(): void {
    this.clearLevel()
    this.dropAtlases()
    this.movers.clear()
    this.motionRevision = -1
    for (const h of this.handCache.values()) this.dropHand(h)
    this.handCache.clear()
    this.hands = { weapon: null, offhand: null }
    this.shadowBatch.dispose()
    this.shadowMat.dispose()
    this.cursorMesh.geometry.dispose()
    this.cursorTileMesh.geometry.dispose()
    this.cursorMat.dispose()
    this.cursorTileMat.dispose()
    this.voidMat.dispose()
    this.blitMat.dispose()
    ;(this.blitScene.children[0] as THREE.Mesh).geometry.dispose()
    this.box.dispose()
    this.target?.dispose()
    this.target = null
    this.depthTarget?.dispose()
    this.depthTarget = null
    this.ghostUniforms.sceneDepth.value = null
    this.shadeTex?.dispose()
    this.shadeTex = null
    this.flashTex?.dispose()
    this.flashTex = null
    this.fieldUniforms.shadeMap.value = null
    this.fieldUniforms.flashMap.value = null
    this.renderer?.dispose()
    this.renderer = null
    this.peelWorker?.terminate()
    this.peelWorker = undefined
    this.alive = false
    this.builtRevision = -1
    this.builtLayout = -1
  }

  /** The lens after the last frame, for the HUD's edge pips. */
  projector(): { tanHalfY: number; aspect: number; height: number; toCamera(x: number, y: number, h: number): { x: number; y: number; z: number } } {
    const cam = this.cam
    cam.updateMatrixWorld()
    const inv = cam.matrixWorld.clone().invert()
    const v = new THREE.Vector3()
    return {
      tanHalfY: Math.tan((cam.fov * Math.PI) / 360),
      aspect: cam.aspect,
      height: this.height,
      toCamera: (x, y, h) => {
        v.set(x + 0.5, h, y + 0.5).applyMatrix4(inv)
        return { x: v.x, y: v.y, z: v.z }
      },
    }
  }

  /**
   * The cell under a point of the canvas: the view ray walked across the
   * level's cells until it meets a wall's body, the floor or the lid. Done on
   * the grid, not on the meshes: the level is the grid's own picture.
   */
  pick(px: number, py: number): CellKey | null {
    const scene = this.scene
    if (!scene) return null
    this.cam.updateMatrixWorld()
    const ndc = new THREE.Vector3((px / this.width) * 2 - 1, -(py / this.height) * 2 + 1, 0.5)
    const o = this.cam.position.clone()
    const d = ndc.unproject(this.cam).sub(o).normalize()
    const classAt = this.grid?.classAt ?? sceneClassAt(scene)
    const fo = { inset: this.opts.wallInset }
    const hasLid = scene.level.sky === 'none'
    let x = Math.floor(o.x), z = Math.floor(o.z)
    const sx = Math.sign(d.x), sz = Math.sign(d.z)
    let tx = d.x === 0 ? Infinity : ((sx > 0 ? x + 1 : x) - o.x) / d.x
    let tz = d.z === 0 ? Infinity : ((sz > 0 ? z + 1 : z) - o.z) / d.z
    const tdx = d.x === 0 ? Infinity : Math.abs(1 / d.x)
    const tdz = d.z === 0 ? Infinity : Math.abs(1 / d.z)
    let tIn = 0
    for (let i = 0; i < 256; i++) {
      const tOut = Math.min(tx, tz)
      if (classAt(x, z) !== 'floor') {
        // a solid cell: does the ray meet its body's box between entering and leaving the cell?
        const r = bodyRect(classAt, x, z, fo)
        if (r) {
          const t0 = slab(o.x, d.x, x + r.x0, x + r.x1), t1 = slab(o.z, d.z, z + r.z0, z + r.z1), t2 = slab(o.y, d.y, 0, 1)
          const enter = Math.max(t0[0], t1[0], t2[0], tIn), leave = Math.min(t0[1], t1[1], t2[1], tOut)
          if (enter <= leave) return cellKey(x, z)
        }
      } else {
        // an open cell: the floor or the lid inside it
        if (d.y < 0) {
          const t = -o.y / d.y
          if (t >= tIn && t <= tOut) return cellKey(x, z)
        } else if (d.y > 0 && hasLid) {
          const t = (1 - o.y) / d.y
          if (t >= tIn && t <= tOut) return cellKey(x, z)
        }
      }
      if (!Number.isFinite(tOut)) return null
      tIn = tOut
      if (tx < tz) { x += sx; tx += tdx } else { z += sz; tz += tdz }
    }
    return null
  }

  // ------------------------------------------------------------- the level

  private tileDraw(): (id: number) => TileDraw | null {
    const tiles = this.tiles!
    const cache = new Map<number, TileDraw | null>()
    return (id) => {
      let t = cache.get(id)
      if (t !== undefined) return t
      const r = tiles.tile(id)
      const a = r ? this.atlas(r.atlas) : null
      t = r && a ? { r, atlas: r.atlas, uv: uvFor(r, a.width, a.height) } : null
      cache.set(id, t)
      return t
    }
  }

  private clearLevel() {
    for (const ck of this.mesher.clear().dropped) this.dropChunk(ck)
    for (const ck of [...this.levelMeshes.keys()]) this.dropChunk(ck)
    this.grid = null
    this.fixtures = []
  }

  private dropChunk(ck: number) {
    const meshes = this.levelMeshes.get(ck)
    if (!meshes) return
    for (const m of meshes) {
      this.three.remove(m)
      m.geometry.dispose()
    }
    this.levelMeshes.delete(ck)
  }

  /** Put the chunks the mesher just built up as meshes, in place of what stood. */
  private placeChunks(built: number[]) {
    for (const ck of built) {
      this.dropChunk(ck)
      const parts = this.mesher.chunks.get(ck)
      if (!parts) continue
      const meshes: THREE.Mesh[] = []
      for (const g of parts) {
        const mesh = this.chunkMesh(g)
        if (!mesh) continue
        this.three.add(mesh)
        meshes.push(mesh)
      }
      if (meshes.length) this.levelMeshes.set(ck, meshes)
    }
  }

  private chunkMesh(g: ChunkGeometry): THREE.Mesh | null {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(g.position, 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(g.uv, 2))
    geo.setAttribute('color', new THREE.BufferAttribute(g.color, 3))
    geo.setAttribute('cell', new THREE.BufferAttribute(g.cell, 2))
    geo.setAttribute('cut', new THREE.BufferAttribute(g.cut, 1))
    geo.setIndex(new THREE.BufferAttribute(g.index, 1))
    geo.computeBoundingSphere()
    let mat: THREE.Material
    if (g.kind === 'void') mat = this.voidMat
    else {
      const a = this.atlas(g.atlas)
      if (!a) {
        geo.dispose()
        return null
      }
      mat = g.kind === 'decal' ? a.decal : a.level
    }
    const mesh = new THREE.Mesh(geo, mat)
    if (g.kind === 'decal') mesh.renderOrder = 1
    return mesh
  }

  private rebuildLevel(scene: Scene, grid: LevelGrid) {
    if (!this.tiles) {
      this.clearLevel()
      return
    }
    const ctx: MeshContext = { tileOf: this.tileDraw(), fo: { inset: this.opts.wallInset }, chamfer: this.opts.chamfer }
    this.placeChunks(this.mesher.update(grid, ctx, LEVEL_BUDGET_MS))
    this.mark?.('level')
    this.stats.fixtureBuilds++
    const tiles = this.tiles
    this.fixtures = fixtureInstances(scene, (id) => tiles.tile(id), grid.framed, grid.occupied)
    this.crowdRevision = -1
  }

  // ------------------------------------------------------------ the fields

  private updateFields(scene: Scene) {
    this.stats.fieldUpdates++
    const b = scene.bounds
    const ox = b.left - 1, oz = b.top - 1
    const w = Math.max(1, b.right - b.left + 3)
    const h = Math.max(1, b.bottom - b.top + 3)
    let shade = this.shadeTex
    let flash = this.flashTex
    if (!shade || !flash || shade.image.width !== w || shade.image.height !== h) {
      shade?.dispose()
      flash?.dispose()
      shade = this.shadeTex = new THREE.DataTexture(new Uint8Array(w * h), w, h, THREE.RedFormat, THREE.UnsignedByteType)
      shade.magFilter = THREE.NearestFilter
      shade.minFilter = THREE.NearestFilter
      shade.generateMipmaps = false
      shade.unpackAlignment = 1
      flash = this.flashTex = new THREE.DataTexture(new Uint8Array(w * h * 4), w, h, THREE.RGBAFormat, THREE.UnsignedByteType)
      flash.magFilter = THREE.LinearFilter
      flash.minFilter = THREE.LinearFilter
      flash.generateMipmaps = false
      this.fieldUniforms.shadeMap.value = shade
      this.fieldUniforms.flashMap.value = flash
      this.fieldUniforms.fieldSize.value.set(w, h)
    }
    this.fieldUniforms.fieldOrigin.value.set(ox, oz)
    const sd = shade.image.data as Uint8Array
    const fd = flash.image.data as Uint8Array
    let hue = { r: 0, g: 0, b: 0 }
    for (const cell of scene.cells.values()) {
      if (!cell.flash || cell.flash.a <= 0) continue
      hue = { r: cell.flash.r, g: cell.flash.g, b: cell.flash.b }
      break
    }
    sd.fill(255)
    for (let i = 0; i < w * h; i++) {
      fd[i * 4] = hue.r
      fd[i * 4 + 1] = hue.g
      fd[i * 4 + 2] = hue.b
      fd[i * 4 + 3] = 0
    }
    for (const cell of scene.cells.values()) {
      const x = cell.x - ox, z = cell.y - oz
      if (x < 0 || x >= w || z < 0 || z >= h) continue
      const i = z * w + x
      sd[i] = Math.round(shadeOf(cell, scene) * 255)
      const f = cell.flash
      if (f?.a) {
        fd[i * 4] = f.r
        fd[i * 4 + 1] = f.g
        fd[i * 4 + 2] = f.b
        fd[i * 4 + 3] = Math.min(255, f.a)
      }
    }
    shade.needsUpdate = true
    flash.needsUpdate = true
  }

  // ------------------------------------------------------------- the crowd

  private batch(a: AtlasEntry, pass: SpritePass): Batch {
    const key = `${a.name}|${pass}`
    let b = this.batches.get(key)
    if (!b) {
      // among what blends: the ghosts of what is in view, then remembered ghosts, then the crowd over them, then the translucent
      const order = pass === 'ghostVisible' ? -2 : pass === 'ghostRemembered' ? -1 : pass === 'blend' ? 1 : 0
      b = new Batch(this.box, a.sprite[pass], SPRITE_ATTRS, order)
      if (pass !== 'fixture') b.mesh.layers.set(LAYER_STANDING)
      this.three.add(b.mesh)
      this.batches.set(key, b)
    }
    return b
  }

  /**
   * Write every standing instance — the fixtures, the crowd, the shadows —
   * into its batch. Whole lists, every time: a few hundred instances of a
   * few floats each, which is less than the bookkeeping it would take to
   * write less. The blended ones go back to front from the eye.
   */
  private writeInstances(eye: { x: number; y: number }, now: number) {
    this.stats.crowdSyncs++
    for (const b of this.batches.values()) b.begin()
    this.shadowBatch.begin()
    const blend: SpriteInstance[] = []
    const offsetOf = (id: number | undefined) => (this.opts.motion ? this.movers.offset(id, now) : null)
    const write = (inst: SpriteInstance) => {
      const a = this.atlas(inst.atlas)
      if (!a) return
      if (!a.peeled) this.peelNow(a)
      if (a.peeled !== true) return
      const o = offsetOf(inst.moverId)
      const anchor = o ? [inst.anchor[0] + o.x, inst.anchor[1], inst.anchor[2] + o.y] : inst.anchor
      this.batch(a, inst.pass).push([anchor, inst.quad, inst.z, inst.texel, inst.color, inst.misc, inst.cell])
      this.stats.spriteWrites++
    }
    this.ghostCount = 0
    for (const inst of this.fixtures) write(inst)
    for (const inst of this.crowd) {
      if (inst.pass === 'blend') blend.push(inst)
      else {
        if (inst.pass === 'ghostVisible' || inst.pass === 'ghostRemembered') this.ghostCount++
        write(inst)
      }
    }
    if (blend.length) {
      const far = (i: SpriteInstance) => {
        const o = offsetOf(i.moverId)
        const dx = i.anchor[0] + (o?.x ?? 0) - (eye.x + 0.5), dz = i.anchor[2] + (o?.y ?? 0) - (eye.y + 0.5)
        return dx * dx + dz * dz
      }
      blend.sort((p, q) => far(q) - far(p))
      for (const inst of blend) write(inst)
    }
    for (const s of this.shadows) {
      const o = offsetOf(s.moverId)
      this.shadowBatch.push([[s.x + 0.5 + (o?.x ?? 0), 0, s.y + 0.5 + (o?.y ?? 0)], [s.r]])
    }
    for (const b of this.batches.values()) b.end()
    this.shadowBatch.end()
  }

  private placeCursor() {
    const cur = this.cursor
    if (!cur) {
      this.cursorMesh.visible = this.cursorTileMesh.visible = false
      return
    }
    const rect = cur.tile !== undefined && this.tiles ? this.tiles.tile(cur.tile) : undefined
    const a = rect ? this.atlas(rect.atlas) : null
    if (rect && a) {
      const uv = uvFor(rect, a.width, a.height)
      this.cursorTileMat.uniforms.map.value = a.texture
      this.cursorTileMat.uniforms.uvRect.value.set(uv.u0, uv.v0, uv.u1, uv.v1)
      this.cursorTileMesh.visible = true
      this.cursorMesh.visible = false
      this.cursorTileMesh.position.set(cur.x + 0.5, 0.012, cur.y + 0.5)
    } else {
      this.cursorTileMesh.visible = false
      this.cursorMesh.visible = true
      const c = new THREE.Color(cur.mode === 'map' ? CURSOR_MAP_COLOUR : CURSOR_COLOUR)
      this.cursorMat.uniforms.color.value.set(c.r, c.g, c.b, 0.95)
      this.cursorMesh.position.set(cur.x + 0.5, 0.012, cur.y + 0.5)
    }
  }

  // -------------------------------------------------------------- the frame

  /**
   * The frame's target and the ghosts' depth image (II.4: the level and its
   * fixtures), made at the frame's size or remade when that changes.
   */
  private targetsFor(r: THREE.WebGLRenderer): { frame: THREE.WebGLRenderTarget; depth: THREE.WebGLRenderTarget } {
    const size = r.getDrawingBufferSize(this.bufferSize)
    const w = Math.max(1, size.x), h = Math.max(1, size.y)
    let rt = this.target
    let dt = this.depthTarget
    if (!rt || !dt || rt.width !== w || rt.height !== h) {
      rt?.dispose()
      dt?.dispose()
      const opts = { depthBuffer: true, stencilBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false }
      rt = this.target = new THREE.WebGLRenderTarget(w, h, opts)
      const depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType)
      dt = this.depthTarget = new THREE.WebGLRenderTarget(w, h, { ...opts, depthTexture })
      this.ghostUniforms.sceneDepth.value = depthTexture
      this.ghostUniforms.resolution.value.set(w, h)
      this.blitMat.uniforms.map.value = rt.texture
    }
    return { frame: rt, depth: dt }
  }

  render(now = nowSeconds()): void {
    const r = this.renderer
    const scene = this.scene
    const cam = this.camera
    if (!r || !scene || !cam) return
    this.lift = Number.isNaN(this.vmLift) ? NaN : this.liftEnvelope(now - this.vmLift)
    if (Number.isNaN(this.lift)) this.vmLift = NaN
    // a step that ends this frame leaves the crowd standing where the last frame drew it: it is written once more, on its cell
    let landed = false
    if (this.opts.motion) {
      this.trackMotion(now)
      landed = this.movers.landed(now).length > 0
    }
    let builtLevel = false
    if (scene.revision !== this.builtRevision) {
      this.builtRevision = scene.revision
      const grid = new LevelGrid(scene)
      const t = scene.level.tint
      const tintKey = `${t.r},${t.g},${t.b}`
      if (scene.layoutRevision !== this.builtLayout || tintKey !== this.builtTint || !this.grid || this.mesher.occupiedChanged(grid)) {
        this.builtLayout = scene.layoutRevision
        this.builtTint = tintKey
        builtLevel = true
        this.grid = grid
        this.rebuildLevel(scene, grid)
      }
      this.updateFields(scene)
      this.mark?.('fields')
    }
    if (this.mesher.hasPending && !builtLevel) {
      this.placeChunks(this.mesher.continue_(LEVEL_BUDGET_MS))
      this.mark?.('level')
    }
    // the crowd's instances are worked out again for a new scene or a new selection; written every frame something moves
    const selKey = this.cursor ? `${this.cursor.x},${this.cursor.y}` : ''
    if (scene.revision !== this.crowdRevision || selKey !== this.crowdSelection) {
      this.crowdRevision = scene.revision
      this.crowdSelection = selKey
      const tiles = this.tiles
      const { sprites, shadows } = tiles ? crowdInstances(scene, (id) => tiles.tile(id), this.cursor) : { sprites: [], shadows: [] }
      this.crowd = sprites
      this.shadows = shadows
      this.writeInstances({ x: cam.eyeX, y: cam.eyeY }, now)
    } else if (this.movers.active || landed) this.writeInstances({ x: cam.eyeX, y: cam.eyeY }, now)
    this.mark?.('crowd')
    this.cam.position.set(cam.eyeX + 0.5, Math.max(EYE_MIN, Math.min(EYE_MAX, this.opts.eyeHeight)), cam.eyeY + 0.5)
    this.cam.rotation.set(cam.pitch, -cam.yaw, 0)
    this.cam.updateMatrixWorld()
    this.standUniforms.standYaw.value = this.cam.rotation.y
    this.placeCursor()
    this.mark?.('place')
    const bg = scene.level.sky === 'open' ? 0x0b1220 : scene.level.sky === 'dark' ? 0x120818 : 0x000000
    const { frame, depth } = this.targetsFor(r)
    // the target holds encoded values, and three would clear it in linear: hand it the encoded colour as if linear
    r.setClearColor(new THREE.Color().setRGB(((bg >> 16) & 255) / 255, ((bg >> 8) & 255) / 255, (bg & 255) / 255, THREE.LinearSRGBColorSpace), 1)
    if (this.ghostCount > 0) {
      // the level and its fixtures alone, for their depth: what the ghosts show through
      this.ghostUniforms.cameraNear.value = this.cam.near
      this.ghostUniforms.cameraFar.value = this.cam.far
      const layers = this.cam.layers.mask
      this.cam.layers.set(0)
      r.setRenderTarget(depth)
      r.clear(true, true, false)
      r.render(this.three, this.cam)
      this.cam.layers.mask = layers
    }
    r.setRenderTarget(frame)
    r.clear(true, true, false)
    r.render(this.three, this.cam)
    r.setRenderTarget(null)
    r.render(this.blitScene, this.cam)
    this.mark?.('draw')
    this.renderViewmodel(r, scene)
  }

  // ------------------------------------------------------------- viewmodel

  /** Where the hands are drawn, as fractions of the canvas, so the HUD keeps its corner clear of them. */
  handsFootprint(): HandRect[] {
    if (!this.vmVisible) return []
    const vm = this.viewmodel!
    return handsFootprint({ weapon: !!vm.weapon, offhand: !vm.offhand ? 'none' : vm.offhand.name?.startsWith('HAND2_') ? 'shield' : 'weapon' }, this.cam.aspect)
  }

  private get vmVisible(): boolean {
    return this.opts.viewmodel && !!this.viewmodel && (!!this.viewmodel.weapon || !!this.viewmodel.offhand)
  }

  private liftEnvelope(t: number): number {
    if (t < 0 || t >= VM_LIFT_S) return NaN
    const u = t / VM_LIFT_S
    return u < 0.3 ? u / 0.3 : 1 - (u - 0.3) / 0.7
  }

  /** The item's icon layers painted into one cell-sized pixel grid, as WebTiles composes an inventory icon. */
  private paintIcon(item: HandItem): { canvas: HTMLCanvasElement | OffscreenCanvas; cell: number; data: Uint8ClampedArray } | null {
    if (!this.tiles) return null
    let cell = 32
    const rects: { r: TileRect; h: number; img: TexImageSource }[] = []
    for (const l of item.layers) {
      const r = this.tiles.tile(l.tile, l.layer)
      if (!r) continue
      const img = this.tiles.atlas(r.atlas)
      if (!img) continue
      let h = r.h
      if (l.ymax !== undefined && l.ymax < r.oy + r.h) h = Math.max(0, l.ymax - r.oy)
      if (h <= 0) continue
      cell = r.cell
      rects.push({ r, h, img })
    }
    if (!rects.length) return null
    const canvas = makeCanvas(cell, cell)
    const ctx = canvas?.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null
    if (!canvas || !ctx) return null
    ctx.imageSmoothingEnabled = false
    try {
      for (const { r, h, img } of rects) ctx.drawImage(img as CanvasImageSource, r.sx, r.sy, r.w, h, r.ox, r.oy, r.w, h)
      const image = ctx.getImageData(0, 0, cell, cell)
      // the hands are the same art as the world's sprites, so they lose the same outline
      peelInk(image.data, cell, cell, 128)
      ctx.putImageData(image, 0, 0)
      return { canvas, cell, data: image.data }
    } catch {
      return null
    }
  }

  /**
   * One hand: the icon as a texture of its own, its distance field, and one
   * instance of the sprite box VM_DEPTH texels thick, its hull closed both
   * sides (a hand is posed with its back to the eye as often as its front),
   * hanging from the bottom centre of its opaque texels.
   */
  private buildHand(item: HandItem): Hand | null {
    const px = this.paintIcon(item)
    if (!px) return null
    const { canvas, cell, data } = px
    const mask = new Uint8Array(cell * cell)
    let bx0 = cell, bx1 = -1, by0 = cell, by1 = -1
    for (let y = 0; y < cell; y++)
      for (let x = 0; x < cell; x++)
        if (data[(y * cell + x) * 4 + 3] >= 128) {
          mask[y * cell + x] = 1
          if (x < bx0) bx0 = x
          if (x > bx1) bx1 = x
          if (y < by0) by0 = y
          if (y > by1) by1 = y
        }
    if (bx1 < 0) return null
    const texture = new THREE.Texture(canvas as unknown as HTMLImageElement)
    texture.magFilter = texture.minFilter = THREE.NearestFilter
    texture.generateMipmaps = false
    texture.colorSpace = THREE.SRGBColorSpace
    texture.flipY = false
    texture.needsUpdate = true
    const dist = new THREE.DataTexture(distanceField(mask, cell, cell), cell, cell, THREE.RedFormat, THREE.UnsignedByteType)
    dist.magFilter = dist.minFilter = THREE.NearestFilter
    dist.generateMipmaps = false
    dist.unpackAlignment = 1
    dist.needsUpdate = true
    const material = this.raw(
      SPRITE_VERT,
      SPRITE_FRAG,
      { map: { value: texture }, distMap: { value: dist }, atlasSize: { value: new THREE.Vector2(cell, cell) }, ...this.fieldUniforms, ...this.standUniforms, ...this.spriteUniforms, modelInverse: { value: new THREE.Matrix4() } },
      {},
      { OUT_SRGB: '' },
    )
    const batch = new Batch(this.box, material, SPRITE_ATTRS, 0)
    // the origin is the bottom centre of the opaque texels, so an icon drawn off-centre in its cell still hangs from the hand
    const cxb = (bx0 + bx1 + 1) / 2
    const bottom = by1 + 1
    const s = (VM_SIZE * VM_FILL) / Math.max(bx1 - bx0 + 1, by1 - by0 + 1)
    this.vmScene.add(batch.mesh)
    return { texture, dist, material, batch, cell, quad: [(cell / 2 - cxb) * s, (bottom - cell / 2) * s, (cell / 2) * s, (cell / 2) * s], scale: s }
  }

  private dropHand(h: Hand | null) {
    if (!h) return
    this.vmScene.remove(h.batch.mesh)
    h.batch.dispose()
    h.material.dispose()
    h.texture.dispose()
    h.dist.dispose()
  }

  private hand(item: HandItem | null): Hand | null {
    if (!item) return null
    const key = JSON.stringify(item.layers)
    let h = this.handCache.get(key)
    if (h === undefined) {
      h = this.buildHand(item)
      this.handCache.set(key, h)
    }
    return h
  }

  private renderViewmodel(r: THREE.WebGLRenderer, scene: Scene) {
    if (!this.vmVisible || !this.tiles) return
    const vm = this.viewmodel!
    if (!this.hands.weapon && vm.weapon) this.hands.weapon = this.hand(vm.weapon)
    if (!this.hands.offhand && vm.offhand) this.hands.offhand = this.hand(vm.offhand)
    for (const h of this.handCache.values()) if (h) h.batch.mesh.visible = false
    const asp = this.vmCam.aspect
    const lift = this.lift
    const tint = scene.level.tint
    const flash = flashOf(getCell(scene, scene.player.x, scene.player.y))
    const pose = (h: Hand | null, p: HandPose, push = 0) => {
      if (!h) return
      const m = h.batch.mesh
      m.visible = true
      const len = Math.hypot(p.x * asp, p.y) || 1
      m.position.set(p.x * asp * (1 - push / len), p.y * (1 - push / len), 0)
      m.rotation.set(p.pitch, p.yaw, p.roll, 'YXZ')
      m.updateMatrixWorld()
      ;(h.material.uniforms.modelInverse.value as THREE.Matrix4).copy(m.matrixWorld).invert()
      // the hands take the level's light and the flash over the cell the player stands in
      h.batch.begin()
      h.batch.push([[0, 0, 0], h.quad, [0, VM_DEPTH * h.scale], [0, 0, h.cell, h.cell], [tint.r, tint.g, tint.b, 1], [MODE_THICK | MODE_HULL_FRONT | MODE_FLASH_OVERRIDE, 1, h.scale, 0], [0, 0]])
      h.batch.end()
    }
    this.spriteUniforms.flashOverride.value.set(flash.r, flash.g, flash.b, flash.a)
    pose(this.hands.weapon, VM_WEAPON_REST, (lift || 0) * VM_LIFT)
    pose(this.hands.offhand, vm.offhand?.name?.startsWith('HAND2_') ? VM_SHIELD_REST : VM_OFFWEAPON_REST)
    r.clearDepth()
    r.render(this.vmScene, this.vmCam)
  }

}

/** The parameter range over which `o + t·d` lies within [lo, hi]; empty (a > b) when it never does. */
function slab(o: number, d: number, lo: number, hi: number): [number, number] {
  if (d === 0) return o >= lo && o <= hi ? [-Infinity, Infinity] : [Infinity, -Infinity]
  const a = (lo - o) / d, b = (hi - o) / d
  return a < b ? [a, b] : [b, a]
}

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas | null {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    return c
  }
  return null
}

function nowSeconds(): number {
  return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000
}

export { BLOCK_SHADE }
export type { Billboard, Viewmodel }
export * from './footprint.js'
export { gridWalk } from './gridwalk.js'
export { peelInk, distanceField } from './peel.js'
export { LevelGrid, framedDoors, occupiedFeatures } from './grid.js'
export { LevelMesher, LEVEL_CHUNK, LEVEL_REACH, type ChunkGeometry, type MeshContext } from './level-mesh.js'
export * from './sprites.js'
