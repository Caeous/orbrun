/**
 * Crawl's text for a describe popup and the character overview (`%`), as
 * HTML a popup narrower than crawl's eighty columns can wrap well. The
 * official client (ui-layouts.js fmt_body_txt) prints the text as it came,
 * which reads the same here wherever eighty columns fit. On a phone held
 * upright, sixty-odd columns across, that breaks a table row in the middle
 * of a column and sends every wrapped line back to the left edge. So:
 *
 * - a console table (the overview's stats, its resistances beside the gear,
 *   a monster's stats and attacks) keeps its columns and its rows level
 *   (styles.css `.ctable`): at crawl's own widths where they fit, and on a
 *   phone drawn in close, the last column wrapping in itself (a long piece of
 *   gear on the gear side, beside the resistances);
 * - a talisman's table, whose headings no column start holds, stays as crawl
 *   drew it, slid across where it must be;
 * - a line hangs what wraps of it under its text: an indented line under its
 *   first letter, `Flame:     It burns` under `It`, the overview's
 *   `A: horns 2, ...` under `horns`, a point of the changelog under its
 *   words, a quote under the words after its mark;
 * - a line crawl broke itself at eighty columns (describe.cc
 *   `_format_prop_desc`, a monster's statuses, output.cc
 *   `_status_mut_rune_list`) is put back together, so it breaks only where
 *   the popup does, and so is prose someone wrapped by hand (a quote, the
 *   changelog), though not verse;
 * - words crawl set against the right edge (the overview's turn count) go
 *   down a line whole, not broken after their first word, and a line it
 *   pushed there with spaces alone (a mutation's category) stays there;
 * - a rule is cut short where the popup is narrower than crawl drew it.
 *
 * Any other line comes out as formattedStringToHtml prints it, with a `<br>`
 * after it. test/e2e/record-describes.test.ts records crawl's own text for
 * each of these from the offline engine (test/fixtures/describes.json).
 */
import { formattedStringToSpans, type FormattedSpan } from '@orbrun/webtiles'
import { escapeHtml } from './dom'

/** a line of the text, in the colours crawl gave it */
type Line = FormattedSpan[]

/** crawl's console width: what its tables are padded to, and where it breaks its own lines (stringutil.cc wordwrap_line) */
const CONSOLE_COLS = 80

/**
 * how far right of a column's start a row's text may begin: TablePrinter
 * (describe.cc) right-aligns each column's labels to the longest, so `  AC:`
 * stands over `Size:` and `   SH:` over `Regen:`
 */
const LABEL_PAD = 3

/** a label and the spaces after it, if it is one: see labelAt */
const LABEL = /^\S[^:]{0,22}: *(?=\S)/
/** a quote's first line, its mark hung in the margin: dat/descript/quotes.txt goes on a space in, under the words */
const QUOTE = /^[“"‘'](?=\S)/
/** a point of a list and the spaces before it: the version screen's changelog, `* ` and under it `  - ` */
const BULLET = /^ *[*-] (?=\S)/
/** a rule across the console: a talisman's `____` (describe.cc `_describe_talisman_form`), a heading's `----` */
const RULE = /^([-_=])\1{7,}$/
/** one of the overview's keys before its list: output.cc `_status_mut_rune_list` (`%: `, `@: `, `A: `) */
const KEY = /^\S: (?=\S)/
const INDENT = /^ +(?=\S)/
/** an item in a list, by its letter: the overview's gear (output.cc `_append_overview_screen_item`) */
const ITEM = /^\S - (?=\S)/
/** words set against the console's right edge, across a gap from the rest of the line: output.cc `_overview_screen_title`'s turn count */
const RIGHT = / {4,}(\S+(?: \S+)*)$/

const plain = (l: Line) => l.map((s) => s.text).join('')

/** the text's lines, each a run of spans in the colours crawl gave them */
function linesOf(text: string): Line[] {
  const lines: Line[] = [[]]
  for (const s of formattedStringToSpans(text)) {
    s.text.split('\n').forEach((part, i) => {
      if (i) lines.push([])
      if (part) lines[lines.length - 1].push({ ...s, text: part })
    })
  }
  return lines
}

/** characters `[from, to)` of a line, in their colours */
function slice(l: Line, from: number, to = Infinity): Line {
  const out: Line = []
  let at = 0
  for (const s of l) {
    const a = Math.max(from, at)
    const b = Math.min(to, at + s.text.length)
    if (a < b) out.push({ ...s, text: s.text.slice(a - at, b - at) })
    at += s.text.length
  }
  return out
}

/**
 * A line as formattedStringToHtml prints it: a span per colour. `whole`
 * keeps a word with a hyphen inside from breaking at it, as a browser would:
 * an artefact's `{-Tele *Silence}` is no `{-` and a `Tele` under it.
 */
function spansHtml(l: Line, whole = false): string {
  return l
    .map((s) => {
      const cls = [s.fg !== undefined ? 'fg' + s.fg : '', s.bg !== undefined ? 'bg' + s.bg : ''].filter(Boolean).join(' ')
      let text = escapeHtml(s.text)
      if (whole) text = text.replace(/\S+-\S+/g, '<span class="keep">$&</span>')
      return cls ? `<span class="${cls}">${text}</span>` : text
    })
    .join('')
}

/**
 * Whether a table column can start at `c` on `row` (its end trimmed): two
 * spaces before it, a single one being a gap between words, and the row's
 * next text at most LABEL_PAD after it; or nothing more on the row.
 */
function cutFits(row: string, c: number): boolean {
  if (row.length <= c - 2) return true
  if (row[c - 1] !== ' ' || row[c - 2] !== ' ') return false
  let at = c
  while (row[at] === ' ') at++
  return at <= c + LABEL_PAD
}

/** a row with text either side of a cut, as a table's rows have and a short line under one does not */
const crosses = (row: string, c: number) => /\S/.test(row.slice(0, c - 2)) && /\S/.test(row.slice(c))

/** a row whose words run on over a cut rather than stopping two spaces short of it (a cell that is empty there runs over nothing) */
const runsAcross = (row: string, c: number) => row.length > c && !cutFits(row, c) && /\S/.test(row.slice(c - 2, c))

export interface ConsoleTable {
  /** how many rows it takes, from the first */
  rows: number
  /** where each column after the first starts */
  starts: number[]
}

/**
 * The console table that starts at `rows[0]` (each row's end trimmed): the
 * rows from there that keep to some column starts in common, and those
 * starts. Null when fewer than two rows have text either side of one, and
 * for a list of labels and what they mean (an artefact's `rF+:       It
 * protects you from fire.`), whose words stay beside their label and wrap
 * under themselves. A first row that the table starting under it would run
 * past is a heading over that table, not a row of one of its own: the
 * overview's title, whose turn count can stand where `Next:` does.
 */
export function consoleTable(rows: string[]): ConsoleTable | null {
  const table = tableAt(rows)
  const under = table && rows.length > 1 && rows[1].trim() ? tableAt(rows.slice(1)) : null
  return table && !(under && under.rows >= table.rows) ? table : null
}

function tableAt(rows: string[]): ConsoleTable | null {
  const width = Math.max(...rows.map((r) => r.length))
  let cuts: number[] = []
  for (let c = 2; c < width; c++) if (cutFits(rows[0], c)) cuts.push(c)
  let n = 1
  for (; n < rows.length && rows[n].trim(); n++) {
    const kept = cuts.filter((c) => cutFits(rows[n], c))
    if (!kept.length) break
    // a row whose words run across a column two rows above it keep, and that stands in no column of its own, is no
    // row of theirs: the line under a monster's stats (a row with words in another column is one, its first cell long)
    const above = rows.slice(0, n)
    if (!kept.some((c) => crosses(rows[n], c)) && cuts.some((c) => runsAcross(rows[n], c) && above.filter((r) => crosses(r, c)).length >= 2)) break
    cuts = kept
  }
  const block = rows.slice(0, n)
  // of a run of starts, the last: where the text itself starts, not the spaces before it
  const starts = cuts.filter((c, i) => cuts[i + 1] !== c + 1 && block.filter((r) => crosses(r, c)).length >= 2)
  if (!starts.length) return null
  const labels = starts.length === 1 && block.every((r) => !r.slice(0, starts[0]).trim() || r.slice(0, starts[0]).trim().endsWith(':'))
  return labels ? null : { rows: n, starts }
}

/**
 * A table's cells, each placed on the row and column it came from: styles.css
 * sets the columns crawl's widths apart, or on a phone as close as their
 * widest cells allow, the last taking what is left and wrapping in itself.
 * `--cols` is crawl's widths of all but the last, `--n` how many that is.
 */
function tableHtml(lines: Line[], rows: string[], starts: number[]): string {
  const bounds = [0, ...starts]
  const cells: string[] = []
  rows.forEach((row, r) =>
    bounds.forEach((from, k) => {
      const len = row.slice(from, bounds[k + 1]).trimEnd().length
      if (!len) return
      const cell = slice(lines[r], from, from + len)
      // an item that wraps does so under its name, not its letter
      const hang = (ITEM.exec(plain(cell)) ?? INDENT.exec(plain(cell)))?.[0].length
      const style = `grid-area:${r + 1}/${k + 1}` + (hang ? `;--hang:${hang}ch` : '')
      cells.push(`<span class="ccell${hang ? ' hang' : ''}" style="${style}">${spansHtml(cell, true)}</span>`)
    }),
  )
  const widths = starts.map((s, k) => s - bounds[k] + 'ch').join(' ')
  return `<span class="ctable" style="--cols:${widths};--n:${starts.length}">${cells.join('')}</span>`
}

/** how many columns short of `width` `last` stopped with `next`'s first word still to come: below none, it broke there for want of room */
const gap = (last: string, next: string, width = CONSOLE_COLS) => width - last.length - 1 - next.trimStart().split(' ')[0].length

/** how far short of its widest line a line of prose wrapped by hand may stop: a long word put down whole */
const SLACK = 12
/** the narrowest anyone wraps a quote's prose to (Cigotuvi's Monster's, sixty-one): a shorter run is verse, or fits as it is */
const PROSE_WIDTH = 60

/** a line that starts a line of its own however short the one above it: a speaker's (`• Roy Quixote:`, `— Durkon Pansa:`), a point's */
const STARTS = /^ *(?:[•—–]|[*-] )/

/**
 * How the run of lines from `i` that go on at `under` was wrapped, where
 * someone wrapped it by hand: a quote (database.cc unwrap_desc keeps a line
 * that starts with a space as it was written), the changelog. Prose runs
 * near its widest, most of its lines, and goes on in lower case: the width
 * it was wrapped to. Verse goes on in capitals, three lines of it or more,
 * however long they run: -1, never put together. Zero where it cannot tell.
 * `end` is the run's last line, which the verdict holds for.
 */
function wrappedBy(rows: string[], i: number, under: number): { by: number; end: number } {
  const run = [rows[i]]
  for (let j = i + 1; rows[j]?.trim() && INDENT.exec(rows[j])?.[0].length === under && !STARTS.test(rows[j]); j++) run.push(rows[j])
  const end = i + run.length - 1
  if (run.length < 2) return { by: 0, end }
  const lower = run.slice(1).filter((r) => /^\p{Ll}/u.test(r.trimStart())).length / (run.length - 1)
  if (lower < 0.3) return { by: run.length >= 3 ? -1 : 0, end }
  const width = Math.max(...run.map((r) => r.length))
  const gaps = run.slice(1).map((r, k) => gap(run[k], r, width)).sort((a, b) => a - b)
  return { by: width >= PROSE_WIDTH && gaps[(gaps.length - 1) >> 1] <= SLACK ? width : 0, end }
}

/**
 * The column the words beside a label start at, where describe.cc
 * `_format_prop_desc` set them there: a label padded out to it (`Flame:     It
 * burns`, `rF+:       It protects`), or one too long for the padding, a single
 * space after it, whose words crawl broke under themselves (`'Of mesmerism':
 * When you are struck`, the next line indented to `When`).
 */
function labelAt(rows: string[], i: number): number | undefined {
  const label = LABEL.exec(rows[i])?.[0]
  if (!label) return undefined
  return label.endsWith('  ') || INDENT.exec(rows[i + 1] ?? '')?.[0].length === label.length ? label.length : undefined
}

/**
 * How many rows from `i` make a table under a heading and a rule, kept as
 * crawl drew it: a talisman's, whose headings stand centred over numbers set
 * right, so no column start holds both. Zero where there is none.
 */
function gridAt(rows: string[], i: number): number {
  if (!/\S {2,}\S.* {2,}\S/.test(rows[i].trim()) || !/^-+$/.test(rows[i + 1] ?? '')) return 0
  let n = 2
  while (rows[i + n]?.trim()) n++
  return n > 2 ? n : 0
}

/** a line crawl set against its right edge by spaces alone: a mutation's `Category: [Anatomy]` (mutation.cc get_mutation_desc) */
const pushedRight = (row: string) => row.length === CONSOLE_COLS && (INDENT.exec(row)?.[0].length ?? 0) >= CONSOLE_COLS / 2

/** a formatted string's lines as HTML for a white-space: pre-wrap box: its tables, hanging lines and the rest */
export function consoleHtml(text: string): string {
  const lines = linesOf(text)
  const rows = lines.map((l) => plain(l).trimEnd())
  const out: { html: string; block: boolean; empty: boolean }[] = []
  let run = { by: 0, end: -1 }
  for (let i = 0; i < lines.length; i++) {
    const grid = gridAt(rows, i)
    if (grid) {
      const html = lines.slice(i, i + grid).map((l, k) => spansHtml(slice(l, 0, rows[i + k].length)))
      out.push({ html: `<span class="grid">${html.join('\n')}</span>`, block: true, empty: false })
      i += grid - 1
      continue
    }
    const table = rows[i].trim() ? consoleTable(rows.slice(i)) : null
    if (table) {
      out.push({ html: tableHtml(lines.slice(i, i + table.rows), rows.slice(i, i + table.rows), table.starts), block: true, empty: false })
      i += table.rows - 1
      continue
    }
    if (RULE.test(rows[i]) || pushedRight(rows[i])) {
      const html = spansHtml(slice(lines[i], INDENT.exec(rows[i])?.[0].length ?? 0, rows[i].length))
      out.push({ html: `<span class="${RULE.test(rows[i]) ? 'rule' : 'right'}">${html}</span>`, block: true, empty: false })
      continue
    }
    const indent = INDENT.exec(rows[i])?.[0].length
    const label = labelAt(rows, i)
    const key = label === undefined && KEY.test(rows[i])
    // where what wraps of the line goes: under a label's words, a point's, a quote's (its mark in the margin), an
    // indented line's first letter; and where crawl went on with it when it broke it at eighty columns itself
    const hang = label ?? BULLET.exec(rows[i])?.[0].length ?? (QUOTE.test(rows[i]) ? 1 : undefined) ?? (key ? 3 : indent)
    const under = key ? 0 : hang
    let line = slice(lines[i], 0, rows[i].length)
    // the lines crawl broke this one into for want of room, back on it, or someone wrapping prose by hand (judged on
    // the whole run, the lines a break in it left to start their own included); a speaker or a point under it is a
    // line of its own, as is the overview's next key
    if (under && i > run.end) run = wrappedBy(rows, i, under)
    const by = under && i <= run.end ? run.by : 0
    for (let last = rows[i]; under !== undefined && by >= 0 && i + 1 < lines.length; i++) {
      const next = rows[i + 1]
      const at = INDENT.exec(next)?.[0].length ?? 0
      const broke = last.length <= CONSOLE_COLS && (gap(last, next) < 0 || (by > 0 && gap(last, next, by) <= SLACK))
      if (!next.trim() || at !== under || STARTS.test(next) || (key && KEY.test(next)) || !broke) break
      line = [...line, { ...line[line.length - 1], text: ' ' }, ...slice(lines[i + 1], at, next.length)]
      last = next
    }
    if (hang) {
      out.push({ html: `<span class="hang" style="--hang:${hang}ch">${spansHtml(line)}</span>`, block: true, empty: false })
      continue
    }
    // words set against the right edge go down a line whole where they no longer fit beside the rest
    const right = rows[i].length >= CONSOLE_COLS - 2 ? RIGHT.exec(rows[i]) : null
    const at = right && right[1].length <= CONSOLE_COLS / 2 ? rows[i].length - right[1].length : -1
    const html = at > 0 ? spansHtml(slice(lines[i], 0, at)) + `<span class="keep">${spansHtml(slice(lines[i], at))}</span>` : spansHtml(lines[i])
    out.push({ html, block: false, empty: !rows[i] })
  }
  // a line ends at a <br>, but a block (a table, a hanging line) takes a line of its own; a blank line before one keeps its height by a <br>
  return out.map((o, k) => o.html + (!o.block && k + 1 < out.length && (!out[k + 1].block || o.empty) ? '<br>' : '')).join('')
}
