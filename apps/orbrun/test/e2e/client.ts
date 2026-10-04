/**
 * The e2e client: the app's own Session and GameScreen, with only the map
 * renderer stubbed (happy-dom has no WebGL). Keys go in as real keydown
 * events on the window and pad buttons as the pad events GamepadInput would
 * emit, so every input takes the route it takes in the browser; what reaches
 * crawl is recorded as it is sent.
 *
 * Two ways to run it, one code path:
 *  - live (`startLive`): crawl itself, in this process (engine.ts), behind
 *    the real LocalWasmConnection. Everything crawl sends is recorded, one
 *    step per `settle()`.
 *  - replay (`startReplay`): a recording fed back step by step, no engine.
 *    The client ends up exactly where the live one was, in milliseconds, so
 *    every input can be tried from the same screen. What the client sends
 *    while it replays must match what it sent live, or the replay says so.
 *
 * `settle()` is the only wait: it runs until crawl is idle and every message
 * it sent has been applied, then draws one frame, so a test reads the screen
 * exactly as the player would see it after the input.
 */
import { readFileSync } from 'node:fs'
import { vi } from 'vitest'
import { LocalWasmConnection } from '@orbrun/offline'
import type { ClientMessage, CloseReason, Connection, GameState, ServerMessage } from '@orbrun/webtiles'
import type { MapRenderer } from '@orbrun/scene'
import type { Button, PadEvent } from '../../src/gamepad'
import type { Context } from '../../src/context'
import type { InputDevice } from '../../src/game'
import { DIST, channel, inProcessEngine, type InProcessEngine } from './engine'

// gamedata from engine/dist on disk, without the atlases' pixels (nothing here draws), loaded once per version
vi.mock('@orbrun/gamedata', async (orig) => {
  const real = await orig<typeof import('@orbrun/gamedata')>()
  const loaded = new Map<string, ReturnType<typeof real.loadGamedata>>()
  return {
    ...real,
    browserIo: () => ({
      fetchText: async (url: string) => readFileSync(url, 'utf8'),
      loadImage: async () => ({ width: 1, height: 1, close() {} }) as unknown as ImageBitmap,
    }),
    loadGamedata: (o: Parameters<typeof real.loadGamedata>[0]) => {
      const key = o.base + '|' + o.version
      let p = loaded.get(key)
      if (!p) {
        // shared by every client of the run: a session closing must not dispose it under the next one
        p = real.loadGamedata({ ...o, signal: undefined, skipImages: true }).then((gd) => Object.assign(gd, { dispose() {} }))
        loaded.set(key, p)
      }
      return p
    },
  }
})

// the 2D view's surface (game.ts calls setOptions on a 2D renderer), drawing nothing
const noRenderer = (): MapRenderer =>
  ({
    setOptions() {},
    mount() {},
    setTiles() {},
    setScene() {},
    setCamera() {},
    setCursor() {},
    render() {},
    pick: () => null,
    resize() {},
    destroy() {},
  }) as MapRenderer

/** What a test needs of the screen, which keeps these private. */
interface ScreenInternals {
  ctx: Context
  dirty: boolean
  loop(now: number): void
  pad(ev: PadEvent): void
  back(): void
  destroy(): void
}

/** An input the client was given, as a recording keeps it. */
export type Input =
  | { kind: 'key'; key: string; mods?: { shift?: boolean; ctrl?: boolean; alt?: boolean } }
  | { kind: 'padDown'; button: Button }
  | { kind: 'padUp'; button: Button; heldMs: number }
  | { kind: 'dir'; dir: 0 | 2 | 4 | 6 | null }
  | { kind: 'raw'; text: string }
  | { kind: 'message'; msg: ClientMessage }

/** One settle: the input that started it (none for a wait), and what crawl sent before it was over. */
interface Step {
  input?: Input
  msgs: ServerMessage[]
}

/** What happened, one step per settle, and everything the client sent along the way. */
export interface Recording {
  channel: string
  device: InputDevice
  steps: Step[]
  sent: ClientMessage[]
}

export interface LiveOptions {
  channel?: string
  /** after the server's own: `-seed`, `-species`, `-background`, `-wizard` */
  args?: string[]
  /** files in the save dir before the game starts, by path relative to it */
  files?: Record<string, Uint8Array>
  device?: InputDevice
}

export interface E2e {
  state(): GameState
  ctx(): Context
  /** every message the client sent crawl since the last `clearSent` */
  sent: ClientMessage[]
  clearSent(): void
  /** crawl's own stderr (live only), for a failure's report */
  log(): string[]
  /** the overlay stack's DOM, as the player sees it */
  root: HTMLElement
  /** one keyboard key: `'Enter'`, `'a'`, `'ArrowDown'`, with modifiers */
  key(key: string, mods?: { shift?: boolean; ctrl?: boolean; alt?: boolean }): Promise<void>
  /** a whole string typed on the keyboard, one key each */
  type(text: string): Promise<void>
  /** one pad button, pressed and released */
  press(button: Button, heldMs?: number): Promise<void>
  /** pad buttons pressed one after another faster than crawl answers: one settle, after the last */
  burst(buttons: Button[]): Promise<void>
  /** one d-pad direction: 0 up, 2 right, 4 down, 6 left */
  dpad(dir: 0 | 2 | 4 | 6): Promise<void>
  /** a click on an element of the screen */
  click(el: Element): Promise<void>
  /** any recorded input, applied as live */
  apply(i: Input): Promise<void>
  /** Android's back button (GameScreen.back) */
  back(): Promise<void>
  /** keys sent straight to crawl, around the client: a scenario's setup */
  raw(text: string): Promise<void>
  /** a message sent straight to crawl, around the client */
  rawMessage(msg: ClientMessage): Promise<void>
  settle(): Promise<void>
  /** what happened so far, for a replay */
  recording(): Recording
  close(): void
}

const tick = () => new Promise<void>((r) => setImmediate(r))

/** How long crawl may take to go quiet after an input before the harness calls it hung. */
const SETTLE_MS = 20_000

/**
 * A canvas 2D context that draws nothing (happy-dom has none): every method
 * is a no-op, every property takes what is set, and what a caller reads back
 * to lay out text is a zero-sized answer.
 */
function nullContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
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
  }) as unknown as CanvasRenderingContext2D
}

let stubbed = false
function stubBrowser() {
  if (stubbed) return
  stubbed = true
  const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    let c = contexts.get(this)
    if (!c) contexts.set(this, (c = nullContext(this)))
    return c as never
  })
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
}

/** A connection that plays a recording back: what it is sent is kept, and nothing answers it. */
class ReplayConnection implements Connection {
  readonly kind = 'local-wasm' as const
  readonly gamedataBase = DIST
  open = true
  private handlers = new Set<(m: ServerMessage) => void>()
  private opens = new Set<() => void>()
  send() {}
  onMessage(h: (m: ServerMessage) => void) {
    this.handlers.add(h)
    return () => this.handlers.delete(h)
  }
  onClose(_h: (r: CloseReason) => void) {
    return () => {}
  }
  onOpen(h: () => void) {
    this.opens.add(h)
    queueMicrotask(() => h())
    return () => this.opens.delete(h)
  }
  close() {
    this.open = false
  }
  deliver(msgs: ServerMessage[]) {
    for (const m of msgs) for (const h of this.handlers) h(m)
  }
  /** run once, the first time the client asks whether crawl is idle: the recorded answer arrives after the input */
  onNextSettle: (() => void) | null = null
  idle(): boolean {
    const f = this.onNextSettle
    this.onNextSettle = null
    f?.()
    return true
  }
}

interface Transport {
  conn: Connection
  idle(): boolean
  log(): string[]
  channelId: string
  /** the engine goes quiet before the connection closes (engine.ts `kill`) */
  kill?(): void
}

async function startClient(t: Transport, device: InputDevice, before: (settle: () => Promise<void>) => Promise<void>, afterScreen: (g: E2e, settle: () => Promise<void>) => Promise<void>): Promise<E2e> {
  stubBrowser()
  const [{ Session }, { GameScreen }, { getSettings }] = await Promise.all([import('../../src/session'), import('../../src/game'), import('../../src/servers')])
  const server = { id: 'e2e', name: 'e2e', host: 'e2e', ws: '', http: '', offline: true }
  const session = new Session(server, 'e2e', t.conn)
  const sent: ClientMessage[] = []
  const allSent: ClientMessage[] = []
  session.on((e) => {
    if (e.type === 'sent') {
      sent.push(e.msg)
      allSent.push(e.msg)
    }
  })
  const steps: Step[] = []
  let msgs: ServerMessage[] = []
  let input: Input | undefined
  t.conn.onMessage((m) => msgs.push(m))
  const held = new Set<Button>()
  const host = document.createElement('div')
  document.body.append(host)
  let screen: ScreenInternals | null = null
  let now = 1000

  const settle = async () => {
    // crawl first: it may answer in several flushes, and each flush is delivered on a later tick
    const deadline = Date.now() + SETTLE_MS
    for (;;) {
      await tick()
      if (t.idle() && !session.loading) {
        // two quiet ticks: the connection delivers a flush a tick after crawl wrote it
        await tick()
        await tick()
        if (t.idle() && !session.loading) break
      }
      if (Date.now() > deadline) throw new Error(`crawl did not settle in ${SETTLE_MS} ms; last it said: ${t.log().slice(-3).join(' / ')}`)
    }
    steps.push(input ? { input, msgs } : { msgs })
    msgs = []
    input = undefined
    if (screen) {
      now += 16
      screen.dirty = true
      screen.loop(now)
    }
  }

  /** Give the client one input, as the browser or the pad would, and settle. */
  const apply = async (i: Input) => {
    input = i
    switch (i.kind) {
      case 'key': {
        window.dispatchEvent(keydown(i.key, i.mods ?? {}))
        break
      }
      case 'padDown':
        held.add(i.button)
        screen!.pad({ type: 'press', button: i.button, t: now })
        break
      case 'padUp':
        held.delete(i.button)
        screen!.pad({ type: 'release', button: i.button, t: now + i.heldMs, held: i.heldMs })
        break
      case 'dir':
        screen!.pad({ type: 'dir', dir: i.dir, source: 'dpad' })
        break
      case 'raw':
        session.send({ msg: 'input', text: i.text })
        break
      case 'message':
        session.send(i.msg)
        break
    }
    await settle()
  }

  if (!t.conn.open) await new Promise<void>((r) => t.conn.onOpen(() => r()))
  await before(settle)
  const gs = new GameScreen(host, session, {
    settings: () => ({ ...getSettings(), renderer: '2d' }),
    settingsPanel: () => ({ el: document.createElement('div'), rows: [] }),
    onSystem() {},
    gamepad: { kind: 'xbox', isHeld: (b: Button) => held.has(b) } as never,
    initialInput: device,
    renderer: noRenderer,
  })
  screen = gs as unknown as ScreenInternals

  const e2e: E2e = {
    state: () => session.state,
    ctx: () => screen!.ctx,
    sent,
    clearSent: () => void sent.splice(0),
    log: t.log,
    root: host,
    apply,
    key: (key, mods) => apply(mods ? { kind: 'key', key, mods } : { kind: 'key', key }),
    async type(text) {
      for (const ch of text) await e2e.key(ch)
    },
    async press(button, heldMs = 50) {
      await apply({ kind: 'padDown', button })
      await apply({ kind: 'padUp', button, heldMs })
    },
    async burst(buttons) {
      for (const button of buttons) {
        held.add(button)
        screen!.pad({ type: 'press', button, t: now })
        held.delete(button)
        screen!.pad({ type: 'release', button, t: now + 50, held: 50 })
      }
      await settle()
    },
    async dpad(dir) {
      await apply({ kind: 'dir', dir })
      await apply({ kind: 'dir', dir: null })
    },
    async click(el) {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      await settle()
    },
    async back() {
      screen!.back()
      await settle()
    },
    raw: (text) => apply({ kind: 'raw', text }),
    rawMessage: (msg) => apply({ kind: 'message', msg }),
    settle,
    recording: () => ({ channel: t.channelId, device, steps: steps.map((s) => ({ ...s })), sent: allSent.slice() }),
    close() {
      t.kill?.()
      screen?.destroy()
      session.close()
      host.remove()
    },
  }
  await afterScreen(e2e, settle)
  return e2e
}

/** The game on crawl itself: log in, Play, and a GameScreen over it, as the front end does. */
export async function startLive(o: LiveOptions = {}): Promise<E2e> {
  const ch = channel(o.channel ?? 'stable')
  const engine: InProcessEngine = inProcessEngine(o.args ?? [])
  Object.assign(engine.files, o.files ?? {})
  const conn = new LocalWasmConnection({ channels: [ch], engineBase: () => '', gamedataBase: DIST, launch: engine.launch })
  return startClient(
    { conn, idle: engine.idle, log: () => engine.log, channelId: ch.id, kill: engine.kill },
    o.device ?? 'keyboard',
    async (settle) => {
      conn.send({ msg: 'token_login', cookie: 'offline:e2e' })
      conn.send({ msg: 'play', game_id: ch.id })
      await settle()
    },
    (_g, settle) => settle(),
  )
}

/**
 * A recording played back into a fresh client, step by step: each step's
 * input applied as it was live, then what crawl answered delivered, then a
 * frame. What the client sends along the way must be what it sent live: a
 * replay that drifts from its recording is a harness bug, and throws.
 */
export async function startReplay(rec: Recording): Promise<E2e> {
  const conn = new ReplayConnection()
  const [first, ...rest] = rec.steps
  const g = await startClient(
    { conn, idle: () => conn.idle(), log: () => [], channelId: rec.channel },
    rec.device,
    async (settle) => {
      conn.deliver(first?.msgs ?? [])
      await settle()
    },
    async (g) => {
      for (const s of rest) {
        // the step's own messages go in once its input has been given, before its frame
        const pending = s.msgs
        conn.onNextSettle = () => conn.deliver(pending)
        if (s.input) await g.apply(s.input)
        else await g.settle()
      }
    },
  )
  // `menu_scroll` goes out on a wall-clock timer (overlays.ts `scheduleScrollSync`, 100 ms after the hover moves), so
  // whether it lands inside a step depends on how loaded the machine is; it only reports the rows in view, and a
  // replay's answers are recorded, so leaving it out of the comparison loses nothing the replay depends on
  const strip = (l: ClientMessage[]) => JSON.stringify(l.filter((m) => m.msg !== 'token_login' && m.msg !== 'play' && m.msg !== 'menu_scroll'))
  if (strip(g.sent) !== strip(rec.sent)) throw new Error(`replay drifted from its recording:\n live   ${strip(rec.sent)}\n replay ${strip(g.sent)}`)
  g.clearSent()
  return g
}

/** The unshifted and shifted characters of a US keyboard's symbol keys: code, keyCode. */
const US_SYMBOLS: [string, string, string, number][] = [
  ['1', '!', 'Digit1', 49], ['2', '@', 'Digit2', 50], ['3', '#', 'Digit3', 51], ['4', '$', 'Digit4', 52], ['5', '%', 'Digit5', 53],
  ['6', '^', 'Digit6', 54], ['7', '&', 'Digit7', 55], ['8', '*', 'Digit8', 56], ['9', '(', 'Digit9', 57], ['0', ')', 'Digit0', 48],
  ['-', '_', 'Minus', 189], ['=', '+', 'Equal', 187], ['[', '{', 'BracketLeft', 219], [']', '}', 'BracketRight', 221],
  ['\\', '|', 'Backslash', 220], [';', ':', 'Semicolon', 186], ["'", '"', 'Quote', 222], [',', '<', 'Comma', 188],
  ['.', '>', 'Period', 190], ['/', '?', 'Slash', 191], ['`', '~', 'Backquote', 192],
]
const NAMED: Record<string, [string, number]> = {
  Enter: ['Enter', 13], Escape: ['Escape', 27], Tab: ['Tab', 9], Backspace: ['Backspace', 8], ' ': ['Space', 32],
  ArrowUp: ['ArrowUp', 38], ArrowDown: ['ArrowDown', 40], ArrowLeft: ['ArrowLeft', 37], ArrowRight: ['ArrowRight', 39],
  PageUp: ['PageUp', 33], PageDown: ['PageDown', 34], Home: ['Home', 36], End: ['End', 35], Delete: ['Delete', 46], Insert: ['Insert', 45],
}

/**
 * The keydown a US-layout browser fires for `key`: its `code`, its legacy
 * `keyCode` (which keys.ts reads first, as the official client reads
 * `which`) and Shift where the character needs it. `%` is Shift+Digit5 with
 * keyCode 53, not a bare 37, which is the left arrow's.
 */
function keyEventInit(key: string, mods: { shift?: boolean; ctrl?: boolean; alt?: boolean }): KeyboardEventInit & { keyCode: number } {
  let code = key
  let keyCode = 0
  let shift = !!mods.shift
  if (key in NAMED) [code, keyCode] = NAMED[key]
  else if (/^F\d{1,2}$/.test(key)) keyCode = 111 + Number(key.slice(1))
  else if (/^[a-z]$/i.test(key)) {
    code = 'Key' + key.toUpperCase()
    keyCode = key.toUpperCase().charCodeAt(0)
    if (key !== key.toLowerCase()) shift = true
  } else {
    const row = US_SYMBOLS.find((r) => r[0] === key || r[1] === key)
    if (!row) throw new Error(`no US-layout key for ${JSON.stringify(key)}`)
    code = row[2]
    keyCode = row[3]
    if (row[1] === key) shift = true
  }
  return { key, code, keyCode, shiftKey: shift, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, bubbles: true, cancelable: true }
}

function keydown(key: string, mods: { shift?: boolean; ctrl?: boolean; alt?: boolean }): KeyboardEvent {
  const init = keyEventInit(key, mods)
  const ev = new KeyboardEvent('keydown', init)
  // happy-dom leaves the legacy field at 0 whatever the init says
  if (ev.keyCode !== init.keyCode) Object.defineProperty(ev, 'keyCode', { value: init.keyCode })
  return ev
}
