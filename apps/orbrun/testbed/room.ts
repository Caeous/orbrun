/**
 * Room test bed: the front end's room (src/room/antechamber.des) drawn by the
 * game's renderer beside the same vault top down, with the eye, the light,
 * the field of view and the pitch on sliders, and the app's own home screen
 * laid over it so the composition is judged through the menu and not only
 * bare. Served by the dev server at /testbed/room.html; not part of the
 * build. With `?poster` it draws the room alone at rest, full window, and
 * sets `window.__poster` once the first frame is up (tools/build/poster.mjs).
 */
import { Render3d } from '@orbrun/render-3d'
import { Render2d } from '@orbrun/render-2d'
import { dirToYaw, normalizeYaw, shadeOf, type Camera, type Scene } from '@orbrun/scene'
import { parseDes, vaultCamera, vaultScene, DesError, type Vault } from '@orbrun/vault'
import desText from '../src/room/antechamber.des?raw'
import { loadRoomTiles, type RoomTiles } from '../src/room/tiles'
import { ROOM_EYE_HEIGHT, ROOM_FOV } from '../src/room/room-3d'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const poster = new URLSearchParams(location.search).has('poster')
if (poster) document.body.classList.add('poster')

const view = $('view')
const canvas = document.createElement('canvas')
canvas.className = 'room in'
view.prepend(canvas)
const overlay = $('overlay')
const des = $<HTMLTextAreaElement>('des')
des.value = desText
const err = $('err')
const stats = $('stats')

let tiles: RoomTiles
let vault: Vault
let scene: Scene
let cam: Camera
let light: { x: number; y: number }
const r3 = new Render3d({ view: 'first', fov: ROOM_FOV, eyeHeight: ROOM_EYE_HEIGHT, viewmodel: false, motion: false })
r3.mount(canvas)
const r2 = new Render2d({ cellSize: 24, mode: 'tiles', follow: false })
const map2d = $<HTMLCanvasElement>('map2d')
const marks = $<HTMLCanvasElement>('marks')
r2.mount(map2d)

// draw calls per frame, counted on the context the renderer draws with
let draws = 0
const gl = canvas.getContext('webgl2') as WebGL2RenderingContext | null
if (gl)
  for (const k of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced'] as const) {
    const f = gl[k] as (...a: unknown[]) => unknown
    ;(gl as unknown as Record<string, unknown>)[k] = function (this: unknown, ...a: unknown[]) {
      draws++
      return f.apply(this, a)
    }
  }

function compile(): boolean {
  try {
    vault = parseDes(des.value)
    scene = vaultScene(vault, tiles)
    cam = vaultCamera(vault)
    light = { ...vault.light }
    err.textContent = ''
    return true
  } catch (e) {
    err.textContent = e instanceof DesError ? e.message : String(e)
    return false
  }
}

function relight() {
  scene.player = { x: light.x, y: light.y }
  scene.revision++
}

function sliders() {
  $('fovV').textContent = `${$<HTMLInputElement>('fov').value}°`
  $('eyeV').textContent = `${Number($<HTMLInputElement>('eye').value).toFixed(2)} cells`
  $('pitchV').textContent = `${$<HTMLInputElement>('pitch').value}°`
  $('yawV').textContent = `${$<HTMLInputElement>('yaw').value}°`
  $('lxV').textContent = String(light.x)
  $('lyV').textContent = String(light.y)
}

function applySliders() {
  r3.setOptions({ fov: Number($<HTMLInputElement>('fov').value), eyeHeight: Number($<HTMLInputElement>('eye').value) })
  cam.pitch = (Number($<HTMLInputElement>('pitch').value) * Math.PI) / 180
  cam.yaw = normalizeYaw((Number($<HTMLInputElement>('yaw').value) * Math.PI) / 180)
  sliders()
  draw()
}

function resize() {
  const w = view.clientWidth || 1
  const h = view.clientHeight || 1
  r3.resize(w, h, Math.min(window.devicePixelRatio || 1, 1))
  const cs = Math.max(6, Math.floor(Math.min(360 / vault.width, 240 / vault.height)))
  r2.setOptions({ cellSize: cs })
  const mw = cs * vault.width
  const mh = cs * vault.height
  r2.resize(mw, mh, 1)
  map2d.style.width = mw + 'px'
  map2d.style.height = mh + 'px'
  marks.width = mw
  marks.height = mh
  marks.style.width = mw + 'px'
  marks.style.height = mh + 'px'
  draw()
}

function draw() {
  draws = 0
  const t0 = performance.now()
  r3.setScene(scene)
  r3.setCamera(cam)
  r3.render()
  const ms = performance.now() - t0
  r2.setScene(scene)
  r2.setCamera(cam)
  r2.render()
  markMap()
  const eyeShade = shadeOf(scene.cells.get(((vault.eye.y + 512) << 10) | (vault.eye.x + 512)), scene)
  const stairs = [...scene.cells.values()].find((c) => c.feature?.type === 'stairs')
  stats.textContent = `${draws} draw calls, ${ms.toFixed(1)} ms on the CPU side · shade at the eye ${eyeShade.toFixed(2)}, at the stairs ${(stairs ? shadeOf(stairs, scene) : 0).toFixed(2)}`
  if (poster && !(window as unknown as { __poster?: boolean }).__poster) {
    ;(window as unknown as { __poster?: boolean }).__poster = true
    document.title = 'poster ready'
  }
}

/** the eye and the light on the map */
function markMap() {
  const ctx = marks.getContext('2d')!
  const cs = marks.width / vault.width
  ctx.clearRect(0, 0, marks.width, marks.height)
  ctx.lineWidth = 2
  ctx.strokeStyle = '#ffd45c'
  ctx.fillStyle = '#ffd45c'
  const ex = (vault.eye.x + 0.5) * cs
  const ey = (vault.eye.y + 0.5) * cs
  ctx.beginPath()
  ctx.arc(ex, ey, cs * 0.3, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(ex, ey)
  ctx.lineTo(ex + Math.sin(cam.yaw) * cs * 0.9, ey - Math.cos(cam.yaw) * cs * 0.9)
  ctx.stroke()
  ctx.strokeStyle = '#fff'
  ctx.beginPath()
  ctx.arc((light.x + 0.5) * cs, (light.y + 0.5) * cs, cs * 0.22, 0, Math.PI * 2)
  ctx.stroke()
}

// ---------------------------------------------------------------- input
let drag: { x: number; y: number } | null = null
canvas.addEventListener('pointerdown', (ev) => {
  drag = { x: ev.clientX, y: ev.clientY }
  canvas.setPointerCapture(ev.pointerId)
})
canvas.addEventListener('pointermove', (ev) => {
  if (!drag) return
  const k = Math.PI / Math.max(300, canvas.clientWidth)
  cam.yaw = normalizeYaw(cam.yaw - (ev.clientX - drag.x) * k)
  cam.pitch = Math.max((-25 * Math.PI) / 180, Math.min((15 * Math.PI) / 180, cam.pitch + (ev.clientY - drag.y) * k))
  drag = { x: ev.clientX, y: ev.clientY }
  $<HTMLInputElement>('yaw').value = String(Math.round((cam.yaw * 180) / Math.PI))
  $<HTMLInputElement>('pitch').value = String(Math.round((cam.pitch * 180) / Math.PI))
  sliders()
  draw()
})
canvas.addEventListener('pointerup', () => (drag = null))
marks.addEventListener('click', (ev) => {
  const cs = marks.width / vault.width
  const x = Math.floor(ev.offsetX / cs)
  const y = Math.floor(ev.offsetY / cs)
  const c = scene.cells.get(((y + 512) << 10) | (x + 512))
  if (!c || c.occluder) return
  light = { x, y }
  $<HTMLInputElement>('lx').value = String(x)
  $<HTMLInputElement>('ly').value = String(y)
  relight()
  sliders()
  draw()
})
for (const id of ['fov', 'eye', 'pitch', 'yaw']) $(id).addEventListener('input', applySliders)
for (const id of ['lx', 'ly']) {
  $(id).addEventListener('input', () => {
    light = { x: Number($<HTMLInputElement>('lx').value), y: Number($<HTMLInputElement>('ly').value) }
    relight()
    sliders()
    draw()
  })
}
$('menu').addEventListener('change', () => overlay.classList.toggle('off', !$<HTMLInputElement>('menu').checked))
$('faceN').addEventListener('click', () => {
  $<HTMLInputElement>('yaw').value = '0'
  applySliders()
})
$('faceS').addEventListener('click', () => {
  $<HTMLInputElement>('yaw').value = '180'
  applySliders()
})
$('apply').addEventListener('click', () => {
  if (!compile()) return
  $<HTMLInputElement>('lx').value = String(light.x)
  $<HTMLInputElement>('ly').value = String(light.y)
  $<HTMLInputElement>('yaw').value = String(Math.round((dirToYaw(vault.eye.facing) * 180) / Math.PI))
  applySliders()
  resize()
})
window.addEventListener('resize', resize)

// ---------------------------------------------------------------- go
loadRoomTiles().then((t) => {
  tiles = t
  r3.setTiles(tiles)
  r2.setTiles(tiles)
  if (!compile()) return
  $<HTMLInputElement>('lx').max = String(vault.width - 1)
  $<HTMLInputElement>('ly').max = String(vault.height - 1)
  $<HTMLInputElement>('lx').value = String(light.x)
  $<HTMLInputElement>('ly').value = String(light.y)
  $<HTMLInputElement>('yaw').value = String(Math.round((dirToYaw(vault.eye.facing) * 180) / Math.PI))
  if (poster) overlay.classList.add('off')
  applySliders()
  resize()
})
