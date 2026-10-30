/**
 * The whole game in a terminal: the app's own Session and GameScreen, run in
 * node on the offline engine, laid out as the browser lays the game out, in
 * nothing but the terminal's cells, so any terminal with truecolour plays it,
 * here or over SSH.
 *
 *  - the 3D view over the whole terminal as the glyph view's cells
 *    (view.ts): the level cast a ray a column, its walls as render-3d
 *    stands them, what stands drawn finer, the hands over all, each cell a
 *    glyph of the mosaic in the two colours that show it best;
 *  - over it, each on the view darkened under its text: the stats pane at
 *    the top-left (grid/stats.ts, the app's own rows) with the portrait in
 *    the view's glyphs, the minimap at the top-right in half blocks with the
 *    cone the view faces and the monster list under it, the messages along
 *    the bottom (grid/messages.ts);
 *  - crawl's menus and popups, the prompts and Orbrun's own sheets, laid out
 *    from the overlay DOM (text.ts), over the whole screen as console crawl
 *    shows its menus;
 *  - the level map (X) as crawl's own glyphs.
 *
 * Each frame is one grid of cells, written as only the cells that changed
 * since the last (glyph/render.ts `ansiInto`). Keys are the browser's
 * keydown events (input.ts), so every binding is the app's. `io` is the
 * terminal: `write(s)` (settles once taken), `cols`, `rows`, `onInput`,
 * `onResize`, `end()`.
 */
import fs from 'node:fs'
import path from 'node:path'
import { installPage } from './env'
import type { OfflineChannel } from '@orbrun/offline'
import type { TermConfig } from './config'
import { PALETTE, cut, layout, lineLength, type Line, type RGB } from './text'
import { press, terminalKeys } from './input'
import { ANSI_BAND, ANSI_CELL, ansiInto } from '../glyph/render'
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

/** What the client plays and how (config.ts), where it keeps its state, and the crawl to play. */
export interface ClientOptions extends TermConfig {
  stateDir: string
  channel: OfflineChannel
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
/** the action panel's tiles, rows tall, and the most lines of them */
const PANEL_ROWS = 3
const PANEL_LINES = 2
/** the pack's gear slots (pack-tabs.ts MAX_GEAR): the slots after them are crawl's consumable pages */
const GEAR_SLOTS = 52
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
const MORE: RGB = [0xaa, 0xaa, 0xaa]
/** the minimap's player, and the warm light of the cone the view faces over it (render-2d `drawFacing`) */
const MAP_PLAYER: RGB = [255, 255, 255]
const CONE: RGB = [255, 240, 200]
/** how far the cone reaches, in map cells (render-2d FACING_REACH), and how strong it is at the player */
const CONE_REACH = 3.5
const CONE_ALPHA = 0.25
/** how a cell of the frame is had: the view's, its own, or its own text on the view darkened */
const VIEW = 0
const SOLID = 1
const SHADE = 2
/** a cell's glyph a full block, and a half block's upper half (for the minimap, two of its cells to a terminal cell) */
const FULL = 0x2588
const UPPER = 0x2580

export async function runGame(io: Io, o: ClientOptions) {
  // ORBRUN_TERM_TRACE=1: when each step of starting up was reached, in <state>/trace.log
  const t0 = performance.now()
  const trace = (what: string) => {
    if (o.trace) fs.appendFileSync(path.join(o.stateDir, 'trace.log'), `${(performance.now() - t0).toFixed(0).padStart(6)} ms  ${what}\n`)
  }
  trace('start')
  const page = installPage(o.stateDir, { reducedMotion: o.reducedMotion })
  const { engine, builtChannels, DIST } = await import('./engine')
  const { TermView } = await import('./view')
  const { LocalWasmConnection } = await import('@orbrun/offline')
  const { Session } = await import('../../../apps/orbrun/src/session')
  const { GameScreen } = await import('../../../apps/orbrun/src/game')
  const { getSettings, saveSettings, OFFLINE_SERVER } = await import('../../../apps/orbrun/src/servers')
  const { STATUS_BADGE_ROWS, minimapFit } = await import('../../../apps/orbrun/src/hud')
  const { typedInLog } = await import('../../../apps/orbrun/src/bindings')
  const { PORTRAIT_ROWS, statsRows } = await import('../../../apps/orbrun/src/grid/stats')
  const { STAT_WIDTH } = await import('../../../apps/orbrun/src/grid/console')
  const { paneRows } = await import('../../../apps/orbrun/src/grid/messages')
  const { bearingTo, cellKey, rotateDir } = await import('@orbrun/scene')
  const { monsterGroups } = await import('@orbrun/scene-webtiles')
  const { actionPanelItems } = await import('@orbrun/webtiles')
  trace('modules')

  const channels = builtChannels()

  const ch = o.channel
  // the game's settings to start with: written over what it saved, as the Settings menu would
  if (Object.keys(o.settings).length) saveSettings({ ...getSettings(), ...o.settings })
  const eng = engine(path.join(o.stateDir, 'saves', o.name))
  const conn = new LocalWasmConnection({ channels, engineBase: () => '', gamedataBase: DIST, launch: eng.launch, username: o.name })
  const session = new Session(OFFLINE_SERVER, o.name, conn)

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

  await new Promise<void>((r) => (conn.open ? r() : conn.onOpen(() => r())))
  trace('connected')
  conn.send({ msg: 'token_login', cookie: `offline:${o.name}` })
  conn.send({ msg: 'play', game_id: ch.id })
  const host = document.createElement('div')
  document.body.append(host)
  const newScreen = () =>
    new GameScreen(host, session, {
      settings: () => ({ ...getSettings(), renderer: '3d' }),
      settingsPanel: () => ({ el: document.createElement('div'), rows: [] }),
      onSystem: () => void quit(),
      gamepad: { kind: 'xbox', isHeld: () => false, virtualRelease() {} } as never,
      initialInput: 'keyboard',
      renderer: () => view,
    })
  let gs = newScreen()
  const screenState = () => gs as unknown as { mapShown: boolean }
  new MutationObserver(() => (dirty = true)).observe(host, { subtree: true, childList: true, characterData: true, attributes: true })
  let rev = -1
  conn.onClose(() => void quit(false))
  // out of a game (death, save and exit, quit): crawl goes back to its lobby, and the player picks what next
  let over = false
  let firstScene = true
  let nudged = false
  session.on((e) => {
    if (e.type === 'gamedata' && e.status !== 'loading') trace('gamedata ' + e.status)
    if (e.type === 'sent') trace('-> ' + JSON.stringify(e.msg).slice(0, 120))
    if (e.type === 'state') trace('<- ' + (['input_mode', 'layout', 'msgs', 'ui-push', 'menu'].includes(String(e.msg.msg)) ? JSON.stringify(e.msg).slice(0, 300) : e.msg.msg))
    if (e.type === 'state' && (e.msg.msg === 'game_started' || e.msg.msg === 'game_client')) trace(e.msg.msg)
    if (e.type === 'scene' && firstScene && e.scene.cells.size) {
      firstScene = false
      trace('first map')
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
    if (e.type === 'state' && e.msg.msg === 'go_lobby') {
      over = true
      dirty = true
    }
  })
  const playAgain = () => {
    over = false
    nudged = false
    gs.destroy()
    host.replaceChildren()
    conn.send({ msg: 'play', game_id: ch.id })
    gs = newScreen()
    dirty = true
  }

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
    if (s.includes(QUIT)) return void quit(!over)
    if (over) {
      if (s === '\r' || s === '\n') playAgain()
      else if (s === 'q' || s === '\x1b') void quit(false)
      return
    }
    for (const k of terminalKeys(d)) {
      try {
        press(k.key, k.mods)
      } catch (e) {
        // a key the page could not take is no reason to lose the game
        fs.appendFileSync(path.join(o.stateDir, 'errors.log'), `${new Date().toISOString()} key ${k.key}: ${(e as Error).stack ?? e}\n`)
      }
    }
    dirty = true
    soon()
  })
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

  // ---- one frame: every cell of the terminal, its text and its colours, over the view where it shows
  /** the view's cells, or null where none is shown */
  const frame = (vc: Int32Array | null): Int32Array => {
    const n = cols * rows
    const char: string[] = new Array(n).fill(' ')
    const fg = new Uint8Array(n * 3)
    const bg = new Uint8Array(n * 3)
    // VIEW: the view's cell shows; SOLID: the cell's own; SHADE: its own text on the view darkened under it
    const mode = new Uint8Array(n)
    /** cells packed whole into the frame (the portrait, the minimap), by index */
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
     * A box of `lines` over the view as the browser's popup is (styles.css `.popup`): hung POPUP_TOP rows from the top
     * and a row further down a stack's depth, or in the middle (`centred`), across the middle, `inner` wide inside its
     * padding; the lit line's row lit across the box (`.popup li.hovered`) and kept in view, the box scrolling past
     * what does not fit, with a mark on its border where more is.
     */
    const popup = (lines: Line[], lit: number[], depth: number, centred: boolean, inner = Math.max(POPUP_MIN_W, ...lines.map(lineLength))) => {
      const bw = Math.min(cols, inner + 4)
      const top = Math.min(POPUP_TOP + depth, Math.floor(rows / 4))
      const room = Math.max(1, rows - 2 * top - 2)
      const bh = Math.min(lines.length, room) + 2
      const bx = Math.floor((cols - bw) / 2)
      const by = centred ? Math.max(0, Math.floor((rows - bh) / 2)) : top
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
      const shown = bh - 2
      const focus = lit.length ? lit[lit.length - 1] : 0
      const scroll = lines.length <= shown ? 0 : Math.max(0, Math.min(lines.length - shown, focus - Math.floor(shown / 2)))
      for (let i = 0; i < shown && scroll + i < lines.length; i++) {
        const row = by + 1 + i
        // a row lit whole (an item under the cursor), not one with a lit piece of it (the current tab)
        const line = lines[scroll + i]
        const on = lit.includes(scroll + i) && line.every((p) => p.lit || !p.text.trim())
        if (on) fill(bx + 1, row, bw - 2, 1, LIT_BG)
        text(bx + 2, row, lines[scroll + i], bw - 4, on ? LIT_BG : POPUP_BG)
      }
      if (scroll > 0) put(bx + bw - 1, by + 1, '▲', MORE, POPUP_BG)
      if (scroll + shown < lines.length) put(bx + bw - 1, by + bh - 2, '▼', MORE, POPUP_BG)
    }

    const st = session.state
    const mapShown = !over && screenState().mapShown
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
    const playing = st.phase === 'playing' && !!st.player.name && !!session.scene.cells.size
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
      // the minimap, the badges and the action panel stand down while the level map is open, as the browser's do
      if (!mapShown) {
        // as many tiles as the settings ask (hud.ts `minimapFit`), as fit in up to a quarter of the width beside the
        // stats pane and half the height
        const set = getSettings()
        const room = { w: Math.max(0, Math.min(Math.floor(cols * 0.25), cols - statsW - 2)), h: Math.floor(rows * 0.5) * 2 }
        const fit = minimapFit(room, 0, set.minimapTiles, 1)
        if (fit.w > 0) {
          const tiles = fit.tiles
          const mapW = tiles
          mapH = Math.ceil(tiles / 2)
          sideW = Math.max(sideW, mapW + 2)
          // the player on the middle tile
          const left = sc.player.x - (tiles - 1) / 2, top = sc.player.y - (tiles - 1) / 2
          const px = view.minimap(left, top, tiles, mapH * 2, 1)
          const yaw = view.camera?.yaw ?? 0
          const fov = view.fovAcross(cols / (rows * aspect()))
          const x0 = (mapLeft = cols - mapW - 1)
          for (let r = 0; r < mapH; r++)
            for (let c = 0; c < mapW; c++) {
              const i = r * cols + x0 + c
              // each half: the level's colour there, the cone's light over it, the player white; or the view darkened where nothing is known
              const half = (k: number): RGB | null => {
                const my = r * 2 + k
                const o = (my * tiles + c) * 4
                const mx = left + c, myy = top + my
                if (sc.playerOnLevel && mx === sc.player.x && myy === sc.player.y) return MAP_PLAYER
                const cone = sc.playerOnLevel ? coneAt(mx - sc.player.x, myy - sc.player.y, yaw, fov) : 0
                if (!px[o + 3]) return cone ? (CONE.map((v) => v * cone) as RGB) : null
                return [px[o] + (CONE[0] - px[o]) * cone, px[o + 1] + (CONE[1] - px[o + 1]) * cone, px[o + 2] + (CONE[2] - px[o + 2]) * cone]
              }
              const a = half(0), b = half(1)
              inked[i] = 1
              if (!a && !b) {
                mode[i] = SHADE
                char[i] = ' '
                continue
              }
              const shade = shadeOf(vc, i)
              const ta = a ?? shade, tb = b ?? shade
              mode[i] = SOLID
              packed.set(i, [UPPER, rgb(ta), rgb(tb)])
            }
        }
      }
      // the status strip (hud.ts `renderStatuses`): the badges on the player, each a square of STATUS_BADGE_ROWS rows in
      // the view's glyphs, in rows leftward from the minimap's left edge, or under it where the stats pane leaves no room
      const me = sc.playerOnLevel ? sc.billboards.find((b) => b.kind === 'player' && b.x === sc.player.x && b.y === sc.player.y) : undefined
      const badges = (me?.statusIcons ?? []).filter((i) => !i.at && !i.square && !i.full)
      let under = 0
      /** the first column the badges beside the minimap leave */
      let badgeLeft = mapLeft
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
        else badgeLeft = mapLeft - per * bw
      }
      if (!mapShown) drawPanel(statsW + 1, badgeLeft - 1, inked, mode, packed, over_)
      const sideX = cols - sideW
      const msgH = Math.min(Math.max(3, st.messages.paneHeight || 5) + 1, Math.floor(rows / 3))
      // the level map (X) in the clear part of the view, as the browser's (console.ts `levelMapSplit`): left of the right
      // column and above the messages, the stats pane over its corner
      if (mapShown) drawMap(put, fill, 0, 0, sideX - 1, rows - msgH)
      // the monster list, always: crawl's letter for each where the browser has its sprite, and no edge pips, which a
      // terminal's few cells could not show
      const monH = drawMonsters(sideX, mapH + under, sideW, rows - mapH - under, over_)
      // the portrait: PORTRAIT_ROWS rows, square, at the corner, in the view's glyphs; the rows beside it after a cell
      const portraitW = Math.round(PORTRAIT_ROWS * aspect())
      const portrait = portraitW > 0 ? view.portraitCells(portraitW, PORTRAIT_ROWS) : null
      if (portrait)
        for (let y = 0; y < Math.min(PORTRAIT_ROWS, rows); y++)
          for (let x = 0; x < portraitW && x + 1 < cols; x++) {
            const i = y * cols + x + 1, k = (y * portraitW + x) * 3
            inked[i] = 1
            mode[i] = SOLID
            packed.set(i, [portrait[k], portrait[k + 1], portrait[k + 2]])
          }
      const s = statsRows(st.player, st.options, statsPrev, statsW - 2, portrait ? portraitW + 1 : 0)
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

    // the top overlay: crawl's menus and popups, prompts, Orbrun's sheets, over the whole screen as console crawl
    // shows them; or, out of a game, what next
    // the overlays, each a box over the view as the browser's popups are (styles.css `.popup`): crawl's menus and
    // popups, prompts, Orbrun's sheets, one over another as they stack; or, out of a game, what next
    const stack = overlays()
    if (over) {
      const why = st.exit?.message || st.exit?.reason || 'The game is over.'
      popup([[{ text: why, fg: PALETTE[14] }], [], [{ text: 'Enter: play (a new character, or continue a saved one)' }], [{ text: 'q: quit' }]], [], 0, true)
    } else if (stack.length) {
      for (const el of stack) {
        const depth = Number(/--depth:\s*(\d+)/.exec(el.getAttribute('style') ?? '')?.[1] ?? 0)
        // laid out as wide as the screen allows, then the box as wide as its widest line
        let laid = layout(el, Math.max(10, cols - 6))
        const widest = Math.max(0, ...laid.lines.map(lineLength))
        const inner = Math.min(cols - 6, Math.max(POPUP_MIN_W, widest))
        if (inner < cols - 6) laid = layout(el, inner)
        // a prompt card stands in the middle of the view, as does what crawl centres (`ui-centred`, before a game exists)
        popup(laid.lines, laid.lit, depth, isCard(el) || el.classList.contains('centred') || !playing, inner)
      }
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

  /** a prompt card (overlays.ts): a yes/no or a choice */
  function isCard(el: Element): boolean {
    return el.classList.contains('prompt-card')
  }

  /** the overlays shown and with something to say, bottom first; none out of a game */
  function overlays(): Element[] {
    const stack = over ? null : host.querySelector('.overlay-stack')
    return stack ? (Array.from(stack.children).filter((e) => !(e as HTMLElement).hidden && (e.textContent ?? '').trim()) as Element[]) : []
  }

  /** The view's cell `i` as text's ground: its colour as the eye takes it from its two, darkened so light text reads on it. */
  function shadeOf(vc: Int32Array | null, i: number): RGB {
    if (!vc) return PANE_BG
    const cp = vc[i * 3], f = vc[i * 3 + 1], b = vc[i * 3 + 2]
    const c = cp === 32 ? 0 : cp === FULL ? 1 : 0.5
    const m = (s: number) => ((b >> s) & 255) * (1 - c) + ((f >> s) & 255) * c
    const r = m(16), g = m(8), bl = m(0)
    const lum = 0.3 * r + 0.59 * g + 0.11 * bl
    const k = lum > 0 ? Math.min(PANE_SHADE, TEXT_GROUND / lum) : PANE_SHADE
    return [Math.round(r * k + PANE_BG[0] * (1 - k)), Math.round(g * k + PANE_BG[1] * (1 - k)), Math.round(bl * k + PANE_BG[2] * (1 - k))]
  }

  let statsPrev = {}

  /**
   * The action panel (hud.ts `renderActionPanel`, action_panel.js) in the
   * strip between the stats pane and what stands left of the minimap, from
   * x0 up to x1: each consumable crawl puts on it, in its order, its tile in
   * the view's glyphs PANEL_ROWS rows tall, or its glyph in its colour under
   * `action_panel_glyphs`, with its letter and how many under it; a line
   * more where they do not fit, PANEL_LINES at most, and an ellipsis for the
   * rest, as the browser leaves it. None where the rc turns it off.
   */
  function drawPanel(x0: number, x1: number, inked: Uint8Array, mode: Uint8Array, packed: Map<number, [number, number, number]>, over: (x: number, y: number, line: Line, width: number) => void) {
    const st = session.state, opt = st.options
    if (opt.action_panel_disabled === true || opt.action_panel_show === false || !Object.values(st.player.inv).length) return
    const items = actionPanelItems(st)
    const glyphs = opt.action_panel_glyphs === true
    const h = glyphs ? 1 : PANEL_ROWS
    const w = glyphs ? 4 : Math.max(4, Math.round(PANEL_ROWS * aspect()))
    const across = Math.floor((x1 - x0 + 1) / w)
    if (across < 1 || !items.length) return
    const shown = Math.min(items.length, across * PANEL_LINES)
    for (let k = 0; k < shown; k++) {
      const item = items[k]
      const x = x0 + (k % across) * w, y = Math.floor(k / across) * (h + 1)
      if (k === shown - 1 && shown < items.length) {
        over(x, y, [{ text: '…', fg: MORE }], 1)
        break
      }
      if (glyphs) over(x + 1, y, [{ text: typeof item.g === 'string' ? item.g : '?', fg: PALETTE[(item.col ?? 7) & 15] }], 1)
      else if (item.tile !== undefined) {
        const cells = view.itemCells(item.tile, w - 1, h, rgb(PANE_BG))
        if (cells)
          for (let j = 0; j < h; j++)
            for (let i = 0; i < w - 1; i++) {
              const at = (y + j) * cols + x + i, c = (j * (w - 1) + i) * 3
              if (y + j >= rows || x + i >= cols) continue
              inked[at] = 1
              mode[at] = SOLID
              packed.set(at, [cells[c], cells[c + 1], cells[c + 2]])
            }
      }
      // the letter, Orbrun's, and the quantity, action_panel.js's, under it; no letter for a consumable of crawl's own
      // pages (a slot past the gear's), which webtiles' letters do not name
      const n = item.quantity && item.quantity > 1 ? String(item.quantity) : ''
      const letter = item.slot < GEAR_SLOTS ? item.letter : ' '
      over(x, y + h, [{ text: letter, fg: PALETTE[15] }, { text: n.padStart(w - 2), fg: TEXT }], w - 1)
    }
  }

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
    // the game's animation frame first, so what is drawn is the game as it stands now: a turn moves on by one step
    // a frame, not by however many the page's own timer happened to run between two of the terminal's
    page.frame()
    const r = session.state.rev.any
    if (r !== rev) {
      rev = r
      dirty = true
    }
    // a frame is drawn while the one before it is on its way to the terminal, but not while two are
    if (dirty && !busy && inFlight < 2) {
      dirty = false
      busy = true
      // the view where it shows: not under the level map, a menu, or out of a game
      // the view where it shows: not under the level map, or out of a game; under a popup, as in the browser
      const showsView = !over && !screenState().mapShown && cols > 0 && rows > 0
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
    // closing the connection stops the game with its save landed (the offline server's stop), then it goes to disk
    if (save) {
      session.close()
      await new Promise((r) => setTimeout(r, 1500))
    }
    await eng.sync()
    closed = true
    await writing
    await io.write('\x1b[0m\x1b[2J\x1b[?25h\x1b[?1049l')
    view.close()
    io.end(0)
  }
}

/** a packed colour (0xRRGGBB) times `k` */
const dim = (c: number, k: number) => (Math.round(((c >> 16) & 255) * k) << 16) | (Math.round(((c >> 8) & 255) * k) << 8) | Math.round((c & 255) * k)

/** a colour packed as 0xRRGGBB */
const rgb = (c: RGB) => (Math.round(c[0]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[2])

/**
 * How much of the cone the view faces lights the map cell (dx, dy) from the
 * player's (render-2d `drawFacing`): a wedge as wide as the view toward
 * `yaw` (north 0, clockwise), fading out over CONE_REACH cells.
 */
function coneAt(dx: number, dy: number, yaw: number, fov: number): number {
  const d = Math.hypot(dx, dy)
  if (d === 0 || d > CONE_REACH) return 0
  let off = Math.atan2(dx, -dy) - yaw
  off -= 2 * Math.PI * Math.round(off / (2 * Math.PI))
  if (Math.abs(off) > fov / 2) return 0
  return CONE_ALPHA * (1 - Math.max(0, Math.min(1, (d - 0.3) / (CONE_REACH - 0.3))))
}

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

