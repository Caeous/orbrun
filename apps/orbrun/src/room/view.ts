import { CameraController } from '../camera'
import { h } from '../dom'
import { getSettings } from '../servers'
import type { Room3d } from './room-3d'

/**
 * The room behind the front end: the Antechamber (antechamber.des), drawn by
 * the game's own renderer from a fixed eye in the middle of the hall. The
 * right stick and a drag on the scenery look around it; left alone, the eye
 * turns clockwise so slowly it reads as stillness (DRIFT_RATE below), and
 * nothing else moves. Nothing is drawn while nothing moves.
 *
 * Stands where the level backdrop stood: a canvas under the screen's frame,
 * publishing the cell size the console-face menus are laid out on (`--cw`,
 * `--ch`, `--fs`, `--fit` on the host) and `onfit` when it changes.
 *
 * The renderer, three.js with it, is a lazy chunk: the menus draw and work
 * before it lands, on the dark. Usually the live room is up within a moment
 * and fades in from the dark facing a random way at the resting pitch, so
 * each visit opens on a different wall; nothing is remembered between
 * visits. Only when the room is slow to land (POSTER_DELAY) does the poster
 * come up (the room at rest, drawn once at build: tools/build/poster.mjs),
 * and then the live room opens on the poster's own shot, so the one never
 * cuts to the other. No WebGL (or a context lost and not given back) leaves
 * the menus on the poster.
 */
/** the room at rest, as a picture */
const POSTER_URL = '/room/poster.jpg'
/** how long the menus stand on the dark before the poster comes up, in ms; the live room usually beats it */
const POSTER_DELAY = 400
/** the pixel ratio the room is drawn at: one drawn pixel per css pixel, as the game's view (game.ts VIEW_MAX_DPR) */
const ROOM_MAX_DPR = 1
/** the glance up and down: never under the floor, never into the lid's edge */
const PITCH_MIN = -(Math.PI / 180) * 30
const PITCH_MAX = (Math.PI / 180) * 15
/** a press on the scenery is a look once it has moved this far, in css px (game.ts DRAG_SLOP) */
const DRAG_SLOP = 6
/**
 * The idle turn: left alone, the eye turns clockwise (to the right, as the
 * stick turns it) so slowly nobody would call it movement, DRIFT_RATE radians
 * a second; it is under way as the room comes in, holds still for IDLE_DELAY
 * seconds after any look and eases (back) up to speed over DRIFT_RAMP
 * seconds, so a hand on the scenery is never fought. Off under
 * prefers-reduced-motion.
 */
const DRIFT_RATE = (Math.PI / 180) * 0.35
const IDLE_DELAY = 4
const DRIFT_RAMP = 3
/** the console grid the menus stand on: the cell the level backdrop settled on for its usual floor, kept so nothing about the menus' scale changes */
const GRID_COLS = 59
const GRID_ROWS = 32

export class RoomView {
  readonly el: HTMLCanvasElement
  /** the picture under the canvas */
  readonly poster: HTMLImageElement
  onfit: (() => void) | null = null
  private reducedMotion = false
  private host: HTMLElement
  private ro: ResizeObserver | null = null
  private grid = { cw: 16, ch: 23 }
  private room: Room3d | null = null
  private cam = new CameraController()
  private raf = 0
  private last = 0
  private needsRender = false
  private lost = false
  private destroyed = false
  private drag: { id: number; x: number; y: number; x0: number; y0: number; moved: boolean } | null = null
  /** how far the idle turn has come up to speed, 0..1 */
  private driftEnv = 0
  /** seconds since the last look; the idle turn waits for IDLE_DELAY of them, and none on opening: the room comes in already turning */
  private idle = IDLE_DELAY
  private size = { w: 1, h: 1 }
  private posterTimer = 0

  get cellWidth(): number {
    return this.grid.cw
  }

  constructor(host: HTMLElement) {
    this.host = host
    this.el = h('canvas', { class: 'room', 'aria-hidden': 'true' })
    this.poster = h('img', { class: 'room-poster', src: POSTER_URL, alt: '', 'aria-hidden': 'true', draggable: 'false' })
    host.prepend(this.el)
    host.prepend(this.poster)
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    this.fit = this.fit.bind(this)
    this.tick = this.tick.bind(this)
    this.onVisibility = this.onVisibility.bind(this)
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(this.fit)
      this.ro.observe(this.el)
    }
    this.fit()
    this.el.addEventListener('webglcontextlost', (ev) => {
      ev.preventDefault()
      this.lost = true
      this.el.classList.remove('in')
      this.showPoster()
    })
    this.el.addEventListener('webglcontextrestored', () => {
      this.lost = false
      this.invalidate()
    })
    document.addEventListener('visibilitychange', this.onVisibility)
    this.attachPointer()
    this.posterTimer = window.setTimeout(() => this.showPoster(), POSTER_DELAY)
    void this.start()
  }

  destroy() {
    this.destroyed = true
    clearTimeout(this.posterTimer)
    cancelAnimationFrame(this.raf)
    this.ro?.disconnect()
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.room?.destroy()
    this.room = null
    this.el.remove()
    this.poster.remove()
  }

  /** Right stick: dx, dy in [-1, 1]; zero releases it. */
  look(dx: number, dy: number) {
    const st = getSettings()
    if (dx !== 0 || dy !== 0) this.interrupt()
    this.cam.look(dx, dy, st.lookSensitivity, st.invertLook)
    this.invalidate()
  }

  private async start() {
    if (!hasWebGL(this.el)) {
      this.showPoster()
      return
    }
    let mod: typeof import('./room-3d')
    try {
      mod = await import('./room-3d')
      if (this.destroyed) return
      this.room = await mod.Room3d.create(this.el)
    } catch (e) {
      console.warn('the front room could not be drawn; the menus stand on the dark', e)
      return
    }
    if (this.destroyed) {
      this.room.destroy()
      this.room = null
      return
    }
    // the eye opens somewhere new each time: any heading, at the resting pitch; but a poster already up
    // is the shot the room must open on, or the fade would cut from one heading to another
    clearTimeout(this.posterTimer)
    this.cam.camera = { ...this.room.camera }
    if (!this.poster.classList.contains('up')) this.cam.restore({ yaw: Math.random() * Math.PI * 2, pitch: this.room.camera.pitch })
    // the eye opens at the angle the player set, as the game's would
    this.cam.setRestPitch(radians(getSettings().restPitch))
    this.cam.camera.pitch = clampPitch(this.cam.camera.pitch)
    this.room.resize(this.size.w, this.size.h, dpr())
    this.invalidate()
  }

  /**
   * The Camera settings changed (the settings screen stands over the room):
   * the lens, the eye's height and its rest angle show at once, so a change
   * is seen before it is played. The view tilts by the angle's change rather
   * than snapping to it, as the game's does, so a look under way is kept.
   */
  applySettings() {
    const st = getSettings()
    this.cam.setRestPitch(radians(st.restPitch))
    this.cam.camera.pitch = clampPitch(this.cam.camera.pitch)
    this.room?.applySettings(st)
    this.invalidate()
  }

  /** The screen's grid: the cell size the menus are laid out on, as the level backdrop chose it for its usual floor. */
  private fit() {
    const w = this.el.clientWidth || window.innerWidth
    const hgt = this.el.clientHeight || window.innerHeight
    const cw = Math.min(18, Math.max(11, Math.ceil(Math.max(w / GRID_COLS, hgt / (GRID_ROWS * 1.45)))))
    const ch = Math.round(cw * 1.45)
    const fs = Math.round(cw * 1.55)
    this.grid = { cw, ch }
    this.host.style.setProperty('--cw', cw + 'px')
    this.host.style.setProperty('--ch', ch + 'px')
    this.host.style.setProperty('--fs', fs + 'px')
    this.host.style.setProperty('--fit', (cw - fs * 0.602).toFixed(2) + 'px')
    this.size = { w, h: hgt }
    this.room?.resize(w, hgt, dpr())
    this.invalidate()
    this.onfit?.()
  }

  private invalidate() {
    this.needsRender = true
    if (!this.raf && !document.hidden) this.raf = requestAnimationFrame(this.tick)
  }

  /** The picture of the room at rest, for as long as there is no live room to stand on. */
  private showPoster() {
    if (!this.destroyed) this.poster.classList.add('up')
  }

  /** The player looked: the idle turn lets go and waits; the eye is theirs until they leave it. */
  private interrupt() {
    this.idle = 0
    this.driftEnv = 0
  }

  /** Whether the eye is left alone: no stick, no drag. */
  private get atRest(): boolean {
    return !this.cam.steering && !this.drag
  }

  /**
   * The idle turn: a step of it, once the eye has been left alone a while.
   * Returns whether the camera moved.
   */
  private drift(dt: number): boolean {
    if (this.reducedMotion || !this.room || !this.atRest || !this.el.classList.contains('in')) return false
    this.idle += dt
    if (this.idle < IDLE_DELAY) return false
    this.driftEnv = Math.min(1, this.driftEnv + dt / DRIFT_RAMP)
    const env = this.driftEnv * this.driftEnv * (3 - 2 * this.driftEnv)
    const c = this.cam.camera
    this.cam.restore({ yaw: c.yaw + env * DRIFT_RATE * dt, pitch: c.pitch })
    return true
  }

  /** A frame while something moves; then nothing until something does (the idle turn counts as something). */
  private tick(now: number) {
    this.raf = 0
    const dt = Math.min(0.05, (now - this.last) / 1000 || 0)
    this.last = now
    if (this.cam.update(dt)) {
      this.cam.camera.pitch = clampPitch(this.cam.camera.pitch)
      this.needsRender = true
    } else if (this.drift(dt)) {
      this.needsRender = true
    }
    if (this.needsRender && this.room && !this.lost) {
      this.needsRender = false
      this.room.render(this.cam.camera)
      this.el.classList.add('in')
    }
    const turning = !this.reducedMotion && !!this.room && !this.lost && this.el.classList.contains('in')
    if (this.cam.steering || this.needsRender || turning) this.raf = requestAnimationFrame(this.tick)
  }

  private onVisibility() {
    if (document.hidden) {
      cancelAnimationFrame(this.raf)
      this.raf = 0
      this.last = 0
    } else this.invalidate()
  }

  /** A drag on the scenery looks around, as in the game (game.ts attachPointer); a press that never moves does nothing. */
  private attachPointer() {
    const c = this.el
    c.addEventListener('pointerdown', (ev) => {
      if (this.drag || !this.room) return
      this.interrupt()
      this.drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, x0: ev.clientX, y0: ev.clientY, moved: false }
      c.setPointerCapture(ev.pointerId)
    })
    c.addEventListener('pointermove', (ev) => {
      const d = this.drag
      if (!d || ev.pointerId !== d.id) return
      const dx = ev.clientX - d.x
      const dy = ev.clientY - d.y
      d.x = ev.clientX
      d.y = ev.clientY
      if (!d.moved && Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) < DRAG_SLOP) return
      d.moved = true
      const st = getSettings()
      const k = (Math.PI / Math.max(300, c.clientWidth)) * st.lookSensitivity
      this.cam.lookBy(-dx * k, (st.invertLook ? -dy : dy) * k)
      this.cam.camera.pitch = clampPitch(this.cam.camera.pitch)
      this.invalidate()
    })
    const end = (ev: PointerEvent) => {
      const d = this.drag
      if (!d || ev.pointerId !== d.id) return
      this.drag = null
      if (c.hasPointerCapture(ev.pointerId)) c.releasePointerCapture(ev.pointerId)
      if (d.moved) {
        this.cam.endDrag()
        this.invalidate()
      }
    }
    c.addEventListener('pointerup', end)
    c.addEventListener('pointercancel', end)
  }

}

function radians(deg: number): number {
  return (deg * Math.PI) / 180
}

function clampPitch(p: number): number {
  return Math.max(PITCH_MIN, Math.min(PITCH_MAX, p))
}

function dpr(): number {
  return Math.min(window.devicePixelRatio || 1, ROOM_MAX_DPR)
}


/** Whether this canvas can have a WebGL context at all (a test's DOM, a browser with it off). */
function hasWebGL(canvas: HTMLCanvasElement): boolean {
  if (typeof WebGL2RenderingContext === 'undefined' && typeof WebGLRenderingContext === 'undefined') return false
  try {
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'))
  } catch {
    return false
  }
}
