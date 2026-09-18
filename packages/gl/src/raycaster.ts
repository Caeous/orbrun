/**
 * Picking: a ray from the camera through a screen point, tested against the
 * triangles of the meshes given (the level's floor and walls). The renderer
 * wants the nearest hit's point; the tests match the baseline's, so the
 * same pixel picks the same cell.
 */
import { Layers, type Camera, type Mesh } from './core.js'
import { Matrix4, Ray, Sphere, Vector3 } from './math.js'
import { BackSide, FrontSide, type Material } from './material.js'

export interface Intersection {
  distance: number
  point: Vector3
  object: Mesh
}

const _inverseMatrix = /*@__PURE__*/ new Matrix4()
const _ray = /*@__PURE__*/ new Ray()
const _sphere = /*@__PURE__*/ new Sphere()
const _sphereHitAt = /*@__PURE__*/ new Vector3()
const _vA = /*@__PURE__*/ new Vector3()
const _vB = /*@__PURE__*/ new Vector3()
const _vC = /*@__PURE__*/ new Vector3()
const _point = /*@__PURE__*/ new Vector3()
const _world = /*@__PURE__*/ new Vector3()

export class Raycaster {
  ray = new Ray()
  near: number
  far: number
  layers = new Layers()
  constructor(origin?: Vector3, direction?: Vector3, near = 0, far = Infinity) {
    if (origin) this.ray.origin.copy(origin)
    if (direction) this.ray.direction.copy(direction)
    this.near = near
    this.far = far
  }
  /** The ray through normalised device coordinates (-1..1) of a perspective camera. */
  setFromCamera(coords: { x: number; y: number }, camera: Camera): void {
    this.ray.origin.setFromMatrixPosition(camera.matrixWorld)
    this.ray.direction.set(coords.x, coords.y, 0.5).unproject(camera).sub(this.ray.origin).normalize()
  }
  /** Hits on the meshes themselves (never their children), nearest first. */
  intersectObjects(objects: Mesh[], recursive = false, intersects: Intersection[] = []): Intersection[] {
    for (const o of objects) {
      if (o.layers.test(this.layers)) this.raycastMesh(o, intersects)
      if (recursive) for (const c of o.children) if ((c as Mesh).isMesh) this.intersectObjects([c as Mesh], true, intersects)
    }
    intersects.sort((a, b) => a.distance - b.distance)
    return intersects
  }
  private raycastMesh(mesh: Mesh, intersects: Intersection[]) {
    const geometry = mesh.geometry
    const material = mesh.material as Material | undefined
    const matrixWorld = mesh.matrixWorld
    if (material === undefined) return
    if (geometry.boundingSphere === null) geometry.computeBoundingSphere()
    _sphere.copy(geometry.boundingSphere!)
    _sphere.applyMatrix4(matrixWorld)
    _ray.copy(this.ray).recast(this.near)
    if (_sphere.containsPoint(_ray.origin) === false) {
      if (_ray.intersectSphere(_sphere, _sphereHitAt) === null) return
      if (_ray.origin.distanceToSquared(_sphereHitAt) > (this.far - this.near) ** 2) return
    }
    _inverseMatrix.copy(matrixWorld).invert()
    _ray.copy(this.ray).applyMatrix4(_inverseMatrix)
    const index = geometry.index
    const position = geometry.attributes.position
    const drawRange = geometry.drawRange
    if (index !== null) {
      const start = Math.max(0, drawRange.start)
      const end = Math.min(index.count, drawRange.start + drawRange.count)
      for (let i = start; i < end; i += 3) this.checkTriangle(mesh, material, index.getX(i), index.getX(i + 1), index.getX(i + 2), intersects)
    } else if (position !== undefined) {
      const start = Math.max(0, drawRange.start)
      const end = Math.min(position.count, drawRange.start + drawRange.count)
      for (let i = start; i < end; i += 3) this.checkTriangle(mesh, material, i, i + 1, i + 2, intersects)
    }
  }
  private checkTriangle(mesh: Mesh, material: Material, a: number, b: number, c: number, intersects: Intersection[]) {
    mesh.getVertexPosition(a, _vA)
    mesh.getVertexPosition(b, _vB)
    mesh.getVertexPosition(c, _vC)
    let hit: Vector3 | null
    if (material.side === BackSide) hit = _ray.intersectTriangle(_vC, _vB, _vA, true, _point)
    else hit = _ray.intersectTriangle(_vA, _vB, _vC, material.side === FrontSide, _point)
    if (hit === null) return
    _world.copy(_point).applyMatrix4(mesh.matrixWorld)
    const distance = this.ray.origin.distanceTo(_world)
    if (distance < this.near || distance > this.far) return
    intersects.push({ distance, point: _world.clone(), object: mesh })
  }
}
