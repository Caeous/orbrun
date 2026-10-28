/**
 * The whole game in a terminal: the app's own Session and GameScreen, run in
 * node on the offline engine, laid out as the browser lays the game out.
 *
 *  - the 3D view, by render-term, in quadrant blocks, over the whole terminal;
 *  - over it, each on the view darkened: the stats pane at the top-left
 *    (grid/stats.ts, the app's own rows), the minimap at the top-right with
 *    the monster list under it, the messages along the bottom
 *    (grid/messages.ts);
 *  - crawl's menus and popups, the prompts and Orbrun's own sheets, laid out
 *    from the overlay DOM (text.ts) in a box over the middle;
 *  - the level map (X) as crawl's own glyphs.
 *
 * Keys are the browser's keydown events (input.ts), so every binding is the
 * app's. `io` is the terminal: `write(s)` (settles once taken), `cols`,
 * `rows`, `onInput`, `onResize`, `end()`.
 */
import fs from 'node:fs'
import path from 'node:path'
import { installPage } from './env'
// @ts-expect-error: plain JS, shared with the browser bridge
import { BLOCKS, Screen, blockCells } from '../frame.mjs'
import { PALETTE, cut, layout, type Line, type RGB } from './text'
import { press, terminalKeys } from './input'
// @ts-expect-error: plain JS
import { kittyImage } from '../frame.mjs'
import type { Dir8 } from '@orbrun/scene'

export interface Io {
  cols: number
  rows: number
  write(s: string): Promise<void>
  onInput(fn: (d: Buffer) => void): void
  onResize(fn: (cols: number, rows: number) => void): void
  end(code?: number): void
}

export interface ClientOptions {
  stateDir: string
  /** the player's name */
  name: string
  /** 'stable' or 'trunk' */
  channel: string
  /** most frames a second */
  fps?: number
}

/** The key that leaves, saving first: Ctrl-\, which crawl does not use. */
const QUIT = '\x1c'
const PANE_BG: RGB = [10, 10, 14]
/** the share of the terminal's width the stats pane takes, up to the app's own width */
const STATS_SHARE = 0.3
/** how much of the view shows under the HUD's text and its padding: a light shadow, not a backing */
const PANE_SHADE = 0.7
/** the brightest the view is left under text (luminance, 0..255): enough for the game's palest text to read on */
const TEXT_GROUND = 60
/**
 * Asked of the terminal at the start: whether it shows kitty graphics (the
 * protocol's query, answered `OK`), and its cell's size in pixels (CSI 16 t).
 * The answers come back as input, and are taken out of it before the keys.
 */
const PROBE = '\x1b_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\\x1b[16t'
const PROBE_REPLY = /\x1b_Gi=31;([^\x1b]*)\x1b\\|\x1b\[6;(\d+);(\d+)t/g
/** the kitty images the HUD shows, by name */
const IMAGE_IDS = { portrait: 7, minimap: 8, cone: 9 }

/** An image over cells: its top-left cell, the cells it covers, and its pixels (RGBA) when it is to be sent. */
interface Image {
  at: [number, number]
  cols: number
  rows: number
  /** what its pixels are made from: the same key, the same pixels */
  key: string
  /** over the images under it: the higher the nearer (kitty's z-index) */
  z?: number
  make(): { px: Uint8Array; w: number; h: number } | null
}
const QUADS = ' ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█'
/** monster_list.js: at most this many rows */
const MONSTER_ROWS = 5
/** the attitude colours of the monster list's names (styles.css `.monsters .name`) */
const ATTITUDE: Record<string, RGB> = { hostile: [0xff, 0x8a, 0x8a], neutral: [0xff, 0xe0, 0x8a], good_neutral: [0xd8, 0xff, 0xa0], friendly: [0x8a, 0xff, 0x8a] }
const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖']
const BOX_BG: RGB = [16, 16, 24]
const BORDER: RGB = [120, 110, 80]
const TEXT: RGB = PALETTE[7]
const LIT_BG: RGB = [90, 70, 20]

export async function runGame(io: Io, o: ClientOptions) {
  // ORBRUN_TERM_TRACE=1: when each step of starting up was reached, in <state>/trace.log
  const t0 = performance.now()
  const trace = (what: string) => {
    if (process.env.ORBRUN_TERM_TRACE) fs.appendFileSync(path.join(o.stateDir, 'trace.log'), `${(performance.now() - t0).toFixed(0).padStart(6)} ms  ${what}\n`)
  }
  trace('start')
  installPage(o.stateDir)
  const { engine, builtChannels, DIST } = await import('./engine')
  const { TermView, facingCone } = await import('./view')
  const { LocalWasmConnection } = await import('@orbrun/offline')
  const { Session } = await import('../../../apps/orbrun/src/session')
  const { GameScreen } = await import('../../../apps/orbrun/src/game')
  const { getSettings, OFFLINE_SERVER } = await import('../../../apps/orbrun/src/servers')
  const { minimapFit } = await import('../../../apps/orbrun/src/hud')
  const { PORTRAIT_ROWS, statsRows } = await import('../../../apps/orbrun/src/grid/stats')
  const { STAT_WIDTH } = await import('../../../apps/orbrun/src/grid/console')
  const { paneRows } = await import('../../../apps/orbrun/src/grid/messages')
  const { bearingTo, cellKey, rotateDir } = await import('@orbrun/scene')
  const { monsterGroups } = await import('@orbrun/scene-webtiles')
  trace('modules')

  const channels = builtChannels()
  const ch = channels.find((c) => c.id.endsWith(o.channel)) ?? channels[0]
  if (!ch) throw new Error('no engine built: run engine/build.sh first')
  const eng = engine(path.join(o.stateDir, 'saves', o.name))
  const conn = new LocalWasmConnection({ channels, engineBase: () => '', gamedataBase: DIST, launch: eng.launch, username: o.name })
  const session = new Session(OFFLINE_SERVER, o.name, conn)

  let cols = io.cols
  let rows = io.rows
  let screen = new Screen(cols, rows, 0)
  let dirty = true
  let ended = false
  const view = new TermView(() => (dirty = true))

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

  // what the terminal said of itself: kitty graphics, and its cell in pixels
  let kitty = false
  let cellPx = { w: 8, h: 16 }
  /** each image as last sent, by name: where it stood and its pixels */
  let sent: Record<string, { at: string; key: string; px: Uint8Array }> = {}
  /**
   * The block characters the view is drawn in: octants where the terminal is
   * known to draw them (Ghostty and Rex draw them themselves, kitty too, and
   * a terminal that shows kitty graphics is one of those or newer); whole
   * cells in Terminal.app, which draws blocks from the font, short of the
   * line, so every block leaves a sliver of its background showing; else
   * quadrants, which every terminal with a decent font has.
   * ORBRUN_TERM_BLOCKS (cell, half, quadrant, sextant, octant) says otherwise.
   */
  const blocks = (): keyof typeof BLOCKS => {
    const said = process.env.ORBRUN_TERM_BLOCKS
    if (said && said in BLOCKS) return said as keyof typeof BLOCKS
    const named = /ghostty|rex|kitty/i.test(`${process.env.TERM_PROGRAM ?? ''} ${process.env.TERM ?? ''}`)
    if (named || kitty) return 'octant'
    return process.env.TERM_PROGRAM === 'Apple_Terminal' ? 'cell' : 'quadrant'
  }
  io.onInput((d) => {
    const raw = d.toString('latin1')
    const rest = raw.replace(PROBE_REPLY, (_m, g: string | undefined, h: string | undefined, w: string | undefined) => {
      if (g !== undefined) kitty = g === 'OK'
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
  })
  io.onResize((c, r) => {
    cols = c
    rows = r
    screen = new Screen(cols, rows, 0)
    sent = {}
    void io.write('\x1b[0m\x1b[2J')
    dirty = true
  })
  await io.write('\x1b[?1049h\x1b[?25l\x1b[2J' + PROBE)

  // ---- one frame: every cell of the terminal
  const frame = () => {
    const n = cols * rows
    const char: string[] = new Array(n).fill(' ')
    const fg = new Uint8Array(n * 3)
    const bg = new Uint8Array(n * 3)
    const put = (x: number, y: number, c: string, f: RGB, b: RGB) => {
      if (x < 0 || y < 0 || x >= cols || y >= rows) return
      const i = y * cols + x
      char[i] = c
      fg.set(f, i * 3)
      bg.set(b, i * 3)
    }
    const fill = (x: number, y: number, w: number, h: number, b: RGB) => {
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) put(i, j, ' ', TEXT, b)
    }
    const text = (x: number, y: number, line: Line, width: number, b: RGB) => {
      let cx = x
      for (const s of cut(line, width))
        for (const c of s.text) {
          put(cx++, y, c, s.fg ?? TEXT, s.lit ? LIT_BG : (s.bg ?? b))
        }
    }

    const st = session.state
    images = {}
    const vw = cols
    const vh = rows

    // the view, or the level map, under everything
    if (!over && screenState().mapShown) drawMap(put, fill, 0, 0, vw, vh)
    else if (vw > 0 && vh > 0) {
      // a pixel a dot of the cell's block character: octants' are square in a cell twice as tall as it is wide
      const kind = blocks()
      const { sx, sy } = BLOCKS[kind] as { sx: number; sy: number }
      const w = vw * sx
      const h = vh * sy
      const buf = new Uint8Array(w * h * 3)
      const cellAspect = Number(process.env.ORBRUN_TERM_CELL_ASPECT) || cellPx.h / cellPx.w
      view.draw(w, h, buf, (cellAspect * sx) / sy)
      const pic = blockCells(buf, w, h, 3, vw, vh, kind) as { char: string[]; fg: Uint8Array; bg: Uint8Array }
      for (let y = 0; y < vh; y++)
        for (let x = 0; x < vw; x++) {
          const i = y * vw + x
          const o = y * cols + x
          char[o] = pic.char[i]
          fg.set(pic.fg.subarray(i * 3, i * 3 + 3), o * 3)
          bg.set(pic.bg.subarray(i * 3, i * 3 + 3), o * 3)
        }
    }

    // the HUD over the view, as the browser lays it (hud.ts `layout`): bare, the view left whole round the text
    /**
     * How much of the view at a cell stays under text: PANE_SHADE, or less where
     * the view is bright, so what is left is no brighter than TEXT_GROUND and
     * light text reads on a white wall as on a dark one.
     */
    const keep = (o: number) => {
      const i = o * 3
      const lum = (0.3 * (fg[i] + bg[i]) + 0.59 * (fg[i + 1] + bg[i + 1]) + 0.11 * (fg[i + 2] + bg[i + 2])) / 2
      return lum > 0 ? Math.min(PANE_SHADE, TEXT_GROUND / lum) : PANE_SHADE
    }
    /** the view at a cell, its two colours mixed, darkened for text to stand on */
    const behind = (x: number, y: number): RGB => {
      const o = y * cols + x, i = o * 3
      const k = keep(o)
      return [0, 1, 2].map((ch) => ((fg[i + ch] + bg[i + ch]) / 2) * k + PANE_BG[ch] * (1 - k)) as RGB
    }
    // a line on the view: each character on the view darkened behind it, as the browser shadows its text
    // (styles.css `.hud .stats` text-shadow) rather than backing it; a blank leaves the view, but where it is a bar
    const inked = new Uint8Array(n)
    const over_ = (x: number, y: number, line: Line, width: number) => {
      if (y < 0 || y >= rows) return
      let cx = x
      for (const s of cut(line, width))
        for (const c of s.text) {
          if (cx >= 0 && cx < cols && (c !== ' ' || s.bg || s.lit)) {
            put(cx, y, c, s.fg ?? TEXT, s.lit ? LIT_BG : (s.bg ?? behind(cx, y)))
            inked[y * cols + cx] = 1
          }
          cx++
        }
    }
    /** the shadow a cell further: the view either side of the text darkened as under it, its blocks kept */
    const pad = () => {
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++) {
          const o = y * cols + x
          if (inked[o] || !((x > 0 && inked[o - 1]) || (x < cols - 1 && inked[o + 1]))) continue
          const k = keep(o)
          for (let ch = 0; ch < 3; ch++) {
            fg[o * 3 + ch] = fg[o * 3 + ch] * k + PANE_BG[ch] * (1 - k)
            bg[o * 3 + ch] = bg[o * 3 + ch] * k + PANE_BG[ch] * (1 - k)
          }
        }
    }
    const playing = st.phase === 'playing' && !!st.player.name && !!session.scene.cells.size
    if (playing && !screenState().mapShown) {
      // the stats pane at the top-left, a share of the width as the phone's narrower column is (console.ts `gameSplit`):
      // under 36 cells its rows print the short captions (stats.ts `compactStats`), so a small terminal keeps its view
      const statsW = Math.min(STAT_WIDTH + 2, Math.max(24, Math.round(cols * STATS_SHARE)), cols - 22)
      // the right column: the minimap at the top, the monster list under it
      let sideW = Math.min(34, Math.max(20, Math.floor(cols * 0.22)))
      let mapH = Math.min(Math.floor(sideW / 2), Math.max(0, rows - 10))
      if (kitty) {
        // the level's own tiles, sized as the browser sizes its map (hud.ts `minimapFit`) on a screen of the terminal's
        // pixels: up to half its width and never over the stats pane, 70% of its height, the settings' tiles and cell
        const gw = cols * cellPx.w, gh = rows * cellPx.h
        const set = getSettings()
        const fit = minimapFit({ w: Math.min(gw * 0.5, gw - (statsW + 1) * cellPx.w), h: gh * 0.7 }, Math.min(gw, gh), set.minimapTiles, set.minimapCell)
        if (fit.w > 0) {
          sideW = Math.max(sideW, Math.ceil(fit.w / cellPx.w))
          mapH = Math.ceil(fit.h / cellPx.h)
          // the player on the middle tile, the square against the corner of the cells it takes
          const sc = session.scene
          const left = sc.player.x - (fit.tiles - 1) / 2, top = sc.player.y - (fit.tiles - 1) / 2
          const boxW = sideW * cellPx.w, boxH = mapH * cellPx.h
          images.minimap = {
            at: [cols - sideW, 0],
            cols: sideW,
            rows: mapH,
            key: `${sc.revision},${left},${top},${fit.tiles},${fit.cell},${boxW},${boxH}`,
            make: () => ({ px: corner(view.minimap(left, top, fit.tiles, fit.tiles, fit.cell), fit.w, fit.h, boxW, boxH), w: boxW, h: boxH }),
          }
          // the cone the view faces, over the north-up map on the player's cell (hud.ts `placeCone`), turned with the view
          const yaw = view.camera?.yaw ?? 0
          const fov = view.fovAcross((cols * cellPx.w) / (rows * cellPx.h))
          const cx = boxW - fit.w + (sc.player.x - left + 0.5) * fit.cell, cy = (sc.player.y - top + 0.5) * fit.cell
          if (sc.playerOnLevel)
            images.cone = {
              at: [cols - sideW, 0],
              cols: sideW,
              rows: mapH,
              z: 1,
              key: `${cx},${cy},${fit.cell},${boxW},${boxH},${yaw.toFixed(3)},${fov.toFixed(3)}`,
              make: () => ({ px: facingCone(boxW, boxH, cx, cy, fit.cell, yaw, fov), w: boxW, h: boxH }),
            }
        }
      }
      const sideX = cols - sideW
      if (!kitty) drawMinimap(put, behind, sideX, 0, sideW, mapH)
      const monH = drawMonsters(sideX, mapH, sideW, rows - mapH, over_)
      // the portrait, where the terminal shows images: PORTRAIT_ROWS rows square at the corner, the rows beside it after a cell
      const portraitW = kitty ? Math.round((PORTRAIT_ROWS * cellPx.h) / cellPx.w) : 0
      const side = PORTRAIT_ROWS * cellPx.h
      // a cell in from the edge as the rows are, its cells padded either side as the text is
      if (portraitW) for (let y = 0; y < PORTRAIT_ROWS; y++) for (let x = 1; x <= portraitW; x++) inked[y * cols + x] = 1
      if (portraitW) images.portrait = { at: [1, 0], cols: portraitW, rows: PORTRAIT_ROWS, key: `${session.scene.revision},${side}`, make: () => { const px = view.portrait(side); return px && { px, w: side, h: side } } }
      const s = statsRows(st.player, st.options, statsPrev, statsW - 2, portraitW ? portraitW + 1 : 0)
      statsPrev = s.prev
      const statsH = Math.min(s.rows.length, rows)
      // a cell in from the edge: the padding either side of the text is the edge's
      s.rows.slice(0, statsH).forEach((row, i) => over_(1, i, fromRow(row), statsW - 2))
      // the messages along the bottom, as wide as the right column leaves them
      const msgH = Math.min(Math.max(3, st.messages.paneHeight || 5) + 1, Math.floor(rows / 3))
      const reach = mapH + monH
      const msgW = rows - msgH < reach ? sideX - 1 : cols
      const pane = paneRows(st.messages, msgH - 1, msgW - 2)
      // the newest line on the last row, or on the one over the --more-- line
      const lines = pane.lines.filter((row) => row.length)
      const foot = pane.more.length ? rows - 2 : rows - 1
      lines.forEach((row, i) => over_(1, foot - (lines.length - 1 - i), fromRow(row), msgW - 2))
      if (pane.more.length) over_(1, rows - 1, fromRow(pane.more), msgW - 2)
      pad()
    }

    // the top overlay: crawl's menus and popups, prompts, Orbrun's sheets; or, out of a game, what next
    const stack = over ? null : host.querySelector('.overlay-stack')
    if (over) {
      const why = st.exit?.message || st.exit?.reason || 'The game is over.'
      const lines = [why, '', 'Enter: play (a new character, or continue a saved one)', 'q: quit']
      const bw = Math.min(cols - 2, Math.max(...lines.map((l) => l.length)) + 6)
      const bx = Math.floor((cols - bw) / 2)
      const by = Math.floor((rows - lines.length - 2) / 2)
      fill(bx, by, bw, lines.length + 2, BOX_BG)
      lines.forEach((l, i) => text(bx + 3, by + 1 + i, [{ text: l, fg: i === 0 ? PALETTE[14] : TEXT }], bw - 6, BOX_BG))
    }
    const top = stack ? (Array.from(stack.children).reverse().find((e) => !(e as HTMLElement).hidden && (e.textContent ?? '').trim()) as Element | undefined) : undefined
    if (top) {
      const bw = Math.min(cols - 2, Math.max(40, Math.min(100, cols - 8)))
      const inner = bw - 4
      const { lines, lit } = layout(top, inner)
      const bh = Math.min(rows - 2, lines.length + 2)
      const bx = Math.floor((cols - bw) / 2)
      const by = Math.max(0, Math.floor((rows - bh) / 2))
      fill(bx, by, bw, bh, BOX_BG)
      for (let i = bx; i < bx + bw; i++) {
        put(i, by, '─', BORDER, BOX_BG)
        put(i, by + bh - 1, '─', BORDER, BOX_BG)
      }
      for (let j = by; j < by + bh; j++) {
        put(bx, j, '│', BORDER, BOX_BG)
        put(bx + bw - 1, j, '│', BORDER, BOX_BG)
      }
      put(bx, by, '┌', BORDER, BOX_BG)
      put(bx + bw - 1, by, '┐', BORDER, BOX_BG)
      put(bx, by + bh - 1, '└', BORDER, BOX_BG)
      put(bx + bw - 1, by + bh - 1, '┘', BORDER, BOX_BG)
      // keep the lit line in view
      const room = bh - 2
      const focus = lit.length ? lit[lit.length - 1] : 0
      const scroll = Math.max(0, Math.min(lines.length - room, focus - Math.floor(room / 2)))
      for (let i = 0; i < room && scroll + i < lines.length; i++) text(bx + 2, by + 1 + i, lines[scroll + i], inner, BOX_BG)
      if (scroll > 0) put(bx + bw - 2, by + 1, '▲', BORDER, BOX_BG)
      if (scroll + room < lines.length) put(bx + bw - 2, by + bh - 2, '▼', BORDER, BOX_BG)
    } else if (!over && (st.phase !== 'playing' || !session.scene.cells.size)) {
      const msg = ended ? 'Saving…' : session.loading ? 'Loading…' : 'Starting crawl…'
      text(Math.max(0, Math.floor((cols - msg.length) / 2)), Math.floor(rows / 2), [{ text: msg, fg: PALETTE[14] }], cols, PANE_BG)
    }
    return { char, fg, bg }
  }
  let statsPrev = {}
  /** the images the frame wants over its cells, where the terminal shows them: by name, each made when sent */
  let images: Record<string, Image> = {}

  type Put = (x: number, y: number, c: string, f: RGB, b: RGB) => void
  type Fill = (x: number, y: number, w: number, h: number, b: RGB) => void

  /** The level map: every known cell as crawl's glyph, in crawl's colours, centred on the cursor or the player. */
  function drawMap(put: Put, fill: Fill, x0: number, y0: number, w: number, h: number) {
    fill(x0, y0, w, h, [0, 0, 0])
    const sc = session.scene
    const cur = session.state.cursors.find((c) => c) ?? sc.player
    const left = cur.x - Math.floor(w / 2)
    const top = cur.y - Math.floor(h / 2)
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const c = sc.cells.get(cellKey(left + i, top + j))
        if (!c || !c.glyph) continue
        const col = PALETTE[(c.colour ?? 7) & 15] ?? TEXT
        const dim = c.visibility === 'remembered'
        put(x0 + i, y0 + j, c.glyph, dim ? col.map((v) => v * 0.55) as RGB : col, [0, 0, 0])
      }
    const px = sc.player.x - left
    const py = sc.player.y - top
    if (px >= 0 && py >= 0 && px < w && py < h) put(x0 + px, y0 + py, '@', PALETTE[15], [0, 0, 0])
  }

  /**
   * The monster list (hud.ts `renderMonsters`, monster_list.js) at (x0, y0),
   * each row ending at the right edge: the monsters in view grouped as the
   * browser groups them, at most MONSTER_ROWS, a line each: the bearing from
   * facing and the name (or "3 jackals") in its attitude's colour, without
   * the browser's sprites. Returns the rows it took.
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
        line = [{ text: ARROWS[rel] + ' ', fg: TEXT }, { text: name, fg: first.threat === 'trivial' ? (colour.map((v) => v * 0.75) as RGB) : colour }]
        if (r === n - 1 && n < all) line.push({ text: ' ...', fg: [0xaa, 0xaa, 0xaa] })
      }
      const len = Math.min(w - 2, line.reduce((k, s) => k + s.text.length, 0))
      over(right - len, y, line, len)
    }
    return n
  }

  /** A minimap: two cells of the level a character, in half blocks, in the top-right corner. */
  /** An image `w` x `h` (RGBA) in the top-right corner of a clear one `bw` x `bh`. */
  function corner(px: Uint8Array, w: number, h: number, bw: number, bh: number): Uint8Array {
    const out = new Uint8Array(bw * bh * 4)
    const x0 = Math.max(0, bw - w)
    for (let y = 0; y < Math.min(h, bh); y++) out.set(px.subarray(y * w * 4, (y * w + Math.min(w, bw)) * 4), (y * bw + x0) * 4)
    return out
  }

  /**
   * The cells a minimap `w` x `h` cells shows: what is known, against the
   * top-right corner; a level bigger than the map follows the player, the
   * edges kept in. Its top-left cell.
   */
  function minimapWindow(w: number, h: number): { left: number; top: number } {
    const sc = session.scene
    let x0k = Infinity, x1k = -Infinity, y0k = Infinity, y1k = -Infinity
    for (const c of sc.cells.values())
      if (c.kind !== 'unknown') {
        x0k = Math.min(x0k, c.x)
        x1k = Math.max(x1k, c.x)
        y0k = Math.min(y0k, c.y)
        y1k = Math.max(y1k, c.y)
      }
    const fit = (lo: number, hi: number, size: number, at: number, end: boolean) =>
      hi - lo + 1 <= size ? (end ? hi - size + 1 : lo) : Math.max(lo, Math.min(hi - size + 1, at - Math.floor(size / 2)))
    if (!Number.isFinite(x0k)) return { left: sc.player.x - Math.floor(w / 2), top: sc.player.y - Math.floor(h / 2) }
    return { left: fit(x0k, x1k, w, sc.player.x, true), top: fit(y0k, y1k, h, sc.player.y, false) }
  }

  function drawMinimap(put: Put, behind: (x: number, y: number) => RGB, x0: number, y0: number, w: number, h: number) {
    const sc = session.scene
    const { left, top } = minimapWindow(w, h * 2)
    const mons = new Set(sc.billboards.filter((b) => b.kind === 'monster').map((b) => cellKey(b.x, b.y)))
    const items = new Set(sc.billboards.filter((b) => b.kind === 'item').map((b) => cellKey(b.x, b.y)))
    const colourAt = (x: number, y: number): RGB | null => {
      if (x === sc.player.x && y === sc.player.y) return [255, 255, 80]
      const k = cellKey(x, y)
      const c = sc.cells.get(k)
      if (!c || c.kind === 'unknown') return null
      const seen = c.visibility === 'visible'
      if (seen && mons.has(k)) return [230, 60, 60]
      if (seen && items.has(k)) return [80, 200, 120]
      let rgb: RGB =
        c.flags.lava ? [200, 60, 20] : c.flags.water ? [40, 80, 200] : c.kind === 'wall' ? [120, 120, 130] : c.kind === 'door' ? [160, 110, 40] : c.kind === 'feature' ? [80, 170, 190] : [60, 60, 66]
      if (!seen) rgb = rgb.map((v) => v * 0.55) as RGB
      return rgb
    }
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const t = colourAt(left + i, top + j * 2)
        const b = colourAt(left + i, top + j * 2 + 1)
        if (!t && !b) continue
        // half a cell that is not known shows the view behind, darkened as under text
        const under = behind(x0 + i, y0 + j)
        put(x0 + i, y0 + j, '▀', t ?? under, b ?? under)
      }
  }

  // ---- the loop: a frame when something changed, at most `fps` a second
  const minMs = 1000 / (o.fps ?? 120)
  let busy = false
  // ORBRUN_TERM_TRACE=1 also counts the frames: how many, how long one took to make and to send, and the bytes
  const stats = { frames: 0, make: 0, send: 0, bytes: 0, since: performance.now() }
  const tick = async () => {
    const start = performance.now()
    if (ended && busy) return
    const r = session.state.rev.any
    if (r !== rev) {
      rev = r
      dirty = true
    }
    if (dirty && !busy) {
      dirty = false
      busy = true
      let out = screen.update(frame())
      out += sendImages()
      const made = performance.now()
      if (out) await io.write(out)
      busy = false
      stats.frames++
      stats.make += made - start
      stats.send += performance.now() - made
      stats.bytes += out.length
    }
    if (process.env.ORBRUN_TERM_TRACE && start - stats.since > 2000) {
      const n = stats.frames || 1
      trace(`${cols}x${rows}: ${((stats.frames * 1000) / (start - stats.since)).toFixed(0)} frames/s, make ${(stats.make / n).toFixed(2)} ms, send ${(stats.send / n).toFixed(2)} ms, ${((stats.bytes / (start - stats.since)) * 1000 / 1024).toFixed(0)} KB/s`)
      Object.assign(stats, { frames: 0, make: 0, send: 0, bytes: 0, since: start })
    }
    // the next frame is due a frame after this one began, not after it ended
    setTimeout(tick, Math.max(0, minMs - (performance.now() - start)))
  }
  void tick()

  /**
   * The frame's images as kitty images over their cells: each sent when its
   * pixels or its place changed (the portrait with every step, the minimap
   * as the level is seen), taken down when the frame wants it no more.
   */
  function sendImages(): string {
    let out = ''
    for (const [name, id] of Object.entries(IMAGE_IDS)) {
      const want = images[name]
      const last = sent[name]
      if (want && last && last.key === want.key && last.at === `${want.at},${want.cols},${want.rows}`) continue
      const made = want?.make()
      if (!want || !made) {
        if (sent[name]) out += `\x1b_Ga=d,d=I,i=${id},q=2\x1b\\`
        delete sent[name]
        continue
      }
      const at = `${want.at},${want.cols},${want.rows}`
      const same = last && last.at === at && last.px.length === made.px.length && Buffer.compare(last.px, made.px) === 0
      sent[name] = { at, key: want.key, px: made.px }
      if (same) continue
      out += `\x1b[${want.at[1] + 1};${want.at[0] + 1}H` + kittyImage(id, made.px, made.w, made.h, want.cols, want.rows, want.z ?? 0)
    }
    return out
  }

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
    await io.write(Object.values(IMAGE_IDS).map((id) => `\x1b_Ga=d,d=I,i=${id},q=2\x1b\\`).join('') + '\x1b[0m\x1b[2J\x1b[?25h\x1b[?1049l')
    io.end(0)
  }
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

