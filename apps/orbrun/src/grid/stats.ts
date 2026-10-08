/**
 * The stats pane on the grid.
 *
 * The sidebar's columns hold the WebTiles `#stats` pane as text rows, one
 * console row each, in the order and with the captions player.js
 * `update_stats_pane` uses and game.html `#stats` lays out. Every width is
 * the stylesheet's percentage of the pane, in whole cells: the HP and MP bars
 * are `#stats_hp_bar`'s 55% (23 of 42 cells), the left column
 * `#stats_leftcolumn`'s 45% (the 19 cells before the bar), the noise bar
 * `#stats_noise` 95% × `#stats_noise_inter` 61% × `#stats_noise_bar` 82%
 * (9 cells; 11 when superloud, the bar "goes to eleven"). A bar is painted
 * on those cells: `update_bar`'s four segments as percentages of the
 * maximum, on the track.
 *
 * Colours and thresholds come from the player's rc through the `options`
 * message (`hp_colour`, `mp_colour`, `stat_colour`, `show_game_time`,
 * `always_show_doom_contam`); nothing is decided here. Pure: a `player`
 * message in, rows out, so a recorded session pins it.
 */
import { hasStatus, indexToLetter, type PlayerState, type ServerOptions } from '@orbrun/webtiles'
import { STAT_WIDTH } from './console'
import { blank, cutRow, fromFormatted, joinRows, padRow, rowLength, wrapRow, type Row, type Span } from './rows'

/** style.css `.stats_caption`: brown */
const CAPTION = 6
/** style.css `#stats_titleline, #stats_species_god, #stats_piety`: yellow */
const TITLE = 14
/** style.css `#stats_wizmode`: blue */
const WIZMODE = 1
/** style.css `#stats_piety.penance`: red; `.monk`: darkgray */
const PENANCE = 4
const MONK = 8
/**
 * The Health and Magic bars are WebTiles' own (game.html `#stats_hp_bar` /
 * `#stats_mp_bar`, `.bar` at `height: 1em`): flat blocks the row's full
 * height, `update_bar`'s four segments laid left to right on a darkgray
 * track, in style.css's colours — `_full` lightgreen for health and
 * lightblue for magic, `_poison` yellow, `_decrease` red / magenta,
 * `_increase` green / blue, the track `#stats_hp_bar`'s own darkgray. The
 * colours are the palette's entries, so the bars take Orbrun's palette the
 * way every other coloured span in the pane does, and nothing is
 * translucent: a bar stands on its track, not on the view behind it.
 *
 * The one thing WebTiles has that the pane here does not is a black page
 * behind it. Its darkgray track reads as the dark part of the bar because
 * it sits on black; on Orbrun's bare pane the same grey sits over a lit
 * dungeon and the bar reads washed out, its empty end nearly as bright as
 * its fill. So the track is the palette's darkgray taken most of the way
 * to black (`--stats-bar-track`): the black WebTiles paints under it,
 * folded into the colour, keeping the bar's contrast where the official
 * client has it.
 *
 * The whole bar is one CSS background the host paints across its cells
 * rather than a span a segment, so a boundary lands on the exact percentage
 * `update_bar` computes and not on the nearest cell — the pane's cells are
 * a far coarser grid than the percent WebTiles lays these out in.
 */
/** style.css: the track `#stats_hp_bar` darkgray over the black page it stands on (styles.css), and `update_bar`'s segments, as palette entries */
const BAR_TRACK = 'var(--stats-bar-track)'
const BAR_POISON = 14
export type BarColours = { full: number; decrease: number; increase: number }
/** `#stats_hp_bar_full` lightgreen, `_decrease` red, `_increase` green */
export const HP_BAR: BarColours = { full: 10, decrease: 4, increase: 2 }
/** `#stats_mp_bar_full` lightblue, `_decrease` magenta, `_increase` blue */
export const MP_BAR: BarColours = { full: 9, decrease: 5, increase: 1 }
/** the frame `barCells` lays the segments in: fractions of the bar, as `update_bar`'s percentages are */
const BAR_FRAME = 1

/** a horizontal gradient of hard stops, `stops` as [fraction from, fraction to, palette entry or css colour] */
function stripes(stops: [number, number, number | string][]): string {
  const pct = (f: number) => Math.round(f * 10000) / 100 + '%'
  const colour = (c: number | string) => (typeof c === 'number' ? `var(--color-${c})` : c)
  return `linear-gradient(to right, ${stops.map(([a, b, c]) => `${colour(c)} ${pct(a)} ${pct(b)}`).join(', ')})`
}

/**
 * `update_bar`'s segments as one span `cells` wide: the full segment, the
 * poison segment, then the change since the last update, and the track for
 * whatever is left of the bar. `seg` is `update_bar` in fractions of the
 * bar (`barCells` on `BAR_FRAME`), so each block ends where WebTiles ends
 * it.
 */
function paintBar(cells: number, seg: ReturnType<typeof barCells>, c: BarColours): Row {
  if (cells <= 0) return []
  const stops: [number, number, number | string][] = []
  let at = 0
  const paint = (width: number, colour: number | string) => {
    if (width > 0) stops.push([at, at + width, colour])
    at += width
  }
  paint(seg.full, c.full)
  paint(seg.poison, BAR_POISON)
  paint(seg.decrease, c.decrease)
  paint(seg.increase, c.increase)
  if (!stops.length) return [blank(cells, BAR_TRACK)]
  // a gradient carries its last colour to its end, so the track closes the bar off past the segments
  if (at < BAR_FRAME) stops.push([at, BAR_FRAME, BAR_TRACK])
  return [blank(cells, stripes(stops))]
}

/** style.css `#stats_noise_bar`: the track; `_decrease` darkgray; `_full` by `data-level` */
const NOISE_TRACK = '#2f2f2f'
const NOISE_DECREASE = 8
const NOISE_FULL: Record<string, string> = { quiet: '#d3d3d3', loud: '#ffd700', veryloud: '#ff0000', superloud: '#ff00ff', blank: '#000000' }
/** player.js `stat_boosters`: a status that paints the stat lightblue */
const STAT_BOOSTERS: Record<string, RegExp> = {
  str: /vitalised/,
  int: /vitalised/,
  dex: /vitalised/,
  hp: /divinely vigorous|berserking/,
  mp: /divinely vigorous/,
}

/** player.js `old_hp`, `old_mp`, `old_noise`: the values a bar last showed, sizing its change segment */
export interface BarMemory {
  hp?: number
  mp?: number
  noise?: number
}

/**
 * The portrait (hud.md): the player's own cell, drawn by the cell renderer
 * at the pane's top-left corner, stands this many rows tall, beside the title
 * and the species-of-god lines, which start after it. The rows below it run
 * the pane's full width, so the bars and the two columns keep their cells.
 */
export const PORTRAIT_ROWS = 4

/**
 * The pane's narrow layout. WebTiles has no such thing: `#stats` is always
 * `enums.stat_width` wide, because the official client is a desktop client
 * and its sidebar never gives way. Orbrun's does (console.ts `gameSplit`
 * shrinks the column so a phone still gets a dungeon), and below this many
 * cells the captions no longer fit their columns -- `XL: 27 Next: 44%` alone
 * wants 16 of the left column's 45%. So under it the pane prints the same
 * lines with the captions cut to what names them (`Next:` dropped entirely,
 * the percentage simply following the level; `Place:` down to the `@` that
 * is the player). The portrait keeps its four rows, as on the wide pane.
 */
const COMPACT_WIDTH = 36

/** the pane at `width` cells prints the short captions */
function compactStats(width: number): boolean {
  return width < COMPACT_WIDTH
}

/** the pane's regions, in cells, for a sidebar `width` wide */
function statsColumns(width = STAT_WIDTH): { bar: number; split: number } {
  // #stats_hp_bar floats right at 55%; #stats_leftcolumn is the 45% before it, so the two share a column
  const bar = Math.round(width * 0.55)
  return { bar, split: width - bar }
}

/**
 * `update_bar` in player.js in the texels of a `frame` wide: the full
 * segment, then (for hp) the yellow poison segment for
 * `hp - poison_survival`, then the change since the last update as a
 * decrease or increase, on the track. The segments are its percentages of
 * the maximum, cumulative so they never sum past the frame, and are left
 * unrounded: the bar is the icons' frame stretched over the pane's cells,
 * so the fill ends exactly where a monster's does (`minibarRects`, which
 * takes the fraction raw) and not on a texel or a cell boundary.
 */
function barCells(frame: number, value: number, max: number, old: number | undefined, poisonSurvival?: number): { full: number; poison: number; decrease: number; increase: number; track: number } {
  max = max || 1
  value = Math.max(0, value)
  let oldValue = old === undefined ? value : old
  if (oldValue > max) oldValue = max
  const increase = oldValue < value
  let full = Math.round((10000 * (increase ? oldValue : value)) / max)
  let change = Math.floor((10000 * Math.abs(oldValue - value)) / max)
  let poison = 0
  if (poisonSurvival !== undefined && poisonSurvival < value) {
    poison = Math.round((10000 * (value - poisonSurvival)) / max)
    full = Math.round((10000 * poisonSurvival) / max)
  }
  if (full + poison + change > 10000) change = 10000 - poison - full
  const at = (pct: number) => Math.min(frame, (frame * pct) / 10000)
  const fullC = at(full)
  const poisonC = at(full + poison) - fullC
  const changeC = at(full + poison + change) - fullC - poisonC
  return { full: fullC, poison: poisonC, decrease: increase ? 0 : changeC, increase: increase ? changeC : 0, track: frame - fullC - poisonC - changeC }
}

/**
 * `percentage_color` in player.js: a booster status paints the value
 * lightblue; otherwise the rc's `hp_colour` / `mp_colour` thresholds apply,
 * against the real maximum when drained.
 */
function percentageColour(p: PlayerState, opts: ServerOptions, name: 'hp' | 'mp'): Partial<Span> {
  if (hasStatus(p, STAT_BOOSTERS[name])) return { cls: 'boosted_stat' }
  const real = name === 'hp' && p.real_hp_max && p.real_hp_max !== p.hp_max ? p.real_hp_max : (p[name + '_max'] as number)
  const colour = thresholdColour(opts[name + '_colour'], (p[name] / (real || 1)) * 100)
  return colour ? { cls: 'colour_' + colour } : {}
}

/** `stat_class` in player.js: lost, then rc `stat_colour`, then boosted, then below maximum. */
function statClass(p: PlayerState, opts: ServerOptions, name: 'str' | 'int' | 'dex'): Partial<Span> {
  if (hasStatus(p, new RegExp('lost ' + name))) return { cls: 'zero_stat' }
  const colour = thresholdColour(opts.stat_colour, p[name])
  if (colour) return { cls: 'colour_' + colour }
  if (hasStatus(p, STAT_BOOSTERS[name])) return { cls: 'boosted_stat' }
  if (p[name] < (p[name + '_max'] as number)) return { cls: 'degenerated_stat' }
  return {}
}

function thresholdColour(limits: unknown, pct: number): string | null {
  if (!Array.isArray(limits)) return null
  let colour: string | null = null
  for (const l of limits as { value: number; colour: string }[]) if (pct <= l.value) colour = l.colour
  return colour
}

/** `update_defense` in player.js: lightblue when boosted, red when degenerated */
function defense(p: PlayerState, type: 'ac' | 'ev' | 'sh'): Span {
  const mod = p[type + '_mod'] as number
  const s: Span = { text: String(p[type]) }
  if (mod > 0) s.cls = 'boosted_defense'
  else if (mod < 0) s.cls = 'degenerated_defense'
  return s
}

/** `update_stat` in player.js: the value, and the maximum in parentheses when below it */
function stat(p: PlayerState, opts: ServerOptions, name: 'str' | 'int' | 'dex'): Span {
  const val = p[name]
  const max = p[name + '_max'] as number
  return { text: String(val) + (val < max ? ` (${max})` : ''), ...statClass(p, opts, name) }
}

/**
 * `wielded_weapon` in player.js: the unarmed attack in `weapon_colour`, or
 * the item, coloured by `weapon_colour` unless it is -1. Servers before
 * `weapon_colour` existed (0.34) leave it at -1, so the item's own colour,
 * or lightgray for unarmed, applies as in the older client.
 */
function wieldedWeapon(p: PlayerState, offhand: boolean): Span {
  const index = offhand ? p.offhand_index : p.weapon_index
  const colour = offhand ? p.offhand_weapon_colour : p.weapon_colour
  if (index === -1) return { text: p.unarmed_attack, fg: colour !== -1 && colour != null ? colour : 7 }
  const item = p.inv[index]
  const col = colour !== -1 && colour != null ? colour : item?.col != null && item.col !== -1 ? item.col : undefined
  const s: Span = { text: item?.name || '' }
  if (col !== undefined) s.fg = col
  return s
}

const cap = (text: string): Span => ({ text, fg: CAPTION })
/** a caption and, on a compact pane, the shorter one that stands for it; the long one is its tooltip there */
const capShort = (compact: boolean, text: string, short: string): Span => (compact ? { text: short, fg: CAPTION, title: text.replace(/:$/, '') } : { text, fg: CAPTION })
const rep = (ch: string, n: number) => ch.repeat(Math.max(0, n))

/**
 * The pane as rows of `width` cells, in `update_stats_pane` order: title
 * (with `*WIZARD*` / `*EXPLORE*` at the right end), species of god with
 * piety, Health and Magic with their bars, the two columns (AC, EV, SH, XL
 * and Next, Noise on the left; Str with Doom, Int with Contam, Dex, Place,
 * Time or Turn on the right), the weapon, the off-hand weapon for Coglins,
 * the quiver, and the status lights, wrapped. `prev` is the bar memory from
 * the last call; the returned one feeds the next. `portrait` is the cells the
 * first `PORTRAIT_ROWS` rows leave blank at the left for the portrait;
 * those rows keep their layout in the room that is left (the wizmode marker still
 * ends at the pane's right edge, the bars run to it). `corner` lays the same out
 * beside the minimap at the top of a phone held upright (`cornerRows`).
 */
export function statsRows(p: PlayerState, opts: ServerOptions, prev: BarMemory = {}, width = STAT_WIDTH, portrait = 0, corner = false): { rows: Row[]; prev: BarMemory } {
  const { split } = statsColumns(width)
  const compact = corner || compactStats(width)
  const rows: Row[] = []
  const next: BarMemory = {}
  // the rows beside the portrait: blank cells under it, then the row on what is left
  const lead = Math.max(0, Math.min(portrait, width))
  const leadAt = (i: number) => (i < PORTRAIT_ROWS ? lead : 0)
  const beside = (row: Row): Row => (leadAt(rows.length) ? [blank(leadAt(rows.length)), ...row] : row)
  const besideW = width - leadAt(0)
  /** a row built for the room the next row has: `room` cells, its columns by `statsColumns` */
  const place = (build: (room: number, cols: ReturnType<typeof statsColumns>) => Row) => {
    const room = width - leadAt(rows.length)
    rows.push(beside(cutRow(build(room, statsColumns(room)), room)))
  }

  // title line, the wizmode marker floated right
  const wiz = p.wizard ? '*WIZARD*' : p.explore ? '*EXPLORE*' : ''
  const title: Row = [{ text: p.name + ((p.title || '')[0] === ',' ? '' : ' ') + (p.title || ''), fg: TITLE }]
  const titleIn = (room: number): Row => (wiz ? joinRows(title, room - wiz.length, [{ text: wiz, fg: WIZMODE }]) : cutRow(title, room))

  // species of god, piety pips, Gozag's gold. Trunk's player.js prints `species_display_name`; a 0.34
  // server (the recorded CDI session) sends only `species`, which its own client printed.
  let speciesGod = p.species_display_name || p.species || ''
  if (p.god) speciesGod += ' of ' + p.god
  const pietyColour = p.penance ? PENANCE : p.god ? TITLE : MONK
  const piety: Row = []
  const rank = p.piety_rank
  if (p.god === 'Xom') piety.push({ text: rank >= 0 ? rep('.', rank) + '*' + rep('.', 5 - rank) : '......', fg: pietyColour })
  else if ((rank > 0 || p.god !== '') && p.god !== 'Gozag') {
    piety.push({ text: rep('*', rank) + rep('.', 6 - rank - p.ostracism_pips), fg: pietyColour })
    if (p.ostracism_pips) piety.push({ text: rep('X', p.ostracism_pips), fg: 5 })
  }
  const tail: Row = []
  if (piety.length) tail.push({ text: ' ' }, ...piety)
  if (p.god === 'Gozag') tail.push(capShort(compact, ' Gold: ', ' $:'), { text: String(p.gold), ...(hasStatus(p, /gold aura/) ? { cls: 'boosted_stat' } : {}) })
  // too long for its room (beside the portrait on a phone held upright), the line keeps the piety or the
  // gold whole: the species goes first, then the god's name is cut, the whole line its tooltip
  const line2 = (room: number): Row => {
    const full: Row = [{ text: speciesGod, fg: TITLE }, ...tail]
    if (!p.god || rowLength(full) <= room) return cutRow(full, room)
    const head = cutRow([{ text: p.god, fg: TITLE, title: speciesGod }], Math.max(1, room - rowLength(tail)), true)
    return cutRow([...head, ...tail], room)
  }

  // the two columns
  const showDoomContam = (v: number) => !(v === 0 && opts.always_show_doom_contam === false)
  const doomColour = p.doom >= 75 ? 5 : p.doom >= 50 ? 12 : p.doom >= 25 ? 14 : p.doom === 0 ? 8 : 7
  const contamColour = p.contam >= 200 ? 4 : p.contam >= 100 ? 14 : 8
  const showTime = opts.show_game_time === true
  const clock = showTime ? (p.time / 10).toFixed(1) : String(p.turn)
  const time = clock + (p.time_delta ? ` (${(p.time_delta / 10).toFixed(1)})` : '')
  const left: Row[] = [
    [cap('AC:'), { text: ' ' }, defense(p, 'ac')],
    [cap('EV:'), { text: ' ' }, defense(p, 'ev')],
    [cap('SH:'), { text: ' ' }, defense(p, 'sh')],
    // compact: the percentage follows the level with no caption between them, as `XL: 27 44%`
    compact ? [cap('XL:'), { text: ` ${p.xl} ` }, { text: `${p.progress}%`, title: 'Next' }] : [cap('XL:'), { text: ` ${p.xl} ` }, cap('Next:'), { text: ` ${p.progress}%` }],
    noiseRow(p, prev, next, split, compact),
  ]
  const right: Row[] = [
    [capShort(compact, 'Str:', 'St:'), { text: ' ' }, stat(p, opts, 'str')],
    [capShort(compact, 'Int:', 'In:'), { text: ' ' }, stat(p, opts, 'int')],
    [capShort(compact, 'Dex:', 'Dx:'), { text: ' ' }, stat(p, opts, 'dex')],
    [capShort(compact, 'Place:', '@:'), { text: ' ' + p.place + (p.depth ? ':' + p.depth : '') }],
    [capShort(compact, showTime ? 'Time:' : 'Turn:', 'T:'), { text: ' ' + time }],
  ]
  // game.html: Doom sits 2.2em after Str, Contam 1.1em after Int
  if (showDoomContam(p.doom)) right[0].push({ text: compact ? ' ' : '  ' }, capShort(compact, 'Doom:', 'Dm:'), { text: ` ${p.doom}%`, fg: doomColour, title: p.doom_desc || undefined })
  if (showDoomContam(p.contam)) right[1].push({ text: ' ' }, capShort(compact, 'Contam:', 'Cn:'), { text: ` ${p.contam}%`, fg: contamColour })
  // Health and Magic: the bar over the row, one cell, then the value/max left-aligned in one column at the
  // pane's right edge (as wide as the longer of the two, so the bars end together). WebTiles prints
  // `Health:` / `Magic:` (and `HP:` when drained) before the number; here the bar's colour names it and the
  // word is the value's tooltip, so the bar can be as long as the room beside the portrait allows (hud.md).
  // player.js deletes `old_hp` / `old_mp` on game_init and sets them only in update_bar, which runs on a
  // `player` message; the pane drawn before the first one (a max of 0, as game_init leaves it) remembers
  // nothing, or the first message would paint the whole bar as an increase
  const realHp = p.real_hp_max !== p.hp_max
  if (p.hp_max) next.hp = Math.max(0, p.hp)
  const hpValue: Row = [{ text: String(p.hp), title: realHp ? 'HP' : 'Health', ...percentageColour(p, opts, 'hp') }, { text: '/' + p.hp_max, title: realHp ? 'HP' : 'Health' }]
  if (realHp) hpValue.push({ text: ` (${p.real_hp_max})`, title: 'HP' })
  let mpValue: Row | undefined
  if (p.species !== 'Djinni') {
    if (p.mp_max) next.mp = Math.max(0, p.mp)
    mpValue = [{ text: String(p.mp), title: 'Magic', ...percentageColour(p, opts, 'mp') }, { text: '/' + p.mp_max, title: 'Magic' }]
    if (p.species === 'Deep Dwarf' && p.dd_real_mp_max !== p.mp_max) mpValue.push({ text: ` (${p.dd_real_mp_max})`, title: 'Magic' })
  } else next.mp = prev.mp
  // the column is as wide as the value at its maximum (`hp_max/hp_max`), not as the digits it shows now, so
  // health ticking past ten or a hundred moves nothing: the bar only changes length when a maximum does
  const widest = (value: Row, v: number, max: number) => rowLength(value) + Math.max(0, String(max).length - String(v).length)
  const valueW = Math.max(widest(hpValue, p.hp, p.hp_max), mpValue ? widest(mpValue, p.mp, p.mp_max) : 0)
  const valueBar = (value: Row, room: number, paint: (cells: number) => Row): Row => [...paint(Math.max(1, room - valueW - 1)), blank(1), ...padRow(cutRow(value, valueW), valueW)]
  const hpBar = (room: number) => valueBar(hpValue, room, (cells) => paintBar(cells, barCells(BAR_FRAME, p.hp, p.hp_max, prev.hp, p.poison_survival), HP_BAR))
  const mpBar = (room: number) => valueBar(mpValue!, room, (cells) => paintBar(cells, barCells(BAR_FRAME, p.mp, p.mp_max, prev.mp), MP_BAR))

  // weapon, off-hand weapon (Coglins), quiver
  const weapon: Row = [cap(indexToLetter(p.weapon_index) + ')'), { text: ' ' }, wieldedWeapon(p, false)]
  const offhand: Row | null = p.offhand_weapon ? [cap(indexToLetter(p.offhand_index) + ')'), { text: ' ' }, wieldedWeapon(p, true)] : null
  const quiver = fromFormatted(p.quiver_desc || '')

  // status lights: only entries with a light, in the server's colour and order, wrapped
  const lights: Row = []
  for (const st of p.status) {
    if (!st.light) continue
    if (lights.length) lights.push({ text: ' ' })
    lights.push({ text: st.light, fg: st.col ?? 7, title: st.desc || undefined })
  }

  if (corner) {
    // Doom and Contam without the gap after Str and Int that sets them off there, one cell between them
    const doomContam: Row = []
    if (showDoomContam(p.doom)) doomContam.push(...right[0].slice(4), { text: ' ' })
    if (showDoomContam(p.contam)) doomContam.push(...right[1].slice(4), { text: ' ' })
    // the time without the last action's length after it: the column has no room to spare for it
    const clockRow: Row = [capShort(true, showTime ? 'Time:' : 'Turn:', 'T:'), { text: ' ' + clock }]
    const stacked = cornerRows(width, lead, { title: titleIn, line2, hp: hpBar, mp: mpValue ? mpBar : null, left, right: right.map((r) => r.slice(0, 3)), doomContam, noise: noiseRow(p, prev, next, CORNER_NOISE, true), time: clockRow, weapon, offhand, quiver, lights })
    return { rows: stacked, prev: next }
  }

  rows.push(beside(titleIn(besideW)))
  rows.push(beside(line2(besideW)))
  place(hpBar)
  if (mpValue) place(mpBar)

  // a Djinni's pane has no Magic row, so its AC row still sits beside the portrait
  for (let i = 0; i < left.length; i++) place((_, cols) => joinRows(left[i], cols.split, right[i]))

  rows.push(cutRow(weapon, width, true))
  if (offhand) rows.push(cutRow(offhand, width, true))
  rows.push(cutRow(quiver, width, true))
  for (const l of wrapRow(lights, width)) rows.push(l)

  return { rows, prev: next }
}

/** the noise bar's room in the corner, as `noiseRow`'s split: a short bar after the caption */
const CORNER_NOISE = 8
/** the cells between the defences and the attributes */
const CORNER_GAP = 2

/**
 * The pane as a column of `width` cells beside the minimap at the top of a
 * phone held upright (console.ts gameSplit). WebTiles has no such layout.
 * Beside the portrait (`lead` cells) the title, the species line and the two
 * bars; under it, the stats as narrow as they go, the band being taller than
 * it is wide: the defences beside the attributes, a pair a row, as game.html
 * stands its two columns, then the level, the noise, the place and the time
 * a row each; then Doom and Contam when they show, the weapon, the off-hand
 * weapon, the quiver, a row each, and the status lights, wrapped. `left`
 * and `right` are the pane's two columns.
 */
function cornerRows(width: number, lead: number, r: { title: (room: number) => Row; line2: (room: number) => Row; hp: (room: number) => Row; mp: ((room: number) => Row) | null; left: Row[]; right: Row[]; doomContam: Row; noise: Row; time: Row; weapon: Row; offhand: Row | null; quiver: Row; lights: Row }): Row[] {
  const room = Math.max(1, width - lead)
  const rows: Row[] = [r.title(room), r.line2(room), r.hp(room), r.mp ? r.mp(room) : []].map((l) => [blank(lead), ...l])
  // the attributes on one column after the widest defence
  const defenceW = Math.max(...r.left.slice(0, 3).map(rowLength))
  for (let i = 0; i < 3; i++) rows.push([...padRow(r.left[i], defenceW + CORNER_GAP), ...r.right[i]])
  rows.push(r.left[3], r.noise, r.right[3], r.time)
  if (r.doomContam.length) rows.push(r.doomContam.slice(0, -1))
  rows.push(r.weapon)
  if (r.offhand) rows.push(r.offhand)
  if (r.quiver.length) rows.push(r.quiver)
  for (const l of wrapRow(r.lights, width)) if (r.lights.length) rows.push(l)
  return rows.map((row) => cutRow(row, width, true))
}

/**
 * `update_bar_noise` in player.js on the left column: the caption, then the
 * bar right-aligned in `#stats_noise_inter` (61% of the 95% row; 45% when
 * wizard mode shows the number), 82% of that wide, all of it when
 * superloud. Silenced blanks the bar and prints `Silenced` where it was.
 */
function noiseRow(p: PlayerState, prev: BarMemory, next: BarMemory, split: number, compact = false): Row {
  const max = 1000
  let level = Math.max(0, p.adjusted_noise || 0)
  let old = prev.noise === undefined ? level : prev.noise
  if (old > max) old = max
  let cat = level <= 333 ? 'quiet' : level <= 666 ? 'loud' : level < 1000 ? 'veryloud' : 'superloud'
  const silenced = hasStatus(p, /silence/)
  if (silenced) {
    level = 0
    old = 0
    cat = 'blank'
  }
  next.noise = level
  const showNum = !!p.wizard && !silenced
  const noiseW = Math.round(split * 0.95)
  const interW = Math.round(noiseW * (showNum ? 0.45 : 0.61))
  const barW = cat === 'superloud' ? interW : Math.round(interW * 0.82)
  let full = Math.round((10000 * level) / max)
  let change = Math.round((10000 * Math.abs(old - level)) / max)
  if (full + change > 10000) change = 10000 - full
  const fullC = Math.min(barW, Math.round((barW * full) / 10000))
  const changeC = Math.min(barW - fullC, Math.round((barW * change) / 10000))
  const row: Row = [capShort(compact, 'Noise:', 'N:')]
  if (showNum) row.push({ text: ' ' + p.noise, fg: 7 })
  const lead = noiseW - interW
  if (silenced) {
    // style.css #stats_noise_status: magenta, at the right end of the row
    const status = 'Silenced'
    return [...padRow(row, Math.max(rowLength(row), noiseW - status.length)), { text: status, fg: 5 }]
  }
  const bar: Row = []
  if (fullC) bar.push({ text: ' '.repeat(fullC), bg: NOISE_FULL[cat], cls: 'noise_' + cat })
  if (changeC) bar.push(blank(changeC, NOISE_DECREASE))
  if (barW - fullC - changeC > 0) bar.push(blank(barW - fullC - changeC, NOISE_TRACK))
  return [...padRow(cutRow(row, lead), lead), ...bar]
}
