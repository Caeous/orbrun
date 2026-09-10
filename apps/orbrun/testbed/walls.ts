/**
 * Wall test bed (rendering-3d.md II.1, "Inset walls" experiment).
 *
 * Renders ASCII layouts with the footprint rule from @orbrun/render-3d, with
 * a live inset slider, beside a top-down map of the same
 * footprints that overlays the literal definition so any seam shows in red.
 * Served by the app's dev server at /testbed/walls.html; not part of the build.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { asciiClassAt, insetFootprint, insetOracle, inPoly, type ClassAt, type FootprintOptions } from '@orbrun/render-3d'

const LAYOUTS: Record<string, string[]> = {
  corridor: ['#########', '#.......#', '#.#######', '#.#.....#', '#.#.....#', '#.......#', '#########'],
  pillar: ['#######', '#.....#', '#.#...#', '#...#.#', '#.....#', '#######'],
  junction: ['###########', '#.........#', '#####.#####', '    #.#', '    #.#', '  ###.###', '  #.....#', '  #######'],
  checker: ['#.#.#', '.#.#.', '#.#.#', '.#.#.', '#.#.#'],
  cave: ['   ####    ', '  ##..##   ', ' ##....###', ' #..#....# ', ' #.....#.# ', ' ###.....# ', '   ###..## ', '     ####  '],
  screenshot: [
    '#####  ######',
    '#.#.#  #.#.##',
    '#.#.####.#..#',
    '#.####.##.#.#',
    '#...#.#..##.#',
    '###.#.#.#.#.#',
    '#.....#.....#',
    '#.####.#.#.##',
    '#.#..#...#..#',
    '#############',
  ],
}

const EYE = 0.62
const SIDE_SHADE = 0.82

// ---------------------------------------------------------------------------
// DOM

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const view = $('view')
const layoutSel = $<HTMLSelectElement>('layout')
const insetIn = $<HTMLInputElement>('inset')
const oracleIn = $<HTMLInputElement>('oracle')
const ascii = $<HTMLTextAreaElement>('ascii')
const map = $<HTMLCanvasElement>('map')
const stats = $('stats')
for (const name of Object.keys(LAYOUTS)) layoutSel.append(new Option(name, name))

let rows = LAYOUTS.corridor
ascii.value = rows.join('\n')
layoutSel.onchange = () => { rows = LAYOUTS[layoutSel.value]; ascii.value = rows.join('\n'); rebuild() }
$('apply').onclick = () => { rows = ascii.value.split('\n'); rebuild() }
for (const el of [insetIn, oracleIn]) el.oninput = rebuild

function options(): FootprintOptions {
  return { inset: Number(insetIn.value) / 32 }
}

// ---------------------------------------------------------------------------
// Textures: a 32-texel brick tile with a bright border texel, so tile seams and stretch are visible

function tileTexture(kind: 'wall' | 'floor'): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 32
  const g = c.getContext('2d')!
  if (kind === 'wall') {
    g.fillStyle = '#6a6a5e'
    g.fillRect(0, 0, 32, 32)
    g.fillStyle = '#4c4c44'
    for (let row = 0; row < 4; row++) {
      const off = row % 2 ? 8 : 0
      for (let x = -8; x < 32; x += 16) g.fillRect(x + off + 1, row * 8 + 1, 14, 6)
    }
    g.fillStyle = '#8a8a7a'
    g.fillRect(0, 0, 32, 1); g.fillRect(0, 0, 1, 32)
  } else {
    g.fillStyle = '#2b2b30'
    g.fillRect(0, 0, 32, 32)
    g.fillStyle = '#33333a'
    for (let i = 0; i < 40; i++) g.fillRect((i * 7) % 32, (i * 13) % 32, 2, 2)
  }
  const t = new THREE.CanvasTexture(c)
  t.magFilter = t.minFilter = THREE.NearestFilter
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

// ---------------------------------------------------------------------------
// Three

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
view.append(renderer.domElement)
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x000000)
const camera = new THREE.PerspectiveCamera(70, 1, 0.02, 200)
const orbit = new OrbitControls(camera, renderer.domElement)
orbit.enableDamping = true
const wallMat = new THREE.MeshBasicMaterial({ map: tileTexture('wall'), vertexColors: true })
const floorMat = new THREE.MeshBasicMaterial({ map: tileTexture('floor'), vertexColors: true })
const voidMat = new THREE.MeshBasicMaterial({ color: 0x000000 })
const level = new THREE.Group()
scene.add(level)

let mode: 'orbit' | 'walk' = 'orbit'
const walk = { x: 1.5, z: 1.5, yaw: 0, pitch: -0.08, h: EYE }
const keys = new Set<string>()
$('modeOrbit').onclick = () => setMode('orbit')
$('modeWalk').onclick = () => setMode('walk')
function setMode(m: typeof mode) {
  mode = m
  orbit.enabled = m === 'orbit'
  $('modeOrbit').classList.toggle('on', m === 'orbit')
  $('modeWalk').classList.toggle('on', m === 'walk')
}
addEventListener('keydown', (e) => { keys.add(e.key.toLowerCase()) })
addEventListener('keyup', (e) => { keys.delete(e.key.toLowerCase()) })
let drag: { x: number; y: number } | null = null
renderer.domElement.addEventListener('pointerdown', (e) => { if (mode === 'walk') drag = { x: e.clientX, y: e.clientY } })
addEventListener('pointerup', () => { drag = null })
addEventListener('pointermove', (e) => {
  if (!drag) return
  walk.yaw -= (e.clientX - drag.x) * 0.005
  walk.pitch = Math.max(-1.4, Math.min(1.4, walk.pitch - (e.clientY - drag.y) * 0.005))
  drag = { x: e.clientX, y: e.clientY }
})

class Geo {
  pos: number[] = []; uv: number[] = []; col: number[] = []; idx: number[] = []
  quad(p: [number, number, number][], uv: [number, number][], shade: number) {
    const b = this.pos.length / 3
    for (const q of p) this.pos.push(...q)
    for (const u of uv) this.uv.push(...u)
    for (let i = 0; i < 4; i++) this.col.push(shade, shade, shade)
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3)
  }
  poly(p: [number, number, number][], uv: [number, number][], shade: number) {
    const b = this.pos.length / 3
    for (const q of p) this.pos.push(...q)
    for (const u of uv) this.uv.push(...u)
    for (let i = 0; i < p.length; i++) this.col.push(shade, shade, shade)
    const tris = THREE.ShapeUtils.triangulateShape(p.map(([x, , z]) => new THREE.Vector2(x, z)), [])
    for (const [a, bb, c] of tris) this.idx.push(b + a, b + bb, b + c)
  }
  build(mat: THREE.Material): THREE.Mesh | null {
    if (!this.idx.length) return null
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3))
    g.setIndex(this.idx)
    return new THREE.Mesh(g, mat)
  }
}

function bounds() {
  const w = Math.max(...rows.map((r) => r.length))
  return { w, h: rows.length }
}

function rebuild() {
  insetIn.nextElementSibling!.textContent = `${insetIn.value}/32`
  const at = asciiClassAt(rows)
  const o = options()
  const { w, h } = bounds()
  for (const c of [...level.children]) { level.remove(c); (c as THREE.Mesh).geometry?.dispose() }
  const walls = new Geo(), floors = new Geo(), voids = new Geo()
  let faces = 0
  for (let z = -1; z <= h; z++) {
    for (let x = -1; x <= w; x++) {
      const cls = at(x, z)
      // floor and lid under and over everything inside the known area and its rim; the body covers what it should
      const nearKnown = cls !== 'void' || [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]].some(([dx, dz]) => at(x + dx, z + dz) !== 'void')
      if (nearKnown) {
        floors.quad([[x, 0, z + 1], [x + 1, 0, z + 1], [x + 1, 0, z], [x, 0, z]], [[0, 0], [1, 0], [1, 1], [0, 1]], 1)
        walls.quad([[x, 1, z], [x + 1, 1, z], [x + 1, 1, z + 1], [x, 1, z + 1]], [[0, 1], [1, 1], [1, 0], [0, 0]], 0.55)
      }
      if (cls === 'floor') continue
      const fp = insetFootprint(at, x, z, o)
      if (!fp.poly.length) continue
      const sink = cls === 'void' ? voids : walls
      for (const f of fp.faces) {
        if (f.covered) continue
        faces++
        const ax = x + f.a[0], az = z + f.a[1], bx = x + f.b[0], bz = z + f.b[1]
        // u runs along the face by world position so a run of cells tiles continuously
        const ua = Math.abs(f.nx) > 0.5 ? az : ax, ub = Math.abs(f.nx) > 0.5 ? bz : bx
        const shade = Math.abs(f.nx) > 0.5 ? SIDE_SHADE : 1
        // wind the quad so its front faces the footprint's outward normal
        const cross = new THREE.Vector3(bx - ax, 0, bz - az).cross(new THREE.Vector3(0, 1, 0))
        const p: [number, number, number][] = [[ax, 0, az], [bx, 0, bz], [bx, 1, bz], [ax, 1, az]]
        const uv: [number, number][] = [[ua, 0], [ub, 0], [ub, 1], [ua, 1]]
        if (cross.x * f.nx + cross.z * f.nz < 0) { p.reverse(); uv.reverse() }
        sink.quad(p, uv, shade)
      }
      // top cap, for the orbit view above the lid
      const top = [...fp.poly].reverse().map(([fx, fz]) => [x + fx, 1.001, z + fz] as [number, number, number])
      sink.poly(top, top.map(([px, , pz]) => [px, pz]), 0.9)
    }
  }
  for (const m of [walls.build(wallMat), floors.build(floorMat), voids.build(voidMat)]) if (m) level.add(m)
  stats.textContent = `${faces} wall faces`
  drawMap(at, o)
}

// ---------------------------------------------------------------------------
// Top-down map: footprints, exposed faces, and the definition overlay

function drawMap(at: ClassAt, o: FootprintOptions) {
  const g = map.getContext('2d')!
  const { w, h } = bounds()
  const S = Math.floor(Math.min(map.width / (w + 2), map.height / (h + 2)))
  const ox = (map.width - S * (w + 2)) / 2 + S, oz = (map.height - S * (h + 2)) / 2 + S
  g.fillStyle = '#000'
  g.fillRect(0, 0, map.width, map.height)
  let disagreements = 0
  for (let z = -1; z <= h; z++) {
    for (let x = -1; x <= w; x++) {
      const cls = at(x, z)
      g.fillStyle = cls === 'floor' ? '#2b2b30' : '#000'
      g.fillRect(ox + x * S, oz + z * S, S, S)
      if (cls === 'floor') { g.strokeStyle = '#3a3a45'; g.strokeRect(ox + x * S + 0.5, oz + z * S + 0.5, S - 1, S - 1); continue }
      const fp = insetFootprint(at, x, z, o)
      if (fp.poly.length) {
        g.fillStyle = cls === 'void' ? '#181818' : '#6a6a5e'
        g.beginPath()
        fp.poly.forEach(([fx, fz], i) => (i ? g.lineTo(ox + (x + fx) * S, oz + (z + fz) * S) : g.moveTo(ox + (x + fx) * S, oz + (z + fz) * S)))
        g.closePath(); g.fill()
      }
      if (oracleIn.checked) {
        // sample the definition: red where the polygon disagrees with it (never, if the rule is right)
        const N = 8
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
          const fx = (i + 0.5) / N, fz = (j + 0.5) / N
          const a = insetOracle(at, x, z, fx, fz, o), b = fp.poly.length > 0 && inPoly(fp.poly, fx, fz)
          if (a !== b) { disagreements++; g.fillStyle = '#f33'; g.fillRect(ox + (x + fx) * S - 1, oz + (z + fz) * S - 1, 2, 2) }
        }
      }
      g.lineWidth = 2
      for (const f of fp.faces) {
        if (f.covered) continue
        g.strokeStyle = cls === 'void' ? '#448' : '#9cf'
        g.beginPath(); g.moveTo(ox + (x + f.a[0]) * S, oz + (z + f.a[1]) * S); g.lineTo(ox + (x + f.b[0]) * S, oz + (z + f.b[1]) * S); g.stroke()
      }
      g.lineWidth = 1
    }
  }
  // the walker
  g.fillStyle = '#5f5'
  g.beginPath(); g.arc(ox + walk.x * S, oz + walk.z * S, 3, 0, Math.PI * 2); g.fill()
  g.strokeStyle = '#5f5'
  g.beginPath(); g.moveTo(ox + walk.x * S, oz + walk.z * S); g.lineTo(ox + (walk.x + Math.sin(walk.yaw) * -0.6) * S, oz + (walk.z - Math.cos(walk.yaw) * 0.6) * S); g.stroke()
  if (oracleIn.checked) stats.textContent += disagreements ? ` · ${disagreements} definition mismatches` : ' · matches definition'
  map.onclick = (e) => {
    const r = map.getBoundingClientRect()
    const cx = Math.floor((e.clientX - r.left) * (map.width / r.width) - ox) / S, cz = Math.floor((e.clientY - r.top) * (map.height / r.height) - oz) / S
    const x = Math.floor(cx), z = Math.floor(cz)
    if (at(x, z) !== 'floor') return
    walk.x = x + 0.5; walk.z = z + 0.5
    setMode('walk')
    drawMap(at, o)
  }
}

// ---------------------------------------------------------------------------
// Frame loop

function resize() {
  const w = view.clientWidth, h = view.clientHeight
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}
addEventListener('resize', resize)
resize()
{
  const { w, h } = bounds()
  camera.position.set(w / 2, Math.max(w, h) * 0.9, h * 1.4)
  orbit.target.set(w / 2, 0, h / 2)
}

let last = performance.now()
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now
  if (mode === 'orbit') orbit.update()
  else {
    const sp = 2 * dt
    const fx = -Math.sin(walk.yaw), fz = -Math.cos(walk.yaw)
    if (keys.has('w')) { walk.x += fx * sp; walk.z += fz * sp }
    if (keys.has('s')) { walk.x -= fx * sp; walk.z -= fz * sp }
    if (keys.has('a')) { walk.x += fz * sp; walk.z -= fx * sp }
    if (keys.has('d')) { walk.x -= fz * sp; walk.z += fx * sp }
    if (keys.has('q')) walk.yaw += 1.8 * dt
    if (keys.has('e')) walk.yaw -= 1.8 * dt
    if (keys.has('r')) walk.h = Math.min(0.98, walk.h + dt)
    if (keys.has('f')) walk.h = Math.max(0.1, walk.h - dt)
    camera.position.set(walk.x, walk.h, walk.z)
    camera.rotation.set(0, 0, 0)
    camera.rotateY(walk.yaw)
    camera.rotateX(walk.pitch)
    if (keys.size) drawMap(asciiClassAt(rows), options())
  }
  renderer.render(scene, camera)
  requestAnimationFrame(frame)
}
rebuild()
requestAnimationFrame(frame)
// for driving the page from a script (headless checks)
Object.assign(window, { __tb: { walk, setMode, rebuild, camera } })
