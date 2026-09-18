/**
 * Textures and the one render target: what the renderer uploads, and the
 * flags that say how. A `Texture` shares its `Source` with its clones (a
 * clone is the same image with its own offset and repeat, the cursor's icon
 * cut from the atlas), and `needsUpdate` bumps both versions so the renderer
 * uploads the image again on its next use.
 *
 * The constants carry the baseline's values so a test that compares
 * against them keeps meaning.
 */
import { EventDispatcher } from './core.js'
import { Matrix3, NoColorSpace, Vector2, Vector4, type ColorSpace } from './math.js'

export const NearestFilter = 1003
export const LinearFilter = 1006
export const LinearMipmapLinearFilter = 1008
export const ClampToEdgeWrapping = 1001
export const RepeatWrapping = 1000
export type Wrapping = typeof ClampToEdgeWrapping | typeof RepeatWrapping
export const RGBAFormat = 1023
export const RedFormat = 1028
export const DepthFormat = 1026
export const UnsignedByteType = 1009
export const UnsignedIntType = 1014
export type TextureFilter = typeof NearestFilter | typeof LinearFilter | typeof LinearMipmapLinearFilter
export type TextureFormat = typeof RGBAFormat | typeof RedFormat | typeof DepthFormat
export type TextureType = typeof UnsignedByteType | typeof UnsignedIntType

export type DataImage = { data: ArrayBufferView | null; width: number; height: number }
export type TextureImage = TexImageSource | DataImage | { width: number; height: number }

/** The image behind a texture, shared by the texture's clones. */
export class Source {
  data: TextureImage | null
  version = 0
  /**
   * Called by the renderer once it has uploaded the image (not on a version
   * bump that had no pixels to send). An owner that kept the pixels for the
   * upload alone lets them go here, leaving `data` a bare `{ width, height }`
   * or a `DataImage` with null data: the renderer then keeps what it has.
   */
  onUpload: ((source: Source) => void) | null = null
  constructor(data: TextureImage | null = null) {
    this.data = data
  }
  set needsUpdate(value: boolean) {
    if (value === true) this.version++
  }
}

let _textureId = 0

export class Texture extends EventDispatcher {
  readonly id = _textureId++
  readonly isTexture = true
  source: Source
  wrapS: Wrapping = ClampToEdgeWrapping
  wrapT: Wrapping = ClampToEdgeWrapping
  magFilter: TextureFilter = LinearFilter
  minFilter: TextureFilter = LinearMipmapLinearFilter
  format: TextureFormat = RGBAFormat
  type: TextureType = UnsignedByteType
  offset = new Vector2(0, 0)
  repeat = new Vector2(1, 1)
  center = new Vector2(0, 0)
  rotation = 0
  matrixAutoUpdate = true
  matrix = new Matrix3()
  generateMipmaps = true
  premultiplyAlpha = false
  flipY = true
  /** 1, 2, 4 or 8: how rows of the uploaded data are padded. */
  unpackAlignment = 4
  colorSpace: ColorSpace = NoColorSpace
  version = 0
  constructor(image: TextureImage | null = null) {
    super()
    this.source = new Source(image)
  }
  get image(): TextureImage | null {
    return this.source.data
  }
  set image(value: TextureImage | null) {
    this.source.data = value
  }
  set needsUpdate(value: boolean) {
    if (value === true) {
      this.version++
      this.source.needsUpdate = true
    }
  }
  /** The uv transform the map shader applies, from offset, repeat, rotation and centre. */
  updateMatrix(): void {
    this.matrix.setUvTransform(this.offset.x, this.offset.y, this.repeat.x, this.repeat.y, this.rotation, this.center.x, this.center.y)
  }
  clone(): this {
    return new (this.constructor as new () => this)().copy(this)
  }
  copy(source: Texture): this {
    this.source = source.source
    this.wrapS = source.wrapS
    this.wrapT = source.wrapT
    this.magFilter = source.magFilter
    this.minFilter = source.minFilter
    this.format = source.format
    this.type = source.type
    this.offset.copy(source.offset)
    this.repeat.copy(source.repeat)
    this.center.copy(source.center)
    this.rotation = source.rotation
    this.matrixAutoUpdate = source.matrixAutoUpdate
    this.matrix.copy(source.matrix)
    this.generateMipmaps = source.generateMipmaps
    this.premultiplyAlpha = source.premultiplyAlpha
    this.flipY = source.flipY
    this.unpackAlignment = source.unpackAlignment
    this.colorSpace = source.colorSpace
    this.needsUpdate = true
    return this
  }
  dispose(): void {
    this.dispatchEvent({ type: 'dispose' })
  }
}

/** A texture drawn on a canvas: uploaded as it is now, and again after `needsUpdate`. */
export class CanvasTexture extends Texture {
  readonly isCanvasTexture = true
  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    super(canvas)
    this.needsUpdate = true
  }
}

/** A texture from bytes in memory: nearest filtered, unpadded rows, never flipped. */
export class DataTexture extends Texture {
  readonly isDataTexture = true
  override get image(): DataImage {
    return this.source.data as DataImage
  }
  override set image(value: DataImage) {
    this.source.data = value
  }
  constructor(data: ArrayBufferView | null = null, width = 1, height = 1, format: TextureFormat = RGBAFormat, type: TextureType = UnsignedByteType) {
    super({ data, width, height })
    this.format = format
    this.type = type
    this.magFilter = NearestFilter
    this.minFilter = NearestFilter
    this.generateMipmaps = false
    this.flipY = false
    this.unpackAlignment = 1
  }
}

/** A render target's depth attachment, readable as a texture: 24-bit depth, nearest filtered. */
export class DepthTexture extends Texture {
  readonly isDepthTexture = true
  override get image(): { width: number; height: number } {
    return this.source.data as { width: number; height: number }
  }
  override set image(value: { width: number; height: number }) {
    this.source.data = value
  }
  constructor(width: number, height: number, type: TextureType = UnsignedIntType) {
    super({ width, height })
    this.format = DepthFormat
    this.type = type
    this.magFilter = NearestFilter
    this.minFilter = NearestFilter
    this.flipY = false
    this.generateMipmaps = false
  }
}

export interface RenderTargetOptions {
  depthTexture?: DepthTexture | null
  depthBuffer?: boolean
  stencilBuffer?: boolean
  /** False for a target drawn for its depth alone: no colour attachment is allocated, and `texture` is never drawn into. */
  colorBuffer?: boolean
}

/**
 * An off-screen framebuffer: one colour attachment (unless `colorBuffer` is
 * false, a depth-only target), and a
 * depth texture where given.
 */
export class WebGLRenderTarget extends EventDispatcher {
  readonly isRenderTarget = true
  width: number
  height: number
  viewport: Vector4
  texture: Texture
  depthTexture: DepthTexture | null
  depthBuffer: boolean
  stencilBuffer: boolean
  colorBuffer: boolean
  constructor(width = 1, height = 1, options: RenderTargetOptions = {}) {
    super()
    this.width = width
    this.height = height
    this.viewport = new Vector4(0, 0, width, height)
    this.texture = new Texture({ width, height })
    this.texture.minFilter = LinearFilter
    this.texture.generateMipmaps = false
    this.texture.flipY = false
    this.depthTexture = options.depthTexture ?? null
    this.depthBuffer = options.depthBuffer ?? true
    this.stencilBuffer = options.stencilBuffer ?? false
    this.colorBuffer = options.colorBuffer ?? true
  }
  dispose(): void {
    this.dispatchEvent({ type: 'dispose' })
  }
}
