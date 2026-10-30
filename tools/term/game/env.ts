/**
 * A page for the app to run in, in node: happy-dom's window as the globals,
 * with what happy-dom does not do filled in as the terminal client needs it.
 *
 *  - Gamedata is read from disk: `fetch` of a path (not a URL) reads the file,
 *    and `createImageBitmap` decodes a PNG to an `RgbaBitmap` that carries its
 *    pixels, which render-term draws from.
 *  - `requestAnimationFrame` runs when the terminal draws (`frame`, which the
 *    client calls at the start of each of its frames), so each frame shows
 *    the game as its loop has just moved it, as a browser runs the page's
 *    animation frames just before it paints; on a timer until the terminal
 *    draws, and whenever it stops.
 *  - A canvas's 2D context draws nothing (no canvas here), as the e2e harness
 *    has it; the terminal draws the view and the minimap itself.
 *  - localStorage (settings, the offline player, the saved view) is kept in a
 *    JSON file, so it lasts from one run to the next.
 *  - `reducedMotion`: the player prefers reduced motion
 *    (`prefers-reduced-motion: reduce`), as the app reads it: turns and steps
 *    land at once, and nothing glides or swings, so a move is one frame of
 *    the view sent rather than a stream of them.
 *
 * Import this before anything of the app's.
 */
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { Window } from 'happy-dom'

/** A decoded image with its pixels, standing in for an ImageBitmap. */
export interface RgbaBitmap {
  width: number
  height: number
  rgba: Uint8Array
  close(): void
}

export function isRgbaBitmap(x: unknown): x is RgbaBitmap {
  return !!x && typeof x === 'object' && (x as RgbaBitmap).rgba instanceof Uint8Array
}

export function installPage(stateDir: string, { reducedMotion = false, frameMs = 8 } = {}) {
  const window = new Window({ url: 'http://localhost/', width: 1280, height: 800 })
  const g = globalThis as Record<string, unknown>
  // everything of the window's the global scope lacks, as vitest's happy-dom environment does it
  const keys = new Set([...Object.getOwnPropertyNames(window), ...Object.getOwnPropertyNames(Object.getPrototypeOf(window))])
  for (const k of keys) {
    if (k in g || k === 'constructor') continue
    try {
      const v = (window as unknown as Record<string, unknown>)[k]
      Object.defineProperty(g, k, { value: typeof v === 'function' && !/^[A-Z]/.test(k) ? v.bind(window) : v, configurable: true, writable: true })
    } catch {
      /* a getter that needs a live page */
    }
  }
  // node has events of its own; the page's must be happy-dom's, or its elements refuse them
  for (const k of ['Event', 'EventTarget', 'CustomEvent', 'UIEvent', 'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'FocusEvent', 'InputEvent', 'WheelEvent', 'MessageEvent', 'ErrorEvent']) {
    const v = (window as unknown as Record<string, unknown>)[k]
    if (v) Object.defineProperty(g, k, { value: v, configurable: true, writable: true })
  }
  g.window = window
  g.document = window.document
  g.navigator ??= window.navigator

  // reduced motion, where asked for
  if (reducedMotion) {
    const matchMedia = window.matchMedia.bind(window)
    const reduce = (q: string) => /prefers-reduced-motion\s*:\s*reduce/.test(q)
    window.matchMedia = (q: string) => (reduce(q) ? Object.defineProperty(matchMedia(q), 'matches', { value: true }) : matchMedia(q))
    g.matchMedia = window.matchMedia
  }

  // localStorage lasts across runs
  const storeFile = path.join(stateDir, 'storage.json')
  try {
    const saved = JSON.parse(fs.readFileSync(storeFile, 'utf8')) as Record<string, string>
    for (const [k, v] of Object.entries(saved)) window.localStorage.setItem(k, v)
  } catch {
    /* first run */
  }
  let storeTimer: NodeJS.Timeout | null = null
  const persist = () => {
    const out: Record<string, string> = {}
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)!
      out[k] = window.localStorage.getItem(k)!
    }
    fs.mkdirSync(stateDir, { recursive: true })
    fs.writeFileSync(storeFile, JSON.stringify(out))
  }
  const later = () => {
    if (!storeTimer) storeTimer = setTimeout(() => ((storeTimer = null), persist()), 200)
  }
  // happy-dom's storage takes no methods of ours (it keeps what is set on it as items), so the page is given one
  // that saves each change
  const store = window.localStorage
  const saving: Storage = {
    get length() {
      return store.length
    },
    key: (i) => store.key(i),
    getItem: (k) => store.getItem(k),
    setItem: (k, v) => (store.setItem(k, v), later()),
    removeItem: (k) => (store.removeItem(k), later()),
    clear: () => (store.clear(), later()),
  }
  Object.defineProperty(window, 'localStorage', { value: saving, configurable: true })
  g.localStorage = saving

  // gamedata from disk
  const netFetch = globalThis.fetch.bind(globalThis)
  g.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.startsWith('/') && fs.existsSync(url.split('?')[0])) {
      const file = url.split('?')[0]
      const type = file.endsWith('.png') ? 'image/png' : file.endsWith('.json') ? 'application/json' : 'text/javascript'
      return new Response(fs.readFileSync(file), { headers: { 'content-type': type } })
    }
    return netFetch(input as string, init)
  }
  g.createImageBitmap = async (blob: Blob): Promise<RgbaBitmap> => {
    const { data, info } = await sharp(Buffer.from(await blob.arrayBuffer())).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    return { width: info.width, height: info.height, rgba: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), close() {} }
  }

  // the game's loop in step with the terminal's frames: the callbacks asked for, run together when it draws
  let next = 1
  const waiting = new Map<number, (t: number) => void>()
  /** when the terminal last drew, and the timer that runs the callbacks where it has not for a while */
  let drawnAt = -Infinity
  let fallback: NodeJS.Timeout | null = null
  const frame = (now = performance.now()) => {
    if (fallback) clearTimeout(fallback)
    fallback = null
    // those asked for during this frame wait for the next, as a browser's do
    const due = [...waiting]
    waiting.clear()
    for (const [, cb] of due) cb(now)
  }
  g.requestAnimationFrame = (cb: (t: number) => void) => {
    const id = next++
    waiting.set(id, cb)
    // until the terminal draws, and once it has stopped, on a timer
    fallback ??= setTimeout(
      () => {
        fallback = null
        frame()
      },
      performance.now() - drawnAt < FALLBACK_MS ? FALLBACK_MS : frameMs,
    )
    return id
  }
  g.cancelAnimationFrame = (id: number) => void waiting.delete(id)
  window.requestAnimationFrame = g.requestAnimationFrame as typeof window.requestAnimationFrame
  window.cancelAnimationFrame = g.cancelAnimationFrame as typeof window.cancelAnimationFrame

  // canvases draw nothing
  const contexts = new WeakMap<object, unknown>()
  ;(window.HTMLCanvasElement.prototype as unknown as { getContext: () => unknown }).getContext = function (this: object) {
    let c = contexts.get(this)
    if (!c) contexts.set(this, (c = nullContext(this)))
    return c
  }
  return {
    window,
    persist,
    /** A frame of the terminal's: the page's animation frames run now, before it draws. */
    frame: () => {
      drawnAt = performance.now()
      frame(drawnAt)
    },
  }
}

/** How long after the terminal last drew the page's animation frames wait for it before they run on their own, ms. */
const FALLBACK_MS = 100

/** A canvas 2D context that draws nothing and answers what is read back with zeros (e2e client.ts). */
function nullContext(canvas: object): unknown {
  const props: Record<string | symbol, unknown> = { canvas }
  const fn = () => undefined
  const answers: Record<string, unknown> = {
    measureText: () => ({ width: 0, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0 }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(0, w * h * 4)) }),
    createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(0, w * h * 4)) }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    createLinearGradient: () => ({ addColorStop: fn }),
    createRadialGradient: () => ({ addColorStop: fn }),
    createPattern: () => ({}),
    isPointInPath: () => false,
  }
  return new Proxy(props, {
    get: (t, k) => (k in t ? t[k] : typeof k === 'string' && k in answers ? answers[k] : fn),
    set: (t, k, v) => {
      t[k] = v
      return true
    },
  })
}
