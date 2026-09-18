/**
 * The WebGL2 backend: walks a scene, culls by bounding sphere, sorts the
 * opaque and the blended draws, compiles a program per distinct material
 * source, uploads what changed, and draws.
 *
 * It draws the subset @orbrun/render-3d needs (docs/custom-renderer-plan.md),
 * and where a choice could move a pixel against the baseline, the baseline's
 * way is kept on purpose:
 *
 * - The draw order. Opaque draws go front to back within a `renderOrder`,
 *   grouped by material; blended draws go back to front, by the depth of the
 *   object's bounding-sphere centre, with the object's id breaking ties. The
 *   ghosts, the shadows and the cursor lean on that order.
 * - A transparent double-sided material is drawn twice, back faces first
 *   (with the front face wound clockwise, so `gl_FrontFacing` reads the far
 *   side as front) and then front faces.
 * - The state defaults: depth LEQUAL, straight-alpha blending
 *   (SRC_ALPHA, ONE_MINUS_SRC_ALPHA; ONE, ONE_MINUS_SRC_ALPHA for alpha), the
 *   clear colour encoded to sRGB, no unpack colour conversion, an sRGB atlas
 *   stored as SRGB8_ALPHA8 and the frame encoded in the shader.
 *
 * Every GL object is keyed off its owner (geometry, texture, target) and
 * released on the owner's `dispose`; a lost context drops them all and a
 * restored one rebuilds them on demand, so the renderer never throws while
 * the context is gone.
 */
import { Camera, Mesh, Object3D, Scene, type BufferAttribute, type BufferGeometry } from './core.js'
import { Color, Frustum, Matrix3, Matrix4, SRGBColorSpace, Vector3, Vector4, type ColorSpace } from './math.js'
import { BackSide, DoubleSide, FrontSide, Material, MeshBasicMaterial, NormalBlending, ShaderMaterial, type IUniform, type Side } from './material.js'
import { buildSources, basicFragment, basicVertex, programKey, type ProgramParameters } from './shaders.js'
import { DepthFormat, DepthTexture, LinearFilter, NearestFilter, RGBAFormat, RedFormat, RepeatWrapping, Source, Texture, UnsignedIntType, WebGLRenderTarget, type DataImage } from './texture.js'

export interface WebGLRendererParameters {
  canvas?: HTMLCanvasElement | OffscreenCanvas
  alpha?: boolean
  antialias?: boolean
  premultipliedAlpha?: boolean
  preserveDrawingBuffer?: boolean
  depth?: boolean
  stencil?: boolean
  powerPreference?: 'default' | 'high-performance' | 'low-power'
  failIfMajorPerformanceCaveat?: boolean
}

interface UniformInfo {
  location: WebGLUniformLocation
  type: number
  /** The last value uploaded, so an unchanged one is not uploaded again. */
  cache: number[]
}

interface Program {
  id: number
  program: WebGLProgram
  /**
   * The shaders, held until the link is checked. Linking is left to run in the driver's
   * own time (KHR_parallel_shader_compile where it exists), so `compile()` can hand every
   * program over at once; the link status and the introspection wait for the first draw.
   */
  vs: WebGLShader | null
  fs: WebGLShader | null
  linked: boolean
  uniforms: Map<string, UniformInfo>
  attributes: Map<string, number>
  /** The attributes as parallel arrays, for the per-draw loops (a Map iterator is an allocation a frame can do without). */
  attributeNames: string[]
  attributeLocations: number[]
  /** Which camera's matrices the program holds, and which frame they were set in. */
  cameraStamp: number
  /** The material-facing uniforms, by name, that the program actually has. */
  usedNames: string[]
  /** The built-in uniforms every draw sets, looked up once here rather than by name per draw. */
  modelViewMatrix: UniformInfo | null
  modelMatrix: UniformInfo | null
  projectionMatrix: UniformInfo | null
  viewMatrix: UniformInfo | null
  cameraPosition: UniformInfo | null
  isOrthographic: UniformInfo | null
}

interface MaterialProps {
  version: number
  /** Programs by cache key: a transparent double-sided material has one per side it is drawn with. */
  programs: Map<string, Program>
  /** The same programs by the few bits of material and geometry that pick one (`fastKey`), so a draw builds no key string. */
  fast: Map<number, Program>
  /** The uniform table the program reads: a basic material's built-ins plus what `onBeforeCompile` added, or a ShaderMaterial's own. */
  uniforms: Record<string, IUniform> | null
  currentProgram: Program | null
  /** The program uniforms that have a value in the table, paired up, per program: a double-sided transparent material alternates two. */
  uniformsLists: Map<Program, [UniformInfo, IUniform][]>
}

interface AttributeGL {
  buffer: WebGLBuffer
  version: number
  /** Element count the buffer was allocated for; a longer array is a new allocation. */
  length: number
}

interface VertexArrayGL {
  vao: WebGLVertexArrayObject
  bound: (BufferAttribute | undefined)[]
  index: BufferAttribute | null
  /**
   * The constant values of the attributes the geometry lacks. A generic attribute's value is
   * context state, not vertex-array state, so it is set again at every bind where the context
   * holds another value, not once at the vertex array's build.
   */
  generic: { location: number; value: number[] }[]
}

interface GeometryGL {
  attributes: Map<BufferAttribute, AttributeGL>
  /** One vertex array per program layout, keyed by program id, with the attribute objects it was bound with. */
  vaos: Map<number, VertexArrayGL>
}

/**
 * The GL texture behind a `Source`, shared by every `Texture` on it (a clone of the atlas
 * is one upload). The sampler state is the last texture's to upload through
 * it; clones with different filters or wrapping are not told apart.
 */
interface TextureGL {
  texture: WebGLTexture
  /** The source version uploaded, or -1 for none yet. */
  version: number
  width: number
  height: number
  /** Mip levels the storage was allocated with: the full chain where the texture asks for mipmaps. */
  levels: number
  /** The textures sharing this upload; the GL texture goes when the last of them is disposed. */
  owners: Set<Texture>
}

interface RenderTargetGL {
  framebuffer: WebGLFramebuffer
  /** The depth (and stencil) renderbuffer, where the target has no depth texture; deleted with the framebuffer. */
  renderbuffer: WebGLRenderbuffer | null
  /** The size the attachments were allocated at: a target resized since is rebuilt at its next bind. */
  width: number
  height: number
}

export interface RenderItem {
  id: number
  object: Mesh
  geometry: BufferGeometry
  material: Material
  groupOrder: number
  renderOrder: number
  z: number
}

const FLOAT = 0x1406
const FLOAT_VEC2 = 0x8b50
const FLOAT_VEC3 = 0x8b51
const FLOAT_VEC4 = 0x8b52
const INT = 0x1404
const BOOL = 0x8b56
const FLOAT_MAT3 = 0x8b5b
const FLOAT_MAT4 = 0x8b5c
const SAMPLER_2D = 0x8b5e

/** Opaque order: group, then `renderOrder`, then material, then front to back, then object id. */
export function painterSortStable(a: RenderItem, b: RenderItem): number {
  if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder
  else if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder
  else if (a.material.id !== b.material.id) return a.material.id - b.material.id
  else if (a.z !== b.z) return a.z - b.z
  else return a.id - b.id
}

/** Blended order: group, then `renderOrder`, then back to front, then object id. */
export function reversePainterSortStable(a: RenderItem, b: RenderItem): number {
  if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder
  else if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder
  else if (a.z !== b.z) return b.z - a.z
  else return a.id - b.id
}

const _projScreenMatrix = /*@__PURE__*/ new Matrix4()
const _frustum = /*@__PURE__*/ new Frustum()
const _vector4 = /*@__PURE__*/ new Vector4()
const _vector3 = /*@__PURE__*/ new Vector3()
const _rgb = { r: 0, g: 0, b: 0 }
const _mat3 = new Float32Array(9)
const _mat4 = new Float32Array(16)

let _programId = 0

export class WebGLRenderer {
  readonly domElement: HTMLCanvasElement
  autoClear = true
  autoClearColor = true
  autoClearDepth = true
  autoClearStencil = true
  sortObjects = true
  /** The frame is encoded to this on the way out; sRGB, as a canvas is. */
  outputColorSpace: ColorSpace = SRGBColorSpace
  /**
   * Draw depth alone: every fragment stops after its alpha test and the colour buffer is
   * masked off, so a pass whose only reader samples depth (the ghosts' occluder image)
   * pays for no shading. Programs are compiled per mode and kept, so switching is free
   * after the first frame.
   */
  depthOnly = false
  /** Work done, for the test bed: draws issued this frame, programs compiled ever. */
  readonly info = { render: { calls: 0, frame: 0 }, programs: 0 }
  private gl!: WebGL2RenderingContext
  private readonly premultipliedAlpha: boolean
  private lost = false
  /** Whether the frame being drawn is left linear (a render target's texture, unless it says sRGB): part of the program key. */
  private outputLinear = false
  /** KHR_parallel_shader_compile is present: a link's status can be polled rather than waited for. */
  private parallelCompile = false
  private _width = 1
  private _height = 1
  private _pixelRatio = 1
  private _viewport = new Vector4(0, 0, 1, 1)
  private _currentViewport = new Vector4(0, 0, 1, 1)
  private _clearColor = new Color(0x000000)
  private _clearAlpha = 0
  private currentRenderTarget: WebGLRenderTarget | null = null
  // GL state as last set, so a draw that needs nothing changed sets nothing
  private s = {
    blend: false,
    blending: -1,
    premult: false,
    depthTest: true,
    depthMask: true,
    cull: true,
    flipSided: false,
    colorMask: true,
    program: null as WebGLProgram | null,
    vao: null as WebGLVertexArrayObject | null,
    unit: -1,
    bound: [] as (WebGLTexture | null)[],
    clear: [0, 0, 0, 1],
    unpackFlipY: false,
    unpackPremultiply: false,
    unpackAlignment: 4,
    unpackConversion: 0,
    framebuffer: null as WebGLFramebuffer | null,
    /** The constant value each generic attribute location holds, where one was set. */
    generic: [] as (number[] | undefined)[],
  }
  private programs = new Map<string, Program>()
  private materials = new WeakMap<Material, MaterialProps>()
  private geometries = new WeakMap<BufferGeometry, GeometryGL>()
  private textures = new WeakMap<Source, TextureGL>()
  private targets = new WeakMap<WebGLRenderTarget, RenderTargetGL>()
  /**
   * How to unhook every dispose listener registered against the current context, so a
   * restored one starts clean instead of leaving each owner with a listener per context.
   * Held strongly until the owner is disposed or the context is lost, like the GL handle it guards.
   */
  private unhooks = new Set<() => void>()
  private emptyTexture: WebGLTexture | null = null
  private opaque: RenderItem[] = []
  private transparent: RenderItem[] = []
  private items: RenderItem[] = []
  private itemsUsed = 0
  private currentMaterialId = -1
  private currentCamera: Camera | null = null
  private cameraStamp = 0
  private textureUnit = 0
  private readonly onLost = (ev: Event) => {
    ev.preventDefault()
    this.lost = true
  }
  private readonly onRestored = () => {
    this.lost = false
    this.initContext()
  }

  constructor(parameters: WebGLRendererParameters = {}) {
    const canvas = (parameters.canvas ?? document.createElement('canvas')) as HTMLCanvasElement
    this.domElement = canvas
    this.premultipliedAlpha = parameters.premultipliedAlpha ?? true
    const attributes: WebGLContextAttributes = {
      alpha: parameters.alpha ?? false,
      depth: parameters.depth ?? true,
      stencil: parameters.stencil ?? false,
      antialias: parameters.antialias ?? false,
      premultipliedAlpha: this.premultipliedAlpha,
      preserveDrawingBuffer: parameters.preserveDrawingBuffer ?? false,
      powerPreference: parameters.powerPreference ?? 'default',
      failIfMajorPerformanceCaveat: parameters.failIfMajorPerformanceCaveat ?? false,
    }
    const gl = canvas.getContext('webgl2', attributes) as WebGL2RenderingContext | null
    if (!gl) throw new Error('WebGLRenderer: WebGL2 is not available')
    this.gl = gl
    // the canvas keeps the size it has until `setSize` is called
    this._width = canvas.width
    this._height = canvas.height
    canvas.addEventListener('webglcontextlost', this.onLost as EventListener, false)
    canvas.addEventListener('webglcontextrestored', this.onRestored as EventListener, false)
    this.initContext()
  }

  /** Fresh GL state and empty caches: on creation, and again after a restored context, when every old handle is gone. */
  private initContext(): void {
    const gl = this.gl
    for (const unhook of this.unhooks) unhook()
    this.unhooks.clear()
    this.parallelCompile = gl.getExtension('KHR_parallel_shader_compile') !== null
    this.programs = new Map()
    this.materials = new WeakMap()
    this.geometries = new WeakMap()
    this.textures = new WeakMap()
    this.targets = new WeakMap()
    this.s = {
      blend: false,
      blending: -1,
      premult: false,
      depthTest: true,
      depthMask: true,
      cull: true,
      flipSided: false,
      colorMask: true,
      program: null,
      vao: null,
      unit: -1,
      bound: [],
      clear: [0, 0, 0, 1],
      unpackFlipY: false,
      unpackPremultiply: false,
      unpackAlignment: 4,
      unpackConversion: gl.BROWSER_DEFAULT_WEBGL,
      framebuffer: null,
      generic: [],
    }
    // the starting GL state the renderer assumes
    gl.clearColor(0, 0, 0, 1)
    gl.clearDepth(1)
    gl.clearStencil(0)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.depthMask(true)
    gl.frontFace(gl.CCW)
    gl.cullFace(gl.BACK)
    gl.enable(gl.CULL_FACE)
    gl.disable(gl.BLEND)
    gl.colorMask(true, true, true, true)
    // a 1×1 empty texture for a sampler with nothing to read
    this.emptyTexture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.emptyTexture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))
    gl.bindTexture(gl.TEXTURE_2D, null)
    this._currentViewport.set(0, 0, gl.canvas.width, gl.canvas.height)
    this.currentRenderTarget = null
    // the viewport alone: the canvas is not resized here
    this.setViewport(0, 0, this._width, this._height)
  }

  /** Register `fn` for the owner's dispose, and remember how to unhook it when the context goes. */
  private onDispose(owner: { addEventListener(type: string, fn: () => void): void; removeEventListener(type: string, fn: () => void): void }, fn: () => void): void {
    const unhook = () => {
      owner.removeEventListener('dispose', listener)
      this.unhooks.delete(unhook)
    }
    const listener = () => {
      unhook()
      fn()
    }
    owner.addEventListener('dispose', listener)
    this.unhooks.add(unhook)
  }

  // ------------------------------------------------------------- size

  getContext(): WebGL2RenderingContext {
    return this.gl
  }

  getPixelRatio(): number {
    return this._pixelRatio
  }

  setPixelRatio(value: number): void {
    if (value === undefined) return
    this._pixelRatio = value
    this.setSize(this._width, this._height, false)
  }

  getSize<T extends { set(x: number, y: number): unknown }>(target: T): T {
    target.set(this._width, this._height)
    return target
  }

  /** The canvas's drawing buffer becomes `width × height` css pixels at the pixel ratio; `updateStyle` also sizes the element. */
  setSize(width: number, height: number, updateStyle = true): void {
    this._width = width
    this._height = height
    const canvas = this.domElement
    canvas.width = Math.floor(width * this._pixelRatio)
    canvas.height = Math.floor(height * this._pixelRatio)
    if (updateStyle === true && canvas.style) {
      canvas.style.width = width + 'px'
      canvas.style.height = height + 'px'
    }
    this.setViewport(0, 0, width, height)
  }

  getDrawingBufferSize<T extends { set(x: number, y: number): unknown; floor(): unknown }>(target: T): T {
    target.set(this._width * this._pixelRatio, this._height * this._pixelRatio)
    target.floor()
    return target
  }

  setViewport(x: number, y: number, width: number, height: number): void {
    this._viewport.set(x, y, width, height)
    this.viewport(_vector4.copy(this._viewport).multiplyScalar(this._pixelRatio).round())
  }

  private viewport(v: Vector4): void {
    if (this._currentViewport.equals(v) === false) {
      this.gl.viewport(v.x, v.y, v.z, v.w)
      this._currentViewport.copy(v)
    }
  }

  // ------------------------------------------------------------ clear

  setClearColor(color: number | Color, alpha = 1): void {
    this._clearColor.set(color)
    this._clearAlpha = alpha
    this.setClear(this._clearColor, this._clearAlpha)
  }

  getClearColor(target: Color): Color {
    return target.copy(this._clearColor)
  }

  getClearAlpha(): number {
    return this._clearAlpha
  }

  /** The clear colour in the space the target is in: sRGB for the canvas, linear for a render target. */
  private setClear(color: Color, alpha: number): void {
    color.getRGB(_rgb, this.currentRenderTarget === null ? this.outputColorSpace : 'srgb-linear')
    let r = _rgb.r, g = _rgb.g, b = _rgb.b
    if (this.premultipliedAlpha) {
      r *= alpha
      g *= alpha
      b *= alpha
    }
    const c = this.s.clear
    if (c[0] !== r || c[1] !== g || c[2] !== b || c[3] !== alpha) {
      this.gl.clearColor(r, g, b, alpha)
      c[0] = r
      c[1] = g
      c[2] = b
      c[3] = alpha
    }
  }

  clear(color = true, depth = true, stencil = true): void {
    if (this.lost) return
    const gl = this.gl
    let bits = 0
    // a depth-only pass has no colour to clear: the buffer is masked off for the whole pass
    if (color && !this.depthOnly) {
      bits |= gl.COLOR_BUFFER_BIT
      // the clear must write the colour buffer whatever the last material left the mask at
      this.setColorMask(true)
    }
    if (depth) {
      bits |= gl.DEPTH_BUFFER_BIT
      // and the depth buffer likewise
      this.setDepthMask(true)
    }
    if (stencil) bits |= gl.STENCIL_BUFFER_BIT
    if (bits) gl.clear(bits)
  }

  clearColor(): void {
    this.clear(true, false, false)
  }

  clearDepth(): void {
    this.clear(false, true, false)
  }

  // ---------------------------------------------------- render target

  getRenderTarget(): WebGLRenderTarget | null {
    return this.currentRenderTarget
  }

  setRenderTarget(renderTarget: WebGLRenderTarget | null): void {
    this.currentRenderTarget = renderTarget
    if (this.lost) return
    const gl = this.gl
    if (renderTarget) {
      const t = this.getRenderTargetGL(renderTarget)
      this.bindFramebuffer(t.framebuffer)
      this.viewport(_vector4.copy(renderTarget.viewport))
    } else {
      this.bindFramebuffer(null)
      this.viewport(_vector4.copy(this._viewport).multiplyScalar(this._pixelRatio).round())
    }
  }

  private bindFramebuffer(fb: WebGLFramebuffer | null): void {
    if (this.s.framebuffer !== fb) {
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, fb)
      this.s.framebuffer = fb
    }
  }

  private getRenderTargetGL(rt: WebGLRenderTarget): RenderTargetGL {
    let t = this.targets.get(rt)
    const gl = this.gl
    if (t && (t.width !== rt.width || t.height !== rt.height)) {
      // resized: immutable storage cannot grow, so the colour texture is reallocated below as a new
      // GL object, and the framebuffer that pointed at the old one goes with it
      this.deleteRenderTargetGL(rt, t)
      rt.texture.needsUpdate = true
      t = undefined
    }
    if (t) return t
    const framebuffer = gl.createFramebuffer()!
    this.bindFramebuffer(framebuffer)
    let renderbuffer: WebGLRenderbuffer | null = null
    if (rt.colorBuffer) {
      // the colour attachment, allocated once at the target's size
      const colour = this.getTextureGL(rt.texture, rt.width, rt.height)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colour.texture, 0)
    } else {
      // depth alone: WebGL2 completes a framebuffer with no colour image once nothing is drawn to or read from one
      gl.drawBuffers([gl.NONE])
      gl.readBuffer(gl.NONE)
    }
    if (rt.depthTexture) {
      const dt = rt.depthTexture
      if (dt.image.width !== rt.width || dt.image.height !== rt.height) {
        dt.image.width = rt.width
        dt.image.height = rt.height
        dt.needsUpdate = true
      }
      const depth = this.getTextureGL(dt, rt.width, rt.height)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth.texture, 0)
    } else if (rt.depthBuffer) {
      renderbuffer = gl.createRenderbuffer()
      gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer)
      gl.renderbufferStorage(gl.RENDERBUFFER, rt.stencilBuffer ? gl.DEPTH24_STENCIL8 : gl.DEPTH_COMPONENT24, rt.width, rt.height)
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, rt.stencilBuffer ? gl.DEPTH_STENCIL_ATTACHMENT : gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, renderbuffer)
    }
    t = { framebuffer, renderbuffer, width: rt.width, height: rt.height }
    this.targets.set(rt, t)
    this.onDispose(rt, () => {
      const cur = this.targets.get(rt)
      if (cur) this.deleteRenderTargetGL(rt, cur)
      // the attachments go with the target
      rt.texture.dispose()
      rt.depthTexture?.dispose()
    })
    return t
  }

  private deleteRenderTargetGL(rt: WebGLRenderTarget, t: RenderTargetGL): void {
    if (!this.lost) {
      const gl = this.gl
      gl.deleteFramebuffer(t.framebuffer)
      if (t.renderbuffer) gl.deleteRenderbuffer(t.renderbuffer)
      if (this.s.framebuffer === t.framebuffer) this.s.framebuffer = null
    }
    this.targets.delete(rt)
  }

  // ---------------------------------------------------------- textures

  /**
   * The GL texture for `texture`, uploaded from its source where the source is newer than what
   * the GL holds. Keyed by the source, so a clone (its own offset and repeat on the same image)
   * shares the upload rather than doubling it.
   */
  private getTextureGL(texture: Texture, width?: number, height?: number, unit?: number): TextureGL {
    const gl = this.gl
    const source = texture.source
    let t = this.textures.get(source)
    if (!t) {
      t = { texture: gl.createTexture()!, version: -1, width: 0, height: 0, levels: 1, owners: new Set() }
      this.textures.set(source, t)
    }
    if (!t.owners.has(texture)) {
      t.owners.add(texture)
      this.onDispose(texture, () => {
        const cur = this.textures.get(source)
        if (!cur) return
        cur.owners.delete(texture)
        if (cur.owners.size > 0) return
        if (!this.lost) {
          gl.deleteTexture(cur.texture)
          for (let i = 0; i < this.s.bound.length; i++) if (this.s.bound[i] === cur.texture) this.s.bound[i] = null
        }
        this.textures.delete(source)
      })
    }
    if (t.version !== source.version) this.uploadTexture(texture, t, width, height, unit)
    return t
  }

  private uploadTexture(texture: Texture, t: TextureGL, width?: number, height?: number, unit?: number): void {
    const gl = this.gl
    const image = texture.image
    const w = width ?? (image as { width: number })?.width ?? 1
    const h = height ?? (image as { height: number })?.height ?? 1
    // the unit the upload goes through: the sampler's own where the upload is for a draw, so it displaces no
    // unit already bound for the same draw; otherwise whatever is active, and the next draw's binds put it back
    if (unit === undefined) unit = this.s.unit < 0 ? 0 : this.s.unit
    this.activeTexture(unit)
    gl.bindTexture(gl.TEXTURE_2D, t.texture)
    this.s.bound[unit] = t.texture
    const isBitmap = typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap
    if (!isBitmap) {
      this.pixelStore(gl.UNPACK_FLIP_Y_WEBGL, texture.flipY)
      this.pixelStore(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, texture.premultiplyAlpha)
      this.pixelStore(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
    }
    this.pixelStore(gl.UNPACK_ALIGNMENT, texture.unpackAlignment)
    const depth = texture.format === DepthFormat
    let uploaded = false
    // the full mip chain where the texture filters through one and asks for it built; one level otherwise
    const mipmapped = !depth && texture.generateMipmaps && texture.minFilter !== NearestFilter && texture.minFilter !== LinearFilter
    const levels = mipmapped ? Math.floor(Math.log2(Math.max(w, h))) + 1 : 1
    const allocate = t.version === -1 || t.width !== w || t.height !== h || t.levels !== levels
    if (allocate && t.version !== -1) {
      // immutable storage cannot be resized: a new texture object takes the old one's place
      gl.deleteTexture(t.texture)
      t.texture = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, t.texture)
      this.s.bound[unit] = t.texture
    }
    // the sampler state goes with every upload, so a filter changed with the image is honoured
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, texture.wrapS === RepeatWrapping ? gl.REPEAT : gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, texture.wrapT === RepeatWrapping ? gl.REPEAT : gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, texture.magFilter === NearestFilter ? gl.NEAREST : gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, texture.minFilter === NearestFilter ? gl.NEAREST : texture.minFilter === LinearFilter ? gl.LINEAR : gl.LINEAR_MIPMAP_LINEAR)
    if (depth) {
      if (allocate) gl.texStorage2D(gl.TEXTURE_2D, 1, texture.type === UnsignedIntType ? gl.DEPTH_COMPONENT24 : gl.DEPTH_COMPONENT16, w, h)
    } else {
      const red = texture.format === RedFormat
      const format = red ? gl.RED : gl.RGBA
      const internal = red ? gl.R8 : texture.colorSpace === SRGBColorSpace ? gl.SRGB8_ALPHA8 : gl.RGBA8
      if (allocate) gl.texStorage2D(gl.TEXTURE_2D, levels, internal, w, h)
      if (image && 'data' in image) {
        // bytes in memory (a DataTexture); null data is storage alone
        const data = (image as DataImage).data
        if (data) {
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, format, gl.UNSIGNED_BYTE, data as ArrayBufferView)
          uploaded = true
        }
      } else if (isTexImageSource(image)) {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, format, gl.UNSIGNED_BYTE, image)
        uploaded = true
      }
      // a bare { width, height } (a render target's colour) is storage alone
      if (mipmapped) gl.generateMipmap(gl.TEXTURE_2D)
    }
    t.version = texture.source.version
    t.width = w
    t.height = h
    t.levels = levels
    if (uploaded) texture.source.onUpload?.(texture.source)
  }

  private pixelStore(pname: number, value: number | boolean): void {
    const gl = this.gl
    const s = this.s
    if (pname === gl.UNPACK_FLIP_Y_WEBGL) {
      if (s.unpackFlipY === value) return
      s.unpackFlipY = value as boolean
    } else if (pname === gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL) {
      if (s.unpackPremultiply === value) return
      s.unpackPremultiply = value as boolean
    } else if (pname === gl.UNPACK_ALIGNMENT) {
      if (s.unpackAlignment === value) return
      s.unpackAlignment = value as number
    } else if (pname === gl.UNPACK_COLORSPACE_CONVERSION_WEBGL) {
      if (s.unpackConversion === value) return
      s.unpackConversion = value as number
    }
    gl.pixelStorei(pname, value as number)
  }

  private activeTexture(unit: number): void {
    if (this.s.unit !== unit) {
      this.gl.activeTexture(this.gl.TEXTURE0 + unit)
      this.s.unit = unit
    }
  }

  /** Bind `texture` (or the empty one) on `unit`, uploading it first where it changed. */
  private bindTexture(texture: Texture | null, unit: number): void {
    const glTex = texture ? this.getTextureGL(texture, undefined, undefined, unit).texture : this.emptyTexture
    if (this.s.bound[unit] !== glTex) {
      this.activeTexture(unit)
      this.gl.bindTexture(this.gl.TEXTURE_2D, glTex)
      this.s.bound[unit] = glTex
    }
  }

  // ---------------------------------------------------------- programs

  private parametersFor(material: Material, geometry: BufferGeometry, side: Side): ProgramParameters {
    const basic = (material as MeshBasicMaterial).isMeshBasicMaterial === true
    const shader = material as ShaderMaterial
    const map = basic ? !!(material as MeshBasicMaterial).map : false
    const color = geometry.attributes.color
    return {
      shaderType: material.type,
      shaderName: material.name,
      vertexShader: basic ? basicVertex : shader.vertexShader,
      fragmentShader: basic ? basicFragment : shader.fragmentShader,
      defines: material.defines,
      map,
      vertexColors: material.vertexColors,
      vertexAlphas: material.vertexColors === true && !!color && color.itemSize === 4,
      alphaTest: material.alphaTest > 0,
      opaque: material.transparent === false && material.blending === NormalBlending,
      doubleSided: side === DoubleSide,
      flipSided: side === BackSide,
      premultipliedAlpha: material.premultipliedAlpha,
      defaultAttributeValues: basic ? undefined : shader.defaultAttributeValues,
      customProgramCacheKey: material.customProgramCacheKey(),
      // a depth-only program has no encode to pick
      outputLinear: this.outputLinear && !this.depthOnly,
      depthOnly: this.depthOnly,
    }
  }

  private materialProps(material: Material): MaterialProps {
    let p = this.materials.get(material)
    if (!p) {
      p = { version: -1, programs: new Map(), fast: new Map(), uniforms: null, currentProgram: null, uniformsLists: new Map() }
      this.materials.set(material, p)
      this.onDispose(material, () => this.materials.delete(material))
    }
    return p
  }

  /** The program for this material drawn with `side` (a double-sided transparent material is drawn twice, once per side). */
  private getProgram(props: MaterialProps, material: Material, geometry: BufferGeometry, side: Side): Program {
    if (props.version !== material.version) {
      // a change that alters the sources: forget the programs compiled for the old ones
      props.programs = new Map()
      props.fast = new Map()
      props.uniformsLists = new Map()
      props.version = material.version
      props.currentProgram = null
    }
    // everything that picks a program, as a few bits; the full key is built only on a miss
    const color = geometry.attributes.color
    const fastKey =
      side |
      ((material as MeshBasicMaterial).map ? 4 : 0) |
      (material.vertexColors === true && !!color && color.itemSize === 4 ? 8 : 0) |
      (material.alphaTest > 0 ? 16 : 0) |
      (material.transparent === false && material.blending === NormalBlending ? 32 : 0) |
      (material.vertexColors ? 64 : 0) |
      (material.premultipliedAlpha ? 128 : 0) |
      (this.depthOnly ? 256 : this.outputLinear ? 512 : 0)
    const fast = props.fast.get(fastKey)
    if (fast) return fast
    const parameters = this.parametersFor(material, geometry, side)
    const key = programKey(parameters)
    let program = props.programs.get(key)
    if (!program) {
      const basic = (material as MeshBasicMaterial).isMeshBasicMaterial === true
      // the uniform table the material's programs read; a basic material's is built here and filled from the material each draw
      if (!props.uniforms) {
        props.uniforms = basic
          ? { diffuse: { value: new Color(0xffffff) }, opacity: { value: 1 }, map: { value: null }, mapTransform: { value: new Matrix3() }, alphaTest: { value: 0 } }
          : (material as ShaderMaterial).uniforms
      }
      const shader = { name: material.name, uniforms: props.uniforms, vertexShader: parameters.vertexShader, fragmentShader: parameters.fragmentShader }
      material.onBeforeCompile(shader)
      parameters.vertexShader = shader.vertexShader
      parameters.fragmentShader = shader.fragmentShader
      // the hook may have changed the sources: the compiled program is cached under what was actually compiled
      const compiledKey = programKey(parameters)
      program = this.programs.get(compiledKey)
      if (!program) {
        program = this.compileProgram(parameters)
        this.programs.set(compiledKey, program)
      }
      props.programs.set(key, program)
    }
    props.fast.set(fastKey, program)
    return program
  }

  /**
   * Compile and link, and no more: the driver is not asked whether the link went through until
   * the program is first drawn with (`finishProgram`), so a `compile()` over the whole scene
   * hands every program to the driver at once and lets it link them in parallel where it can
   * (KHR_parallel_shader_compile) rather than one at a time, each waited for.
   */
  private compileProgram(p: ProgramParameters): Program {
    const gl = this.gl
    const { vertex, fragment } = buildSources(p)
    const vs = gl.createShader(gl.VERTEX_SHADER)!
    gl.shaderSource(vs, vertex)
    gl.compileShader(vs)
    const fs = gl.createShader(gl.FRAGMENT_SHADER)!
    gl.shaderSource(fs, fragment)
    gl.compileShader(fs)
    const program = gl.createProgram()!
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    this.info.programs++
    return {
      id: _programId++,
      program,
      vs,
      fs,
      linked: false,
      uniforms: new Map(),
      attributes: new Map(),
      attributeNames: [],
      attributeLocations: [],
      cameraStamp: -1,
      usedNames: [],
      modelViewMatrix: null,
      modelMatrix: null,
      projectionMatrix: null,
      viewMatrix: null,
      cameraPosition: null,
      isOrthographic: null,
    }
  }

  /** Check the link and read the program's uniforms and attributes: the part of compiling that waits for the driver. */
  private finishProgram(program: Program): void {
    if (program.linked) return
    const gl = this.gl
    const p = program.program
    const vs = program.vs!
    const fs = program.fs!
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) {
      const log = gl.getProgramInfoLog(p)
      const vlog = gl.getShaderInfoLog(vs)
      const flog = gl.getShaderInfoLog(fs)
      gl.deleteProgram(p)
      throw new Error(`WebGLRenderer: shader program failed to link\n${log}\nvertex: ${vlog}\nfragment: ${flog}`)
    }
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    program.vs = null
    program.fs = null
    const uniforms = program.uniforms
    const usedNames = program.usedNames
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i)!
      const name = info.name.replace(/\[0\]$/, '')
      const location = gl.getUniformLocation(p, info.name)
      if (!location) continue
      uniforms.set(name, { location, type: info.type, cache: [] })
      usedNames.push(name)
    }
    const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES) as number
    for (let i = 0; i < na; i++) {
      const info = gl.getActiveAttrib(p, i)!
      const location = gl.getAttribLocation(p, info.name)
      program.attributes.set(info.name, location)
      program.attributeNames.push(info.name)
      program.attributeLocations.push(location)
    }
    program.modelViewMatrix = uniforms.get('modelViewMatrix') ?? null
    program.modelMatrix = uniforms.get('modelMatrix') ?? null
    program.projectionMatrix = uniforms.get('projectionMatrix') ?? null
    program.viewMatrix = uniforms.get('viewMatrix') ?? null
    program.cameraPosition = uniforms.get('cameraPosition') ?? null
    program.isOrthographic = uniforms.get('isOrthographic') ?? null
    program.linked = true
  }

  // ------------------------------------------------------------ uniforms

  private setUniform(u: UniformInfo, value: unknown): void {
    const gl = this.gl
    const cache = u.cache
    switch (u.type) {
      case FLOAT: {
        const v = value as number
        if (cache[0] === v) return
        gl.uniform1f(u.location, v)
        cache[0] = v
        return
      }
      case INT:
      case BOOL: {
        const v = value as number | boolean
        const n = typeof v === 'boolean' ? (v ? 1 : 0) : v
        if (cache[0] === n) return
        gl.uniform1i(u.location, n)
        cache[0] = n
        return
      }
      case FLOAT_VEC2: {
        const v = value as { x: number; y: number } | number[]
        if (Array.isArray(v)) {
          if (cache[0] === v[0] && cache[1] === v[1]) return
          gl.uniform2f(u.location, v[0], v[1])
          cache[0] = v[0]
          cache[1] = v[1]
        } else {
          if (cache[0] === v.x && cache[1] === v.y) return
          gl.uniform2f(u.location, v.x, v.y)
          cache[0] = v.x
          cache[1] = v.y
        }
        return
      }
      case FLOAT_VEC3: {
        const v = value as { x?: number; y: number; z: number; r?: number; g: number; b: number } | number[]
        if (Array.isArray(v)) {
          if (cache[0] === v[0] && cache[1] === v[1] && cache[2] === v[2]) return
          gl.uniform3f(u.location, v[0], v[1], v[2])
          cache[0] = v[0]
          cache[1] = v[1]
          cache[2] = v[2]
        } else if (v.x !== undefined) {
          if (cache[0] === v.x && cache[1] === v.y && cache[2] === v.z) return
          gl.uniform3f(u.location, v.x, v.y, v.z)
          cache[0] = v.x
          cache[1] = v.y
          cache[2] = v.z
        } else {
          if (cache[0] === v.r && cache[1] === v.g && cache[2] === v.b) return
          gl.uniform3f(u.location, v.r!, v.g, v.b)
          cache[0] = v.r!
          cache[1] = v.g
          cache[2] = v.b
        }
        return
      }
      case FLOAT_VEC4: {
        const v = value as { x: number; y: number; z: number; w: number } | number[]
        if (Array.isArray(v)) {
          if (cache[0] === v[0] && cache[1] === v[1] && cache[2] === v[2] && cache[3] === v[3]) return
          gl.uniform4f(u.location, v[0], v[1], v[2], v[3])
          cache[0] = v[0]
          cache[1] = v[1]
          cache[2] = v[2]
          cache[3] = v[3]
        } else {
          if (cache[0] === v.x && cache[1] === v.y && cache[2] === v.z && cache[3] === v.w) return
          gl.uniform4f(u.location, v.x, v.y, v.z, v.w)
          cache[0] = v.x
          cache[1] = v.y
          cache[2] = v.z
          cache[3] = v.w
        }
        return
      }
      case FLOAT_MAT3: {
        const e = (value as Matrix3).elements
        if (arraysEqual(cache, e, 9)) return
        _mat3.set(e)
        gl.uniformMatrix3fv(u.location, false, _mat3)
        copyArray(cache, e, 9)
        return
      }
      case FLOAT_MAT4: {
        const e = (value as Matrix4).elements
        if (arraysEqual(cache, e, 16)) return
        _mat4.set(e)
        gl.uniformMatrix4fv(u.location, false, _mat4)
        copyArray(cache, e, 16)
        return
      }
      case SAMPLER_2D: {
        const unit = this.textureUnit++
        if (cache[0] !== unit) {
          gl.uniform1i(u.location, unit)
          cache[0] = unit
        }
        this.bindTexture((value as Texture | null) || null, unit)
        return
      }
    }
  }

  /** The program's uniforms that the material's table has values for, paired once per program. */
  private uniformsList(props: MaterialProps, program: Program): [UniformInfo, IUniform][] {
    const cached = props.uniformsLists.get(program)
    if (cached) return cached
    const list: [UniformInfo, IUniform][] = []
    const table = props.uniforms!
    for (const name of program.usedNames) {
      const u = table[name]
      if (u !== undefined) list.push([program.uniforms.get(name)!, u])
    }
    props.uniformsLists.set(program, list)
    return list
  }

  /** A basic material's built-in uniforms take the material's current colour, opacity, map and alpha test. */
  private refreshBasicUniforms(uniforms: Record<string, IUniform>, material: MeshBasicMaterial): void {
    ;(uniforms.diffuse.value as Color).copy(material.color)
    uniforms.opacity.value = material.opacity
    if (material.map) {
      uniforms.map.value = material.map
      if (material.map.matrixAutoUpdate === true) material.map.updateMatrix()
      ;(uniforms.mapTransform.value as Matrix3).copy(material.map.matrix)
    }
    if (material.alphaTest > 0) uniforms.alphaTest.value = material.alphaTest
  }

  // ----------------------------------------------------------- geometry

  private geometryGL(geometry: BufferGeometry): GeometryGL {
    let g = this.geometries.get(geometry)
    if (!g) {
      g = { attributes: new Map(), vaos: new Map() }
      this.geometries.set(geometry, g)
      const gl = this.gl
      this.onDispose(geometry, () => {
        const cur = this.geometries.get(geometry)
        if (cur && !this.lost) {
          for (const a of cur.attributes.values()) gl.deleteBuffer(a.buffer)
          for (const v of cur.vaos.values()) {
            if (this.s.vao === v.vao) {
              gl.bindVertexArray(null)
              this.s.vao = null
            }
            gl.deleteVertexArray(v.vao)
          }
        }
        this.geometries.delete(geometry)
      })
    }
    return g
  }

  /**
   * The buffer behind `attribute`, created or brought up to the attribute's version (the written ranges alone where
   * it says which). A longer or shorter array reallocates the same buffer object, since the vertex arrays point at it.
   */
  private updateAttribute(g: GeometryGL, attribute: BufferAttribute, target: number): AttributeGL {
    const gl = this.gl
    let a = g.attributes.get(attribute)
    const array = attribute.array
    if (!a || a.length !== array.length) {
      const buffer = a ? a.buffer : gl.createBuffer()!
      gl.bindBuffer(target, buffer)
      gl.bufferData(target, array, gl.STATIC_DRAW)
      attribute.clearUpdateRanges()
      if (a) {
        a.version = attribute.version
        a.length = array.length
      } else {
        a = { buffer, version: attribute.version, length: array.length }
        g.attributes.set(attribute, a)
      }
      return a
    }
    if (a.version !== attribute.version) {
      gl.bindBuffer(target, a.buffer)
      const ranges = attribute.updateRanges
      if (ranges.length === 0) gl.bufferSubData(target, 0, array)
      else {
        ranges.sort((x, y) => x.start - y.start)
        let mergeIndex = 0
        for (let i = 1; i < ranges.length; i++) {
          const prev = ranges[mergeIndex]
          const range = ranges[i]
          if (range.start <= prev.start + prev.count + 1) prev.count = Math.max(prev.count, range.start + range.count - prev.start)
          else ranges[++mergeIndex] = range
        }
        ranges.length = mergeIndex + 1
        for (const r of ranges) gl.bufferSubData(target, r.start * array.BYTES_PER_ELEMENT, array, r.start, r.count)
        attribute.clearUpdateRanges()
      }
      a.version = attribute.version
    }
    return a
  }

  /**
   * Drop the buffers behind attribute objects the geometry no longer holds
   * (swapped for new ones, which a resize is not: that refills the same
   * buffer), and the vertex arrays of the other programs still pointing at
   * them. Without this a geometry that swaps an attribute keeps the old
   * buffer on the GPU until the whole geometry is disposed. Runs where a
   * vertex array was just built, so the attributes in use are already uploaded.
   */
  private retireAttributes(g: GeometryGL, geometry: BufferGeometry, builtFor: number): void {
    const attrs = geometry.attributes
    let retired: Set<BufferAttribute> | null = null
    for (const [attribute, a] of g.attributes) {
      if (attribute === geometry.index) continue
      let held = false
      for (const name in attrs) {
        if (attrs[name] === attribute) {
          held = true
          break
        }
      }
      if (held) continue
      this.gl.deleteBuffer(a.buffer)
      g.attributes.delete(attribute)
      ;(retired ??= new Set()).add(attribute)
    }
    if (!retired) return
    for (const [id, v] of g.vaos) {
      if (id === builtFor) continue
      if (!((v.index && retired.has(v.index)) || v.bound.some((b) => b !== undefined && retired!.has(b)))) continue
      if (this.s.vao === v.vao) {
        this.gl.bindVertexArray(null)
        this.s.vao = null
      }
      this.gl.deleteVertexArray(v.vao)
      g.vaos.delete(id)
    }
  }

  /** Bind the geometry's vertex array for `program`: built once per program layout, rebuilt when an attribute object is swapped. */
  private bindGeometry(geometry: BufferGeometry, program: Program, material: Material): void {
    const gl = this.gl
    const g = this.geometryGL(geometry)
    const index = geometry.index
    const names = program.attributeNames
    const attrs = geometry.attributes
    let entry = g.vaos.get(program.id)
    // the buffers first (a data upload is not vertex-array state, an index binding is), and in the
    // same pass, whether the vertex array still points at these attribute objects
    let fresh = entry === undefined || entry.index !== index
    for (let i = 0; i < names.length; i++) {
      const attribute = attrs[names[i]]
      if (attribute) this.updateAttribute(g, attribute, gl.ARRAY_BUFFER)
      if (entry && entry.bound[i] !== attribute) fresh = true
    }
    if (fresh) {
      if (entry) gl.deleteVertexArray(entry.vao)
      const vao = gl.createVertexArray()!
      gl.bindVertexArray(vao)
      this.s.vao = vao
      const bound: (BufferAttribute | undefined)[] = []
      const generic: { location: number; value: number[] }[] = []
      const defaults = (material as ShaderMaterial).defaultAttributeValues
      for (let i = 0; i < names.length; i++) {
        const name = names[i]
        const location = program.attributeLocations[i]
        const attribute = attrs[name]
        bound.push(attribute)
        if (location < 0) continue
        if (attribute) {
          const a = g.attributes.get(attribute)!
          gl.bindBuffer(gl.ARRAY_BUFFER, a.buffer)
          gl.enableVertexAttribArray(location)
          gl.vertexAttribPointer(location, attribute.itemSize, glType(gl, attribute.array), attribute.normalized, 0, 0)
        } else {
          gl.disableVertexAttribArray(location)
          const value = defaults?.[name]
          if (value !== undefined) generic.push({ location, value })
        }
      }
      if (index) {
        const ia = this.updateAttribute(g, index, gl.ELEMENT_ARRAY_BUFFER)
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ia.buffer)
      }
      entry = { vao, bound, index, generic }
      g.vaos.set(program.id, entry)
      this.retireAttributes(g, geometry, program.id)
    } else {
      if (this.s.vao !== entry!.vao) {
        gl.bindVertexArray(entry!.vao)
        this.s.vao = entry!.vao
      }
      if (index) this.updateAttribute(g, index, gl.ELEMENT_ARRAY_BUFFER)
    }
    // the constants for the attributes the geometry lacks: context state, so set wherever the context holds another value
    const generic = entry!.generic
    for (let i = 0; i < generic.length; i++) {
      const { location, value } = generic[i]
      const held = this.s.generic[location]
      if (held !== undefined && held.length === value.length && arraysEqual(held, value, value.length)) continue
      if (value.length === 2) gl.vertexAttrib2fv(location, value)
      else if (value.length === 3) gl.vertexAttrib3fv(location, value)
      else if (value.length === 4) gl.vertexAttrib4fv(location, value)
      else continue
      this.s.generic[location] = value.slice()
    }
  }

  // -------------------------------------------------------------- state

  private setMaterialState(material: Material, side: Side, frontFaceCW: boolean): void {
    const gl = this.gl
    const s = this.s
    const cull = side !== DoubleSide
    if (s.cull !== cull) {
      if (cull) gl.enable(gl.CULL_FACE)
      else gl.disable(gl.CULL_FACE)
      s.cull = cull
    }
    let flipSided = side === BackSide
    if (frontFaceCW) flipSided = !flipSided
    if (s.flipSided !== flipSided) {
      gl.frontFace(flipSided ? gl.CW : gl.CCW)
      s.flipSided = flipSided
    }
    const blending = material.blending === NormalBlending && material.transparent === false ? 0 : material.blending
    if (blending === 0) {
      if (s.blend) {
        gl.disable(gl.BLEND)
        s.blend = false
      }
    } else {
      if (!s.blend) {
        gl.enable(gl.BLEND)
        s.blend = true
      }
      if (blending !== s.blending || material.premultipliedAlpha !== s.premult) {
        gl.blendEquation(gl.FUNC_ADD)
        if (material.premultipliedAlpha) gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
        else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
        s.blending = blending
        s.premult = material.premultipliedAlpha
      }
    }
    if (s.depthTest !== material.depthTest) {
      if (material.depthTest) gl.enable(gl.DEPTH_TEST)
      else gl.disable(gl.DEPTH_TEST)
      s.depthTest = material.depthTest
    }
    this.setDepthMask(material.depthWrite)
    // a depth-only pass writes no colour whatever the material says
    this.setColorMask(material.colorWrite && !this.depthOnly)
  }

  private setDepthMask(on: boolean): void {
    if (this.s.depthMask !== on) {
      this.gl.depthMask(on)
      this.s.depthMask = on
    }
  }

  private setColorMask(on: boolean): void {
    if (this.s.colorMask !== on) {
      this.gl.colorMask(on, on, on, on)
      this.s.colorMask = on
    }
  }

  private useProgram(program: Program): boolean {
    if (this.s.program !== program.program) {
      this.gl.useProgram(program.program)
      this.s.program = program.program
      return true
    }
    return false
  }

  // -------------------------------------------------------------- frame

  render(scene: Scene, camera: Camera): void {
    if (this.lost) return
    // the frame's encode: a canvas is sRGB by `outputColorSpace`; a render target's texture is linear unless it says otherwise
    const rt = this.currentRenderTarget
    this.outputLinear = rt ? rt.texture.colorSpace !== SRGBColorSpace : this.outputColorSpace !== SRGBColorSpace
    if (scene.matrixWorldAutoUpdate === true) scene.updateMatrixWorld()
    if (camera.parent === null && camera.matrixWorldAutoUpdate === true) camera.updateMatrixWorld()
    _projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    _frustum.setFromProjectionMatrix(_projScreenMatrix)
    this.itemsUsed = 0
    this.opaque.length = 0
    this.transparent.length = 0
    this.projectObject(scene, camera, 0, this.sortObjects)
    // the records past this frame's count still point at last frame's meshes: a scene that shrank (or emptied)
    // must not keep them alive. The records themselves stay: a frame draws the dungeon and then the far smaller
    // hands scene, and truncating to the small pass would have every dungeon pass allocate its records afresh
    for (let i = this.itemsUsed, l = this.items.length; i < l; i++) {
      const item = this.items[i]
      item.object = item.geometry = item.material = null!
    }
    if (this.sortObjects === true) {
      this.opaque.sort(painterSortStable)
      this.transparent.sort(reversePainterSortStable)
    }
    this.info.render.frame++
    this.info.render.calls = 0
    // the background: a colour clears the frame with itself; none leaves the clear colour as set
    let forceClear = false
    if (scene.background) {
      this.setClear(scene.background, 1)
      forceClear = true
    } else this.setClear(this._clearColor, this._clearAlpha)
    if (this.autoClear || forceClear) this.clear(this.autoClearColor, this.autoClearDepth, this.autoClearStencil)
    this.currentMaterialId = -1
    this.currentCamera = null
    this.cameraStamp++
    this.renderObjects(this.opaque, camera)
    this.renderObjects(this.transparent, camera)
    // leave the vertex array unbound: nothing outside a draw should write into one
    if (this.s.vao !== null) {
      this.gl.bindVertexArray(null)
      this.s.vao = null
    }
  }

  private projectObject(object: Object3D, camera: Camera, groupOrder: number, sortObjects: boolean): void {
    if (object.visible === false) return
    const visible = object.layers.test(camera.layers)
    if (visible) {
      if ((object as { isGroup?: boolean }).isGroup) groupOrder = object.renderOrder
      else if ((object as Mesh).isMesh) {
        const mesh = object as Mesh
        if (!mesh.frustumCulled || _frustum.intersectsObject(mesh)) {
          const geometry = mesh.geometry
          const material = mesh.material as Material
          if (sortObjects) {
            if (geometry.boundingSphere === null) geometry.computeBoundingSphere()
            _vector4.copy(geometry.boundingSphere!.center)
            _vector4.applyMatrix4(mesh.matrixWorld).applyMatrix4(_projScreenMatrix)
          }
          if (material.visible) this.push(mesh, geometry, material, groupOrder, _vector4.z)
        }
      }
    }
    const children = object.children
    for (let i = 0, l = children.length; i < l; i++) this.projectObject(children[i], camera, groupOrder, sortObjects)
  }

  private push(object: Mesh, geometry: BufferGeometry, material: Material, groupOrder: number, z: number): void {
    let item = this.items[this.itemsUsed]
    if (item === undefined) {
      item = { id: object.id, object, geometry, material, groupOrder, renderOrder: object.renderOrder, z }
      this.items[this.itemsUsed] = item
    } else {
      item.id = object.id
      item.object = object
      item.geometry = geometry
      item.material = material
      item.groupOrder = groupOrder
      item.renderOrder = object.renderOrder
      item.z = z
    }
    this.itemsUsed++
    if (material.transparent === true) this.transparent.push(item)
    else this.opaque.push(item)
  }

  private renderObjects(list: RenderItem[], camera: Camera): void {
    for (let i = 0, l = list.length; i < l; i++) {
      const item = list[i]
      const object = item.object
      if (object.layers.test(camera.layers)) this.renderObject(object, camera, item.geometry, item.material)
    }
  }

  private renderObject(object: Mesh, camera: Camera, geometry: BufferGeometry, material: Material): void {
    object.modelViewMatrix.multiplyMatrices(camera.matrixWorldInverse, object.matrixWorld)
    if (material.transparent === true && material.side === DoubleSide && material.forceSinglePass === false) {
      // back faces first, then front, for a blended double-sided material
      this.draw(camera, geometry, material, object, BackSide)
      this.draw(camera, geometry, material, object, FrontSide)
    } else this.draw(camera, geometry, material, object, material.side)
  }

  private draw(camera: Camera, geometry: BufferGeometry, material: Material, object: Mesh, side: Side): void {
    const gl = this.gl
    const frontFaceCW = object.matrixWorld.determinantAffine() < 0
    const props = this.materialProps(material)
    const program = this.getProgram(props, material, geometry, side)
    if (!program.linked) this.finishProgram(program)
    let refreshMaterial = false
    if (this.useProgram(program)) refreshMaterial = true
    if (props.currentProgram !== program) {
      props.currentProgram = program
      refreshMaterial = true
    }
    if (material.id !== this.currentMaterialId) {
      this.currentMaterialId = material.id
      refreshMaterial = true
    }
    this.setMaterialState(material, side, frontFaceCW)
    this.textureUnit = 0
    if (program.cameraStamp !== this.cameraStamp || this.currentCamera !== camera) {
      program.cameraStamp = this.cameraStamp
      this.currentCamera = camera
      if (program.projectionMatrix) this.setUniform(program.projectionMatrix, camera.projectionMatrix)
      if (program.viewMatrix) this.setUniform(program.viewMatrix, camera.matrixWorldInverse)
      if (program.cameraPosition) this.setUniform(program.cameraPosition, _vector3.setFromMatrixPosition(camera.matrixWorld))
      if (program.isOrthographic) this.setUniform(program.isOrthographic, false)
    }
    if (refreshMaterial) {
      const table = props.uniforms!
      if ((material as MeshBasicMaterial).isMeshBasicMaterial) this.refreshBasicUniforms(table, material as MeshBasicMaterial)
      const list = this.uniformsList(props, program)
      for (let i = 0; i < list.length; i++) this.setUniform(list[i][0], list[i][1].value)
    }
    if (program.modelViewMatrix) this.setUniform(program.modelViewMatrix, object.modelViewMatrix)
    if (program.modelMatrix) this.setUniform(program.modelMatrix, object.matrixWorld)
    this.bindGeometry(geometry, program, material)
    const index = geometry.index
    const drawRange = geometry.drawRange
    let drawStart = drawRange.start
    let drawEnd = drawRange.start + drawRange.count
    if (index !== null) {
      drawStart = Math.max(drawStart, 0)
      drawEnd = Math.min(drawEnd, index.count)
    } else {
      const position = geometry.attributes.position
      if (!position) return
      drawStart = Math.max(drawStart, 0)
      drawEnd = Math.min(drawEnd, position.count)
    }
    const drawCount = drawEnd - drawStart
    if (drawCount < 0 || drawCount === Infinity) return
    if (index !== null) {
      const bytes = index.array.BYTES_PER_ELEMENT
      gl.drawElements(gl.TRIANGLES, drawCount, bytes === 4 ? gl.UNSIGNED_INT : bytes === 2 ? gl.UNSIGNED_SHORT : gl.UNSIGNED_BYTE, drawStart * bytes)
    } else gl.drawArrays(gl.TRIANGLES, drawStart, drawCount)
    this.info.render.calls++
  }

  // ------------------------------------------------------------ lifecycle

  /**
   * Compile the programs the scene needs before the first frame, so it is not paid for then.
   * Every program is handed to the driver here and none is waited for: the links run in
   * parallel where the driver can, and each is checked when it is first drawn with.
   * With `depthOnly` set, the depth-only programs are compiled instead.
   */
  compile(scene: Scene, camera: Camera): void {
    if (this.lost) return
    scene.traverse((o) => {
      const mesh = o as Mesh
      if (!mesh.isMesh) return
      const material = mesh.material as Material
      const props = this.materialProps(material)
      if (material.transparent && material.side === DoubleSide && !material.forceSinglePass) {
        this.getProgram(props, material, mesh.geometry, BackSide)
        this.getProgram(props, material, mesh.geometry, FrontSide)
      } else this.getProgram(props, material, mesh.geometry, material.side)
    })
    void camera
  }

  /** Lose the context on purpose (WEBGL_lose_context), for testing the loss path; `forceContextRestore` brings it back. */
  forceContextLoss(): void {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext()
  }

  forceContextRestore(): void {
    this.gl.getExtension('WEBGL_lose_context')?.restoreContext()
  }

  dispose(): void {
    const gl = this.gl
    this.domElement.removeEventListener('webglcontextlost', this.onLost as EventListener, false)
    this.domElement.removeEventListener('webglcontextrestored', this.onRestored as EventListener, false)
    if (!this.lost) {
      for (const p of this.programs.values()) {
        gl.deleteProgram(p.program)
        if (p.vs) gl.deleteShader(p.vs)
        if (p.fs) gl.deleteShader(p.fs)
      }
      if (this.emptyTexture) gl.deleteTexture(this.emptyTexture)
    }
    this.programs.clear()
    this.emptyTexture = null
    this.items.length = this.opaque.length = this.transparent.length = 0
    this.itemsUsed = 0
    // the geometries, textures and targets still alive keep their handles until their own dispose; the context outlives this renderer
  }
}

/** An image the browser can upload as it is: an element, a bitmap, a canvas, or ImageData. */
function isTexImageSource(image: unknown): image is TexImageSource {
  if (typeof image !== 'object' || image === null) return false
  return (
    (typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement) ||
    (typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement) ||
    (typeof HTMLVideoElement !== 'undefined' && image instanceof HTMLVideoElement) ||
    (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) ||
    (typeof ImageData !== 'undefined' && image instanceof ImageData) ||
    (typeof OffscreenCanvas !== 'undefined' && image instanceof OffscreenCanvas)
  )
}

function glType(gl: WebGL2RenderingContext, array: ArrayBufferView): number {
  if (array instanceof Float32Array) return gl.FLOAT
  if (array instanceof Uint16Array) return gl.UNSIGNED_SHORT
  if (array instanceof Int16Array) return gl.SHORT
  if (array instanceof Uint32Array) return gl.UNSIGNED_INT
  if (array instanceof Int32Array) return gl.INT
  if (array instanceof Int8Array) return gl.BYTE
  if (array instanceof Uint8Array || array instanceof Uint8ClampedArray) return gl.UNSIGNED_BYTE
  throw new Error('WebGLRenderer: unsupported attribute array type')
}

function arraysEqual(a: number[], b: number[], n: number): boolean {
  if (a.length < n) return false
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false
  return true
}

function copyArray(a: number[], b: number[], n: number): void {
  for (let i = 0; i < n; i++) a[i] = b[i]
}

// referenced for their side effects on typing only
export type { RGBAFormat as _RGBAFormat, DepthTexture as _DepthTexture }
