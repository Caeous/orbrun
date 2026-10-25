import { consoleHtml, consoleTable } from './console-text'
import { escapeHtml } from './dom'

/**
 * A morgue file (chardump.cc) as HTML to read on any screen. The official
 * client links the file and the browser shows it as it is, eighty columns
 * across; on a phone held upright, forty-odd across, that breaks every table
 * row in two and every long line mid-word. So the file is read a block at a
 * time (the runs of lines between its blank ones), and each part is set the
 * way it reads best: as crawl drew it where eighty columns fit, and on a
 * phone so that nothing breaks:
 *
 * - a table drawn with `|` and `+` (the skills by level, the actions, the
 *   gods, the time in each place) is a table, its row labels standing still
 *   while a narrow screen slides its numbers across;
 * - a table of columns side by side (the stats, the gear beside the
 *   resistances, the branches) keeps them side by side where they fit, and
 *   on a phone stacks them in groups that do;
 * - a table under a row of headings (the spells) keeps a row to a line where
 *   it fits, and on a phone wraps each row over two lines, the columns still
 *   lined up under their headings;
 * - the notes keep their turn and place in columns, each note whole;
 * - a map stays as drawn, sliding across where it must;
 * - a line of entries (the shops) wraps between them, never inside one, and
 *   a list under labels (the vaults by level) hangs under its first entry;
 * - the rest is crawl's console text, as the character overview is set in a
 *   popup (console-text.ts), with the lines crawl broke at eighty columns put
 *   back together and an item's words hung under its name.
 *
 * styles.css `.morgue` sets them out; PHONE_COLS is what a phone fits.
 */
export function morgueHtml(text: string): string {
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.trimEnd())
  const blocks: string[][] = []
  for (let i = 0; i < lines.length; ) {
    if (!lines[i]) {
      i++
      continue
    }
    const block: string[] = []
    while (i < lines.length && lines[i]) block.push(lines[i++])
    blocks.push(block)
  }
  return blocks.map(blockHtml).join('')
}

/** how many columns a phone held upright fits, the narrowest (360 pixels across): what a table on one is packed to */
const PHONE_COLS = 40
/** the room between columns a table is packed with */
const GAP = 2
/** crawl's console width: where it breaks its own lines */
const CONSOLE_COLS = 80

/** a line of a map: dungeon features and monsters, never a word */
function mapLine(l: string): boolean {
  const t = l.replace(/ /g, '')
  if (!t) return false
  const letters = (t.match(/\p{L}/gu) ?? []).length
  return !/\p{L}{3}/u.test(t) && letters * 3 <= t.length
}

/** a rule across a table drawn with `|` and `+`: `-------+-----`, `+---+---+` */
const TABLE_RULE = /^ *\+?[-=]+(?:\+[-=+]*)+ *$/
/** the notes' headings (chardump.cc `_sdump_notes`) */
const NOTES_HEAD = /^Turn +\| Place +\| Note$/
/** a note: `  2296 | D:4      | Slain by a gnoll` */
const NOTE = /^ *(\d*) *\| (.*?) *\| ?(.*)$/
/** the rest of a note crawl broke onto the next line, under its column: `                  | Orb.` */
const NOTE_REST = /^ {8,}\| ?(.*)$/
/** a heading over a column: words alone */
const HEADING = /^[A-Za-z][A-Za-z ]*$/
/**
 * a label with a list after it, padded out to where the list starts: `D:1:      lightli_arrival_noodles, ...`, and in a
 * wizard's game its level's debug tag before it, `[+gen,+vis] D:1:      ...`
 */
const LABELLED = /^((?:\[[^\]]*\] )?\S+:)( +)\S/
/** a label with nothing after it, in a wizard's list (`[+gen,-vis] Bailey`) */
const LABEL_ONLY = /^\[[^\]]*\] \S+:?$/
/** a number in a table's cell: a count, a percentage, a time */
const NUMBER = /^[-+]?[\d.,]+%?$/
/** the titles of a morgue's parts (chardump.cc), which stand out over them */
const TITLE = /^(?:Inventory:|Message History|Vanquished Creatures(?: \(.*\))?|Notes|Illustrated notes|Dungeon Overview and Level Annotations|Innate Abilities, Weirdness & Mutations|Levels and vault maps discovered:|Skills:|Table legend:.*|Top non-repeatable levels by time:|Conducts for god: .*|Piety from conduct|Conduct count|DLua errors:|You knew the following spells:|Your spell library contained the following spells:)$/
/** a line of entries crawl spaced across the screen: `D:4 ?   D:6 [   D:12 *` (three spaces or more between) */
const ENTRIES = /\S {3,}\S.* {3,}\S/
/** one of the overview's keys before its list (output.cc `_status_mut_rune_list`): `@: corroded`, `A: plant physiology` */
const KEY_LINE = /^\S: \S/
/** an artefact's property and what it does, padded apart: `   rF+:       It protects you from fire.` */
const PROPERTY = /^ *\S[^:]{0,22}: {2,}\S/
const indentOf = (l: string) => /^ */.exec(l)![0].length
/** an item, by its letter: `j - the +7 rapier "Rameni"` */
const ITEM = /^ ?[a-zA-Z] - \S/

function blockHtml(block: string[]): string {
  if (block.length >= 3 && block.every(mapLine) && block.some((l) => /[#.]/.test(l))) return `<div class="mblock wide map">${escapeHtml(block.join('\n'))}</div>`
  const notes = block.findIndex((l) => NOTES_HEAD.test(l))
  if (notes >= 0) return (notes ? partsHtml(block.slice(0, notes)) : '') + notesHtml(block.slice(notes))
  const drawn = drawnAt(block)
  if (drawn) return [block.slice(0, drawn.from), block.slice(drawn.from, drawn.to), block.slice(drawn.to)].map((part, k) => (k === 1 ? pipeHtml(part) : part.length ? blockHtml(part) : '')).join('')
  return listHtml(block) ?? partsHtml(block)
}

/**
 * The lines of a table drawn with `|` and `+` in a block, `[from, to)`: the
 * rows and rules, and the column letters over the first rule
 * (`     A        B`). What stands before and after (a legend) is text.
 */
function drawnAt(block: string[]): { from: number; to: number } | null {
  const part = (l: string) => TABLE_RULE.test(l) || l.includes('|')
  if (!block.some((l) => TABLE_RULE.test(l))) return null
  let from = block.findIndex(part)
  let to = block.length
  while (to > from && !part(block[to - 1])) to--
  if (from > 0 && !part(block[from - 1]) && /^ {4,}\S.* {2,}\S/.test(block[from - 1])) from--
  return { from, to }
}

/**
 * A table drawn with `|` and `+`, as a table: its columns where the first
 * rule's `+` marks them (a heading row with no `|` of its own, the column
 * letters, read by the same marks), its rules as the lines between groups of
 * rows, a `||` as a double line. A column whose cells are spaced out inside
 * (the skills by level) keeps its spacing; numbers stand to the right.
 */
function pipeHtml(lines: string[]): string {
  const rule = lines.find((l) => TABLE_RULE.test(l))!
  const marks: number[] = []
  for (let i = 0; i < rule.length; i++) if (rule[i] === '+') marks.push(i)
  // the columns between the marks; two marks together are a double line before the next
  const cols: { from: number; to: number; dbl: boolean }[] = []
  let from = 0
  let dbl = false
  for (const m of [...marks, Infinity]) {
    if (m === from) dbl = true
    else cols.push({ from, to: m, dbl })
    if (m !== from) dbl = false
    from = m + 1
  }
  const rows: { cells: string[]; head: boolean; sep: boolean }[] = []
  let ruled = false
  let sep = false
  for (const l of lines) {
    if (TABLE_RULE.test(l)) {
      sep = ruled
      ruled = true
      continue
    }
    rows.push({ cells: cols.map((c) => l.slice(c.from, c.to).replace(/\|/g, '').trimEnd()), head: !ruled, sep })
    sep = false
  }
  // a column nothing stands in (before a leading `+`, after a trailing one) is no column
  const used = cols.map((_, k) => rows.some((r) => r.cells[k].trim()))
  const spaced = cols.map((_, k) => rows.some((r) => /\S {2,}\S/.test(r.cells[k].trim())))
  const numeric = cols.map((_, k) => rows.filter((r) => !r.head && r.cells[k].trim()).every((r) => NUMBER.test(r.cells[k].trim())))
  // the row labels keep crawl's spacing: an action under its kind (`Attack: Normal`, `        Riposte`), a place set right
  const labels = used.indexOf(true)
  const cell = (tag: string, r: (typeof rows)[number], k: number) => {
    const pre = spaced[k] || k === labels
    const cls = [numeric[k] ? 'n' : '', pre ? 'pre' : '', cols[k].dbl ? 'dbl' : ''].filter(Boolean).join(' ')
    const t = pre ? r.cells[k].replace(/^ /, '') : r.cells[k].trim()
    return `<${tag}${cls ? ` class="${cls}"` : ''}>${escapeHtml(t)}</${tag}>`
  }
  const row = (r: (typeof rows)[number], tag: string) => `<tr${r.sep ? ' class="sep"' : ''}>${cols.map((_, k) => (used[k] ? cell(tag, r, k) : '')).join('')}</tr>`
  const head = rows.filter((r) => r.head)
  const body = rows.filter((r) => !r.head)
  return `<div class="mblock ptable"><table>${head.length ? `<thead>${head.map((r) => row(r, 'th')).join('')}</thead>` : ''}<tbody>${body.map((r) => row(r, 'td')).join('')}</tbody></table></div>`
}

/**
 * A block's parts: its title, then runs of crawl's console text, the tables
 * among them and the lines of entries, each set its own way.
 */
function partsHtml(block: string[]): string {
  const out: string[] = []
  let text: string[] = []
  const flush = () => {
    if (text.length) out.push(textHtml(text))
    text = []
  }
  for (let i = 0; i < block.length; ) {
    if (i === 0 && TITLE.test(block[0].trim())) {
      out.push(`<div class="mtitle">${escapeHtml(block[0].trim())}</div>`)
      i++
      continue
    }
    // the branches, in the overview: entries crawl set out in columns of its own width (chardump.cc), read entry by entry
    if (block[i] === 'Branches:' && i + 1 < block.length) {
      flush()
      out.push(`<div class="mtitle">${escapeHtml(block[i])}</div>`, entriesGrid(block.slice(i + 1)))
      break
    }
    // crawl's tables start at its left edge, or a column in (the spells' headings); what is set further in is an item's
    // description, its labels and their words (`rF+:       It protects you from fire.`) text and never a table
    const table = /^ {2}/.test(block[i]) ? null : consoleTable(block.slice(i))
    // a label and its words, over and over, is text, not a table
    const labels = table && block.slice(i, i + table.rows).every((r) => !columnsOf(r, table.starts)[0] || columnsOf(r, table.starts)[0].endsWith(':'))
    if (table && table.rows >= 2 && !labels) {
      flush()
      const rows = block.slice(i, i + table.rows)
      out.push(tableHtml(rows, headedAt(rows) ?? table.starts))
      i += table.rows
      continue
    }
    if (ENTRIES.test(block[i]) && !ITEM.test(block[i])) {
      flush()
      out.push(`<div class="entries">${block[i].trim().split(/ {3,}/).map((e) => `<span>${escapeHtml(e)}</span>`).join('')}</div>`)
      i++
      continue
    }
    text.push(block[i++])
  }
  flush()
  return `<div class="mblock parts">${out.join('')}</div>`
}

/**
 * Entries set out across the screen in columns (the branches): crawl's columns where they fit (`--n` across), and on a
 * phone as many as fit, each as wide as the widest entry (`--w`).
 */
function entriesGrid(lines: string[]): string {
  const rows = lines.map((l) => l.trim().split(/ {2,}/))
  const entries = rows.flat()
  const w = Math.max(...entries.map((e) => e.length))
  return `<div class="egrid" style="--n:${Math.max(...rows.map((r) => r.length))};--w:${w}ch">${entries.map((e) => `<span>${escapeHtml(e)}</span>`).join('')}</div>`
}

/**
 * A table's column starts where its headings start (the spells: `Spells   Type   Power   Damage   Failure`): crawl
 * pads those columns to their width (spl-book.cc), so a cell that fills its own is one space from the next
 * (`2d(14-20) 100%`), or none (`2d12 (+2d61%`), where the console's two-space gaps would run the two together. Null
 * for a table with no such headings.
 */
function headedAt(rows: string[]): number[] | null {
  const heads = [...rows[0].matchAll(/\S+(?: \S+)*/g)]
  if (heads.length < 2 || !heads.every((m) => HEADING.test(m[0]))) return null
  return heads.slice(1).map((m) => m.index!)
}

/** a cell's text: the row cut at its table's column starts, trimmed */
function columnsOf(row: string, starts: number[]): string[] {
  const bounds = [0, ...starts, Infinity]
  return bounds.slice(0, -1).map((from, k) => row.slice(from, bounds[k + 1]).trim())
}

/**
 * Consecutive columns in groups, each as wide as a phone fits, those after the first `indent` narrower; a column wider
 * than that is a group of its own, and wraps.
 */
function pack(widths: number[], indent = 0): number[][] {
  const groups: number[][] = []
  let cur: number[] = []
  let w = 0
  widths.forEach((cw, k) => {
    if (cur.length && w + GAP + cw > PHONE_COLS - (groups.length ? indent : 0)) {
      groups.push(cur)
      cur = []
      w = 0
    }
    w += (cur.length ? GAP : 0) + cw
    cur.push(k)
  })
  if (cur.length) groups.push(cur)
  return groups
}

/** a group's columns on a phone: each as wide as its widest cell, the last taking what is left */
const phoneCols = (widths: number[], group: number[]) => group.map((k, i) => (i === group.length - 1 ? 'minmax(0, 1fr)' : widths[k] + 'ch')).join(' ')

/**
 * A table of crawl's console columns: at crawl's widths where they fit
 * (`--cols`), and on a phone by the groups of columns a phone fits
 * (styles.css): a table under headings wraps each row over a line per
 * group, its cells under theirs; any other stacks its groups, each a table of
 * its own. A cell that is an item (`j - +7 rapier`) wraps under its name.
 */
function tableHtml(block: string[], starts: number[]): string {
  const cells = block.map((r) => columnsOf(r, starts))
  const n = starts.length + 1
  const widths = Array.from({ length: n }, (_, k) => Math.max(...cells.map((r) => r[k].length)))
  const bounds = [0, ...starts]
  const cols = [...starts.map((s, k) => s - bounds[k] + 'ch'), 'minmax(0, 1fr)'].join(' ')
  const heading = block.length > 1 && cells[0].every((c) => !c || HEADING.test(c)) && cells[0].some((c) => c)
  // a row's lines after its first are set in by a gap, so they read as the rest of it
  const groups = pack(widths, heading ? GAP : 0)
  // an item hangs under its name where its column can wrap: the last of its group, as wide as what is left
  const span = (t: string, last: boolean, style = '') => `<span class="c${last && ITEM.test(t) ? ' mitem' : ''}"${style ? ` style="${style}"` : ''}>${escapeHtml(t)}</span>`
  if (heading) {
    const rows = cells.map((r, i) => `<div class="mrow${i === 0 ? ' th' : ''}">${groups.map((g) => `<div class="ln" style="--g:${phoneCols(widths, g)}">${g.map((k, j) => span(r[k], j === g.length - 1)).join('')}</div>`).join('')}</div>`)
    return `<div class="mblock mtable rec" style="--cols:${cols}">${rows.join('')}</div>`
  }
  const html = groups.map((g) => `<div class="grp" style="--g:${phoneCols(widths, g)}">${cells.map((r, i) => g.map((k, j) => span(r[k], j === g.length - 1, `--r:${i + 1};--k:${k + 1};--gk:${j + 1}`)).join('')).join('')}</div>`)
  return `<div class="mblock mtable panel" style="--cols:${cols}">${html.join('')}</div>`
}

/**
 * Crawl's console text, as a popup sets it, but first with the lines crawl
 * broke for want of room put back together: a message that ran past eighty
 * columns (`hits you with a +2 trident of` / `distortion!`), so it breaks
 * only where the screen does. An item's words hang under its name, past its
 * letter.
 */
function textHtml(block: string[]): string {
  const lines: string[] = []
  for (let i = 0; i < block.length; i++) {
    const l = block[i]
    // the line above as crawl wrote it, not as put back together: whether crawl ran out of room on it
    const above = block[i - 1]
    const word = l.trimStart().split(' ')[0]
    // set in no further than the line above (a line hung under its text is consoleHtml's to put back), that line full up
    // to where this one's first word would not fit, its sentence not over, and this no line of its own (the overview's
    // next key, `A: plant physiology`, an item, or an artefact's next property)
    const broke = above !== undefined && indentOf(l) <= indentOf(above) && above.length + 1 + word.length > CONSOLE_COLS && (!/[.!?)"]$/.test(above) || /^[a-z(]/.test(word)) && !KEY_LINE.test(l) && !ITEM.test(l) && !PROPERTY.test(l)
    if (broke) lines[lines.length - 1] += ' ' + l.trimStart()
    else lines.push(l)
  }
  // a run of lines set in (an item's description under it, the death under the score) is set in as a whole, and read
  // as crawl's text from its own left edge: its labels (`rN++:      It protects`) are labels there, not the rest of a line
  const runs: { at: number; lines: string[] }[] = []
  for (const l of lines) {
    const at = /^ */.exec(l)![0].length >= 2 ? 2 : 0
    const run = runs[runs.length - 1]
    if (run && (run.at > 0) === (at > 0)) run.lines.push(l)
    else runs.push({ at, lines: [l] })
  }
  const html = runs.map((r) => {
    if (!r.at) return hungLines(itemsHung(consoleHtml(formatted(r.lines))))
    const by = Math.min(...r.lines.map((l) => /^ */.exec(l)![0].length))
    return `<div class="mind" style="--ind:${by}ch">${itemsHung(consoleHtml(formatted(r.lines.map((l) => l.slice(by)))))}</div>`
  })
  return `<div class="text">${html.join('')}</div>`
}

/**
 * Each line of plain text a line of its own, what wraps of it set in under it, so a message that wraps reads as one
 * (styles.css `.mline`). consoleHtml ends a line with a `<br>`; a block of its own (a hanging line) hangs already.
 */
function hungLines(html: string): string {
  const t = document.createElement('template')
  t.innerHTML = html
  const out = document.createElement('div')
  let line: HTMLElement | null = null
  for (const n of Array.from(t.content.childNodes)) {
    // a line ends at a <br>, or at a block that stands on a line of its own (a hanging line, a table)
    if (n.nodeName === 'BR') {
      line = null
      continue
    }
    if (n instanceof HTMLElement && /\b(?:hang|ctable|rule|right|grid)\b/.test(n.className)) {
      line = null
      out.append(n)
      continue
    }
    if (!line) {
      line = document.createElement('div')
      line.className = 'mline'
      out.append(line)
    }
    line.append(n)
  }
  return out.innerHTML
}

/** lines as a formatted string: a plain file's `<` is no colour tag */
const formatted = (lines: string[]) => lines.join('\n').replace(/</g, '<<')

/** an item's line hangs what wraps of it under its name, past its letter (` j - the +7 rapier`), as a legend's under its words (` B = Non-inter-level travel`) */
const itemsHung = (html: string) => html.replace(/<span class="hang" style="--hang:(\d+)ch">( ?)([a-zA-Z]) ([-=]) /g, (_m, _h, sp: string, ch: string, by: string) => `<span class="hang" style="--hang:${sp.length + 4}ch">${sp}${ch} ${by} `)

/** the notes: turn and place in columns, each note whole, wrapping in its own */
function notesHtml(block: string[]): string {
  const rows: { turn: string; place: string; note: string }[] = []
  for (const l of block.slice(1)) {
    if (TABLE_RULE.test(l)) continue
    const rest = NOTE_REST.exec(l)
    if (rest && rows.length) {
      rows[rows.length - 1].note += ' ' + rest[1].trim()
      continue
    }
    const m = NOTE.exec(l)
    if (!m) {
      rows.push({ turn: '', place: '', note: l.trim() })
      continue
    }
    const [, turn, place, note] = m
    const last = rows[rows.length - 1]
    // the rest of the note above, where crawl broke it at its column's end
    if (!turn && !place.trim() && last) last.note += ' ' + note.trim()
    else rows.push({ turn, place: place.trim(), note: note.trim() })
  }
  const cell = (cls: string, t: string) => `<span class="${cls}">${escapeHtml(t)}</span>`
  const head = cell('turn th', 'Turn') + cell('place th', 'Place') + cell('note th', 'Note')
  return `<div class="mblock notes">${head}${rows.map((r) => cell('turn', r.turn) + cell('place', r.place) + cell('note', r.note)).join('')}</div>`
}

/**
 * A list under labels (`D:1:      a, b,` then `          c, d`): each label's
 * entries put back on one line, hung under where they start. Null for a
 * block that is not one, past a first line that heads it.
 */
function listHtml(block: string[]): string | null {
  const start = LABELLED.test(block[0]) ? 0 : 1
  const entries: { label: string; at: number; text: string }[] = []
  for (const l of block.slice(start)) {
    const m = LABELLED.exec(l)
    const last = entries[entries.length - 1]
    if (m) entries.push({ label: m[1], at: m[1].length + m[2].length, text: l.slice(m[1].length + m[2].length) })
    else if (LABEL_ONLY.test(l)) entries.push({ label: l, at: l.length, text: '' })
    else if (last && l.length > last.at && !l.slice(0, last.at).trim()) last.text += ' ' + l.trim()
    else return null
  }
  // a label and its words beside it once each is a list of facts, not of entries: crawl's text as it is
  if (entries.length < 1 || block.length - start === entries.length) return null
  const head = start ? partsHtml(block.slice(0, 1)) : ''
  const html = entries.map((e) => `<span class="hang" style="--hang:${e.at}ch">${escapeHtml(e.label.padEnd(e.at))}${escapeHtml(e.text)}</span>`).join('')
  return `${head}<div class="mblock list">${html}</div>`
}
