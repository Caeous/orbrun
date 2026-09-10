/**
 * Text on the grid: a row is runs of one
 * colour, one character per cell. The stats pane, the message pane and a
 * room's text all reduce to rows, and the host paints a row as a line of
 * spans in the grid font. Nothing here draws.
 */
import { formattedStringToSpans } from '@orbrun/webtiles'

export interface Span {
  text: string
  /** foreground: a terminal colour index (`--color-N`); absent for the region's default */
  fg?: number
  /** background: a terminal colour index, or a css colour where the official stylesheet names one (the noise bar) */
  bg?: number | string
  /** an extra class the official stylesheet names (`colour_yellow`, `boosted_stat`), when the colour is not one of the sixteen */
  cls?: string
  /** a tooltip: the status light's `desc`, the doom's `doom_desc` */
  title?: string
}

export type Row = Span[]

/** how many cells the row takes */
export function rowLength(row: Row): number {
  let n = 0
  for (const s of row) n += Array.from(s.text).length
  return n
}

/** a run of `n` blank cells, painted `bg` when given */
export function blank(n: number, bg?: number | string): Span {
  const s: Span = { text: ' '.repeat(Math.max(0, n)) }
  if (bg !== undefined) s.bg = bg
  return s
}

/**
 * The row cut to `width` cells. With `ellipsis`, a row that was cut ends in
 * `…` as `text-overflow: ellipsis` ends the weapon and quiver lines.
 */
export function cutRow(row: Row, width: number, ellipsis = false): Row {
  if (rowLength(row) <= width) return row
  const out: Row = []
  let left = Math.max(0, ellipsis ? width - 1 : width)
  for (const s of row) {
    if (left <= 0) break
    const chars = Array.from(s.text)
    if (chars.length <= left) {
      out.push(s)
      left -= chars.length
    } else {
      out.push({ ...s, text: chars.slice(0, left).join('') })
      left = 0
    }
  }
  if (ellipsis && width > 0) out.push({ text: '…', fg: out.length ? out[out.length - 1].fg : undefined })
  return out
}

/** a row padded with blank cells to `width`, so what follows lands on a column */
export function padRow(row: Row, width: number): Row {
  const n = width - rowLength(row)
  return n > 0 ? [...row, blank(n)] : row
}

/** two rows side by side: `left` cut and padded to `at` cells, then `right` */
export function joinRows(left: Row, at: number, right: Row): Row {
  return [...padRow(cutRow(left, at), at), ...right]
}

/** a crawl formatted string (`<red>text<lightgrey>`) as a row; `fg` is the colour of untagged text */
export function fromFormatted(str: string, fg?: number): Row {
  return formattedStringToSpans(str).map((s) => {
    const span: Span = { text: s.text }
    const colour = s.fg ?? fg
    if (colour !== undefined) span.fg = colour
    if (s.bg !== undefined) span.bg = s.bg
    return span
  })
}

/**
 * The row wrapped to `width` cells as `white-space: pre-wrap` wraps a
 * message: at the last space that fits, else hard at the width. A row that
 * fits is one line; an empty row is one empty line.
 */
export function wrapRow(row: Row, width: number): Row[] {
  if (width <= 0) return [row]
  // flatten to characters carrying their span, so a break can fall anywhere
  const chars: { ch: string; span: Span }[] = []
  for (const s of row) for (const ch of Array.from(s.text)) chars.push({ ch, span: s })
  const lines: Row[] = []
  let start = 0
  while (start < chars.length) {
    let end = Math.min(chars.length, start + width)
    if (end < chars.length) {
      let brk = -1
      for (let i = end; i > start; i--)
        if (chars[i - 1].ch === ' ') {
          brk = i
          break
        }
      if (brk > start) end = brk
    }
    // the space the line broke at stays at the end of the line, as pre-wrap hangs it there
    lines.push(rebuild(chars.slice(start, end)))
    start = end
  }
  if (!lines.length) lines.push([])
  return lines
}

function rebuild(chars: { ch: string; span: Span }[]): Row {
  const out: Row = []
  let src: Span | null = null
  for (const c of chars) {
    if (src === c.span) out[out.length - 1].text += c.ch
    else {
      out.push({ ...c.span, text: c.ch })
      src = c.span
    }
  }
  return out
}
