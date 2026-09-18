/**
 * The scene graph: objects with a place in the world and a parent, meshes
 * that pair a geometry with a material, the camera, and the buffers a
 * geometry is made of. Built without a GL context so a scene can be stood
 * and inspected under a test runner; the renderer (renderer.ts) reads it.
 *
 * What @orbrun/render-3d relies on is here and nothing more: a `version` bumped by `needsUpdate` to say a buffer changed, update
 * ranges to upload only what was written, `renderOrder` and `layers` read by
 * the renderer's sort and culling, and `dispose` events the renderer listens
 * to so a buffer or texture is freed when its owner lets it go.
 */
import { Box3, Euler, Matrix3, Matrix4, Quaternion, Sphere, Vector3, generateUUID } from './math.js'

type Listener = (event: { type: string; target: unknown }) => void

export class EventDispatcher {
  private _listeners?: Record<string, Listener[]>
  addEventListener(type: string, listener: Listener): void {
    const l = (this._listeners ??= {})
    ;(l[type] ??= []).push(listener)
  }
  removeEventListener(type: string, listener: Listener): void {
    const arr = this._listeners?.[type]
    if (!arr) return
    const i = arr.indexOf(listener)
    if (i !== -1) arr.splice(i, 1)
  }
  dispatchEvent(event: { type: string; target?: unknown }): void {
    const arr = this._listeners?.[event.type]
    if (!arr) return
    event.target = this
    for (const l of arr.slice(0)) l(event as { type: string; target: unknown })
  }
}

export class Layers {
  mask = 1 | 0
  set(layer: number): void {
    this.mask = ((1 << layer) | 0) >>> 0
  }
  enable(layer: number): void {
    this.mask |= (1 << layer) | 0
  }
  disable(layer: number): void {
    this.mask &= ~((1 << layer) | 0)
  }
  test(layers: Layers): boolean {
    return (this.mask & layers.mask) !== 0
  }
}

// ------------------------------------------------------------- buffers

export type TypedArray = Float32Array | Uint8Array | Uint16Array | Uint32Array | Int8Array | Int16Array | Int32Array | Uint8ClampedArray

export interface UpdateRange {
  start: number
  count: number
}

export class BufferAttribute {
  array: TypedArray
  itemSize: number
  count: number
  normalized: boolean
  version = 0
  updateRanges: UpdateRange[] = []
  readonly isBufferAttribute = true
  constructor(array: TypedArray, itemSize: number, normalized = false) {
    this.array = array
    this.itemSize = itemSize
    this.count = array.length / itemSize
    this.normalized = normalized
  }
  /** Setting true bumps the version; the renderer uploads the written ranges (or the whole array) on the next use. */
  set needsUpdate(value: boolean) {
    if (value === true) this.version++
  }
  addUpdateRange(start: number, count: number): void {
    this.updateRanges.push({ start, count })
  }
  clearUpdateRanges(): void {
    this.updateRanges.length = 0
  }
  getX(i: number): number {
    return this.array[i * this.itemSize]
  }
  getY(i: number): number {
    return this.array[i * this.itemSize + 1]
  }
  getZ(i: number): number {
    return this.array[i * this.itemSize + 2]
  }
  setXYZ(i: number, x: number, y: number, z: number): this {
    const o = i * this.itemSize
    this.array[o] = x
    this.array[o + 1] = y
    this.array[o + 2] = z
    return this
  }
  applyMatrix4(m: Matrix4): this {
    for (let i = 0, l = this.count; i < l; i++) {
      _v.fromBufferAttribute(this, i)
      _v.applyMatrix4(m)
      this.setXYZ(i, _v.x, _v.y, _v.z)
    }
    return this
  }
  applyNormalMatrix(m: Matrix3): this {
    for (let i = 0, l = this.count; i < l; i++) {
      _v.fromBufferAttribute(this, i)
      _v.applyNormalMatrix(m)
      this.setXYZ(i, _v.x, _v.y, _v.z)
    }
    return this
  }
}

export class Float32BufferAttribute extends BufferAttribute {
  constructor(array: ArrayLike<number>, itemSize: number, normalized = false) {
    super(new Float32Array(array), itemSize, normalized)
  }
}
export class Uint16BufferAttribute extends BufferAttribute {
  constructor(array: ArrayLike<number>, itemSize: number, normalized = false) {
    super(new Uint16Array(array), itemSize, normalized)
  }
}
export class Uint32BufferAttribute extends BufferAttribute {
  constructor(array: ArrayLike<number>, itemSize: number, normalized = false) {
    super(new Uint32Array(array), itemSize, normalized)
  }
}

function arrayNeedsUint32(array: ArrayLike<number>): boolean {
  for (let i = array.length - 1; i >= 0; --i) if (array[i] >= 65535) return true
  return false
}

const _box = /*@__PURE__*/ new Box3()
const _v = /*@__PURE__*/ new Vector3()
const _m = /*@__PURE__*/ new Matrix4()
const _m1 = /*@__PURE__*/ new Matrix4()
const _q1 = /*@__PURE__*/ new Quaternion()
const _xAxis = /*@__PURE__*/ new Vector3(1, 0, 0)
const _yAxis = /*@__PURE__*/ new Vector3(0, 1, 0)
const _up = /*@__PURE__*/ new Vector3(0, 1, 0)
const _target = /*@__PURE__*/ new Vector3()
const _position = /*@__PURE__*/ new Vector3()
const _scale = /*@__PURE__*/ new Vector3()

let _geometryId = 0

export class BufferGeometry extends EventDispatcher {
  readonly id = _geometryId++
  readonly isBufferGeometry = true
  attributes: Record<string, BufferAttribute> = {}
  index: BufferAttribute | null = null
  boundingSphere: Sphere | null = null
  boundingBox: Box3 | null = null
  drawRange = { start: 0, count: Infinity }
  userData: Record<string, unknown> = {}
  setAttribute(name: string, attribute: BufferAttribute): this {
    this.attributes[name] = attribute
    return this
  }
  /** The attribute by name; the caller vouches that it exists. */
  getAttribute(name: string): BufferAttribute {
    return this.attributes[name]
  }
  hasAttribute(name: string): boolean {
    return this.attributes[name] !== undefined
  }
  deleteAttribute(name: string): this {
    delete this.attributes[name]
    return this
  }
  getIndex(): BufferAttribute | null {
    return this.index
  }
  setIndex(index: BufferAttribute | number[] | null): this {
    if (Array.isArray(index)) this.index = arrayNeedsUint32(index) ? new Uint32BufferAttribute(index, 1) : new Uint16BufferAttribute(index, 1)
    else this.index = index
    return this
  }
  setDrawRange(start: number, count: number): void {
    this.drawRange.start = start
    this.drawRange.count = count
  }
  computeBoundingBox(): void {
    if (this.boundingBox === null) this.boundingBox = new Box3()
    const position = this.attributes.position
    if (position) this.boundingBox.setFromBufferAttribute(position)
    else this.boundingBox.makeEmpty()
  }
  /** The sphere round every vertex, centred on the middle of their box: what the frustum test and the sort read. */
  computeBoundingSphere(): void {
    if (this.boundingSphere === null) this.boundingSphere = new Sphere()
    const position = this.attributes.position
    if (position) {
      const center = this.boundingSphere.center
      if (position.itemSize === 3) {
        // the same box, centre and radius as the general path below, in one pass over the array:
        // a level mesh has hundreds of thousands of vertices and is measured at every rebuild
        const a = position.array
        const n = position.count * 3
        let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity
        for (let i = 0; i < n; i += 3) {
          const x = a[i], y = a[i + 1], z = a[i + 2]
          x0 = Math.min(x0, x)
          y0 = Math.min(y0, y)
          z0 = Math.min(z0, z)
          x1 = Math.max(x1, x)
          y1 = Math.max(y1, y)
          z1 = Math.max(z1, z)
        }
        if (x1 < x0 || y1 < y0 || z1 < z0) center.set(0, 0, 0)
        else center.set((x0 + x1) * 0.5, (y0 + y1) * 0.5, (z0 + z1) * 0.5)
        const cx = center.x, cy = center.y, cz = center.z
        let maxRadiusSq = 0
        for (let i = 0; i < n; i += 3) {
          const dx = cx - a[i], dy = cy - a[i + 1], dz = cz - a[i + 2]
          maxRadiusSq = Math.max(maxRadiusSq, dx * dx + dy * dy + dz * dz)
        }
        this.boundingSphere.radius = Math.sqrt(maxRadiusSq)
        return
      }
      _box.setFromBufferAttribute(position)
      _box.getCenter(center)
      let maxRadiusSq = 0
      for (let i = 0, il = position.count; i < il; i++) {
        _v.fromBufferAttribute(position, i)
        maxRadiusSq = Math.max(maxRadiusSq, center.distanceToSquared(_v))
      }
      this.boundingSphere.radius = Math.sqrt(maxRadiusSq)
    }
  }
  applyMatrix4(matrix: Matrix4): this {
    const position = this.attributes.position
    if (position !== undefined) {
      position.applyMatrix4(matrix)
      position.needsUpdate = true
    }
    const normal = this.attributes.normal
    if (normal !== undefined) {
      const normalMatrix = new Matrix3().getNormalMatrix(matrix)
      normal.applyNormalMatrix(normalMatrix)
      normal.needsUpdate = true
    }
    if (this.boundingSphere !== null) this.computeBoundingSphere()
    return this
  }
  rotateX(angle: number): this {
    _m.makeRotationX(angle)
    return this.applyMatrix4(_m)
  }
  dispose(): void {
    this.dispatchEvent({ type: 'dispose' })
  }
}

// ------------------------------------------------------------- objects

let _objectId = 0

export class Object3D extends EventDispatcher {
  readonly id = _objectId++
  readonly uuid = generateUUID()
  readonly isObject3D = true
  name = ''
  parent: Object3D | null = null
  children: Object3D[] = []
  position = new Vector3()
  rotation = new Euler()
  quaternion = new Quaternion()
  scale = new Vector3(1, 1, 1)
  matrix = new Matrix4()
  matrixWorld = new Matrix4()
  matrixAutoUpdate = true
  matrixWorldNeedsUpdate = false
  matrixWorldAutoUpdate = true
  layers = new Layers()
  visible = true
  frustumCulled = true
  renderOrder = 0
  userData: Record<string, unknown> = {}
  constructor() {
    super()
    // the rotation and the quaternion say the same thing; setting one sets the other
    this.rotation._onChange(() => this.quaternion.setFromEuler(this.rotation, false))
    this.quaternion._onChange(() => this.rotation.setFromQuaternion(this.quaternion, undefined, false))
  }
  /** Turn about an axis of the object's own frame. */
  rotateOnAxis(axis: Vector3, angle: number): this {
    _q1.setFromAxisAngle(axis, angle)
    this.quaternion.multiply(_q1)
    return this
  }
  rotateX(angle: number): this {
    return this.rotateOnAxis(_xAxis, angle)
  }
  rotateY(angle: number): this {
    return this.rotateOnAxis(_yAxis, angle)
  }
  /** Face `target` (world), a camera down its -z; the parent's rotation is taken out. */
  lookAt(x: number | Vector3, y?: number, z?: number): void {
    if (typeof x === 'object') _target.copy(x)
    else _target.set(x, y!, z!)
    const parent = this.parent
    this.updateMatrixWorld(true)
    _position.setFromMatrixPosition(this.matrixWorld)
    if ((this as { isCamera?: boolean }).isCamera) _m1.lookAt(_position, _target, _up)
    else _m1.lookAt(_target, _position, _up)
    this.quaternion.setFromRotationMatrix(_m1)
    if (parent) {
      _m1.copy(parent.matrixWorld)
      _m1.decompose(_position, _q1, _scale)
      this.quaternion.copy(_q1.invert().multiply(this.quaternion))
    }
  }
  add(...objects: Object3D[]): this {
    for (const o of objects) {
      if (o.parent !== null) o.parent.remove(o)
      o.parent = this
      this.children.push(o)
    }
    return this
  }
  remove(...objects: Object3D[]): this {
    for (const o of objects) {
      const i = this.children.indexOf(o)
      if (i !== -1) {
        o.parent = null
        this.children.splice(i, 1)
      }
    }
    return this
  }
  clear(): this {
    return this.remove(...this.children)
  }
  traverse(cb: (o: Object3D) => void): void {
    cb(this)
    const children = this.children
    for (let i = 0, l = children.length; i < l; i++) children[i].traverse(cb)
  }
  updateMatrix(): void {
    this.matrix.compose(this.position, this.quaternion, this.scale)
    this.matrixWorldNeedsUpdate = true
  }
  updateMatrixWorld(force?: boolean): void {
    if (this.matrixAutoUpdate) this.updateMatrix()
    if (this.matrixWorldNeedsUpdate || force) {
      if (this.matrixWorldAutoUpdate === true) {
        if (this.parent === null) this.matrixWorld.copy(this.matrix)
        else this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix)
      }
      this.matrixWorldNeedsUpdate = false
      force = true
    }
    const children = this.children
    for (let i = 0, l = children.length; i < l; i++) children[i].updateMatrixWorld(force)
  }
}

export class Group extends Object3D {
  readonly isGroup = true
}

export class Scene extends Object3D {
  readonly isScene = true
  /** A colour clears the frame before it is drawn; null leaves the renderer's own clear colour. */
  background: import('./math.js').Color | null = null
}

export class Mesh<G extends BufferGeometry = BufferGeometry, M = unknown> extends Object3D {
  readonly isMesh = true
  geometry: G
  material: M
  /** Filled by the renderer per frame: the view matrix times the world matrix. */
  modelViewMatrix = new Matrix4()
  constructor(geometry: G, material: M) {
    super()
    this.geometry = geometry
    this.material = material
  }
  getVertexPosition(index: number, target: Vector3): Vector3 {
    return target.fromBufferAttribute(this.geometry.attributes.position, index)
  }
}

// -------------------------------------------------------------- camera

const _cp = /*@__PURE__*/ new Vector3()
const _cq = /*@__PURE__*/ new Quaternion()
const _cs = /*@__PURE__*/ new Vector3()

export class Camera extends Object3D {
  readonly isCamera = true
  matrixWorldInverse = new Matrix4()
  projectionMatrix = new Matrix4()
  projectionMatrixInverse = new Matrix4()
  override updateMatrixWorld(force?: boolean): void {
    super.updateMatrixWorld(force)
    // the view matrix leaves scale out; the check is on the decomposed scale
    this.matrixWorld.decompose(_cp, _cq, _cs)
    if (_cs.x === 1 && _cs.y === 1 && _cs.z === 1) this.matrixWorldInverse.copy(this.matrixWorld).invert()
    else this.matrixWorldInverse.compose(_cp, _cq, _cs.set(1, 1, 1)).invert()
  }
}

const DEG2RAD = Math.PI / 180

export class PerspectiveCamera extends Camera {
  readonly isPerspectiveCamera = true
  fov: number
  aspect: number
  near: number
  far: number
  zoom = 1
  constructor(fov = 50, aspect = 1, near = 0.1, far = 2000) {
    super()
    this.fov = fov
    this.aspect = aspect
    this.near = near
    this.far = far
    this.updateProjectionMatrix()
  }
  updateProjectionMatrix(): void {
    const near = this.near
    const top = (near * Math.tan(DEG2RAD * 0.5 * this.fov)) / this.zoom
    const height = 2 * top
    const width = this.aspect * height
    const left = -0.5 * width
    this.projectionMatrix.makePerspective(left, left + width, top, top - height, near, this.far)
    this.projectionMatrixInverse.copy(this.projectionMatrix).invert()
  }
}
