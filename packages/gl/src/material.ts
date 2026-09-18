/**
 * Materials: how a mesh is drawn. `MeshBasicMaterial` is the unlit textured
 * material with the hooks @orbrun/render-3d patches its light and flash into
 * (`onBeforeCompile` over the shader's `#include` marks);
 * `ShaderMaterial` is the renderer's own GLSL with its own uniforms. The
 * shader sources themselves are in shaders.ts.
 *
 * The constants carry the baseline's values so a test that compares
 * against them keeps meaning.
 */
import { EventDispatcher } from './core.js'
import { Color, generateUUID } from './math.js'
import type { Texture } from './texture.js'

export const FrontSide = 0
export const BackSide = 1
export const DoubleSide = 2
export type Side = typeof FrontSide | typeof BackSide | typeof DoubleSide

export const NoBlending = 0
export const NormalBlending = 1
export type Blending = typeof NoBlending | typeof NormalBlending

export interface IUniform<T = unknown> {
  value: T
}

/** What `onBeforeCompile` is handed: the sources and the uniforms it may add to. */
export interface ShaderObject {
  name: string
  uniforms: Record<string, IUniform>
  vertexShader: string
  fragmentShader: string
}

let _materialId = 0

export class Material extends EventDispatcher {
  readonly id = _materialId++
  readonly uuid = generateUUID()
  readonly isMaterial = true
  type = 'Material'
  name = ''
  blending: Blending = NormalBlending
  side: Side = FrontSide
  vertexColors = false
  opacity = 1
  /** Drawn in the blended pass, back to front, after everything opaque. */
  transparent = false
  depthTest = true
  depthWrite = true
  colorWrite = true
  premultipliedAlpha = false
  /** A transparent double-sided material is drawn twice, back faces then front, unless this is set. */
  forceSinglePass = false
  visible = true
  userData: Record<string, unknown> = {}
  /** `#define`s put before the shader source; a value of '' defines the name alone. */
  defines: Record<string, string | number | boolean> | undefined = undefined
  /** Version of the compiled program: `needsUpdate` bumps it, and so does a change that alters the program (`alphaTest` on or off). */
  version = 0
  private _alphaTest = 0
  /** Fragments under this alpha are discarded (the fragment shader's `USE_ALPHATEST`). */
  get alphaTest(): number {
    return this._alphaTest
  }
  set alphaTest(value: number) {
    if (this._alphaTest > 0 !== value > 0) this.version++
    this._alphaTest = value
  }
  set needsUpdate(value: boolean) {
    if (value === true) this.version++
  }
  /** Called once per compiled program with the sources and uniforms; what it changes is what compiles. Not carried by `clone`. */
  onBeforeCompile: (shader: ShaderObject) => void = () => {}
  /** Part of the program cache key: the same hook text, the same program. */
  customProgramCacheKey(): string {
    return this.onBeforeCompile.toString()
  }
  setValues(values?: Record<string, unknown>): void {
    if (values === undefined) return
    for (const key in values) {
      const newValue = values[key]
      if (newValue === undefined) continue
      const currentValue = (this as unknown as Record<string, unknown>)[key]
      if (currentValue === undefined) continue
      if (currentValue && (currentValue as Color).isColor) (currentValue as Color).set(newValue as number | Color)
      else (this as unknown as Record<string, unknown>)[key] = newValue
    }
  }
  clone(): this {
    return new (this.constructor as new () => this)().copy(this)
  }
  copy(source: Material): this {
    this.name = source.name
    this.blending = source.blending
    this.side = source.side
    this.vertexColors = source.vertexColors
    this.opacity = source.opacity
    this.transparent = source.transparent
    this.depthTest = source.depthTest
    this.depthWrite = source.depthWrite
    this.colorWrite = source.colorWrite
    this.alphaTest = source.alphaTest
    this.premultipliedAlpha = source.premultipliedAlpha
    this.forceSinglePass = source.forceSinglePass
    this.visible = source.visible
    this.userData = JSON.parse(JSON.stringify(source.userData))
    return this
  }
  dispose(): void {
    this.dispatchEvent({ type: 'dispose' })
  }
}

export interface MeshBasicMaterialParameters {
  color?: number | string | Color
  map?: Texture | null
  vertexColors?: boolean
  transparent?: boolean
  opacity?: number
  alphaTest?: number
  side?: Side
  depthTest?: boolean
  depthWrite?: boolean
  visible?: boolean
  name?: string
}

/** An unlit colour, optionally a map and the vertex colours, multiplied together. */
export class MeshBasicMaterial extends Material {
  readonly isMeshBasicMaterial = true
  color = new Color(0xffffff)
  map: Texture | null = null
  constructor(parameters?: MeshBasicMaterialParameters) {
    super()
    this.type = 'MeshBasicMaterial'
    this.setValues(parameters as Record<string, unknown> | undefined)
  }
  override copy(source: Material): this {
    super.copy(source)
    const s = source as MeshBasicMaterial
    this.color.copy(s.color)
    this.map = s.map
    return this
  }
}

export interface ShaderMaterialParameters {
  uniforms?: Record<string, IUniform>
  defines?: Record<string, string | number | boolean>
  vertexShader?: string
  fragmentShader?: string
  vertexColors?: boolean
  transparent?: boolean
  opacity?: number
  side?: Side
  depthTest?: boolean
  depthWrite?: boolean
  name?: string
}

/** Copy a uniform table: vector, colour and matrix values are cloned, textures and numbers shared. */
export function cloneUniforms(src: Record<string, IUniform>): Record<string, IUniform> {
  const dst: Record<string, IUniform> = {}
  for (const u in src) {
    const v = src[u].value as { isColor?: boolean; isTexture?: boolean; clone?: () => unknown } | null
    dst[u] = { value: v && typeof v === 'object' && !v.isTexture && typeof v.clone === 'function' ? v.clone() : v }
  }
  return dst
}

/** The renderer's own GLSL, with the built-in uniforms and attributes injected so the renderer's sources compile unchanged. */
export class ShaderMaterial extends Material {
  readonly isShaderMaterial = true
  uniforms: Record<string, IUniform> = {}
  override defines: Record<string, string | number | boolean> = {}
  vertexShader = 'void main() {\n\tgl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );\n}'
  fragmentShader = 'void main() {\n\tgl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );\n}'
  /** What an attribute the geometry lacks reads as. */
  defaultAttributeValues: Record<string, number[]> = { color: [1, 1, 1], uv: [0, 0], uv1: [0, 0] }
  constructor(parameters?: ShaderMaterialParameters) {
    super()
    this.type = 'ShaderMaterial'
    // its own GLSL says what a face is; a double-sided transparent one is drawn once
    this.forceSinglePass = true
    this.setValues(parameters as Record<string, unknown> | undefined)
  }
  override copy(source: Material): this {
    super.copy(source)
    const s = source as ShaderMaterial
    this.fragmentShader = s.fragmentShader
    this.vertexShader = s.vertexShader
    this.uniforms = cloneUniforms(s.uniforms)
    this.defines = Object.assign({}, s.defines)
    this.defaultAttributeValues = Object.assign({}, s.defaultAttributeValues)
    return this
  }
}
