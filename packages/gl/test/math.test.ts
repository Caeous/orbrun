import { describe, expect, it } from 'vitest'
import { Color, Euler, Frustum, Matrix4, PerspectiveCamera, Quaternion, Sphere, Vector3, Vector4 } from '../src/index.js'

/**
 * The maths against known answers: a perspective matrix by hand, a rotation
 * through the Euler-quaternion-matrix path, an inverse that undoes, and the
 * frustum test that decides what is drawn. These are the numbers a vertex's
 * screen position comes from, so they must not drift.
 */
describe('Matrix4', () => {
  it('builds the WebGL perspective matrix', () => {
    const cam = new PerspectiveCamera(90, 2, 0.5, 100)
    const e = cam.projectionMatrix.elements
    // fov 90: top = near; aspect 2: right = 2 * near
    expect(e[0]).toBeCloseTo(0.5, 12)
    expect(e[5]).toBeCloseTo(1, 12)
    expect(e[10]).toBeCloseTo(-(100 + 0.5) / (100 - 0.5), 12)
    expect(e[14]).toBeCloseTo((-2 * 100 * 0.5) / (100 - 0.5), 12)
    expect(e[11]).toBe(-1)
    expect(e[15]).toBe(0)
  })

  it('inverts what it composed', () => {
    const q = new Quaternion().setFromEuler(new Euler(0.3, -1.2, 0.5, 'YXZ'))
    const m = new Matrix4().compose(new Vector3(3, -2, 7), q, new Vector3(1, 1, 1))
    const p = new Vector3(0.25, 0.5, -1).applyMatrix4(m).applyMatrix4(m.clone().invert())
    expect(p.x).toBeCloseTo(0.25, 12)
    expect(p.y).toBeCloseTo(0.5, 12)
    expect(p.z).toBeCloseTo(-1, 12)
  })

  it('turns a yaw about y the way the sprites are turned', () => {
    // rotation.y = yaw on an object: +x goes toward -z for a positive yaw (right-handed frame)
    const q = new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, 0))
    const m = new Matrix4().makeRotationFromQuaternion(q)
    const v = new Vector3(1, 0, 0).applyMatrix4(m)
    expect(v.x).toBeCloseTo(0, 12)
    expect(v.z).toBeCloseTo(-1, 12)
    const r = new Matrix4().makeRotationY(Math.PI / 2).elements
    for (let i = 0; i < 16; i++) expect(m.elements[i]).toBeCloseTo(r[i], 12)
  })

  it('multiplies in column-major order', () => {
    const t = new Matrix4().setPosition(1, 2, 3)
    const s = new Matrix4().set(2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1)
    // translate after scaling: (1,1,1) -> (2,2,2) -> (3,4,5)
    const v = new Vector3(1, 1, 1).applyMatrix4(new Matrix4().multiplyMatrices(t, s))
    expect(v.toArray()).toEqual([3, 4, 5])
    // scale after translating: (1,1,1) -> (2,3,4) -> (4,6,8)
    const w = new Vector3(1, 1, 1).applyMatrix4(new Matrix4().multiplyMatrices(s, t))
    expect(w.toArray()).toEqual([4, 6, 8])
  })

  it('decomposes a scaled rotation back to its parts', () => {
    const q = new Quaternion().setFromEuler(new Euler(0.1, 0.2, 0.3))
    const m = new Matrix4().compose(new Vector3(1, 2, 3), q, new Vector3(2, 3, 4))
    const p = new Vector3(), r = new Quaternion(), s = new Vector3()
    m.decompose(p, r, s)
    expect(p.toArray()).toEqual([1, 2, 3])
    expect([s.x, s.y, s.z].map((v) => +v.toFixed(12))).toEqual([2, 3, 4])
    expect(r.x).toBeCloseTo(q.x, 12)
    expect(r.w).toBeCloseTo(q.w, 12)
  })
})

describe('Vector4 and Vector3 transforms', () => {
  it('keeps w on a Vector4 and divides by it on a Vector3', () => {
    const cam = new PerspectiveCamera(60, 1, 0.1, 10)
    const v4 = new Vector4(0, 0, -5, 1).applyMatrix4(cam.projectionMatrix)
    expect(v4.w).toBeCloseTo(5, 12)
    const v3 = new Vector3(0, 0, -5).applyMatrix4(cam.projectionMatrix)
    expect(v3.z).toBeCloseTo(v4.z / v4.w, 12)
  })
})

describe('Color', () => {
  it('decodes a hex from sRGB to linear and back', () => {
    const c = new Color(0xff8800)
    expect(c.r).toBe(1)
    expect(c.g).toBeCloseTo(Math.pow((0x88 / 255) * 0.9478672986 + 0.0521327014, 2.4), 12)
    expect(c.b).toBe(0)
    expect(c.getHex()).toBe(0xff8800)
    // the encode uses a 0.41666 exponent, so the round trip is close, not exact
    const out = c.getRGB({ r: 0, g: 0, b: 0 }, 'srgb')
    expect(out.g).toBeCloseTo(0x88 / 255, 4)
  })
  it('takes a css hex string as sRGB and raw rgb as linear', () => {
    expect(new Color('#000000').getHex()).toBe(0)
    expect(new Color('#fff').getHex()).toBe(0xffffff)
    const c = new Color().setRGB(0.5, 0.25, 1)
    expect([c.r, c.g, c.b]).toEqual([0.5, 0.25, 1])
  })
})

describe('Frustum', () => {
  it('keeps a sphere in view and drops one behind the eye', () => {
    const cam = new PerspectiveCamera(80, 1.6, 0.05, 200)
    cam.position.set(5.5, 0.65, 5.5)
    cam.rotation.order = 'YXZ'
    cam.rotation.set(0, 0, 0)
    cam.updateMatrixWorld()
    const vp = new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)
    const f = new Frustum().setFromProjectionMatrix(vp)
    // ahead is -z
    expect(f.intersectsSphere(new Sphere(new Vector3(5.5, 0.5, 2), 0.5))).toBe(true)
    expect(f.intersectsSphere(new Sphere(new Vector3(5.5, 0.5, 9), 0.5))).toBe(false)
    // a big sphere behind still reaches into the frustum
    expect(f.intersectsSphere(new Sphere(new Vector3(5.5, 0.5, 9), 5))).toBe(true)
    // far off to the side
    expect(f.intersectsSphere(new Sphere(new Vector3(50, 0.5, 4), 1))).toBe(false)
  })
})
