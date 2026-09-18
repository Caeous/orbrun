import { describe, expect, it } from 'vitest'
import {
  BufferGeometry,
  DataTexture,
  DepthTexture,
  Float32BufferAttribute,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  PerspectiveCamera,
  RedFormat,
  Scene,
  ShaderMaterial,
  WebGLRenderTarget,
  WebGLRenderer,
  depthOnlyFragment,
} from '../src/index.js'
import { basicFragment } from '../src/shaders.js'

/**
 * A stand-in WebGL2 context: constants are unique numbers, every call is
 * recorded, and the few queries the renderer makes are answered from the
 * shader sources it handed over. Enough to see which texture each unit
 * holds at a draw, and which buffer objects come and go.
 */
function mockGL() {
  const calls: { name: string; args: unknown[] }[] = []
  const consts = new Map<string, number>()
  const sources = new Map<object, string>()
  const programs = new Map<object, { uniforms: { name: string; type: number }[]; attributes: string[] }>()
  let nextConst = 1000
  let nextHandle = 1
  const handle = (kind: string) => ({ kind, id: nextHandle++ })
  const constant = (name: string) => {
    if (!consts.has(name)) consts.set(name, nextConst++)
    return consts.get(name)!
  }
  // the uniform types are the real GL enum values: the renderer switches on those, not on the context's properties
  const glslType = (t: string) =>
    ({ sampler2D: 0x8b5e, mat4: 0x8b5c, mat3: 0x8b5b, vec4: 0x8b52, vec3: 0x8b51, vec2: 0x8b50, float: 0x1406, bool: 0x8b56, int: 0x1404 })[t] ?? 0x1406
  const state = { unit: 0, bound: new Map<number, unknown>(), arrayBuffer: null as unknown, draws: [] as Map<number, unknown>[] }
  const impl: Record<string, (...args: unknown[]) => unknown> = {
    getContextAttributes: () => ({}),
    isContextLost: () => false,
    getExtension: () => null,
    createTexture: () => handle('texture'),
    createBuffer: () => handle('buffer'),
    createFramebuffer: () => handle('framebuffer'),
    createRenderbuffer: () => handle('renderbuffer'),
    createVertexArray: () => handle('vao'),
    createShader: () => handle('shader'),
    createProgram: () => handle('program'),
    shaderSource: (s, src) => sources.set(s as object, src as string),
    attachShader: (p, s) => {
      const src = sources.get(s as object) ?? ''
      const entry = programs.get(p as object) ?? { uniforms: [], attributes: [] }
      for (const m of src.matchAll(/^\s*uniform\s+(\w+)\s+(\w+)/gm)) if (!entry.uniforms.some((u) => u.name === m[2])) entry.uniforms.push({ name: m[2], type: glslType(m[1]) })
      for (const m of src.matchAll(/^\s*attribute\s+\w+\s+(\w+)/gm)) if (!entry.attributes.includes(m[1])) entry.attributes.push(m[1])
      programs.set(p as object, entry)
    },
    getProgramParameter: (p, pname) => {
      if (pname === constant('LINK_STATUS')) return true
      if (pname === constant('ACTIVE_UNIFORMS')) return programs.get(p as object)!.uniforms.length
      if (pname === constant('ACTIVE_ATTRIBUTES')) return programs.get(p as object)!.attributes.length
      return 0
    },
    getActiveUniform: (p, i) => ({ ...programs.get(p as object)!.uniforms[i as number], size: 1 }),
    getActiveAttrib: (p, i) => ({ name: programs.get(p as object)!.attributes[i as number], size: 1, type: 0 }),
    getUniformLocation: (_p, name) => ({ name }),
    getAttribLocation: (p, name) => programs.get(p as object)!.attributes.indexOf(name as string),
    activeTexture: (u) => (state.unit = (u as number) - constant('TEXTURE0')),
    bindTexture: (_target, tex) => state.bound.set(state.unit, tex),
    bindBuffer: (target, buf) => {
      if (target === constant('ARRAY_BUFFER')) state.arrayBuffer = buf
    },
    drawArrays: () => state.draws.push(new Map(state.bound)),
    drawElements: () => state.draws.push(new Map(state.bound)),
  }
  const gl = new Proxy({ canvas: { width: 8, height: 8 } } as Record<string, unknown>, {
    get(target, prop) {
      if (typeof prop !== 'string') return undefined
      if (prop in target) return target[prop]
      if (/^[A-Z][A-Z0-9_]*$/.test(prop)) return constant(prop)
      return (...args: unknown[]) => {
        calls.push({ name: prop, args })
        return impl[prop]?.(...args)
      }
    },
  })
  const canvas = { width: 8, height: 8, getContext: () => gl, addEventListener() {}, removeEventListener() {}, style: {} }
  return { gl, canvas, calls, state, constant }
}

const VERTEX = `void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`
const FRAGMENT = `uniform sampler2D map;
uniform sampler2D shadeMap;
void main() { gl_FragColor = texture2D(map, vec2(0.5)) * texture2D(shadeMap, vec2(0.5)); }`

function triangle() {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3))
  return geometry
}

describe('WebGLRenderer', () => {
  it('uploads a sampler through its own unit, so an earlier sampler of the same draw keeps its texture', () => {
    const m = mockGL()
    const renderer = new WebGLRenderer({ canvas: m.canvas as unknown as HTMLCanvasElement })
    const atlas = new DataTexture(new Uint8Array(4), 1, 1)
    const shade = new DataTexture(new Uint8Array(1), 1, 1, RedFormat)
    const material = new ShaderMaterial({ uniforms: { map: { value: atlas }, shadeMap: { value: shade } }, vertexShader: VERTEX, fragmentShader: FRAGMENT })
    const scene = new Scene()
    scene.add(new Mesh(triangle(), material))
    const camera = new PerspectiveCamera()
  camera.position.z = 5
    renderer.render(scene, camera)
    const atlasGL = m.calls.find((c) => c.name === 'texSubImage2D')!
    expect(atlasGL).toBeDefined()
    // every frame after the first, with the shade rewritten: unit 0 must still hold the atlas at the draw
    for (let frame = 0; frame < 3; frame++) {
      shade.needsUpdate = true
      renderer.render(scene, camera)
    }
    const uploads = m.calls.filter((c) => c.name === 'texSubImage2D').length
    expect(uploads).toBe(2 + 3)
    const [first, ...rest] = m.state.draws
    const atlasTex = first.get(0)
    const shadeTex = first.get(1)
    expect(atlasTex).not.toBe(shadeTex)
    for (const draw of rest) {
      expect(draw.get(0)).toBe(atlasTex)
      expect(draw.get(1)).toBe(shadeTex)
    }
  })

  it('reallocates a resized attribute in the same buffer object, so the vertex array stays valid', () => {
    const m = mockGL()
    const renderer = new WebGLRenderer({ canvas: m.canvas as unknown as HTMLCanvasElement })
    const geometry = triangle()
    const material = new ShaderMaterial({ uniforms: {}, vertexShader: VERTEX, fragmentShader: `void main() { gl_FragColor = vec4(1.0); }` })
    const scene = new Scene()
    scene.add(new Mesh(geometry, material))
    const camera = new PerspectiveCamera()
  camera.position.z = 5
    renderer.render(scene, camera)
    const position = geometry.attributes.position
    const before = m.calls.filter((c) => c.name === 'bufferData')
    expect(before).toHaveLength(1)
    const pointer = m.calls.find((c) => c.name === 'vertexAttribPointer')!
    const boundAtPointer = m.calls.slice(0, m.calls.indexOf(pointer)).filter((c) => c.name === 'bindBuffer' && c.args[0] === m.constant('ARRAY_BUFFER')).pop()!.args[1]
    // the same attribute object grows: two triangles now
    position.array = new Float32Array(18)
    position.needsUpdate = true
    renderer.render(scene, camera)
    const after = m.calls.filter((c) => c.name === 'bufferData')
    expect(after).toHaveLength(2)
    expect(m.calls.filter((c) => c.name === 'deleteBuffer')).toHaveLength(0)
    // the buffer the vertex array points at is the one that was refilled
    expect(m.state.arrayBuffer).toBe(boundAtPointer)
    expect(m.calls.filter((c) => c.name === 'createVertexArray')).toHaveLength(1)
  })

  it('retires the buffer of an attribute object the geometry swapped out, and the other program’s vertex array on it', () => {
    const m = mockGL()
    const renderer = new WebGLRenderer({ canvas: m.canvas as unknown as HTMLCanvasElement })
    const geometry = triangle()
    const plain = `void main() { gl_FragColor = vec4(1.0); }`
    const a = new Mesh(geometry, new ShaderMaterial({ uniforms: {}, vertexShader: VERTEX, fragmentShader: plain }))
    const b = new Mesh(geometry, new ShaderMaterial({ uniforms: {}, vertexShader: VERTEX, fragmentShader: `uniform float t;\n${plain}` }))
    const scene = new Scene()
    scene.add(a, b)
    const camera = new PerspectiveCamera()
    camera.position.z = 5
    renderer.render(scene, camera)
    expect(m.calls.filter((c) => c.name === 'createBuffer')).toHaveLength(1)
    expect(m.calls.filter((c) => c.name === 'createVertexArray')).toHaveLength(2)
    // a new attribute object in place of the old, as a crowd rebuilt from scratch does
    geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(9), 3))
    renderer.render(scene, camera)
    expect(m.calls.filter((c) => c.name === 'createBuffer')).toHaveLength(2)
    expect(m.calls.filter((c) => c.name === 'deleteBuffer')).toHaveLength(1)
    // both programs' vertex arrays were pointing at the old buffer: both go, both come back
    expect(m.calls.filter((c) => c.name === 'deleteVertexArray')).toHaveLength(2)
    expect(m.calls.filter((c) => c.name === 'createVertexArray')).toHaveLength(4)
    // and nothing further happens on a frame where nothing changed
    renderer.render(scene, camera)
    expect(m.calls.filter((c) => c.name === 'deleteBuffer')).toHaveLength(1)
    expect(m.calls.filter((c) => c.name === 'createVertexArray')).toHaveLength(4)
    // disposing the geometry finds only the live buffer to delete
    geometry.dispose()
    expect(m.calls.filter((c) => c.name === 'deleteBuffer')).toHaveLength(2)
  })

  it('keeps its render-item records across a small pass, unlinked from the meshes of the large one', () => {
    const m = mockGL()
    const renderer = new WebGLRenderer({ canvas: m.canvas as unknown as HTMLCanvasElement })
    const material = new ShaderMaterial({ uniforms: {}, vertexShader: VERTEX, fragmentShader: `void main() { gl_FragColor = vec4(1.0); }` })
    const dungeon = new Scene()
    const meshes = [0, 1, 2].map(() => new Mesh(triangle(), material))
    dungeon.add(...meshes)
    const hands = new Scene()
    hands.add(new Mesh(triangle(), material))
    const camera = new PerspectiveCamera()
    camera.position.z = 5
    const items = () => (renderer as unknown as { items: { object: Mesh | null }[] }).items
    renderer.render(dungeon, camera)
    expect(items()).toHaveLength(3)
    const pooled = items().slice()
    // a frame ends on the hands: the dungeon's records stay pooled, and stop pointing at its meshes
    renderer.render(hands, camera)
    expect(items()).toHaveLength(3)
    expect(items().slice(1).map((i) => i.object)).toEqual([null, null])
    expect(items()[0].object).not.toBe(meshes[0])
    // an empty scene lets go of every mesh, and the records stay for the next frame
    renderer.render(new Scene(), camera)
    expect(items().map((i) => i.object)).toEqual([null, null, null])
    // the next dungeon pass finds them waiting
    renderer.render(dungeon, camera)
    for (let i = 0; i < 3; i++) expect(items()[i]).toBe(pooled[i])
    expect(items().map((i) => i.object)).toEqual(meshes)
    renderer.dispose()
    expect(items()).toHaveLength(0)
  })

  it('deletes a render target’s depth renderbuffer with its framebuffer', () => {
    const m = mockGL()
    const renderer = new WebGLRenderer({ canvas: m.canvas as unknown as HTMLCanvasElement })
    const rt = new WebGLRenderTarget(4, 4, { depthBuffer: true })
    renderer.setRenderTarget(rt)
    renderer.setRenderTarget(null)
    expect(m.calls.filter((c) => c.name === 'createRenderbuffer')).toHaveLength(1)
    rt.dispose()
    expect(m.calls.filter((c) => c.name === 'deleteRenderbuffer')).toHaveLength(1)
    // a depth texture in its place: no renderbuffer at all
    const m2 = mockGL()
    const renderer2 = new WebGLRenderer({ canvas: m2.canvas as unknown as HTMLCanvasElement })
    const rt2 = new WebGLRenderTarget(4, 4, { depthTexture: new DepthTexture(4, 4), depthBuffer: true })
    renderer2.setRenderTarget(rt2)
    expect(m2.calls.filter((c) => c.name === 'createRenderbuffer')).toHaveLength(0)
  })
})

describe('WebGLRenderer textures', () => {
  it('shares one upload between a texture and its clone, and re-uploads once when the source changes', () => {
    const m = mockGL()
    const renderer = new WebGLRenderer({ canvas: m.canvas as unknown as HTMLCanvasElement })
    const atlas = new DataTexture(new Uint8Array(4), 1, 1)
    const icon = atlas.clone()
    const a = new ShaderMaterial({ uniforms: { map: { value: atlas } }, vertexShader: VERTEX, fragmentShader: `uniform sampler2D map; void main() { gl_FragColor = texture2D(map, vec2(0.5)); }` })
    const b = new ShaderMaterial({ uniforms: { map: { value: icon } }, vertexShader: VERTEX, fragmentShader: `uniform sampler2D map; void main() { gl_FragColor = texture2D(map, vec2(0.5)); }` })
    const scene = new Scene()
    scene.add(new Mesh(triangle(), a), new Mesh(triangle(), b))
    const camera = new PerspectiveCamera()
    camera.position.z = 5
    renderer.render(scene, camera)
    expect(m.calls.filter((c) => c.name === 'createTexture')).toHaveLength(1 + 1) // the empty texture, and the atlas
    expect(m.calls.filter((c) => c.name === 'texSubImage2D')).toHaveLength(1)
    const [first, second] = m.state.draws
    expect(first.get(0)).toBe(second.get(0))
    atlas.needsUpdate = true
    renderer.render(scene, camera)
    expect(m.calls.filter((c) => c.name === 'texSubImage2D')).toHaveLength(2)
    // the GL texture outlives the first owner to go, not the last
    icon.dispose()
    expect(m.calls.filter((c) => c.name === 'deleteTexture')).toHaveLength(0)
    atlas.dispose()
    expect(m.calls.filter((c) => c.name === 'deleteTexture')).toHaveLength(1)
  })

  it('allocates the full mip chain for a mipmapped texture, and one level otherwise', () => {
    const m = mockGL()
    const renderer = new WebGLRenderer({ canvas: m.canvas as unknown as HTMLCanvasElement })
    // a DataTexture asks for no mipmaps by default; this one does, through a mip filter
    const mipped = new DataTexture(new Uint8Array(16 * 8 * 4), 16, 8)
    mipped.generateMipmaps = true
    mipped.minFilter = LinearMipmapLinearFilter
    const flat = new DataTexture(new Uint8Array(16 * 8 * 4), 16, 8)
    flat.minFilter = LinearFilter
    const frag = `uniform sampler2D map; void main() { gl_FragColor = texture2D(map, vec2(0.5)); }`
    const scene = new Scene()
    scene.add(new Mesh(triangle(), new ShaderMaterial({ uniforms: { map: { value: mipped } }, vertexShader: VERTEX, fragmentShader: frag })))
    scene.add(new Mesh(triangle(), new ShaderMaterial({ uniforms: { map: { value: flat } }, vertexShader: VERTEX, fragmentShader: frag })))
    const camera = new PerspectiveCamera()
    camera.position.z = 5
    renderer.render(scene, camera)
    const storage = m.calls.filter((c) => c.name === 'texStorage2D').map((c) => c.args[1])
    expect(storage).toEqual([5, 1])
    expect(m.calls.filter((c) => c.name === 'generateMipmap')).toHaveLength(1)
    // the sampler state goes with every upload, not the first alone
    const minFilters = () => m.calls.filter((c) => c.name === 'texParameteri' && c.args[1] === m.constant('TEXTURE_MIN_FILTER')).map((c) => c.args[2])
    expect(minFilters()).toEqual([m.constant('LINEAR_MIPMAP_LINEAR'), m.constant('LINEAR')])
    flat.minFilter = NearestFilter
    flat.needsUpdate = true
    renderer.render(scene, camera)
    expect(minFilters().at(-1)).toBe(m.constant('NEAREST'))
  })

  it('rebuilds a render target that was resized, framebuffer and colour texture both', () => {
    const m = mockGL()
    const renderer = new WebGLRenderer({ canvas: m.canvas as unknown as HTMLCanvasElement })
    const rt = new WebGLRenderTarget(4, 4, { depthBuffer: true })
    renderer.setRenderTarget(rt)
    rt.width = 8
    rt.height = 8
    renderer.setRenderTarget(rt)
    expect(m.calls.filter((c) => c.name === 'createFramebuffer')).toHaveLength(2)
    expect(m.calls.filter((c) => c.name === 'deleteFramebuffer')).toHaveLength(1)
    expect(m.calls.filter((c) => c.name === 'deleteRenderbuffer')).toHaveLength(1)
    const sizes = m.calls.filter((c) => c.name === 'texStorage2D').map((c) => [c.args[3], c.args[4]])
    expect(sizes).toEqual([
      [4, 4],
      [8, 8],
    ])
  })
})

describe('WebGLRenderer state', () => {
  it('clears colour with the colour mask on, whatever the last material left it at', () => {
    const m = mockGL()
    const renderer = new WebGLRenderer({ canvas: m.canvas as unknown as HTMLCanvasElement })
    const material = new ShaderMaterial({ uniforms: {}, vertexShader: VERTEX, fragmentShader: `void main() { gl_FragColor = vec4(1.0); }` })
    material.colorWrite = false
    const scene = new Scene()
    scene.add(new Mesh(triangle(), material))
    const camera = new PerspectiveCamera()
    camera.position.z = 5
    renderer.render(scene, camera)
    const masks = m.calls.filter((c) => c.name === 'colorMask').map((c) => c.args[0])
    expect(masks.at(-1)).toBe(false)
    renderer.render(scene, camera)
    const idx = m.calls.findLastIndex((c) => c.name === 'clear')
    const before = m.calls.slice(0, idx).filter((c) => c.name === 'colorMask').at(-1)!
    expect(before.args[0]).toBe(true)
  })

  it('sets a generic attribute value again where another draw left the context holding a different one', () => {
    const m = mockGL()
    const renderer = new WebGLRenderer({ canvas: m.canvas as unknown as HTMLCanvasElement })
    const vertex = `attribute vec3 color; varying vec3 vC; void main() { vC = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`
    const fragment = `varying vec3 vC; void main() { gl_FragColor = vec4(vC, 1.0); }`
    const red = new ShaderMaterial({ uniforms: {}, vertexShader: vertex, fragmentShader: fragment })
    red.defaultAttributeValues = { color: [1, 0, 0] }
    const blue = new ShaderMaterial({ uniforms: {}, vertexShader: vertex, fragmentShader: fragment })
    blue.defaultAttributeValues = { color: [0, 0, 1] }
    const scene = new Scene()
    const a = new Mesh(triangle(), red)
    const b = new Mesh(triangle(), blue)
    a.renderOrder = 0
    b.renderOrder = 1
    scene.add(a, b)
    const camera = new PerspectiveCamera()
    camera.position.z = 5
    renderer.render(scene, camera)
    renderer.render(scene, camera)
    const values = m.calls.filter((c) => c.name === 'vertexAttrib3fv').map((c) => (c.args[1] as number[])[0])
    // red, blue on the first frame; red, blue again on the second, though both vertex arrays already exist
    expect(values).toEqual([1, 0, 1, 0])
    expect(m.calls.filter((c) => c.name === 'createVertexArray')).toHaveLength(2)
  })

  it('links every program in compile() and reads none back until it is drawn with', () => {
    const m = mockGL()
    const renderer = new WebGLRenderer({ canvas: m.canvas as unknown as HTMLCanvasElement })
    const scene = new Scene()
    for (let i = 0; i < 3; i++) scene.add(new Mesh(triangle(), new ShaderMaterial({ uniforms: {}, vertexShader: VERTEX, fragmentShader: `void main() { gl_FragColor = vec4(${i}.0); }` })))
    const camera = new PerspectiveCamera()
    camera.position.z = 5
    renderer.compile(scene, camera)
    expect(m.calls.filter((c) => c.name === 'linkProgram')).toHaveLength(3)
    expect(m.calls.filter((c) => c.name === 'getProgramParameter')).toHaveLength(0)
    renderer.render(scene, camera)
    expect(m.calls.filter((c) => c.name === 'linkProgram')).toHaveLength(3)
    expect(m.calls.filter((c) => c.name === 'getProgramParameter' && c.args[1] === m.constant('LINK_STATUS'))).toHaveLength(3)
  })

  it('compiles a depth-only program per material for depthOnly, and masks the colour buffer off', () => {
    const m = mockGL()
    const renderer = new WebGLRenderer({ canvas: m.canvas as unknown as HTMLCanvasElement })
    const material = new MeshBasicMaterial({ map: new DataTexture(new Uint8Array(4), 1, 1), alphaTest: 0.5 })
    const scene = new Scene()
    scene.add(new Mesh(triangle(), material))
    const camera = new PerspectiveCamera()
    camera.position.z = 5
    renderer.depthOnly = true
    renderer.render(scene, camera)
    const draw = m.calls.findIndex((c) => c.name === 'drawArrays')
    const mask = m.calls.slice(0, draw).filter((c) => c.name === 'colorMask').at(-1)!
    expect(mask.args[0]).toBe(false)
    expect(m.calls.filter((c) => c.name === 'clear').at(-1)!.args[0]).toBe(m.constant('DEPTH_BUFFER_BIT') | m.constant('STENCIL_BUFFER_BIT'))
    renderer.depthOnly = false
    renderer.render(scene, camera)
    expect(renderer.info.programs).toBe(2)
    const fragments = m.calls.filter((c) => c.name === 'shaderSource').map((c) => c.args[1] as string).filter((s) => s.includes('pc_fragColor'))
    expect(fragments).toHaveLength(2)
    // the depth-only source keeps the alpha test and drops the shading and the write after it
    expect(fragments[0]).toContain('discard')
    expect(fragments[0]).not.toContain('gl_FragColor = vec4( outgoingLight')
    expect(fragments[1]).toContain('gl_FragColor = vec4( outgoingLight')
  })

  it('encodes to sRGB for the canvas and leaves a linear render target linear', () => {
    const m = mockGL()
    const renderer = new WebGLRenderer({ canvas: m.canvas as unknown as HTMLCanvasElement })
    const material = new MeshBasicMaterial({})
    const scene = new Scene()
    scene.add(new Mesh(triangle(), material))
    const camera = new PerspectiveCamera()
    camera.position.z = 5
    renderer.render(scene, camera)
    renderer.setRenderTarget(new WebGLRenderTarget(4, 4))
    renderer.render(scene, camera)
    expect(renderer.info.programs).toBe(2)
    const fragments = m.calls.filter((c) => c.name === 'shaderSource').map((c) => c.args[1] as string).filter((s) => s.includes('pc_fragColor'))
    expect(fragments[0]).toContain('return sRGBTransferOETF(')
    expect(fragments[1]).toContain('return LinearTransferOETF(')
  })
})

describe('depthOnlyFragment', () => {
  it('cuts the source after its alpha test, and leaves a source without one whole', () => {
    const cut = depthOnlyFragment(basicFragment)
    expect(cut.trim().endsWith('#include <alphatest_fragment>\n\n}')).toBe(true)
    expect(cut).not.toContain('opaque_fragment')
    const own = 'void main() { gl_FragColor = vec4(1.0); }'
    expect(depthOnlyFragment(own)).toBe(own)
  })
})
