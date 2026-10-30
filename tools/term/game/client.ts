/**
 * The whole game in a terminal: the app's own Session and its rules for the
 * eye (pilot.ts: the camera after the feet, the context) and the keys
 * (keys.ts, runner.ts), run in node on the offline engine with no page,
 * laid out as the browser lays the game out, in nothing but the terminal's
 * cells, so any terminal with truecolour plays it, here or over SSH.
 *
 *  - the 3D view over the whole terminal as the glyph view's cells
 *    (view.ts): the level cast a ray a column, its walls as render-3d
 *    stands them, what stands drawn finer, the hands over all, each cell a
 *    glyph of the mosaic in the two colours that show it best;
 *  - over it, each on the view darkened under its text: the stats pane at
 *    the top-left (grid/stats.ts, the app's own rows), the minimap at the
 *    top-right in half blocks with the cone the view faces and the monster list under it, the messages along
 *    the bottom (grid/messages.ts);
 *  - crawl's menus, popups, CRT screens and prompts as console crawl draws
 *    them, read from the game's state (screens.ts), a box over the view;
 *  - the level map (X) as crawl's own glyphs.
 *
 * Each frame is one grid of cells, written as only the cells that changed
 * since the last (glyph/render.ts `ansiInto`). Keys go to crawl as console
 * crawl takes them, but for a step or a turn, which is the app's own, taken
 * as the way the view faces (runner.ts), and what the official client keeps
 * for itself in a menu or a popup (screens.ts). `io` is the terminal:
 * `write(s)` (settles once taken), `cols`, `rows`, `onInput`, `onResize`,
 * `end()`.
 */
import fs from 'node:fs'
import path from 'node:path'
import { installNode } from './env'
import type { OfflineChannel } from '@orbrun/offline'
import type { CrispCell, Home as HomeScreen, Logo } from './home'
import type { TermConfig } from './config'
import { PALETTE, cut, lineLength, type Line, type RGB } from './text'
import { terminalKeys } from './input'
import type { Box } from './screens'
import type { KeyLike } from '../../../apps/orbrun/src/keys'
import type { Context } from '../../../apps/orbrun/src/context'
import type { RelDir } from '../../../apps/orbrun/src/bindings'
import { ANSI_BAND, ANSI_CELL, ansiInto } from '../glyph/render'
import { OCTANTS, SEXTANTS, inked } from '../glyph/shapes'
// @ts-expect-error: plain JS
import { synced } from '../frame.mjs'
import type { Dir8 } from '@orbrun/scene'

export interface Io {
  cols: number
  rows: number
  write(s: string): Promise<void>
  onInput(fn: (d: Buffer) => void): void
  onResize(fn: (cols: number, rows: number) => void): void
  end(code?: number): void
}

/** What the client plays and how (config.ts), where it keeps its state, and the crawl to play straight away, if one was named. */
export interface ClientOptions extends TermConfig {
  stateDir: string
  /** none: the front screen (home.ts), as the browser's, to pick a game */
  channel?: OfflineChannel
  /** another player picked on the front screen, to start as the next time (main.ts) */
  remember?(name: string): void
}

/** The key that leaves, saving first: Ctrl-\, which crawl does not use. */
const QUIT = '\x1c'
const PANE_BG: RGB = [10, 10, 14]
const BLACK: RGB = [0, 0, 0]
/** the share of the terminal's width the stats pane takes, up to the app's own width */
const STATS_SHARE = 0.3
/** how much of the view shows under the HUD's text and its padding: a light shadow, not a backing */
const PANE_SHADE = 0.7
/** the brightest the view is left under text (luminance, 0..255): enough for the game's palest text to read on */
const TEXT_GROUND = 60
/**
 * Asked of the terminal at the start: its cell's size in pixels (CSI 16 t),
 * for the shape of a cell; then its attributes (DA1), which every terminal
 * answers, last, so that answer says the others are in. The answers come
 * back as input, and are taken out of it before the keys.
 */
const PROBE = '\x1b[16t\x1b[c'
const PROBE_REPLY = /\x1b\[6;(\d+);(\d+)t|\x1b\[\?([\d;]*)c|\x1b_G[^\x1b]*\x1b\\|\x1bP>\|[^\x1b]*\x1b\\/g
/** how long the terminal has to answer the probe before the cell is taken to be twice as tall as it is wide */
const PROBE_WAIT_MS = 1500
/** how dark the pause vignette over the view is, in its middle and at its edges (styles.css `.more-scrim`) */
const SCRIM_MIDDLE = 0.25
const SCRIM_EDGE = 0.55
/** the level map's cursor, and how near an edge it may come before the map moves */
const MAP_CURSOR: RGB = [255, 200, 60]
const MAP_EDGE = 4
/** monster_list.js: at most this many rows */
const MONSTER_ROWS = 5
/** the attitude colours of the monster list's names (styles.css `.monsters .name`) */
const ATTITUDE: Record<string, RGB> = { hostile: [0xff, 0x8a, 0x8a], neutral: [0xff, 0xe0, 0x8a], good_neutral: [0xd8, 0xff, 0xa0], friendly: [0x8a, 0xff, 0x8a] }
const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖']
const TEXT: RGB = PALETTE[7]
/** the lit row of a popup, and the focused item anywhere (styles.css `.popup li.hovered`: a fifth of gold over the box) */
const LIT_BG: RGB = [59, 50, 30]
/** a popup's box and border (styles.css `.popup`), how far it hangs from the top, in rows, and how narrow it may be */
const POPUP_BG: RGB = [10, 10, 14]
const BORDER: RGB = [85, 85, 85]
const POPUP_TOP = 3
const POPUP_MIN_W = 40
/** crawl's console is eighty columns: its menus and screens are written for that, and wrap no wider */
const POPUP_MAX_W = 80
const MORE: RGB = [0xaa, 0xaa, 0xaa]
/** how a cell of the frame is had: the view's, its own, or its own text on the view darkened */
const VIEW = 0
const SOLID = 1
const SHADE = 2

export async function runGame(io: Io, o: ClientOptions) {
  // ORBRUN_TERM_TRACE=1: when each step of starting up was reached, in <state>/trace.log
  const t0 = performance.now()
  const trace = (what: string) => {
    if (o.trace) fs.appendFileSync(path.join(o.stateDir, 'trace.log'), `${(performance.now() - t0).toFixed(0).padStart(6)} ms  ${what}\n`)
  }
  trace('start')
  const storage = installNode(o.stateDir)
  const { engine, builtChannels, saveBook, savedCharacters, DIST } = await import('./engine')
  const { TermView } = await import('./view')
  const { Screens } = await import('./screens')
  const { LocalWasmConnection } = await import('@orbrun/offline')
  const { Session } = await import('../../../apps/orbrun/src/session')
  const { CameraController } = await import('../../../apps/orbrun/src/camera')
  const { Runner } = await import('../../../apps/orbrun/src/runner')
  const { Pilot, serverCursor } = await import('../../../apps/orbrun/src/pilot')
  const { directionKey, keydownMessage } = await import('../../../apps/orbrun/src/keys')
  const { getSavedView, getSettings, leftRightTurns, saveSettings, saveView, OFFLINE_SERVER, WALL_INSET } = await import('../../../apps/orbrun/src/servers')
  const { fovOf } = await import('../../../apps/orbrun/src/settings-rows')
  const { viewmodelFor } = await import('@orbrun/scene-webtiles')
  const { UiState } = await import('@orbrun/webtiles')
  const { STATUS_BADGE_ROWS, minimapFit } = await import('../../../apps/orbrun/src/hud')
  const { facingArrow } = await import('./minimap')
  const { typedInLog } = await import('../../../apps/orbrun/src/bindings')
  const { statsRows } = await import('../../../apps/orbrun/src/grid/stats')
  const { STAT_WIDTH } = await import('../../../apps/orbrun/src/grid/console')
  const { paneRows } = await import('../../../apps/orbrun/src/grid/messages')
  const { bearingTo, cellKey, rotateDir } = await import('@orbrun/scene')
  const { monsterGroups } = await import('@orbrun/scene-webtiles')
  const { Home, loadRoom, loadLogo, loadTitle, crisp, veilAt, veiled, barAt, LOGO_GROUND } = await import('./home')
  const { exploreOptions } = await import('../../../apps/orbrun/src/settings-rows')
  trace('modules')

  const channels = builtChannels()
  // the front screen's place and logo
  const [room, logo] = await Promise.all([loadRoom(), loadLogo()])
  /** what the view is drawing: the front room, the game, or neither yet */
  let showing: 'room' | 'game' | null = null

  // the game's settings to start with: written over what it saved, as the browser's Settings menu would
  if (Object.keys(o.settings).length) saveSettings({ ...getSettings(), ...o.settings })
  // the player: whose saves these are, which the front screen's Accounts changes
  let player = o.name
  const savesRoot = path.join(o.stateDir, 'saves')
  const saves = () => path.join(savesRoot, player)
  const eng = engine(saves())
  // the explore delay the Settings ask for, as the browser's games are given it (session.ts)
  const conn = new LocalWasmConnection({ channels, engineBase: () => '', gamedataBase: DIST, launch: eng.launch, username: player, saves: saveBook(saves, channels), options: (rc) => exploreOptions(getSettings(), rc) })
  const session = new Session(OFFLINE_SERVER, player, conn)

  let cols = io.cols
  let rows = io.rows
  let dirty = true
  let ended = false
  /** the next frame's timer; null while a frame is being made, which sets the next itself */
  let next: NodeJS.Timeout | null = null
  /**
   * A frame now rather than when the next is due: a key pressed, or crawl's
   * answer to one, is on the screen in the time a frame takes to make, not
   * that and however long the frame's timer had left to run.
   */
  const soon = () => {
    if (!next) return
    clearTimeout(next)
    next = null
    setImmediate(tick)
  }
  const view = new TermView(() => (dirty = true), o.view)

  // the eye: the camera as the last game left it, flown after the feet by the app's own rules (pilot.ts); the keys'
  // steps and turns by the runner's, taken as the way the view faces
  const cam = new CameraController()
  cam.reducedMotion = o.reducedMotion
  const saved = getSavedView()
  if (saved) cam.restore(saved)
  const settings = () => getSettings()
  let ctx: Context
  const runner = new Runner(session, cam, {
    context: () => ctx,
    // the browser's own panels, the on-screen keyboard and the status line have no terminal of their own
    ui() {},
    osk() {},
    menu() {},
    focus() {},
    status() {},
    confirmDangerous: () => settings().confirmStairs,
    now: () => performance.now(),
    swing: () => view.attack(),
  })
  const newPilot = () => new Pilot(session, cam, runner, { newLevel: () => view.resetMotion() })
  let pilot = newPilot()
  ctx = pilot.context()
  const screens = new Screens()
  const applySettings = () => {
    const s = settings()
    cam.setRestPitch((s.restPitch * Math.PI) / 180)
    view.setOptions({ fov: fovOf(s, false, false), eyeHeight: s.eyeHeight, viewmodel: s.viewmodel, wallInset: WALL_INSET, motion: !o.reducedMotion })
    // the front room at the angle the player set, as the browser's (room/view.ts `applySettings`)
    if (room) {
      room.camera = { ...room.camera, pitch: (s.restPitch * Math.PI) / 180 }
      if (showing === 'room') view.setCamera(room.camera)
    }
  }
  applySettings()
  /** when the scene was rebuilt inside a frame: the frame's time, so the glide starts on it */
  let sceneTime: number | undefined

  await new Promise<void>((r) => (conn.open ? r() : conn.onOpen(() => r())))
  trace('connected')
  conn.send({ msg: 'token_login', cookie: `offline:${player}` })
  let rev = -1
  conn.onClose(() => void quit(false))
  /** Out of a game, at the start and after each (death, save and exit, quit): the front screen (home.ts). Null while a game is on. */
  let home: HomeScreen | null = null
  /** the crawl last played, focused when the front screen comes back */
  let last = o.channel
  const openHome = (after: boolean) => {
    const reason = session.state.exit?.reason
    const why = after ? session.state.exit?.message || (reason && ENDED[reason]) || reason || 'The game is over.' : null
    home = new Home(
      {
        player: () => player,
        // the account's character in each: crawl plays it by the account's name (offline server `play`)
        games: () => channels.map((ch) => ({ ch, save: savedCharacters(saves(), ch).find((c) => c.name === player) ?? null })),
        accounts: () => {
          const here = fs.existsSync(savesRoot) ? fs.readdirSync(savesRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : []
          return [...new Set([...here, player])].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
        },
        remove: (name) => {
          if (name !== player && /^[A-Za-z0-9_-]{1,20}$/.test(name)) fs.rmSync(path.join(savesRoot, name), { recursive: true, force: true })
        },
        changed: () => {
          applySettings()
          dirty = true
        },
      },
      why,
      last,
    )
    dirty = true
    soon()
  }
  /** play as `name` from now on: their saves, their games on the front screen */
  const switchTo = (name: string) => {
    player = name
    eng.setHostDir(saves())
    conn.send({ msg: 'token_login', cookie: `offline:${player}` })
    o.remember?.(name)
    last = undefined
    home?.showHome()
  }
  const play = (ch: OfflineChannel) => {
    home = null
    last = ch
    nudged = false
    pilot = newPilot()
    conn.send({ msg: 'play', game_id: ch.id })
    dirty = true
  }
  let firstScene = true
  let nudged = false
  session.on((e) => {
    if (e.type === 'gamedata' && e.status !== 'loading') trace('gamedata ' + e.status)
    if (e.type === 'sent') trace('-> ' + JSON.stringify(e.msg).slice(0, 120))
    if (e.type === 'state') trace('<- ' + (['input_mode', 'layout', 'msgs', 'ui-push', 'ui-state', 'ui-state-sync', 'menu'].includes(String(e.msg.msg)) ? JSON.stringify(e.msg).slice(0, 300) : e.msg.msg))
    if (e.type === 'state' && (e.msg.msg === 'game_started' || e.msg.msg === 'game_client')) trace(e.msg.msg)
    if (e.type === 'gamedata' && e.status === 'ready' && session.gamedata && !home) {
      view.setTiles(session.gamedata)
      showing = 'game'
    }
    if (e.type === 'state') {
      pilot.trackHop()
      if (e.msg.msg === 'input_mode' && pilot.payOwedTurn()) dirty = true
    }
    if (e.type === 'scene') {
      if (firstScene && e.scene.cells.size) {
        firstScene = false
        trace('first map')
      }
      pilot.onScene(sceneTime ?? performance.now() / 1000)
      if (!home) view.setScene(e.scene)
    }
    // crawl, having loaded a save, draws nothing until it has handled a first command, and says nothing of it: a
    // player in a browser presses a key without knowing; here the screen would stay blank. Ctrl-R, crawl's own
    // redraw, is that command, and does nothing else.
    if (e.type === 'state' && e.msg.msg === 'input_mode' && e.msg.mode === 1 && !session.scene.cells.size && !nudged) {
      nudged = true
      setTimeout(() => {
        if (!session.scene.cells.size) session.send({ msg: 'key', keycode: 18 })
      }, 300)
    }
    // crawl has moved the game on (a step taken, a monster's turn): on the screen at once
    if (e.type === 'scene') soon()
    // the save is on disk before the menu reads it
    if (e.type === 'state' && e.msg.msg === 'go_lobby') void eng.sync().then(() => !ended && openHome(true))
  })
  if (o.channel) play(o.channel)
  else openHome(false)

  // what the terminal said of itself: its cell in pixels
  let cellPx = { w: 8, h: 16 }
  /** the terminal has answered the probe, all of it */
  let answered: () => void = () => {}
  const probed = new Promise<void>((r) => (answered = r))
  /** the frame on the screen, packed as the view's cells are; null to write the next whole */
  let shown: Int32Array | null = null
  io.onInput((d) => {
    const raw = d.toString('latin1')
    const rest = raw.replace(PROBE_REPLY, (_m, h: string | undefined, w: string | undefined, da: string | undefined) => {
      if (da !== undefined) answered()
      else if (Number(h) > 0 && Number(w) > 0) cellPx = { w: Number(w), h: Number(h) }
      dirty = true
      return ''
    })
    if (rest !== raw) {
      if (!rest) return
      d = Buffer.from(rest, 'latin1')
    }
    const s = d.toString('utf8')
    if (s.includes(QUIT)) return void quit(!home)
    if (home) {
      for (const k of terminalKeys(d)) {
        const act = home?.key(k)
        if (act?.kind === 'play') play(act.ch)
        else if (act?.kind === 'switch') switchTo(act.name)
        else if (act?.kind === 'quit') void quit(false)
      }
      dirty = true
      soon()
      return
    }
    for (const k of terminalKeys(d)) {
      try {
        key(k)
      } catch (e) {
        // a key the page could not take is no reason to lose the game
        fs.appendFileSync(path.join(o.stateDir, 'errors.log'), `${new Date().toISOString()} key ${k.key}: ${(e as Error).stack ?? e}\n`)
      }
    }
    dirty = true
    soon()
  })
  /**
   * A key: to the screen up over the game where it keeps the key for itself (screens.ts); a direction in the
   * dungeon or while aiming as the way the view faces, a step, a run, an attack or a turn (runner.ts); anything
   * else to crawl, as the official client sends it (keys.ts).
   */
  function key(k: KeyLike) {
    const send = (m: Parameters<typeof runner.send>[0]) => runner.send(m)
    if (screens.key(session.state, k, send)) return
    ctx = pilot.context()
    if (ctx.mode === 'command' || ctx.mode === 'targeting') {
      const d = directionKey(k)
      if (d) {
        runner.step(d.abs as RelDir, { run: d.mod === 'shift', attack: d.mod === 'ctrl', turns: leftRightTurns(d.source, settings()) })
        return
      }
    }
    const msg = keydownMessage(k)
    if (msg) runner.send(msg)
  }

  io.onResize((c, r) => {
    cols = c
    rows = r
    shown = null
    void io.write('\x1b[0m\x1b[2J')
    dirty = true
  })
  await io.write('\x1b[?1049h\x1b[?25l\x1b[2J' + PROBE)
  await Promise.race([probed, new Promise((r) => setTimeout(r, PROBE_WAIT_MS))])
  /** how many times taller than wide a cell is: as said, or as the terminal says */
  const aspect = () => o.view.cellAspect ?? cellPx.h / cellPx.w

  /** each screen's title set in the font (home.ts `loadTitle`), once asked for; null while it is set or where it could not be */
  const titles = new Map<string, Logo | null>()
  const titleArt = (text: string): Logo | null => {
    if (!titles.has(text)) {
      titles.set(text, null)
      void loadTitle(text).then((t) => {
        titles.set(text, t)
        dirty = true
      })
    }
    return titles.get(text) ?? null
  }

  // ---- one frame: every cell of the terminal, its text and its colours, over the view where it shows
  /** the view's cells, or null where none is shown */
  const frame = (vc: Int32Array | null): Int32Array => {
    const n = cols * rows
    // the front room under its veil (home.ts `veilAt`), the words' shade taken from it as it shows
    if (vc && home && room) {
      const v = new Int32Array(vc)
      for (let i = 0; i < n; i++) {
        const at = veilAt(room.tint, ((i % cols) + 0.5) / cols, (Math.floor(i / cols) + 0.5) / rows)
        v[i * 3 + 1] = veiled(vc[i * 3 + 1], at)
        v[i * 3 + 2] = veiled(vc[i * 3 + 2], at)
      }
      vc = v
    }
    const char: string[] = new Array(n).fill(' ')
    const fg = new Uint8Array(n * 3)
    const bg = new Uint8Array(n * 3)
    // VIEW: the view's cell shows; SOLID: the cell's own; SHADE: its own text on the view darkened under it
    const mode = new Uint8Array(n)
    /** cells packed whole into the frame (the badges, the logo), by index */
    const packed = new Map<number, [number, number, number]>()
    const put = (x: number, y: number, c: string, f: RGB, b: RGB) => {
      if (x < 0 || y < 0 || x >= cols || y >= rows) return
      const i = y * cols + x
      char[i] = c
      fg.set(f, i * 3)
      bg.set(b, i * 3)
      mode[i] = SOLID
      packed.delete(i)
    }
    const fill = (x: number, y: number, w: number, h: number, b: RGB) => {
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) put(i, j, ' ', TEXT, b)
    }
    const text = (x: number, y: number, line: Line, width: number, b: RGB) => {
      let cx = x
      for (const s of cut(line, width))
        for (const c of s.text) {
          put(cx++, y, c, s.fg ?? TEXT, s.bg ?? (s.lit ? LIT_BG : b))
        }
    }

    /**
     * A screen's box over the view as the browser's popup is (styles.css `.popup`): hung POPUP_TOP rows from the top,
     * or in the middle (`centred`), across the middle; its head and foot standing, its body the page between them, the
     * lit lines lit across the box, with a mark on its border where there is more above or below.
     */
    const popup = (box: Box) => {
      // crawl's whole console where a border would cut it (a CRT screen on an eighty-column terminal): the screen bare
      if (box.wide && cols < POPUP_MAX_W + 4) {
        fill(0, 0, cols, rows, POPUP_BG)
        ;[...box.head, ...box.body.slice(box.scroll), ...box.foot].slice(0, rows).forEach((l, i) => text(0, i, l, cols, POPUP_BG))
        return
      }
      const all = [...box.head, ...box.body, ...box.foot]
      const inner = box.wide ? Math.min(cols - 4, POPUP_MAX_W) : Math.min(cols - 4, Math.max(POPUP_MIN_W, ...all.map(lineLength)))
      const bw = Math.min(cols, inner + 4)
      const top = Math.min(POPUP_TOP, Math.floor(rows / 4))
      const shownBody = Math.min(box.body.length - box.scroll, Math.max(1, rows - 2 * top - 2 - box.head.length - box.foot.length))
      const bh = box.head.length + Math.max(0, shownBody) + box.foot.length + 2
      const bx = Math.floor((cols - bw) / 2)
      const by = box.centred ? Math.max(0, Math.floor((rows - bh) / 2)) : top
      fill(bx, by, bw, bh, POPUP_BG)
      for (let i = bx + 1; i < bx + bw - 1; i++) {
        put(i, by, '─', BORDER, POPUP_BG)
        put(i, by + bh - 1, '─', BORDER, POPUP_BG)
      }
      for (let j = by + 1; j < by + bh - 1; j++) {
        put(bx, j, '│', BORDER, POPUP_BG)
        put(bx + bw - 1, j, '│', BORDER, POPUP_BG)
      }
      put(bx, by, '╭', BORDER, POPUP_BG)
      put(bx + bw - 1, by, '╮', BORDER, POPUP_BG)
      put(bx, by + bh - 1, '╰', BORDER, POPUP_BG)
      put(bx + bw - 1, by + bh - 1, '╯', BORDER, POPUP_BG)
      let row = by + 1
      const line = (l: Line, on: boolean) => {
        if (on) fill(bx + 1, row, bw - 2, 1, LIT_BG)
        text(bx + 2, row++, l, bw - 4, on ? LIT_BG : POPUP_BG)
      }
      for (const l of box.head) line(l, false)
      const bodyTop = row
      for (let i = 0; i < shownBody; i++) line(box.body[box.scroll + i], box.lit.includes(box.scroll + i))
      for (const l of box.foot) line(l, false)
      if (box.scroll > 0) put(bx + bw - 1, bodyTop, '▲', MORE, POPUP_BG)
      if (box.scroll + shownBody < box.body.length) put(bx + bw - 1, bodyTop + shownBody - 1, '▼', MORE, POPUP_BG)
    }

    const st = session.state
    const mapShown = !home && st.uiState === UiState.VIEW_MAP
    if (!mapShown) mapAt = null

    // the HUD over the view, as the browser lays it (hud.ts `layout`): bare, the view left whole round the text
    // a line on the view: each character on the view darkened behind it, as the browser shadows its text
    // (styles.css `.hud .stats` text-shadow) rather than backing it; a blank leaves the view, but where it is a bar
    const inked = new Uint8Array(n)
    const over_ = (x: number, y: number, line: Line, width: number) => {
      if (y < 0 || y >= rows) return
      let cx = x
      for (const s of cut(line, width))
        for (const c of s.text) {
          if (cx >= 0 && cx < cols && (c !== ' ' || s.bg || s.lit)) {
            const i = y * cols + cx
            if (s.lit || s.bg) put(cx, y, c, s.fg ?? TEXT, s.lit ? LIT_BG : s.bg!)
            else {
              char[i] = c
              fg.set(s.fg ?? TEXT, i * 3)
              mode[i] = SHADE
              packed.delete(i)
            }
            inked[i] = 1
          }
          cx++
        }
    }
    /** the shadow a cell further: the view either side of the text darkened as under it */
    const pad = () => {
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x
          if (inked[i] || mode[i] !== VIEW || !((x > 0 && inked[i - 1]) || (x < cols - 1 && inked[i + 1]))) continue
          mode[i] = SHADE
        }
    }
    const playing = !home && st.phase === 'playing' && !!st.player.name && !!session.scene.cells.size
    if (playing) {
      // the stats pane at the top-left, a share of the width as the phone's narrower column is (console.ts `gameSplit`):
      // under 36 cells its rows print the short captions (stats.ts `compactStats`), so a small terminal keeps its view
      const statsW = Math.min(STAT_WIDTH + 2, Math.max(24, Math.round(cols * STATS_SHARE)), cols - 22)
      // the right column: the minimap at the top, a level cell a column and half a row, the monster list under it
      let sideW = Math.min(34, Math.max(20, Math.floor(cols * 0.22)))
      let mapH = 0
      /** the minimap's first column */
      let mapLeft = cols - 1
      const sc = session.scene
      // the minimap and the badges stand down while the level map is open, as the browser's do
      if (!mapShown) {
        // as many tiles across as the settings ask (hud.ts `minimapFit`), as fit in up to a quarter of the width beside
        // the stats pane and half the height; half as many down, a terminal cell being twice as tall as wide
        const set = getSettings()
        const room = { w: Math.max(0, Math.min(Math.floor(cols * 0.25), cols - statsW - 2)), h: Math.floor(rows * 0.5) * 2 }
        const fit = minimapFit(room, 0, set.minimapTiles, 1)
        if (fit.w > 0) {
          const tiles = fit.tiles
          const mapW = tiles
          // an odd count down too, so the player has a middle row as a middle column
          mapH = Math.ceil(tiles / 2) | 1
          sideW = Math.max(sideW, mapW + 2)
          // the level as crawl's console draws it, as the level map (X) does: each known cell crawl's glyph in its
          // colour, what is remembered dimmer, on black, and what is not known the view darkened, as the browser's
          // glyph minimap leaves it; the player in the middle, as the browser's minimap follows the player, an arrow
          // pointing the way the view faces where crawl has its @; the server's cursor (targeting, `x`) on gold, as
          // on the level map
          const left = sc.player.x - (mapW - 1) / 2, top = sc.player.y - (mapH - 1) / 2
          const x0 = (mapLeft = cols - mapW - 1)
          const cur = st.cursors.find((c) => c)
          for (let r = 0; r < mapH; r++)
            for (let c = 0; c < mapW; c++) {
              const i = r * cols + x0 + c
              inked[i] = 1
              const x = left + c, y = top + r
              const cell = sc.cells.get(cellKey(x, y))
              const player = sc.playerOnLevel && x === sc.player.x && y === sc.player.y
              const g = player ? facingArrow(view.camera?.yaw ?? 0) : cell?.glyph || ' '
              if (cur && x === cur.x && y === cur.y) put(x0 + c, r, g, BLACK, MAP_CURSOR)
              else if (player) put(x0 + c, r, g, PALETTE[15], BLACK)
              else if (cell && cell.kind !== 'unknown') {
                const col = PALETTE[(cell.colour ?? 7) & 15] ?? TEXT
                put(x0 + c, r, g, cell.visibility === 'remembered' ? (col.map((v) => v * 0.55) as RGB) : col, BLACK)
              } else {
                mode[i] = SHADE
                char[i] = ' '
              }
            }
        }
      }
      // the status strip (hud.ts `renderStatuses`): the badges on the player, each a square of STATUS_BADGE_ROWS rows in
      // the view's glyphs, in rows leftward from the minimap's left edge, or under it where the stats pane leaves no room
      const me = sc.playerOnLevel ? sc.billboards.find((b) => b.kind === 'player' && b.x === sc.player.x && b.y === sc.player.y) : undefined
      const badges = (me?.statusIcons ?? []).filter((i) => !i.at && !i.square && !i.full)
      let under = 0
      if (badges.length && !mapShown) {
        const bh = Math.min(STATUS_BADGE_ROWS, Math.max(2, mapH)), bw = Math.round(bh * aspect())
        const beside = Math.floor((mapLeft - statsW - 1) / bw)
        const per = Math.max(1, Math.min(badges.length, beside >= 1 ? beside : Math.floor((cols - mapLeft) / bw)))
        badges.forEach((b, k) => {
          const cells = view.tileCells([b.tile], bw, bh, rgb(PANE_BG))
          if (!cells) return
          const x = beside >= 1 ? mapLeft - (k % per + 1) * bw : cols - 1 - (k % per + 1) * bw
          const y = (beside >= 1 ? 0 : mapH) + Math.floor(k / per) * bh
          for (let j = 0; j < bh; j++)
            for (let i = 0; i < bw; i++) {
              if (x + i < 0 || x + i >= cols || y + j >= rows) continue
              const at = (y + j) * cols + x + i, c = (j * bw + i) * 3
              inked[at] = 1
              mode[at] = SOLID
              packed.set(at, [cells[c], cells[c + 1], cells[c + 2]])
            }
        })
        if (beside < 1) under = Math.ceil(badges.length / per) * bh
      }
      const sideX = cols - sideW
      const msgH = Math.min(Math.max(3, st.messages.paneHeight || 5) + 1, Math.floor(rows / 3))
      // the level map (X) in the clear part of the view, as the browser's (console.ts `levelMapSplit`): left of the right
      // column and above the messages, the stats pane over its corner
      if (mapShown) drawMap(put, fill, 0, 0, sideX - 1, rows - msgH)
      // the monster list, but for while the level map is open, as the browser hides it with the minimap: crawl's letter
      // for each where the browser has its sprite, and no edge pips, which a terminal's few cells could not show
      const monH = mapShown ? 0 : drawMonsters(sideX, mapH + under, sideW, rows - mapH - under, over_)
      const s = statsRows(st.player, st.options, statsPrev, statsW - 2)
      statsPrev = s.prev
      const statsH = Math.min(s.rows.length, rows)
      // a cell in from the edge: the padding either side of the text is the edge's
      s.rows.slice(0, statsH).forEach((row, i) => over_(1, i, fromRow(row), statsW - 2))
      // the messages along the bottom, as wide as the right column leaves them
      const reach = mapH + under + monH
      const msgW = rows - msgH < reach ? sideX - 1 : cols
      // a line crawl reads typed in the log itself, as the browser has it (bindings.ts typedInLog)
      const typed = typedInLog(st.textInput) ? st.textInput!.text : undefined
      const pane = paneRows(st.messages, msgH - 1, msgW - 2, 0, typed)
      // the newest line on the last row, or on the one over the --more-- line
      const lines = pane.lines.filter((row) => row.length)
      const foot = pane.more.length ? rows - 2 : rows - 1
      lines.forEach((row, i) => over_(1, foot - (lines.length - 1 - i), fromRow(row), msgW - 2))
      if (pane.more.length) over_(1, rows - 1, fromRow(pane.more), msgW - 2)
      pad()
    }

    // what is up over the game (screens.ts), a box over the view; or, out of a game, the menu of what to play
    const box = home ? null : screens.box(st, Math.min(POPUP_MAX_W, cols - 6), rows - 2 * Math.min(POPUP_TOP, Math.floor(rows / 4)) - 2)
    if (home) {
      // the front screen (home.ts): the logo (or the screen's title) cut sharp on the mosaic's dots, the room behind
      // the dots it leaves, and a cell it all but fills in the view's two colours, for the orb's shading; the words on
      // the room shaded, the focused row on its bar
      const art = home.title === null ? logo : titleArt(home.title)
      const L = home.layout(cols, rows, (w) => (art ? Math.max(1, Math.round((w * art.h) / art.w / aspect())) : 0))
      if (L.art && art) {
        const { x, y, cols: lc, rows: lr } = L.art
        const name = home.title ?? 'logo'
        const sextant = o.view.mosaic === 'sextant'
        const dots = crispOf(name, art, lc, lr, sextant ? 3 : 4)
        const cells = view.imageCells(name, art.rgba, art.w, art.h, lc, lr, LOGO_GROUND)
        for (let r = 0; r < lr; r++)
          for (let c = 0; c < lc; c++) {
            const at = (y + r) * cols + x + c, k = (r * lc + c) * 3, cell = dots[r * lc + c]
            if (!cell || x + c >= cols || y + r >= rows) continue
            inked[at] = 1
            if (cell.full) packed.set(at, [cells[k], cells[k + 1], cells[k + 2]])
            else packed.set(at, [(sextant ? SEXTANTS : OCTANTS)[cell.mask].codePointAt(0)!, cell.rgb, rgb(seenOf(vc, at))])
          }
      }
      for (const l of L.lines) {
        if (!l.bar) {
          over_(0, l.y, l.line, L.width)
          continue
        }
        for (let i = 0; i < L.bar.width; i++) put(L.bar.x + i, l.y, ' ', TEXT, barAt(i / L.bar.width))
        let cx = 0
        for (const sp of cut(l.line, L.width))
          for (const ch of sp.text) {
            put(cx, l.y, ch, sp.fg ?? TEXT, sp.bg ?? barAt((cx - L.bar.x) / L.bar.width))
            cx++
          }
      }
      over_(L.version.x, L.version.y, L.version.line, cols)
      pad()
    } else if (box) {
      popup(box)
    } else if (st.phase !== 'playing' || !session.scene.cells.size) {
      const msg = ended ? 'Saving…' : session.loading ? 'Loading…' : 'Starting crawl…'
      fill(0, 0, cols, rows, BLACK)
      text(Math.max(0, Math.floor((cols - msg.length) / 2)), Math.floor(rows / 2), [{ text: msg, fg: PALETTE[14] }], cols, BLACK)
    }

    // the cells, packed: the view's where it shows, else each its own, its text on the view darkened where shaded;
    // while a --more-- waits, the view behind the pause vignette (styles.css `.more-scrim`), darker toward the edges
    const scrim = playing && !mapShown && st.messages.more
    const out = new Int32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const k = i * 3
      const p = packed.get(i)
      if (p) {
        out[k] = p[0]
        out[k + 1] = p[1]
        out[k + 2] = p[2]
        continue
      }
      const m = mode[i]
      if (m === VIEW) {
        if (vc) {
          out[k] = vc[k]
          out[k + 1] = vc[k + 1]
          out[k + 2] = vc[k + 2]
          if (scrim) {
            const dx = ((i % cols) + 0.5) / cols - 0.5, dy = (Math.floor(i / cols) + 0.5) / rows - 0.5
            const a = SCRIM_MIDDLE + (SCRIM_EDGE - SCRIM_MIDDLE) * Math.min(1, 2 * Math.hypot(dx, dy))
            out[k + 1] = dim(vc[k + 1], 1 - a)
            out[k + 2] = dim(vc[k + 2], 1 - a)
          }
        } else out[k] = 32
        continue
      }
      // a control character (a message's newline) would move the terminal's cursor, not draw: a space
      const cp = char[i].codePointAt(0) ?? 32
      out[k] = cp < 32 || cp === 127 ? 32 : cp
      out[k + 1] = (fg[k] << 16) | (fg[k + 1] << 8) | fg[k + 2]
      out[k + 2] = m === SOLID ? (bg[k] << 16) | (bg[k + 1] << 8) | bg[k + 2] : rgb(shadeOf(vc, i))
    }
    return out
  }

  /** The view's cell `i` as text's ground: its colour as the eye takes it from its two, darkened so light text reads on it. */
  function shadeOf(vc: Int32Array | null, i: number): RGB {
    if (!vc) return PANE_BG
    const [r, g, bl] = seenOf(vc, i)
    const lum = 0.3 * r + 0.59 * g + 0.11 * bl
    const k = lum > 0 ? Math.min(PANE_SHADE, TEXT_GROUND / lum) : PANE_SHADE
    return [Math.round(r * k + PANE_BG[0] * (1 - k)), Math.round(g * k + PANE_BG[1] * (1 - k)), Math.round(bl * k + PANE_BG[2] * (1 - k))]
  }

  /** The view's cell `i` as the eye takes it from its two colours; the pane's ground where there is no view. */
  function seenOf(vc: Int32Array | null, i: number): RGB {
    if (!vc) return PANE_BG
    const cp = vc[i * 3], f = vc[i * 3 + 1], b = vc[i * 3 + 2]
    // as much of the foreground as the glyph inks: a cell a sprite all but fills is the sprite's, not half the wall's
    const c = inked(cp)
    const m = (s: number) => Math.round(((b >> s) & 255) * (1 - c) + ((f >> s) & 255) * c)
    return [m(16), m(8), m(0)]
  }

  /** the front screen's art cut sharp (home.ts `crisp`), for the size it is drawn at */
  const crisped = new Map<string, (CrispCell | null)[]>()
  function crispOf(name: string, art: Logo, cols: number, rows: number, sy: number) {
    const key = `${name}|${cols}x${rows}|${sy}`
    let c = crisped.get(key)
    if (!c) {
      if (crisped.size > 16) crisped.clear()
      crisped.set(key, (c = crisp(art, cols, rows, 2, sy)))
    }
    return c
  }

  let statsPrev = {}

  type Put = (x: number, y: number, c: string, f: RGB, b: RGB) => void
  type Fill = (x: number, y: number, w: number, h: number, b: RGB) => void

  /** where the level map's top-left cell is, while it is open: it stays put as the cursor moves inside it */
  let mapAt: { left: number; top: number } | null = null

  /**
   * The level map (X) in (x0, y0, w, h): every known cell as crawl's glyph,
   * in crawl's colours, what is remembered dimmer; the map's cursor lit (the
   * 2D view's own), the map centred on it when it opens and moved only when
   * the cursor comes within MAP_EDGE cells of an edge, as a scrolled map.
   */
  function drawMap(put: Put, fill: Fill, x0: number, y0: number, w: number, h: number) {
    fill(x0, y0, w, h, BLACK)
    const sc = session.scene
    const cur = session.state.cursors.find((c) => c) ?? sc.player
    if (!mapAt) mapAt = { left: cur.x - Math.floor(w / 2), top: cur.y - Math.floor(h / 2) }
    const mx = Math.min(MAP_EDGE, Math.floor(w / 4)), my = Math.min(MAP_EDGE, Math.floor(h / 4))
    if (cur.x - mapAt.left < mx || cur.x - mapAt.left >= w - mx) mapAt.left = cur.x - Math.floor(w / 2)
    if (cur.y - mapAt.top < my || cur.y - mapAt.top >= h - my) mapAt.top = cur.y - Math.floor(h / 2)
    const { left, top } = mapAt
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const c = sc.cells.get(cellKey(left + i, top + j))
        if (!c || !c.glyph) continue
        const col = PALETTE[(c.colour ?? 7) & 15] ?? TEXT
        const dim = c.visibility === 'remembered'
        put(x0 + i, y0 + j, c.glyph, dim ? (col.map((v) => v * 0.55) as RGB) : col, BLACK)
      }
    const px = sc.player.x - left
    const py = sc.player.y - top
    if (px >= 0 && py >= 0 && px < w && py < h) put(x0 + px, y0 + py, '@', PALETTE[15], BLACK)
    // the cursor: the cell under it on gold
    const cx = cur.x - left, cy = cur.y - top
    if (session.state.cursors.some((c) => c) && cx >= 0 && cy >= 0 && cx < w && cy < h) {
      const c = sc.cells.get(cellKey(cur.x, cur.y))
      const g = cur.x === sc.player.x && cur.y === sc.player.y ? '@' : c?.glyph || ' '
      put(x0 + cx, y0 + cy, g, BLACK, MAP_CURSOR)
    }
  }

  /**
   * The monster list (hud.ts `renderMonsters`, monster_list.js) at (x0, y0),
   * each row ending at the right edge: the monsters in view grouped as the
   * browser groups them, at most MONSTER_ROWS, a line each: the bearing from
   * facing, crawl's glyph where the browser shows the sprite, and the name
   * (or "3 jackals") in its attitude's colour. Returns the rows it took.
   */
  function drawMonsters(x0: number, y0: number, w: number, h: number, over: (x: number, y: number, line: Line, width: number) => void): number {
    const sc = session.scene
    const groups = monsterGroups(sc)
    const invis = session.state.map.invisibleMonsterDesc
    const all = (invis ? 1 : 0) + groups.length
    const n = Math.min(all, MONSTER_ROWS, h)
    const facing = view.camera?.facing ?? 0
    // a cell in from the edge, for the padding
    const right = x0 + w - 1
    for (let r = 0; r < n; r++) {
      const y = y0 + r
      let line: Line
      if (invis && r === 0) line = [{ text: '? ' + invis, fg: PALETTE[5] }]
      else {
        const group = groups[invis ? r - 1 : r]
        const first = group[0]
        const b = bearingTo(sc, first.x, first.y)
        const rel = b === null ? 0 : rotateDir(b, -facing as Dir8)
        const mon = first.ref as { name?: string; plural?: string } | undefined
        const name = group.length === 1 ? (mon?.name ?? '') : group.length + ' ' + (mon?.plural || mon?.name || '')
        const colour = ATTITUDE[first.attitude ?? 'hostile'] ?? ATTITUDE.hostile
        line = [{ text: ARROWS[rel] + ' ', fg: TEXT }]
        const cell = sc.cells.get(cellKey(first.x, first.y))
        if (cell?.glyph && !/^[\s.#·]$/.test(cell.glyph)) line.push({ text: cell.glyph + ' ', fg: PALETTE[(cell.colour ?? 7) & 15] })
        line.push({ text: name, fg: first.threat === 'trivial' ? (colour.map((v) => v * 0.75) as RGB) : colour })
        if (r === n - 1 && n < all) line.push({ text: ' ...', fg: MORE })
      }
      const len = Math.min(w - 2, line.reduce((k, s) => k + s.text.length, 0))
      over(right - len, y, line, len)
    }
    return n
  }

  // ---- the game a frame on (game.ts `loop`): the scene rebuilt from what crawl said, the eye glided after the feet,
  // the cursor, the hands and the context as they now stand
  let lastFrame = performance.now()
  let cursorKey = ''
  let viewmodelRev = ''
  function step(now: number) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000)
    lastFrame = now
    sceneTime = now / 1000
    try {
      session.flushScene()
    } finally {
      sceneTime = undefined
    }
    // the front screen: its room, still; out of it, the game's own tiles and scene again
    if (home) {
      if (room && showing !== 'room') {
        view.setTiles(room.tiles)
        view.setScene(room.scene)
        view.setViewmodel(null)
        view.setCursor(null)
        view.resetMotion()
        view.setCamera(room.camera)
        showing = 'room'
        dirty = true
      }
      return
    }
    if (showing !== 'game' && session.gamedata) {
      view.setTiles(session.gamedata)
      view.setScene(session.scene)
      viewmodelRev = ''
      cursorKey = ''
      showing = 'game'
      dirty = true
    }
    if (cam.update(dt, now / 1000)) dirty = true
    view.setCamera(cam.camera)
    const st = session.state
    ctx = pilot.context()
    // the hands hold what is wielded (game.ts `syncViewmodel`)
    const vmRev = `${st.rev.player}|${st.rev.map}`
    if (vmRev !== viewmodelRev) {
      viewmodelRev = vmRev
      view.setViewmodel(viewmodelFor(st, session.gamedata ?? undefined))
    }
    // the server's cursor: on the view, which turns to it as it moves (game.ts `cursorFor`, `faceCursor`)
    const c = serverCursor(st, (name) => session.gamedata?.icons.id(name))
    const ck = c ? `${c.x},${c.y},${c.mode},${c.tile}` : ''
    if (ck !== cursorKey) {
      const moved = c && (!cursorKey || !cursorKey.startsWith(`${c.x},${c.y},`))
      cursorKey = ck
      view.setCursor(c)
      if (c && moved) pilot.faceCursor(c, { examining: runner.examining(ctx.mode), viewHeld: runner.holdingView(ctx.mode) })
      dirty = true
    }
    if (view.animating) dirty = true
  }

  // ---- the loop: a frame when something changed, at most `fps` a second
  const minMs = 1000 / (o.fps ?? 60)
  let busy = false
  /** the frames made and not yet written */
  let inFlight = 0
  // the frame going out to the terminal while the next is made; none once the game has closed the screen
  let writing: Promise<void> = Promise.resolve()
  let closed = false
  /** what a frame's output is written into, as long as the worst frame of its size */
  let buf = new Uint8Array(0)
  // ORBRUN_TERM_TRACE=1 also counts the frames: how many, how long one took to make, how long it waited on the terminal, and the bytes
  const stats = { frames: 0, make: 0, send: 0, bytes: 0, since: performance.now() }
  const tick = async () => {
    next = null
    const start = performance.now()
    if (ended && busy) return
    // the game moved on to now first, so what is drawn is the game as it stands: a turn moves on by one step a frame
    step(start)
    const r = session.state.rev.any
    if (r !== rev) {
      rev = r
      dirty = true
    }
    // a frame is drawn while the one before it is on its way to the terminal, but not while two are
    if (dirty && !busy && inFlight < 2) {
      dirty = false
      busy = true
      // the view where it shows: not under the level map, or out of a game; under a popup, as in the browser
      const showsView = (home ? showing === 'room' : session.state.uiState !== UiState.VIEW_MAP) && cols > 0 && rows > 0
      const vc = showsView ? await view.cells(cols, rows, aspect()) : null
      const cells = frame(vc)
      const need = cols * rows * ANSI_CELL + rows * ANSI_BAND
      if (buf.length < need) buf = new Uint8Array(need)
      const end = ansiInto(cells, 0, cols, rows, 1, shown && shown.length === cells.length ? shown : null, buf, 0)
      shown = cells
      const out = Buffer.from(buf.subarray(0, end)).toString('utf8')
      const made = performance.now()
      stats.frames++
      stats.make += made - start
      const before = writing
      inFlight++
      writing = (async () => {
        await before
        if (out && !closed) await io.write(synced(out))
        stats.send += performance.now() - made
        stats.bytes += out.length
      })().finally(() => inFlight--)
      busy = false
    }
    if (o.trace && start - stats.since > 2000) {
      const n = stats.frames || 1
      trace(`${cols}x${rows}: ${((stats.frames * 1000) / (start - stats.since)).toFixed(0)} frames/s, make ${(stats.make / n).toFixed(2)} ms, send ${(stats.send / n).toFixed(2)} ms, ${((stats.bytes / (start - stats.since)) * 1000 / 1024).toFixed(0)} KB/s`)
      Object.assign(stats, { frames: 0, make: 0, send: 0, bytes: 0, since: start })
    }
    // the next frame is due a frame after this one began, not after it ended
    next = setTimeout(tick, Math.max(0, minMs - (performance.now() - start)))
  }
  void tick()

  async function quit(save = true) {
    if (ended) return
    ended = true
    dirty = true
    // closing the connection stops the game with its save landed (the offline server's stop, up to 3 seconds), and
    // the engine puts it on disk before it lets crawl go
    if (save) {
      session.close()
      await eng.stopped(5000)
    }
    saveView(cam.view)
    storage.persist()
    await eng.sync()
    closed = true
    await writing
    await io.write('\x1b[0m\x1b[2J\x1b[?25h\x1b[?1049l')
    view.close()
    io.end(0)
  }
}

/** how a game ended (crawl's `exit_reason`), as the menu says it */
const ENDED: Record<string, string> = { saved: 'Your game is saved.', quit: 'You quit the game.', dead: 'Your character died.', won: 'You won!', crash: 'The game crashed.' }

/** a packed colour (0xRRGGBB) times `k` */
const dim = (c: number, k: number) => (Math.round(((c >> 16) & 255) * k) << 16) | (Math.round(((c >> 8) & 255) * k) << 8) | Math.round((c & 255) * k)

/** a colour packed as 0xRRGGBB */
const rgb = (c: RGB) => (Math.round(c[0]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[2])

/** a grid row (stats, messages) as a line in RGB; a bar (a span over a `linear-gradient`) a cell at a time */
function fromRow(row: { text: string; fg?: number; bg?: number | string }[]): Line {
  const out: Line = []
  for (const s of row) {
    const fg = s.fg !== undefined ? PALETTE[s.fg & 15] : undefined
    if (typeof s.bg === 'string' && s.bg.startsWith('linear-gradient')) {
      const stops = gradientStops(s.bg)
      for (let i = 0; i < s.text.length; i++) {
        const at = ((i + 0.5) / s.text.length) * 100
        out.push({ text: s.text[i], fg, bg: stops.find((x) => at >= x.from && at < x.to)?.rgb ?? BAR_TRACK })
      }
      continue
    }
    out.push({ text: s.text, fg, bg: typeof s.bg === 'number' ? PALETTE[s.bg & 15] : typeof s.bg === 'string' ? css(s.bg) : undefined })
  }
  return out
}

/** the track a bar's segments lie on (styles.css `--stats-bar-track`) */
const BAR_TRACK: RGB = [64, 64, 64]

/** `linear-gradient(to right, C a% b%, …)` (grid/stats.ts `gradient`) as its colour stops */
function gradientStops(g: string): { from: number; to: number; rgb: RGB }[] {
  const out: { from: number; to: number; rgb: RGB }[] = []
  const re = /(var\(--[\w-]+\)|#[0-9a-f]{3,8}|rgba?\([^)]*\))\s+([\d.]+)%\s+([\d.]+)%/gi
  for (let m; (m = re.exec(g)); ) out.push({ from: +m[2], to: +m[3], rgb: css(m[1]) ?? BAR_TRACK })
  return out
}

function css(c: string): RGB | undefined {
  const v = /^var\(--color-(\d+)\)$/.exec(c)
  if (v) return PALETTE[+v[1] & 15]
  if (c === 'var(--stats-bar-track)') return BAR_TRACK
  const hex = /^#([0-9a-f]{6})$/i.exec(c)
  if (hex) return [parseInt(hex[1].slice(0, 2), 16), parseInt(hex[1].slice(2, 4), 16), parseInt(hex[1].slice(4, 6), 16)]
  const rgb = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c)
  return rgb ? [+rgb[1], +rgb[2], +rgb[3]] : undefined
}

