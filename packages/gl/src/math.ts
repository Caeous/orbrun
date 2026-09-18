/**
 * The maths the renderer stands on: vectors, matrices, a quaternion and an
 * Euler, a colour, and the bounding shapes the frustum test and the picker
 * use. Every operation is done in one fixed order, because the frame is
 * compared pixel by pixel with the baseline: a matrix built by
 * multiplying in a different order lands a vertex a few ulps away, and a few
 * ulps at a sprite's edge is a pixel. Only what @orbrun/render-3d uses is
 * here.
 */

export class Vector2 {
  x: number
  y: number
  readonly isVector2 = true
  constructor(x = 0, y = 0) {
    this.x = x
    this.y = y
  }
  set(x: number, y: number): this {
    this.x = x
    this.y = y
    return this
  }
  copy(v: { x: number; y: number }): this {
    this.x = v.x
    this.y = v.y
    return this
  }
  clone(): Vector2 {
    return new Vector2(this.x, this.y)
  }
  floor(): this {
    this.x = Math.floor(this.x)
    this.y = Math.floor(this.y)
    return this
  }
  multiplyScalar(s: number): this {
    this.x *= s
    this.y *= s
    return this
  }
  equals(v: { x: number; y: number }): boolean {
    return v.x === this.x && v.y === this.y
  }
  toArray(): [number, number] {
    return [this.x, this.y]
  }
}

export class Vector3 {
  x: number
  y: number
  z: number
  readonly isVector3 = true
  constructor(x = 0, y = 0, z = 0) {
    this.x = x
    this.y = y
    this.z = z
  }
  set(x: number, y: number, z: number): this {
    this.x = x
    this.y = y
    this.z = z
    return this
  }
  copy(v: { x: number; y: number; z: number }): this {
    this.x = v.x
    this.y = v.y
    this.z = v.z
    return this
  }
  clone(): Vector3 {
    return new Vector3(this.x, this.y, this.z)
  }
  add(v: Vector3): this {
    this.x += v.x
    this.y += v.y
    this.z += v.z
    return this
  }
  addVectors(a: Vector3, b: Vector3): this {
    this.x = a.x + b.x
    this.y = a.y + b.y
    this.z = a.z + b.z
    return this
  }
  addScaledVector(v: Vector3, s: number): this {
    this.x += v.x * s
    this.y += v.y * s
    this.z += v.z * s
    return this
  }
  sub(v: Vector3): this {
    this.x -= v.x
    this.y -= v.y
    this.z -= v.z
    return this
  }
  subVectors(a: Vector3, b: Vector3): this {
    this.x = a.x - b.x
    this.y = a.y - b.y
    this.z = a.z - b.z
    return this
  }
  multiplyScalar(s: number): this {
    this.x *= s
    this.y *= s
    this.z *= s
    return this
  }
  divideScalar(s: number): this {
    return this.multiplyScalar(1 / s)
  }
  min(v: Vector3): this {
    this.x = Math.min(this.x, v.x)
    this.y = Math.min(this.y, v.y)
    this.z = Math.min(this.z, v.z)
    return this
  }
  max(v: Vector3): this {
    this.x = Math.max(this.x, v.x)
    this.y = Math.max(this.y, v.y)
    this.z = Math.max(this.z, v.z)
    return this
  }
  dot(v: Vector3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z
  }
  lengthSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z
  }
  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z)
  }
  normalize(): this {
    return this.divideScalar(this.length() || 1)
  }
  cross(v: Vector3): this {
    return this.crossVectors(this, v)
  }
  crossVectors(a: Vector3, b: Vector3): this {
    const ax = a.x, ay = a.y, az = a.z
    const bx = b.x, by = b.y, bz = b.z
    this.x = ay * bz - az * by
    this.y = az * bx - ax * bz
    this.z = ax * by - ay * bx
    return this
  }
  distanceTo(v: Vector3): number {
    return Math.sqrt(this.distanceToSquared(v))
  }
  distanceToSquared(v: Vector3): number {
    const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z
    return dx * dx + dy * dy + dz * dz
  }
  /** Transform as a point: the perspective divide included. */
  applyMatrix4(m: Matrix4): this {
    const x = this.x, y = this.y, z = this.z
    const e = m.elements
    const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15])
    this.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w
    this.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w
    this.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w
    return this
  }
  applyMatrix3(m: Matrix3): this {
    const x = this.x, y = this.y, z = this.z
    const e = m.elements
    this.x = e[0] * x + e[3] * y + e[6] * z
    this.y = e[1] * x + e[4] * y + e[7] * z
    this.z = e[2] * x + e[5] * y + e[8] * z
    return this
  }
  applyNormalMatrix(m: Matrix3): this {
    return this.applyMatrix3(m).normalize()
  }
  /** Transform as a direction (no translation), normalised. */
  transformDirection(m: Matrix4): this {
    const x = this.x, y = this.y, z = this.z
    const e = m.elements
    this.x = e[0] * x + e[4] * y + e[8] * z
    this.y = e[1] * x + e[5] * y + e[9] * z
    this.z = e[2] * x + e[6] * y + e[10] * z
    return this.normalize()
  }
  setFromMatrixPosition(m: Matrix4): this {
    const e = m.elements
    this.x = e[12]
    this.y = e[13]
    this.z = e[14]
    return this
  }
  fromBufferAttribute(a: { getX(i: number): number; getY(i: number): number; getZ(i: number): number }, i: number): this {
    this.x = a.getX(i)
    this.y = a.getY(i)
    this.z = a.getZ(i)
    return this
  }
  project(camera: { matrixWorldInverse: Matrix4; projectionMatrix: Matrix4 }): this {
    return this.applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix)
  }
  unproject(camera: { projectionMatrixInverse: Matrix4; matrixWorld: Matrix4 }): this {
    return this.applyMatrix4(camera.projectionMatrixInverse).applyMatrix4(camera.matrixWorld)
  }
  equals(v: Vector3): boolean {
    return v.x === this.x && v.y === this.y && v.z === this.z
  }
  toArray(): [number, number, number] {
    return [this.x, this.y, this.z]
  }
}

export class Vector4 {
  x: number
  y: number
  z: number
  w: number
  readonly isVector4 = true
  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = x
    this.y = y
    this.z = z
    this.w = w
  }
  set(x: number, y: number, z: number, w: number): this {
    this.x = x
    this.y = y
    this.z = z
    this.w = w
    return this
  }
  copy(v: { x: number; y: number; z: number; w?: number }): this {
    this.x = v.x
    this.y = v.y
    this.z = v.z
    this.w = v.w !== undefined ? v.w : 1
    return this
  }
  clone(): Vector4 {
    return new Vector4(this.x, this.y, this.z, this.w)
  }
  multiplyScalar(s: number): this {
    this.x *= s
    this.y *= s
    this.z *= s
    this.w *= s
    return this
  }
  round(): this {
    this.x = Math.round(this.x)
    this.y = Math.round(this.y)
    this.z = Math.round(this.z)
    this.w = Math.round(this.w)
    return this
  }
  equals(v: Vector4): boolean {
    return v.x === this.x && v.y === this.y && v.z === this.z && v.w === this.w
  }
  /** Transform without a perspective divide (a Vector4 keeps its w). */
  applyMatrix4(m: Matrix4): this {
    const x = this.x, y = this.y, z = this.z, w = this.w
    const e = m.elements
    this.x = e[0] * x + e[4] * y + e[8] * z + e[12] * w
    this.y = e[1] * x + e[5] * y + e[9] * z + e[13] * w
    this.z = e[2] * x + e[6] * y + e[10] * z + e[14] * w
    this.w = e[3] * x + e[7] * y + e[11] * z + e[15] * w
    return this
  }
}

/** Column-major 3×3. */
export class Matrix3 {
  elements: number[] = [1, 0, 0, 0, 1, 0, 0, 0, 1]
  readonly isMatrix3 = true
  set(n11: number, n12: number, n13: number, n21: number, n22: number, n23: number, n31: number, n32: number, n33: number): this {
    const te = this.elements
    te[0] = n11; te[1] = n21; te[2] = n31
    te[3] = n12; te[4] = n22; te[5] = n32
    te[6] = n13; te[7] = n23; te[8] = n33
    return this
  }
  identity(): this {
    return this.set(1, 0, 0, 0, 1, 0, 0, 0, 1)
  }
  copy(m: Matrix3): this {
    const te = this.elements, me = m.elements
    for (let i = 0; i < 9; i++) te[i] = me[i]
    return this
  }
  clone(): Matrix3 {
    return new Matrix3().copy(this)
  }
  setFromMatrix4(m: Matrix4): this {
    const me = m.elements
    return this.set(me[0], me[4], me[8], me[1], me[5], me[9], me[2], me[6], me[10])
  }
  invert(): this {
    const te = this.elements,
      n11 = te[0], n21 = te[1], n31 = te[2],
      n12 = te[3], n22 = te[4], n32 = te[5],
      n13 = te[6], n23 = te[7], n33 = te[8],
      t11 = n33 * n22 - n32 * n23,
      t12 = n32 * n13 - n33 * n12,
      t13 = n23 * n12 - n22 * n13,
      det = n11 * t11 + n21 * t12 + n31 * t13
    if (det === 0) return this.set(0, 0, 0, 0, 0, 0, 0, 0, 0)
    const detInv = 1 / det
    te[0] = t11 * detInv
    te[1] = (n31 * n23 - n33 * n21) * detInv
    te[2] = (n32 * n21 - n31 * n22) * detInv
    te[3] = t12 * detInv
    te[4] = (n33 * n11 - n31 * n13) * detInv
    te[5] = (n31 * n12 - n32 * n11) * detInv
    te[6] = t13 * detInv
    te[7] = (n21 * n13 - n23 * n11) * detInv
    te[8] = (n22 * n11 - n21 * n12) * detInv
    return this
  }
  transpose(): this {
    let tmp
    const m = this.elements
    tmp = m[1]; m[1] = m[3]; m[3] = tmp
    tmp = m[2]; m[2] = m[6]; m[6] = tmp
    tmp = m[5]; m[5] = m[7]; m[7] = tmp
    return this
  }
  getNormalMatrix(m: Matrix4): this {
    return this.setFromMatrix4(m).invert().transpose()
  }
  /** A texture's offset, repeat, rotation and centre as the uv transform the map shader applies. */
  setUvTransform(tx: number, ty: number, sx: number, sy: number, rotation: number, cx: number, cy: number): this {
    const c = Math.cos(rotation)
    const s = Math.sin(rotation)
    this.set(sx * c, sx * s, -sx * (c * cx + s * cy) + cx + tx, -sy * s, sy * c, -sy * (-s * cx + c * cy) + cy + ty, 0, 0, 1)
    return this
  }
}

const _zero = /*@__PURE__*/ new Vector3(0, 0, 0)
const _one = /*@__PURE__*/ new Vector3(1, 1, 1)
const _v1 = /*@__PURE__*/ new Vector3()
const _lx = /*@__PURE__*/ new Vector3()
const _ly = /*@__PURE__*/ new Vector3()
const _lz = /*@__PURE__*/ new Vector3()
// _m1 is declared after Matrix4, below

/** Column-major 4×4: elements 12, 13, 14 are the translation. */
export class Matrix4 {
  elements: number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  readonly isMatrix4 = true
  set(
    n11: number, n12: number, n13: number, n14: number,
    n21: number, n22: number, n23: number, n24: number,
    n31: number, n32: number, n33: number, n34: number,
    n41: number, n42: number, n43: number, n44: number,
  ): this {
    const te = this.elements
    te[0] = n11; te[4] = n12; te[8] = n13; te[12] = n14
    te[1] = n21; te[5] = n22; te[9] = n23; te[13] = n24
    te[2] = n31; te[6] = n32; te[10] = n33; te[14] = n34
    te[3] = n41; te[7] = n42; te[11] = n43; te[15] = n44
    return this
  }
  identity(): this {
    return this.set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
  }
  copy(m: Matrix4): this {
    const te = this.elements, me = m.elements
    for (let i = 0; i < 16; i++) te[i] = me[i]
    return this
  }
  clone(): Matrix4 {
    return new Matrix4().copy(this)
  }
  copyPosition(m: Matrix4): this {
    const te = this.elements, me = m.elements
    te[12] = me[12]
    te[13] = me[13]
    te[14] = me[14]
    return this
  }
  setPosition(x: number | Vector3, y?: number, z?: number): this {
    const te = this.elements
    if (typeof x === 'object') {
      te[12] = x.x
      te[13] = x.y
      te[14] = x.z
    } else {
      te[12] = x
      te[13] = y!
      te[14] = z!
    }
    return this
  }
  multiply(m: Matrix4): this {
    return this.multiplyMatrices(this, m)
  }
  premultiply(m: Matrix4): this {
    return this.multiplyMatrices(m, this)
  }
  multiplyMatrices(a: Matrix4, b: Matrix4): this {
    const ae = a.elements
    const be = b.elements
    const te = this.elements
    const a11 = ae[0], a12 = ae[4], a13 = ae[8], a14 = ae[12]
    const a21 = ae[1], a22 = ae[5], a23 = ae[9], a24 = ae[13]
    const a31 = ae[2], a32 = ae[6], a33 = ae[10], a34 = ae[14]
    const a41 = ae[3], a42 = ae[7], a43 = ae[11], a44 = ae[15]
    const b11 = be[0], b12 = be[4], b13 = be[8], b14 = be[12]
    const b21 = be[1], b22 = be[5], b23 = be[9], b24 = be[13]
    const b31 = be[2], b32 = be[6], b33 = be[10], b34 = be[14]
    const b41 = be[3], b42 = be[7], b43 = be[11], b44 = be[15]
    te[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41
    te[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42
    te[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43
    te[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44
    te[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41
    te[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42
    te[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43
    te[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44
    te[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41
    te[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42
    te[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43
    te[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44
    te[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41
    te[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42
    te[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43
    te[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44
    return this
  }
  determinant(): number {
    const te = this.elements
    const n11 = te[0], n12 = te[4], n13 = te[8], n14 = te[12]
    const n21 = te[1], n22 = te[5], n23 = te[9], n24 = te[13]
    const n31 = te[2], n32 = te[6], n33 = te[10], n34 = te[14]
    const n41 = te[3], n42 = te[7], n43 = te[11], n44 = te[15]
    const t11 = n23 * n34 - n24 * n33
    const t12 = n22 * n34 - n24 * n32
    const t13 = n22 * n33 - n23 * n32
    const t21 = n21 * n34 - n24 * n31
    const t22 = n21 * n33 - n23 * n31
    const t23 = n21 * n32 - n22 * n31
    return (
      n11 * (n42 * t11 - n43 * t12 + n44 * t13) -
      n12 * (n41 * t11 - n43 * t21 + n44 * t22) +
      n13 * (n41 * t12 - n42 * t21 + n44 * t23) -
      n14 * (n41 * t13 - n42 * t22 + n43 * t23)
    )
  }
  /** The determinant of the upper 3×3: negative where the matrix mirrors, and so turns the winding of what it transforms. */
  determinantAffine(): number {
    const te = this.elements
    const n11 = te[0], n12 = te[4], n13 = te[8]
    const n21 = te[1], n22 = te[5], n23 = te[9]
    const n31 = te[2], n32 = te[6], n33 = te[10]
    return n11 * (n22 * n33 - n23 * n32) - n12 * (n21 * n33 - n23 * n31) + n13 * (n21 * n32 - n22 * n31)
  }
  invert(): this {
    const te = this.elements,
      n11 = te[0], n21 = te[1], n31 = te[2], n41 = te[3],
      n12 = te[4], n22 = te[5], n32 = te[6], n42 = te[7],
      n13 = te[8], n23 = te[9], n33 = te[10], n43 = te[11],
      n14 = te[12], n24 = te[13], n34 = te[14], n44 = te[15],
      t1 = n11 * n22 - n21 * n12,
      t2 = n11 * n32 - n31 * n12,
      t3 = n11 * n42 - n41 * n12,
      t4 = n21 * n32 - n31 * n22,
      t5 = n21 * n42 - n41 * n22,
      t6 = n31 * n42 - n41 * n32,
      t7 = n13 * n24 - n23 * n14,
      t8 = n13 * n34 - n33 * n14,
      t9 = n13 * n44 - n43 * n14,
      t10 = n23 * n34 - n33 * n24,
      t11 = n23 * n44 - n43 * n24,
      t12 = n33 * n44 - n43 * n34
    const det = t1 * t12 - t2 * t11 + t3 * t10 + t4 * t9 - t5 * t8 + t6 * t7
    if (det === 0) return this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
    const detInv = 1 / det
    te[0] = (n22 * t12 - n32 * t11 + n42 * t10) * detInv
    te[1] = (n31 * t11 - n21 * t12 - n41 * t10) * detInv
    te[2] = (n24 * t6 - n34 * t5 + n44 * t4) * detInv
    te[3] = (n33 * t5 - n23 * t6 - n43 * t4) * detInv
    te[4] = (n32 * t9 - n12 * t12 - n42 * t8) * detInv
    te[5] = (n11 * t12 - n31 * t9 + n41 * t8) * detInv
    te[6] = (n34 * t3 - n14 * t6 - n44 * t2) * detInv
    te[7] = (n13 * t6 - n33 * t3 + n43 * t2) * detInv
    te[8] = (n12 * t11 - n22 * t9 + n42 * t7) * detInv
    te[9] = (n21 * t9 - n11 * t11 - n41 * t7) * detInv
    te[10] = (n14 * t5 - n24 * t3 + n44 * t1) * detInv
    te[11] = (n23 * t3 - n13 * t5 - n43 * t1) * detInv
    te[12] = (n22 * t8 - n12 * t10 - n32 * t7) * detInv
    te[13] = (n11 * t10 - n21 * t8 + n31 * t7) * detInv
    te[14] = (n24 * t2 - n14 * t4 - n34 * t1) * detInv
    te[15] = (n13 * t4 - n23 * t2 + n33 * t1) * detInv
    return this
  }
  getMaxScaleOnAxis(): number {
    const te = this.elements
    const scaleXSq = te[0] * te[0] + te[1] * te[1] + te[2] * te[2]
    const scaleYSq = te[4] * te[4] + te[5] * te[5] + te[6] * te[6]
    const scaleZSq = te[8] * te[8] + te[9] * te[9] + te[10] * te[10]
    return Math.sqrt(Math.max(scaleXSq, scaleYSq, scaleZSq))
  }
  makeRotationX(theta: number): this {
    const c = Math.cos(theta), s = Math.sin(theta)
    return this.set(1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1)
  }
  makeRotationY(theta: number): this {
    const c = Math.cos(theta), s = Math.sin(theta)
    return this.set(c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1)
  }
  makeRotationFromQuaternion(q: Quaternion): this {
    return this.compose(_zero, q, _one)
  }
  compose(position: Vector3, quaternion: Quaternion, scale: Vector3): this {
    const te = this.elements
    const x = quaternion._x, y = quaternion._y, z = quaternion._z, w = quaternion._w
    const x2 = x + x, y2 = y + y, z2 = z + z
    const xx = x * x2, xy = x * y2, xz = x * z2
    const yy = y * y2, yz = y * z2, zz = z * z2
    const wx = w * x2, wy = w * y2, wz = w * z2
    const sx = scale.x, sy = scale.y, sz = scale.z
    te[0] = (1 - (yy + zz)) * sx
    te[1] = (xy + wz) * sx
    te[2] = (xz - wy) * sx
    te[3] = 0
    te[4] = (xy - wz) * sy
    te[5] = (1 - (xx + zz)) * sy
    te[6] = (yz + wx) * sy
    te[7] = 0
    te[8] = (xz + wy) * sz
    te[9] = (yz - wx) * sz
    te[10] = (1 - (xx + yy)) * sz
    te[11] = 0
    te[12] = position.x
    te[13] = position.y
    te[14] = position.z
    te[15] = 1
    return this
  }
  decompose(position: Vector3, quaternion: Quaternion, scale: Vector3): this {
    const te = this.elements
    position.x = te[12]
    position.y = te[13]
    position.z = te[14]
    const det = this.determinantAffine()
    if (det === 0) {
      scale.set(1, 1, 1)
      quaternion.identity()
      return this
    }
    let sx = _v1.set(te[0], te[1], te[2]).length()
    const sy = _v1.set(te[4], te[5], te[6]).length()
    const sz = _v1.set(te[8], te[9], te[10]).length()
    if (det < 0) sx = -sx
    _m1.copy(this)
    const invSX = 1 / sx
    const invSY = 1 / sy
    const invSZ = 1 / sz
    _m1.elements[0] *= invSX
    _m1.elements[1] *= invSX
    _m1.elements[2] *= invSX
    _m1.elements[4] *= invSY
    _m1.elements[5] *= invSY
    _m1.elements[6] *= invSY
    _m1.elements[8] *= invSZ
    _m1.elements[9] *= invSZ
    _m1.elements[10] *= invSZ
    quaternion.setFromRotationMatrix(_m1)
    scale.x = sx
    scale.y = sy
    scale.z = sz
    return this
  }
  /** The rotation that looks from `eye` at `target` with `up` upward (a camera looks down its -z). */
  lookAt(eye: Vector3, target: Vector3, up: Vector3): this {
    const te = this.elements
    _lz.subVectors(eye, target)
    if (_lz.lengthSq() === 0) _lz.z = 1
    _lz.normalize()
    _lx.crossVectors(up, _lz)
    if (_lx.lengthSq() === 0) {
      if (Math.abs(up.z) === 1) _lz.x += 0.0001
      else _lz.z += 0.0001
      _lz.normalize()
      _lx.crossVectors(up, _lz)
    }
    _lx.normalize()
    _ly.crossVectors(_lz, _lx)
    te[0] = _lx.x; te[4] = _ly.x; te[8] = _lz.x
    te[1] = _lx.y; te[5] = _ly.y; te[9] = _lz.y
    te[2] = _lx.z; te[6] = _ly.z; te[10] = _lz.z
    return this
  }
  /** WebGL clip space: z from -1 at `near` to 1 at `far`. */
  makePerspective(left: number, right: number, top: number, bottom: number, near: number, far: number): this {
    const te = this.elements
    const x = (2 * near) / (right - left)
    const y = (2 * near) / (top - bottom)
    const a = (right + left) / (right - left)
    const b = (top + bottom) / (top - bottom)
    const c = -(far + near) / (far - near)
    const d = (-2 * far * near) / (far - near)
    te[0] = x; te[4] = 0; te[8] = a; te[12] = 0
    te[1] = 0; te[5] = y; te[9] = b; te[13] = 0
    te[2] = 0; te[6] = 0; te[10] = c; te[14] = d
    te[3] = 0; te[7] = 0; te[11] = -1; te[15] = 0
    return this
  }
}

const _m1 = /*@__PURE__*/ new Matrix4()
const _em = /*@__PURE__*/ new Matrix4()

export type EulerOrder = 'XYZ' | 'YXZ' | 'ZXY' | 'ZYX' | 'YZX' | 'XZY'

export class Quaternion {
  _x: number
  _y: number
  _z: number
  _w: number
  readonly isQuaternion = true
  _onChangeCallback: () => void = () => {}
  constructor(x = 0, y = 0, z = 0, w = 1) {
    this._x = x
    this._y = y
    this._z = z
    this._w = w
  }
  get x(): number { return this._x }
  set x(v: number) { this._x = v; this._onChangeCallback() }
  get y(): number { return this._y }
  set y(v: number) { this._y = v; this._onChangeCallback() }
  get z(): number { return this._z }
  set z(v: number) { this._z = v; this._onChangeCallback() }
  get w(): number { return this._w }
  set w(v: number) { this._w = v; this._onChangeCallback() }
  set(x: number, y: number, z: number, w: number): this {
    this._x = x
    this._y = y
    this._z = z
    this._w = w
    this._onChangeCallback()
    return this
  }
  copy(q: Quaternion): this {
    this._x = q._x
    this._y = q._y
    this._z = q._z
    this._w = q._w
    this._onChangeCallback()
    return this
  }
  clone(): Quaternion {
    return new Quaternion(this._x, this._y, this._z, this._w)
  }
  identity(): this {
    return this.set(0, 0, 0, 1)
  }
  /** The conjugate: for a unit quaternion, the inverse rotation. */
  invert(): this {
    this._x *= -1
    this._y *= -1
    this._z *= -1
    this._onChangeCallback()
    return this
  }
  setFromEuler(euler: Euler, update = true): this {
    const x = euler._x, y = euler._y, z = euler._z, order = euler._order
    const cos = Math.cos
    const sin = Math.sin
    const c1 = cos(x / 2)
    const c2 = cos(y / 2)
    const c3 = cos(z / 2)
    const s1 = sin(x / 2)
    const s2 = sin(y / 2)
    const s3 = sin(z / 2)
    switch (order) {
      case 'XYZ':
        this._x = s1 * c2 * c3 + c1 * s2 * s3
        this._y = c1 * s2 * c3 - s1 * c2 * s3
        this._z = c1 * c2 * s3 + s1 * s2 * c3
        this._w = c1 * c2 * c3 - s1 * s2 * s3
        break
      case 'YXZ':
        this._x = s1 * c2 * c3 + c1 * s2 * s3
        this._y = c1 * s2 * c3 - s1 * c2 * s3
        this._z = c1 * c2 * s3 - s1 * s2 * c3
        this._w = c1 * c2 * c3 + s1 * s2 * s3
        break
      case 'ZXY':
        this._x = s1 * c2 * c3 - c1 * s2 * s3
        this._y = c1 * s2 * c3 + s1 * c2 * s3
        this._z = c1 * c2 * s3 + s1 * s2 * c3
        this._w = c1 * c2 * c3 - s1 * s2 * s3
        break
      case 'ZYX':
        this._x = s1 * c2 * c3 - c1 * s2 * s3
        this._y = c1 * s2 * c3 + s1 * c2 * s3
        this._z = c1 * c2 * s3 - s1 * s2 * c3
        this._w = c1 * c2 * c3 + s1 * s2 * s3
        break
      case 'YZX':
        this._x = s1 * c2 * c3 + c1 * s2 * s3
        this._y = c1 * s2 * c3 + s1 * c2 * s3
        this._z = c1 * c2 * s3 - s1 * s2 * c3
        this._w = c1 * c2 * c3 - s1 * s2 * s3
        break
      case 'XZY':
        this._x = s1 * c2 * c3 - c1 * s2 * s3
        this._y = c1 * s2 * c3 - s1 * c2 * s3
        this._z = c1 * c2 * s3 + s1 * s2 * c3
        this._w = c1 * c2 * c3 + s1 * s2 * s3
        break
    }
    if (update === true) this._onChangeCallback()
    return this
  }
  setFromAxisAngle(axis: Vector3, angle: number): this {
    const halfAngle = angle / 2, s = Math.sin(halfAngle)
    this._x = axis.x * s
    this._y = axis.y * s
    this._z = axis.z * s
    this._w = Math.cos(halfAngle)
    this._onChangeCallback()
    return this
  }
  multiply(q: Quaternion): this {
    return this.multiplyQuaternions(this, q)
  }
  multiplyQuaternions(a: Quaternion, b: Quaternion): this {
    const qax = a._x, qay = a._y, qaz = a._z, qaw = a._w
    const qbx = b._x, qby = b._y, qbz = b._z, qbw = b._w
    this._x = qax * qbw + qaw * qbx + qay * qbz - qaz * qby
    this._y = qay * qbw + qaw * qby + qaz * qbx - qax * qbz
    this._z = qaz * qbw + qaw * qbz + qax * qby - qay * qbx
    this._w = qaw * qbw - qax * qbx - qay * qby - qaz * qbz
    this._onChangeCallback()
    return this
  }
  setFromRotationMatrix(m: Matrix4): this {
    const te = m.elements,
      m11 = te[0], m12 = te[4], m13 = te[8],
      m21 = te[1], m22 = te[5], m23 = te[9],
      m31 = te[2], m32 = te[6], m33 = te[10],
      trace = m11 + m22 + m33
    if (trace > 0) {
      const s = 0.5 / Math.sqrt(trace + 1.0)
      this._w = 0.25 / s
      this._x = (m32 - m23) * s
      this._y = (m13 - m31) * s
      this._z = (m21 - m12) * s
    } else if (m11 > m22 && m11 > m33) {
      const s = 2.0 * Math.sqrt(1.0 + m11 - m22 - m33)
      this._w = (m32 - m23) / s
      this._x = 0.25 * s
      this._y = (m12 + m21) / s
      this._z = (m13 + m31) / s
    } else if (m22 > m33) {
      const s = 2.0 * Math.sqrt(1.0 + m22 - m11 - m33)
      this._w = (m13 - m31) / s
      this._x = (m12 + m21) / s
      this._y = 0.25 * s
      this._z = (m23 + m32) / s
    } else {
      const s = 2.0 * Math.sqrt(1.0 + m33 - m11 - m22)
      this._w = (m21 - m12) / s
      this._x = (m13 + m31) / s
      this._y = (m23 + m32) / s
      this._z = 0.25 * s
    }
    this._onChangeCallback()
    return this
  }
  _onChange(cb: () => void): this {
    this._onChangeCallback = cb
    return this
  }
}

export class Euler {
  _x: number
  _y: number
  _z: number
  _order: EulerOrder
  readonly isEuler = true
  _onChangeCallback: () => void = () => {}
  constructor(x = 0, y = 0, z = 0, order: EulerOrder = 'XYZ') {
    this._x = x
    this._y = y
    this._z = z
    this._order = order
  }
  get x(): number { return this._x }
  set x(v: number) { this._x = v; this._onChangeCallback() }
  get y(): number { return this._y }
  set y(v: number) { this._y = v; this._onChangeCallback() }
  get z(): number { return this._z }
  set z(v: number) { this._z = v; this._onChangeCallback() }
  get order(): EulerOrder { return this._order }
  set order(v: EulerOrder) { this._order = v; this._onChangeCallback() }
  set(x: number, y: number, z: number, order: EulerOrder = this._order): this {
    this._x = x
    this._y = y
    this._z = z
    this._order = order
    this._onChangeCallback()
    return this
  }
  copy(e: Euler): this {
    this._x = e._x
    this._y = e._y
    this._z = e._z
    this._order = e._order
    this._onChangeCallback()
    return this
  }
  clone(): Euler {
    return new Euler(this._x, this._y, this._z, this._order)
  }
  /** The angles that make the (pure rotation) matrix, in `order`. */
  setFromRotationMatrix(m: Matrix4, order: EulerOrder = this._order, update = true): this {
    const te = m.elements
    const m11 = te[0], m12 = te[4], m13 = te[8]
    const m21 = te[1], m22 = te[5], m23 = te[9]
    const m31 = te[2], m32 = te[6], m33 = te[10]
    const clamp = (v: number) => Math.max(-1, Math.min(1, v))
    switch (order) {
      case 'XYZ':
        this._y = Math.asin(clamp(m13))
        if (Math.abs(m13) < 0.9999999) { this._x = Math.atan2(-m23, m33); this._z = Math.atan2(-m12, m11) }
        else { this._x = Math.atan2(m32, m22); this._z = 0 }
        break
      case 'YXZ':
        this._x = Math.asin(-clamp(m23))
        if (Math.abs(m23) < 0.9999999) { this._y = Math.atan2(m13, m33); this._z = Math.atan2(m21, m22) }
        else { this._y = Math.atan2(-m31, m11); this._z = 0 }
        break
      case 'ZXY':
        this._x = Math.asin(clamp(m32))
        if (Math.abs(m32) < 0.9999999) { this._y = Math.atan2(-m31, m33); this._z = Math.atan2(-m12, m22) }
        else { this._y = 0; this._z = Math.atan2(m21, m11) }
        break
      case 'ZYX':
        this._y = Math.asin(-clamp(m31))
        if (Math.abs(m31) < 0.9999999) { this._x = Math.atan2(m32, m33); this._z = Math.atan2(m21, m11) }
        else { this._x = 0; this._z = Math.atan2(-m12, m22) }
        break
      case 'YZX':
        this._z = Math.asin(clamp(m21))
        if (Math.abs(m21) < 0.9999999) { this._x = Math.atan2(-m23, m22); this._y = Math.atan2(-m31, m11) }
        else { this._x = 0; this._y = Math.atan2(m13, m33) }
        break
      case 'XZY':
        this._z = Math.asin(-clamp(m12))
        if (Math.abs(m12) < 0.9999999) { this._x = Math.atan2(m32, m22); this._y = Math.atan2(m13, m11) }
        else { this._x = Math.atan2(-m23, m33); this._y = 0 }
        break
    }
    this._order = order
    if (update === true) this._onChangeCallback()
    return this
  }
  setFromQuaternion(q: Quaternion, order?: EulerOrder, update?: boolean): this {
    _em.makeRotationFromQuaternion(q)
    return this.setFromRotationMatrix(_em, order, update)
  }
  _onChange(cb: () => void): this {
    this._onChangeCallback = cb
    return this
  }
}

// ---------------------------------------------------------------- colour

export const NoColorSpace = ''
export const SRGBColorSpace = 'srgb'
export const LinearSRGBColorSpace = 'srgb-linear'
export type ColorSpace = typeof NoColorSpace | typeof SRGBColorSpace | typeof LinearSRGBColorSpace

export function SRGBToLinear(c: number): number {
  return c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4)
}

export function LinearToSRGB(c: number): number {
  return c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 0.41666) - 0.055
}

/**
 * A colour in the linear working space: a hex or css value
 * is sRGB and is decoded on the way in, `setRGB` takes linear values as they
 * are, and `getRGB` encodes for the space asked for.
 */
export class Color {
  r = 1
  g = 1
  b = 1
  readonly isColor = true
  constructor(r?: number | string | Color, g?: number, b?: number) {
    if (r !== undefined) this.set(r, g, b)
  }
  set(r: number | string | Color, g?: number, b?: number): this {
    if (g === undefined && b === undefined) {
      if (typeof r === 'object') this.copy(r)
      else if (typeof r === 'string') this.setStyle(r)
      else this.setHex(r)
    } else this.setRGB(r as number, g!, b!)
    return this
  }
  /** A css hex colour (`#rgb` or `#rrggbb`), read as sRGB; the one string form the renderers use. */
  setStyle(style: string): this {
    const m = /^#([A-Fa-f\d]+)$/.exec(style.trim())
    if (!m) throw new Error(`Color: unsupported style "${style}"`)
    const hex = m[1]
    if (hex.length === 3) return this.setHex(parseInt(hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2], 16))
    if (hex.length === 6) return this.setHex(parseInt(hex, 16))
    throw new Error(`Color: unsupported style "${style}"`)
  }
  setHex(hex: number, colorSpace: ColorSpace = SRGBColorSpace): this {
    hex = Math.floor(hex)
    this.r = ((hex >> 16) & 255) / 255
    this.g = ((hex >> 8) & 255) / 255
    this.b = (hex & 255) / 255
    if (colorSpace === SRGBColorSpace) this.convertSRGBToLinear()
    return this
  }
  setRGB(r: number, g: number, b: number, colorSpace: ColorSpace = LinearSRGBColorSpace): this {
    this.r = r
    this.g = g
    this.b = b
    if (colorSpace === SRGBColorSpace) this.convertSRGBToLinear()
    return this
  }
  copy(c: Color): this {
    this.r = c.r
    this.g = c.g
    this.b = c.b
    return this
  }
  clone(): Color {
    return new Color(this.r, this.g, this.b)
  }
  convertSRGBToLinear(): this {
    this.r = SRGBToLinear(this.r)
    this.g = SRGBToLinear(this.g)
    this.b = SRGBToLinear(this.b)
    return this
  }
  convertLinearToSRGB(): this {
    this.r = LinearToSRGB(this.r)
    this.g = LinearToSRGB(this.g)
    this.b = LinearToSRGB(this.b)
    return this
  }
  /** The colour in `colorSpace`, written into `target`. */
  getRGB(target: { r: number; g: number; b: number }, colorSpace: ColorSpace = LinearSRGBColorSpace): { r: number; g: number; b: number } {
    _color.copy(this)
    if (colorSpace === SRGBColorSpace) _color.convertLinearToSRGB()
    target.r = _color.r
    target.g = _color.g
    target.b = _color.b
    return target
  }
  getHex(): number {
    _color.copy(this).convertLinearToSRGB()
    return (Math.round(Math.max(0, Math.min(1, _color.r)) * 255) << 16) | (Math.round(Math.max(0, Math.min(1, _color.g)) * 255) << 8) | Math.round(Math.max(0, Math.min(1, _color.b)) * 255)
  }
  equals(c: Color): boolean {
    return c.r === this.r && c.g === this.g && c.b === this.b
  }
}

const _color = /*@__PURE__*/ new Color()

// ---------------------------------------------------------------- shapes

export class Sphere {
  center: Vector3
  radius: number
  constructor(center = new Vector3(), radius = -1) {
    this.center = center
    this.radius = radius
  }
  set(center: Vector3, radius: number): this {
    this.center.copy(center)
    this.radius = radius
    return this
  }
  copy(s: Sphere): this {
    this.center.copy(s.center)
    this.radius = s.radius
    return this
  }
  clone(): Sphere {
    return new Sphere().copy(this)
  }
  containsPoint(p: Vector3): boolean {
    return p.distanceToSquared(this.center) <= this.radius * this.radius
  }
  applyMatrix4(m: Matrix4): this {
    this.center.applyMatrix4(m)
    this.radius = this.radius * m.getMaxScaleOnAxis()
    return this
  }
}

const _vector = /*@__PURE__*/ new Vector3()

export class Box3 {
  min: Vector3
  max: Vector3
  constructor(min = new Vector3(+Infinity, +Infinity, +Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity)) {
    this.min = min
    this.max = max
  }
  makeEmpty(): this {
    this.min.x = this.min.y = this.min.z = +Infinity
    this.max.x = this.max.y = this.max.z = -Infinity
    return this
  }
  isEmpty(): boolean {
    return this.max.x < this.min.x || this.max.y < this.min.y || this.max.z < this.min.z
  }
  expandByPoint(p: Vector3): this {
    this.min.min(p)
    this.max.max(p)
    return this
  }
  setFromBufferAttribute(a: { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number }): this {
    this.makeEmpty()
    for (let i = 0, il = a.count; i < il; i++) this.expandByPoint(_vector.fromBufferAttribute(a, i))
    return this
  }
  getCenter(target: Vector3): Vector3 {
    return this.isEmpty() ? target.set(0, 0, 0) : target.addVectors(this.min, this.max).multiplyScalar(0.5)
  }
}

export class Plane {
  normal: Vector3
  constant: number
  constructor(normal = new Vector3(1, 0, 0), constant = 0) {
    this.normal = normal
    this.constant = constant
  }
  setComponents(x: number, y: number, z: number, w: number): this {
    this.normal.set(x, y, z)
    this.constant = w
    return this
  }
  normalize(): this {
    const inverseNormalLength = 1.0 / this.normal.length()
    this.normal.multiplyScalar(inverseNormalLength)
    this.constant *= inverseNormalLength
    return this
  }
  distanceToPoint(p: Vector3): number {
    return this.normal.dot(p) + this.constant
  }
}

const _sphere = /*@__PURE__*/ new Sphere()

/** Six planes from a view-projection matrix, for culling by bounding sphere. */
export class Frustum {
  planes: Plane[] = [new Plane(), new Plane(), new Plane(), new Plane(), new Plane(), new Plane()]
  setFromProjectionMatrix(m: Matrix4): this {
    const planes = this.planes
    const me = m.elements
    const me0 = me[0], me1 = me[1], me2 = me[2], me3 = me[3]
    const me4 = me[4], me5 = me[5], me6 = me[6], me7 = me[7]
    const me8 = me[8], me9 = me[9], me10 = me[10], me11 = me[11]
    const me12 = me[12], me13 = me[13], me14 = me[14], me15 = me[15]
    planes[0].setComponents(me3 - me0, me7 - me4, me11 - me8, me15 - me12).normalize()
    planes[1].setComponents(me3 + me0, me7 + me4, me11 + me8, me15 + me12).normalize()
    planes[2].setComponents(me3 + me1, me7 + me5, me11 + me9, me15 + me13).normalize()
    planes[3].setComponents(me3 - me1, me7 - me5, me11 - me9, me15 - me13).normalize()
    planes[4].setComponents(me3 - me2, me7 - me6, me11 - me10, me15 - me14).normalize()
    planes[5].setComponents(me3 + me2, me7 + me6, me11 + me10, me15 + me14).normalize()
    return this
  }
  intersectsSphere(sphere: Sphere): boolean {
    const planes = this.planes
    const center = sphere.center
    const negRadius = -sphere.radius
    for (let i = 0; i < 6; i++) {
      const distance = planes[i].distanceToPoint(center)
      if (distance < negRadius) return false
    }
    return true
  }
  /** Whether the object's (world) bounding sphere is in the frustum; the geometry's sphere is computed if it has none. */
  intersectsObject(object: { matrixWorld: Matrix4; geometry: { boundingSphere: Sphere | null; computeBoundingSphere(): void } }): boolean {
    const geometry = object.geometry
    if (geometry.boundingSphere === null) geometry.computeBoundingSphere()
    _sphere.copy(geometry.boundingSphere!).applyMatrix4(object.matrixWorld)
    return this.intersectsSphere(_sphere)
  }
}

const _edge1 = /*@__PURE__*/ new Vector3()
const _edge2 = /*@__PURE__*/ new Vector3()
const _normal = /*@__PURE__*/ new Vector3()
const _diff = /*@__PURE__*/ new Vector3()
const _rv = /*@__PURE__*/ new Vector3()

export class Ray {
  origin: Vector3
  direction: Vector3
  constructor(origin = new Vector3(), direction = new Vector3(0, 0, -1)) {
    this.origin = origin
    this.direction = direction
  }
  copy(r: Ray): this {
    this.origin.copy(r.origin)
    this.direction.copy(r.direction)
    return this
  }
  at(t: number, target: Vector3): Vector3 {
    return target.copy(this.origin).addScaledVector(this.direction, t)
  }
  recast(t: number): this {
    this.origin.copy(this.at(t, _rv))
    return this
  }
  distanceSqToPoint(point: Vector3): number {
    const directionDistance = _rv.subVectors(point, this.origin).dot(this.direction)
    if (directionDistance < 0) return this.origin.distanceToSquared(point)
    _rv.copy(this.origin).addScaledVector(this.direction, directionDistance)
    return _rv.distanceToSquared(point)
  }
  intersectSphere(sphere: Sphere, target: Vector3): Vector3 | null {
    _rv.subVectors(sphere.center, this.origin)
    const tca = _rv.dot(this.direction)
    const d2 = _rv.dot(_rv) - tca * tca
    const radius2 = sphere.radius * sphere.radius
    if (d2 > radius2) return null
    const thc = Math.sqrt(radius2 - d2)
    const t0 = tca - thc
    const t1 = tca + thc
    if (t1 < 0) return null
    if (t0 < 0) return this.at(t1, target)
    return this.at(t0, target)
  }
  intersectTriangle(a: Vector3, b: Vector3, c: Vector3, backfaceCulling: boolean, target: Vector3): Vector3 | null {
    _edge1.subVectors(b, a)
    _edge2.subVectors(c, a)
    _normal.crossVectors(_edge1, _edge2)
    let DdN = this.direction.dot(_normal)
    let sign: number
    if (DdN > 0) {
      if (backfaceCulling) return null
      sign = 1
    } else if (DdN < 0) {
      sign = -1
      DdN = -DdN
    } else return null
    _diff.subVectors(this.origin, a)
    const DdQxE2 = sign * this.direction.dot(_edge2.crossVectors(_diff, _edge2))
    if (DdQxE2 < 0) return null
    const DdE1xQ = sign * this.direction.dot(_edge1.cross(_diff))
    if (DdE1xQ < 0) return null
    if (DdQxE2 + DdE1xQ > DdN) return null
    const QdN = -sign * _diff.dot(_normal)
    if (QdN < 0) return null
    return this.at(QdN / DdN, target)
  }
  applyMatrix4(m: Matrix4): this {
    this.origin.applyMatrix4(m)
    this.direction.transformDirection(m)
    return this
  }
}

let _uuid = 0
/** A unique id string; `crowd.ts` keys its batches by a material's. */
export function generateUUID(): string {
  return 'orbrun-' + (++_uuid).toString(36)
}
