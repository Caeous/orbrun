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
 * - a line hangs what wraps of it under its text: an indented line under its
 *   first letter, `Flame:     It burns` under `It`, the overview's
 *   `A: horns 2, ...` under `horns`;
 * - a line crawl broke itself at eighty columns (describe.cc
 *   `_format_prop_desc`, output.cc `_status_mut_rune_list`) is put back
 *   together, so it breaks only where the popup does;
 * - words crawl set against the right edge (the overview's turn count) go
 *   down a line whole, not broken after their first word.
 *
 * Any other line comes out as formattedStringToHtml prints it, with a `<br>`
 * after it.
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

/** a label padded out to the column its text starts at: describe.cc `_format_prop_desc` (`Flame:     It burns`, `rF+:       It protects`) */
const LABEL = /^\S[^:]{0,22}: {2,}(?=\S)/
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

/** whether crawl broke `last` before `next` for want of room: the next word would have run past eighty columns */
const brokeFor = (last: string, next: string) => last.length <= CONSOLE_COLS && last.length + 1 + next.trimStart().split(' ')[0].length > CONSOLE_COLS

/** a formatted string's lines as HTML for a white-space: pre-wrap box: its tables, hanging lines and the rest */
export function consoleHtml(text: string): string {
  const lines = linesOf(text)
  const rows = lines.map((l) => plain(l).trimEnd())
  const out: { html: string; block: boolean; empty: boolean }[] = []
  for (let i = 0; i < lines.length; i++) {
    const table = rows[i].trim() ? consoleTable(rows.slice(i)) : null
    if (table) {
      out.push({ html: tableHtml(lines.slice(i, i + table.rows), rows.slice(i, i + table.rows), table.starts), block: true, empty: false })
      i += table.rows - 1
      continue
    }
    const label = LABEL.exec(rows[i])?.[0].length
    const key = KEY.test(rows[i])
    const hang = label ?? (key ? 3 : INDENT.exec(rows[i])?.[0].length)
    let line = slice(lines[i], 0, rows[i].length)
    // the lines crawl broke this one into, back on it: a label's indented to its text, the overview's keys' not at all
    for (let last = rows[i]; (label || key) && i + 1 < lines.length; i++) {
      const next = rows[i + 1]
      const indent = INDENT.exec(next)?.[0].length ?? 0
      if (!next.trim() || indent !== (label ?? 0) || (key && KEY.test(next)) || !brokeFor(last, next)) break
      line = [...line, { ...line[line.length - 1], text: ' ' }, ...slice(lines[i + 1], indent, next.length)]
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
