/**
 * Grid test bed: the "one console grid" vision, playable.
 *
 * One rule, everywhere: the screen is a grid of console cells holding a level;
 * a menu is a room carved into the centre of that level, its choices lying on
 * the floor as console glyphs with their labels beside them, the server's
 * switches printed under its wall; the player's @ walks the room and stands on
 * a choice to take it. Keyboard sees the console keys. A pad sees a button
 * glyph painted into each printed bracket, and the message line says what A
 * does where you stand.
 *
 * Served by the app's dev server at /testbed/grid.html; not part of the build.
 * The level, HUD and inventory are mock; the skills screen is a recorded
 * server fixture. `?pad` lets the keyboard stand in for a pad.
 */
import { GamepadInput, type Button, type PadEvent } from '../src/gamepad'
import { glyph } from '../src/glyphs'
import { crtPlainText, scrapeSkills } from '../src/crt-scrape'
import fixture from './skills-crt.json'

// ------------------------------------------------------------------ the grid

interface Hotspot {
  key: string
  label: string
  line: number
  col: number
  len: number
  kind: 'row' | 'switch' | 'cancel'
  act(): void
}

interface RoomEntry {
  /** what lies on the floor cell: an item glyph, a feature, a training sign, or floor */
  glyph: string
  color: number
  /** the printed key; an entry without one is a heading or a note */
  key?: string
  label: string
  labelColor: number
  /** what the message line says when the @ stands here */
  here?: string
  act?: () => void
}

/** A menu as a room of the level: carved into its centre, entries on the floor, switches under the wall. */
interface RoomSpec {
  title: string
  entries: RoomEntry[]
  footer: string[]
  onSwitch(key: string): void
  cancel?: () => void
}

interface Screen {
  lines: string[]
  hotspots: Hotspot[]
  /** the room's door, where the @ starts; the player's own cell with no room */
  start: { line: number; col: number }
}

type Cell = { ch: string; c: number }

let cellPx = Number(localStorage.getItem('grid.cell') || 18)
let cols = 80
let rows = 24
let cellW = cellPx * 0.6
const HUD_W = 42
const MSG_H = 6

const screenEl = document.getElementById('screen')!
const gridEl = document.getElementById('grid')!
const helpEl = document.getElementById('help')!

function measure() {
  const probe = document.createElement('span')
  probe.style.font = `${cellPx}px/1 var(--mono)`
  probe.style.position = 'absolute'
  probe.style.whiteSpace = 'pre'
  probe.textContent = 'M'.repeat(100)
  document.body.append(probe)
  cellW = probe.getBoundingClientRect().width / 100
  probe.remove()
  const W = screenEl.clientWidth
  const H = screenEl.clientHeight
  cols = Math.max(40, Math.floor(W / cellW))
  rows = Math.max(16, Math.floor(H / cellPx))
  document.documentElement.style.setProperty('--cell', cellPx + 'px')
  // centre the grid: the leftover pixels become an even margin
  document.documentElement.style.setProperty('--ox', Math.floor((W - cols * cellW) / 2) + 'px')
  document.documentElement.style.setProperty('--oy', Math.floor((H - rows * cellPx) / 2) + 'px')
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function fg(n: number, s: string): string {
  return `<span class="fg${n}">${esc(s)}</span>`
}

// ------------------------------------------------------------------ the level

// the backdrop: in a game the real level, outside one a game fetched from a server
const MAP = [
  '##########.....##########',
  '#........#.....#........#',
  '#........+.....+........#',
  '#........#..@..#........#',
  '######.###.....###.######',
  '     #.#####.#####.#     ',
  '     #.......g.....#     ',
  '     ###############     ',
]

function colorOf(ch: string): number {
  return ch === '#' || ch === '+' ? 6 : ch === '.' || ch === '@' ? 8 : ch === 'g' ? 2 : 7
}

/** A footer line's bracketed switches, as the server prints them. */
function footerSwitches(text: string, line: number, col: number, act: (key: string) => void): Hotspot[] {
  const out: Hotspot[] = []
  const ms = Array.from(text.matchAll(/\[(\S+)\]/g))
  ms.forEach((m, i) => {
    const key = m[1]
    if (key.length !== 1) return // ranges like [a-z] and named keys like [Esc] are not switches
    const start = m.index ?? 0
    const limit = i + 1 < ms.length ? ms[i + 1].index! : text.length
    const rest = text.slice(start + m[0].length, limit)
    const stop = rest.search(/ {2,}/)
    const label = (stop < 0 ? rest : rest.slice(0, stop)).trim()
    out.push({ key, label, line, col: col + start, len: m[0].length + (stop < 0 ? rest.trimEnd().length : stop), kind: 'switch', act: () => act(key) })
  })
  return out
}

/**
 * The grid: the level in the viewport, the HUD beside it, messages below.
 * With a room, the level's centre is carved out for it: walls, a door on the
 * west wall by the first entry, the title on the wall above, the switches
 * printed under the wall below.
 */
function screen(room?: RoomSpec): Screen {
  const viewW = cols - HUD_W
  const viewH = rows - MSG_H - 1
  const g: Cell[][] = Array.from({ length: viewH }, () => Array.from({ length: viewW }, () => ({ ch: ' ', c: 7 })))
  const put = (y: number, x: number, ch: string, c: number) => {
    if (y >= 0 && y < viewH && x >= 0 && x < viewW) g[y][x] = { ch, c }
  }
  const text = (y: number, x: number, str: string, c: number) => Array.from(str).forEach((ch, i) => put(y, x + i, ch, c))
  const ox = Math.floor(viewW / 2) - 12
  const oy = Math.floor(viewH / 2) - 3
  MAP.forEach((row, y) => Array.from(row).forEach((ch, x) => ch !== ' ' && put(oy + y, ox + x, ch === '@' ? '.' : ch, colorOf(ch))))
  let start = { line: oy + 3, col: ox + 12 }
  const hot: Hotspot[] = []
  if (room) {
    const n = room.entries.length
    const w = 3 + Math.max(...room.entries.map((e) => e.label.length)) + 1
    const x0 = Math.max(1, Math.floor((viewW - w) / 2))
    const y0 = Math.max(2, Math.floor((viewH - n) / 2))
    for (let y = y0 - 1; y <= y0 + n; y++)
      for (let x = x0 - 1; x <= x0 + w; x++) {
        const wall = y === y0 - 1 || y === y0 + n || x === x0 - 1 || x === x0 + w
        put(y, x, wall ? '#' : '.', wall ? 6 : 8)
      }
    put(y0, x0 - 1, '+', 6)
    start = { line: y0, col: x0 - 1 }
    text(y0 - 2, x0 - 1, room.title, 15)
    room.entries.forEach((e, i) => {
      put(y0 + i, x0 + 1, e.glyph, e.color)
      text(y0 + i, x0 + 3, e.label, e.labelColor)
      if (e.key) hot.push({ key: e.key, label: e.label, line: y0 + i, col: x0 + 1, len: 1, kind: 'row', act: e.act! })
    })
    room.footer.forEach((f, i) => {
      const fy = y0 + n + 1 + i
      text(fy, x0 - 1, f, 7)
      hot.push(...footerSwitches(f, fy, x0 - 1, room.onSwitch))
      const escAt = f.indexOf('[Esc]')
      if (escAt >= 0 && room.cancel) hot.push({ key: 'Escape', label: 'Exit', line: fy, col: x0 - 1 + escAt, len: 10, kind: 'cancel', act: room.cancel })
    })
    if (room.cancel && !hot.some((h) => h.kind === 'cancel')) hot.push({ key: 'Escape', label: 'Exit', line: 0, col: 0, len: 0, kind: 'cancel', act: room.cancel })
  }
  const hud = [
    fg(15, 'Orbruntest the Slinger') + '   ' + fg(7, 'Minotaur Hunter'),
    fg(7, 'Health: ') + fg(2, '19/24') + '  ' + fg(2, '=================') + fg(8, '------'),
    fg(7, 'Magic:  ') + fg(9, '2/2') + '    ' + fg(9, '======================='),
    fg(7, 'AC: 5    Str: 17'),
    fg(7, 'EV: 12   Int:  7'),
    fg(7, 'SH: 0    Dex: 13'),
    fg(7, 'XL: 3 Next: 41%  Place: Dungeon:2'),
    fg(7, 'Noise: ') + fg(8, '=----') + '  Time: 1234.5 (10.0)',
    fg(7, 'a) +1 sling   b) 12 stones'),
    '',
    fg(2, 'g') + ' ' + fg(7, 'goblin ') + fg(2, '========') + ' ' + fg(8, 'asleep'),
  ]
  const lines = g.map((row, r) => {
    let html = ''
    let run = ''
    let c = -1
    for (const cell of row) {
      if (cell.c !== c) {
        if (run) html += fg(c, run)
        run = ''
        c = cell.c
      }
      run += cell.ch
    }
    return html + fg(c, run) + ' ' + (hud[r] ?? '')
  })
  lines.push(fg(8, '─'.repeat(viewW)) + ' ' + fg(8, '─'.repeat(HUD_W - 2)))
  const msgs = [fg(7, 'You see here a stone.'), fg(7, 'A goblin comes into view.'), fg(8, 'i inventory, m skills, Esc home.')]
  for (let i = 0; i < MSG_H - 1; i++) lines.push(msgs[i] ?? '')
  return { lines, hotspots: hot, start }
}

// ------------------------------------------------------------------ the rooms

function homeRoom(): RoomSpec {
  const row = (glyph: string, color: number, key: string, label: string, here: string, act: () => void): RoomEntry => ({ glyph, color, key, label: `${key} - ${label}`, labelColor: 15, here, act })
  return {
    title: 'ORBRUN',
    entries: [
      row('>', 7, 'p', 'Play        crawl.dcss.io as orbruntest', 'There is a stone staircase down here.', enterGame),
      row('\\', 5, 'w', 'Watch       14 games running', 'There is a gateway to the gallery here.', () => say('The gallery is not built in this test bed.')),
      row('+', 6, 's', 'Servers     crawl.dcss.io, cbro, cue', 'There is a closed door here.', () => say('The servers screen is not built in this test bed.')),
      row('?', 7, 'o', 'Settings    text size, first person, haptics', 'You see here a scroll labelled SETTINGS.', () => say('The settings scroll is not built in this test bed.')),
      row('<', 2, 'q', 'Quit', 'There is a stone staircase up here.', () => say('You cannot leave a test bed.')),
    ],
    footer: [],
    onSwitch: () => {},
  }
}

const INVENTORY: { key: string; text: string; glyph: string; color: number; head?: string }[] = [
  { key: 'a', text: '+1 sling (weapon)', glyph: ')', color: 7, head: 'Hand Weapons' },
  { key: 'c', text: 'hand axe', glyph: ')', color: 7 },
  { key: 'b', text: '12 stones (quivered)', glyph: '(', color: 6, head: 'Missiles' },
  { key: 'd', text: '+0 leather armour (worn)', glyph: '[', color: 6, head: 'Armour' },
  { key: 'e', text: 'scroll labelled IWOMUJU', glyph: '?', color: 15, head: 'Scrolls' },
  { key: 'f', text: '2 scrolls of teleportation', glyph: '?', color: 15 },
  { key: 'g', text: 'potion of curing', glyph: '!', color: 13, head: 'Potions' },
  { key: 'h', text: 'wand of flame (11)', glyph: '/', color: 5, head: 'Wands' },
]
let invMode: 'examine' | 'use' = 'examine'

function inventoryRoom(): RoomSpec {
  const entries: RoomEntry[] = []
  let lastHead = ''
  for (const it of INVENTORY) {
    if (it.head && it.head !== lastHead) {
      entries.push({ glyph: '.', color: 8, label: it.head, labelColor: 9 })
      lastHead = it.head
    }
    const verb = () => (invMode === 'examine' ? 'Examine' : 'Use')
    entries.push({
      glyph: it.glyph,
      color: it.color,
      key: it.key,
      label: `${it.key} - ${it.text}`,
      labelColor: 7,
      here: `You see here ${/^\d/.test(it.text) ? '' : 'a '}${it.text}.`,
      act: () => say(`You ${verb().toLowerCase()} the ${it.text}.`),
    })
  }
  return {
    title: `Inventory: ${INVENTORY.length}/52 slots`,
    entries,
    footer: [`[!] ${invMode === 'examine' ? 'examine|use' : 'use|examine'}   [?] help   [/] sort   [Esc] exit`],
    onSwitch: (k) => {
      if (k === '!') {
        invMode = invMode === 'examine' ? 'use' : 'examine'
        say(`Action mode: ${invMode}.`)
      } else if (k === '?') say('Help is not built in this test bed.')
      else if (k === '/') say('Sorted (well, not really).')
    },
    cancel: closeRoom,
  }
}

// the skills screen: the fixture's txt messages applied in order give the
// server's two views (cost and target columns); its rows and switches are
// scraped exactly as the app does, then laid out as a room
type Txt = { msg: 'txt'; lines: Record<string, string> }
const SKILL_VIEWS: string[][] = (() => {
  const cur: string[] = []
  const views: string[][] = []
  for (const m of fixture as unknown as (Txt | { msg: string })[]) {
    if (m.msg !== 'txt') continue
    const t = m as Txt
    for (const [i, l] of Object.entries(t.lines)) cur[Number(i)] = crtPlainText(l)
    // a full repaint is a view; single-line updates are the server toggling a row
    if (Object.keys(t.lines).length > 5) views.push(Array.from(cur, (l) => l || ''))
  }
  return views
})()
let skillView = 0
const skillSigns = new Map<string, string>() // local toggles of the training sign, standing in for the server

function skillsRoom(): RoomSpec {
  const plain = SKILL_VIEWS[skillView].map((l) => {
    for (const [k, sign] of skillSigns) l = l.replace(new RegExp(`(${k} )[-+*]( [A-Z])`), `$1${sign}$2`)
    return l
  })
  const hks = scrapeSkills(plain)
  const rowLines = new Set(hks.filter((h) => h.kind === 'row').map((h) => h.line))
  const footLines = new Set(hks.filter((h) => h.kind === 'footer').map((h) => h.line))
  const squeeze = (s: string) => s.trim().replace(/ {3,}/g, '  ')
  const note = (s: string, c: number): RoomEntry => ({ glyph: '.', color: 8, label: squeeze(s), labelColor: c })
  // the header, then each column of skills in turn, then the notes; the footer is the server's
  const entries: RoomEntry[] = [note(plain[0], 9)]
  const cols = Array.from(new Set(hks.filter((h) => h.kind === 'row').map((h) => h.group)))
  for (const col of cols)
    for (const h of hks.filter((x) => x.kind === 'row' && x.group === col)) {
      const sign = plain[h.line][h.col + 2]
      entries.push({
        glyph: sign,
        color: sign === '+' ? 10 : sign === '*' ? 14 : 8,
        key: h.key,
        label: `${h.key} ${squeeze(plain[h.line].slice(h.col + 4, h.col + h.len))}`,
        labelColor: sign === '-' ? 8 : 15,
        here: `${h.label}: ${sign === '-' ? 'not training' : sign === '*' ? 'focused' : 'training'}.`,
        act: () => {
          skillSigns.set(h.key, sign === '-' ? '+' : '-')
          say(`${sign === '-' ? 'Training' : 'Not training'} ${h.label}.`)
        },
      })
    }
  plain.forEach((l, i) => i > 0 && l.trim() && !rowLines.has(i) && !footLines.has(i) && entries.push(note(l, 7)))
  return {
    title: 'Skills',
    entries,
    footer: plain.filter((_, i) => footLines.has(i)).map(squeeze),
    onSwitch: (k) => {
      if (k === '!') skillView = (skillView + 1) % SKILL_VIEWS.length
      say(`${hks.find((h) => h.key === k)?.label ?? k}: ${k}`)
    },
    cancel: closeRoom,
  }
}

// ------------------------------------------------------------------ state

type Device = 'kbd' | 'pad'
let device: Device = location.search.includes('pad') ? 'pad' : 'kbd'
const pads = new GamepadInput()
if (device === 'pad') pads.kind = 'xbox'

let inGame = false
let room: (() => RoomSpec) | null = homeRoom
let current: Screen | null = null
let cursor = 0
/** where the @ stands, walked a cell at a time toward the hovered entry */
let at = { line: 0, col: 0 }
let atTimer = 0
let message = ''
let msgTimer = 0

function say(s: string) {
  message = s
  clearTimeout(msgTimer)
  msgTimer = window.setTimeout(() => {
    message = ''
    render()
  }, 2500)
  render()
}
function openRoom(r: () => RoomSpec) {
  room = r
  cursor = 0
  at = screen(r()).start
  render()
}
function closeRoom() {
  room = null
  clearInterval(atTimer)
  render()
}
function enterGame() {
  inGame = true
  closeRoom()
  say('Welcome back, Orbruntest the Minotaur Hunter.')
}
function goHome() {
  inGame = false
  openRoom(homeRoom)
}

/** The @ walks to the hovered entry: across first, then along the column; a new hover retargets it. */
function walk() {
  const t = target()
  if (!t || (at.line === t.line && at.col === t.col)) return
  clearInterval(atTimer)
  atTimer = window.setInterval(() => {
    const t = target()
    if (!t) return clearInterval(atTimer)
    if (at.col !== t.col) at.col += at.col < t.col ? 1 : -1
    else if (at.line !== t.line) at.line += at.line < t.line ? 1 : -1
    if (at.col === t.col && at.line === t.line) clearInterval(atTimer)
    render()
  }, 35)
}
function rowsOf(s: Screen) {
  return s.hotspots.filter((h) => h.kind === 'row')
}
function target(): Hotspot | undefined {
  return current ? rowsOf(current)[cursor] : undefined
}

// ------------------------------------------------------------------ rendering

function marker(line: number, col: number, cls: string, content: string | Node, width = 1) {
  const row = gridEl.children[line] as HTMLElement | undefined
  if (!row) return
  const m = document.createElement('span')
  m.className = 'marker ' + cls
  // in pixels: a badge's own font is smaller than the cell, so its `ch` would be too
  m.style.left = Math.round(col * cellW) + 'px'
  m.style.width = Math.round(width * cellW) + 'px'
  if (typeof content === 'string') m.textContent = content
  else m.append(content)
  row.append(m)
}

/** The switches promoted to face buttons, in printed order with help last. */
function promoted(s: Screen): Partial<Record<Button, Hotspot>> {
  const sw = s.hotspots.filter((h) => h.kind === 'switch').sort((a, b) => Number(a.key === '?') - Number(b.key === '?'))
  const order: Button[] = ['X', 'Y', 'LT', 'RT']
  const out: Partial<Record<Button, Hotspot>> = {}
  sw.forEach((h, i) => order[i] && (out[order[i]] = h))
  return out
}

function render() {
  measure()
  const spec = room?.()
  const s = screen(spec)
  current = s
  gridEl.replaceChildren()
  for (let r = 0; r < rows; r++) {
    const div = document.createElement('div')
    div.className = 'line'
    div.innerHTML = s.lines[r] || ' '
    gridEl.append(div)
  }
  const t = target()
  if (spec) walk()
  else at = s.start
  marker(at.line, at.col, 'at', '@')
  const standing = !!t && at.line === t.line && at.col === t.col
  const entry = spec && t ? spec.entries.find((e) => e.key === t.key) : undefined
  if (device === 'pad') {
    for (const [btn, h] of Object.entries(promoted(s)) as [Button, Hotspot][]) marker(h.line, h.col, 'badge', glyph(btn, pads.kind), 3)
    const cancel = s.hotspots.find((h) => h.kind === 'cancel')
    if (cancel && cancel.len) marker(cancel.line, cancel.col, 'badge', glyph('B', pads.kind), 5)
  }
  // the bottom line: the message; else what is underfoot, and on a pad what A does there
  const bl = gridEl.children[rows - 1] as HTMLElement
  bl.innerHTML = ''
  const m = document.createElement('span')
  m.className = 'msg'
  if (message) m.textContent = message
  else if (standing && entry) {
    if (device === 'pad') m.append(glyph('A', pads.kind), entry.label.replace(/^. - /, ''))
    else m.textContent = entry.here ?? ''
  } else if (!spec) m.textContent = 'i inventory, m skills, Esc home'
  bl.append(m)
  helpEl.textContent = `${cols}×${rows} cells at ${cellPx}px · ${device === 'pad' ? pads.kind + ' pad' : 'keyboard'} · -/= or L3/R3 text size`
}

// ------------------------------------------------------------------ the one bindings table

type Op = 'up' | 'down' | 'pageUp' | 'pageDown' | 'select' | 'cancel' | 'X' | 'Y' | 'LT' | 'RT' | 'bigger' | 'smaller'

function act(op: Op) {
  if (op === 'bigger' || op === 'smaller') {
    cellPx = Math.max(10, Math.min(40, cellPx + (op === 'bigger' ? 2 : -2)))
    localStorage.setItem('grid.cell', String(cellPx))
    render()
    return
  }
  if (room && current) {
    const n = rowsOf(current).length
    switch (op) {
      case 'up':
        cursor = (cursor - 1 + n) % n
        return render()
      case 'down':
        cursor = (cursor + 1) % n
        return render()
      case 'pageUp':
        cursor = Math.max(0, cursor - 8)
        return render()
      case 'pageDown':
        cursor = Math.min(n - 1, cursor + 8)
        return render()
      case 'select':
        return target()?.act()
      case 'cancel':
        return current.hotspots.find((h) => h.kind === 'cancel')?.act()
      default:
        return promoted(current)[op]?.act()
    }
  }
  // in the game with nothing open (a stand-in: the real thing is the runner)
  switch (op) {
    case 'cancel':
      return goHome()
    case 'X':
      return openRoom(inventoryRoom)
    case 'Y':
      return openRoom(skillsRoom)
    case 'select':
      return say('You rest.')
    default:
      say('The dungeon does not move in this test bed.')
  }
}

// keyboard: the console's keys, untouched
window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return
  // ?pad: the keyboard stands in for a pad, so the glyph layer can be checked without one
  if (!location.search.includes('pad')) device = 'kbd'
  const k = e.key
  const keys: Record<string, Op> = { ArrowUp: 'up', ArrowDown: 'down', PageUp: 'pageUp', PageDown: 'pageDown', Enter: 'select', Escape: 'cancel', '-': 'smaller', '=': 'bigger' }
  if (keys[k]) act(keys[k])
  else if (room && current && k.length === 1) {
    // a printed key goes straight to its hotspot, as the server would take it
    const h = current.hotspots.find((x) => x.key === k)
    if (h) {
      if (h.kind === 'row') {
        cursor = rowsOf(current).indexOf(h)
        at = { line: h.line, col: h.col }
      }
      h.act()
      render()
    } else if (k === 'j') act('down')
    else if (k === 'k') act('up')
    else return
  } else if (inGame && k === 'i') openRoom(inventoryRoom)
  else if (inGame && k === 'm') openRoom(skillsRoom)
  else if (inGame && k.length === 1) say(`'${k}' would go to the server untouched.`)
  else return
  e.preventDefault()
})

// pad: the same table on buttons
const PAD: Partial<Record<Button, Op>> = { A: 'select', B: 'cancel', X: 'X', Y: 'Y', LT: 'LT', RT: 'RT', LB: 'pageUp', RB: 'pageDown', DU: 'up', DD: 'down', L3: 'smaller', R3: 'bigger' }
pads.on((e: PadEvent) => {
  device = 'pad'
  if (e.type === 'press' || (e.type === 'repeat' && (e.button === 'DU' || e.button === 'DD'))) {
    const op = PAD[e.button]
    if (op) act(op)
  } else if ((e.type === 'dir' || e.type === 'dirRepeat') && e.dir !== null) {
    if (e.dir === 0) act('up')
    else if (e.dir === 4) act('down')
  }
})

function frame(t: number) {
  pads.poll(t)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
window.addEventListener('resize', render)
openRoom(homeRoom)
