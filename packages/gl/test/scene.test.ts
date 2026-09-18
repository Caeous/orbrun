import { describe, expect, it } from 'vitest'
import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Material,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  RingGeometry,
  Scene,
  ShaderMaterial,
  ShapeUtils,
  Texture,
  Vector2,
  Vector3,
  buildSources,
  painterSortStable,
  resolveIncludes,
  reversePainterSortStable,
} from '../src/index.js'

/**
 * The scene graph without a context: world matrices down a tree, the draw
 * order the renderer sorts by, the generated geometries' layouts, the
 * triangulator, the picker, and what a program is built from.
 */
describe('Object3D', () => {
  it('composes world matrices down the tree, rotation through the quaternion', () => {
    const root = new Group()
    root.position.set(10, 0, 0)
    const child = new Mesh(new BufferGeometry(), new MeshBasicMaterial())
    child.position.set(1, 0, 0)
    child.rotation.y = Math.PI / 2
    root.add(child)
    root.updateMatrixWorld()
    const p = new Vector3(1, 0, 0).applyMatrix4(child.matrixWorld)
    // (1,0,0) turned a quarter to -z, then +1 x in the child, then +10 x in the root
    expect(p.x).toBeCloseTo(11, 12)
    expect(p.z).toBeCloseTo(-1, 12)
    expect(child.parent).toBe(root)
    root.remove(child)
    expect(child.parent).toBeNull()
    expect(root.children).toHaveLength(0)
  })

  it('numbers objects in creation order and clears children', () => {
    const a = new Object3D(), b = new Object3D()
    expect(b.id).toBeGreaterThan(a.id)
    a.add(b, new Object3D())
    a.clear()
    expect(a.children).toHaveLength(0)
  })
})

describe('the draw order', () => {
  const item = (renderOrder: number, materialId: number, z: number, id: number) => ({ renderOrder, groupOrder: 0, z, id, material: { id: materialId } as Material })
  it('sorts opaque draws by order, then material, then front to back', () => {
    const items = [item(0, 2, 5, 1), item(0, 1, 9, 2), item(0, 1, 3, 3), item(-1, 9, 0, 4)]
    items.sort(painterSortStable as never)
    expect(items.map((i) => i.id)).toEqual([4, 3, 2, 1])
  })
  it('sorts blended draws by order, then back to front, then id', () => {
    const items = [item(1, 1, 5, 1), item(0, 1, 5, 2), item(0, 2, 9, 3), item(0, 3, 5, 4)]
    items.sort(reversePainterSortStable as never)
    expect(items.map((i) => i.id)).toEqual([3, 2, 4, 1])
  })
})

describe('geometries', () => {
  it('lays out a plane: four corners, two triangles, normals and uvs', () => {
    const g = new PlaneGeometry(2, 1)
    expect(Array.from(g.getAttribute('position').array)).toEqual([-1, 0.5, 0, 1, 0.5, 0, -1, -0.5, 0, 1, -0.5, 0])
    expect(Array.from(g.getAttribute('uv').array)).toEqual([0, 1, 1, 1, 0, 0, 1, 0])
    expect(Array.from(g.index!.array)).toEqual([0, 2, 1, 2, 3, 1])
    expect(Object.keys(g.attributes)).toEqual(['position', 'normal', 'uv'])
  })
  it('fans a circle from its centre and rings a ring', () => {
    const c = new CircleGeometry(0.22, 16)
    expect(c.getAttribute('position').count).toBe(18)
    expect(c.index!.count).toBe(48)
    const r = new RingGeometry(0.34, 0.46, 4)
    expect(r.getAttribute('position').count).toBe(10)
    expect(r.index!.count).toBe(24)
    r.rotateX(-Math.PI / 2)
    // a rotation lays it flat: y becomes what z was, and the normals turn with it
    expect(r.getAttribute('position').getY(1)).toBeCloseTo(0, 12)
    expect(r.getAttribute('normal').getY(0)).toBeCloseTo(1, 12)
  })
  it('bounds a geometry by a sphere round its box centre', () => {
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 4, 0, 0, 4, 3, 0], 3))
    g.computeBoundingSphere()
    expect(g.boundingSphere!.center.toArray()).toEqual([2, 1.5, 0])
    expect(g.boundingSphere!.radius).toBeCloseTo(2.5, 12)
    g.computeBoundingBox()
    expect(g.boundingBox!.max.toArray()).toEqual([4, 3, 0])
  })
  it('picks a wide index only when an index needs it, and tracks update ranges', () => {
    const g = new BufferGeometry()
    g.setIndex([0, 1, 2])
    expect(g.index!.array).toBeInstanceOf(Uint16Array)
    g.setIndex([0, 70000, 2])
    expect(g.index!.array).toBeInstanceOf(Uint32Array)
    const a = new BufferAttribute(new Float32Array(6), 3)
    expect(a.count).toBe(2)
    a.addUpdateRange(0, 3)
    a.needsUpdate = true
    expect(a.version).toBe(1)
    expect(a.updateRanges).toEqual([{ start: 0, count: 3 }])
    a.clearUpdateRanges()
    expect(a.updateRanges).toEqual([])
  })
})

describe('ShapeUtils', () => {
  it('triangulates a concave outline into the right number of triangles, indices into the points', () => {
    // an L shape: 6 points, 4 triangles
    const pts = [new Vector2(0, 0), new Vector2(2, 0), new Vector2(2, 1), new Vector2(1, 1), new Vector2(1, 2), new Vector2(0, 2)]
    const tris = ShapeUtils.triangulateShape(pts, [])
    expect(tris).toHaveLength(4)
    for (const t of tris) for (const i of t) expect(i).toBeGreaterThanOrEqual(0)
    // the triangles cover the L's area exactly
    const area = tris.reduce((sum, [a, b, c]) => sum + Math.abs((pts[b].x - pts[a].x) * (pts[c].y - pts[a].y) - (pts[b].y - pts[a].y) * (pts[c].x - pts[a].x)) / 2, 0)
    expect(area).toBeCloseTo(3, 12)
    expect(ShapeUtils.isClockWise(pts)).toBe(false)
  })
  it('drops a duplicated end point', () => {
    const pts = [new Vector2(0, 0), new Vector2(1, 0), new Vector2(1, 1), new Vector2(1, 1)]
    expect(ShapeUtils.triangulateShape(pts, [])).toHaveLength(1)
  })
})

describe('Raycaster', () => {
  it('picks the floor cell under a screen point', () => {
    const cam = new PerspectiveCamera(80, 1.6, 0.05, 200)
    cam.rotation.order = 'YXZ'
    cam.position.set(5.5, 0.65, 5.5)
    cam.rotation.set(-0.3, 0, 0)
    cam.updateMatrixWorld()
    // a floor quad over cells 0..10 at y = 0
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute([0, 0, 10, 10, 0, 10, 10, 0, 0, 0, 0, 0], 3))
    g.setIndex([0, 1, 2, 0, 2, 3])
    const floor = new Mesh(g, new MeshBasicMaterial({ side: DoubleSide }))
    floor.updateMatrixWorld()
    const ray = new Raycaster()
    ray.setFromCamera({ x: 0, y: 0 }, cam)
    const hits = ray.intersectObjects([floor], false)
    expect(hits).toHaveLength(1)
    const p = hits[0].point
    expect(p.y).toBeCloseTo(0, 9)
    expect(p.x).toBeCloseTo(5.5, 9)
    // looking down 0.3 rad from 0.65 up: the floor is hit 0.65 / tan(0.3) ahead
    expect(p.z).toBeCloseTo(5.5 - 0.65 / Math.tan(0.3), 6)
    expect(hits[0].object).toBe(floor)
  })
  it('respects a front-side material\'s facing', () => {
    const cam = new PerspectiveCamera(80, 1, 0.05, 200)
    cam.position.set(0.5, 0.5, 5)
    cam.updateMatrixWorld()
    const g = new PlaneGeometry(1, 1)
    const front = new Mesh(g, new MeshBasicMaterial())
    front.position.set(0.5, 0.5, 0)
    front.updateMatrixWorld()
    const back = new Mesh(g, new MeshBasicMaterial())
    back.position.set(0.5, 0.5, 0)
    back.rotation.y = Math.PI
    back.updateMatrixWorld()
    const ray = new Raycaster()
    // a little off the centre: the plane's diagonal runs through it, and a ray on an edge hits both triangles
    ray.setFromCamera({ x: 0.1, y: 0 }, cam)
    expect(ray.intersectObjects([front], false)).toHaveLength(1)
    expect(ray.intersectObjects([back], false)).toHaveLength(0)
  })
})

describe('materials and textures', () => {
  it('clones a material without its compile hook, and a texture sharing its source', () => {
    const m = new MeshBasicMaterial({ map: new Texture(), transparent: true, opacity: 0.5, side: DoubleSide })
    m.onBeforeCompile = () => {}
    m.defines = { MERGED: '' }
    const c = m.clone()
    expect(c.map).toBe(m.map)
    expect(c.opacity).toBe(0.5)
    expect(c.side).toBe(DoubleSide)
    expect(c.defines).toBeUndefined()
    expect(c.onBeforeCompile).not.toBe(m.onBeforeCompile)
    const t = new Texture({ width: 4, height: 4 })
    const tc = t.clone()
    expect(tc.source).toBe(t.source)
    t.image = { width: 8, height: 8 }
    t.needsUpdate = true
    expect(tc.image).toEqual({ width: 8, height: 8 })
    expect(tc.source.version).toBe(t.source.version)
  })
  it('bumps a material\'s version when the alpha test turns on or off, not otherwise', () => {
    const m = new MeshBasicMaterial({ alphaTest: 0.1 })
    const v = m.version
    m.alphaTest = 0.5
    expect(m.version).toBe(v)
    m.alphaTest = 0
    expect(m.version).toBe(v + 1)
    m.needsUpdate = true
    expect(m.version).toBe(v + 2)
  })
  it('draws a ShaderMaterial once even when double-sided and blended', () => {
    const s = new ShaderMaterial({ transparent: true, side: DoubleSide })
    expect(s.forceSinglePass).toBe(true)
    expect(new MeshBasicMaterial().forceSinglePass).toBe(false)
  })
  it('dispatches dispose to whoever listens', () => {
    const m = new MeshBasicMaterial()
    let n = 0
    m.addEventListener('dispose', () => n++)
    m.dispose()
    expect(n).toBe(1)
  })
})

describe('shader sources', () => {
  it('resolves includes recursively and refuses an unknown one', () => {
    expect(resolveIncludes('#include <begin_vertex>')).toContain('vec3 transformed = vec3( position );')
    expect(() => resolveIncludes('#include <no_such_chunk>')).toThrow()
  })
  it('builds a program from a basic material with the defines its features ask for', () => {
    const { vertex, fragment } = buildSources({
      shaderType: 'MeshBasicMaterial',
      shaderName: '',
      vertexShader: '#include <begin_vertex>',
      fragmentShader: '#include <color_fragment>',
      defines: { MERGED: '' },
      map: true,
      vertexColors: true,
      vertexAlphas: false,
      alphaTest: true,
      opaque: true,
      doubleSided: true,
      flipSided: false,
      premultipliedAlpha: false,
      defaultAttributeValues: undefined,
      customProgramCacheKey: '',
    })
    expect(vertex.startsWith('#version 300 es\n')).toBe(true)
    expect(vertex).toContain('#define MERGED ')
    expect(vertex).toContain('#define USE_MAP')
    expect(vertex).toContain('attribute vec3 color;')
    expect(fragment).toContain('#define USE_ALPHATEST')
    expect(fragment).toContain('#define OPAQUE')
    expect(fragment).toContain('#define DOUBLE_SIDED')
    expect(fragment).toContain('vec4 linearToOutputTexel( vec4 value )')
    expect(fragment).toContain('diffuseColor *= vColor;')
  })
  it('stands a scene with a background and a camera without any GL', () => {
    const s = new Scene()
    expect(s.background).toBeNull()
    expect(s.isScene).toBe(true)
  })
})
