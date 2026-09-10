/**
 * The message pane on the grid.
 *
 * messages.js keeps `#messages` scrolled to its bottom inside a container
 * `msg_height` lines tall, each message a `pre-wrap` div with a prefix glyph
 * (`_` in lightgray for a new turn, darkgray for a new command, a blank
 * otherwise) and the formatted text; `#more` is the line under the
 * container, shown while the server waits on a `--more--`, with the
 * server's `more_text` when it sent one. The text cursor is appended to the
 * last message while the game reads a line there.
 *
 * On the grid the pane is `rows` rows of messages and the more row: the log's
 * lines wrapped to the pane's width, the last `rows` of them shown, scrolled
 * back `offset` lines when the player is reading the log. Pure: a log in,
 * rows out.
 */
import type { MessageLog } from '@orbrun/webtiles'
import { fromFormatted, wrapRow, type Row } from './rows'

/** style.css `.prefix_glyph.turn_marker`: lightgray; `.command_marker`: darkgray */
const TURN_MARKER = 7
const COMMAND_MARKER = 8

export interface PaneRows {
  /** the message rows, oldest first, exactly `rows` long (blank rows at the top when the log is short) */
  lines: Row[]
  /** the `--more--` row: the server's text while a more is pending, else empty */
  more: Row
  /** lines scrolled back past the end of the log, clamped to what the log holds */
  offset: number
}

/** every message of the log as wrapped rows, the marker on the first row of each */
function wrappedLog(log: MessageLog, width: number): Row[] {
  const out: Row[] = []
  const text = Math.max(1, width - 1)
  for (const l of log.lines) {
    const marker: Row = [{ text: l.marker ? '_' : ' ', fg: l.marker === 'turn' ? TURN_MARKER : COMMAND_MARKER }]
    const lines = wrapRow(fromFormatted(l.text), text)
    lines.forEach((row, i) => out.push(i === 0 ? [...marker, ...row] : [{ text: ' ' }, ...row]))
  }
  return out
}

/**
 * The pane's rows: the last `rows` wrapped lines of the log, less `offset`
 * scrolled back, the text cursor on the last line while the game reads
 * there, and the more row.
 */
export function paneRows(log: MessageLog, rows: number, width: number, offset = 0): PaneRows {
  const all = wrappedLog(log, width)
  const maxOffset = Math.max(0, all.length - rows)
  offset = Math.max(0, Math.min(offset, maxOffset))
  const end = all.length - offset
  const shown = all.slice(Math.max(0, end - rows), end)
  if (log.textCursor && offset === 0 && shown.length) shown[shown.length - 1] = [...shown[shown.length - 1], { text: '_', cls: 'text-cursor' }]
  while (shown.length < rows) shown.unshift([])
  const more: Row = log.more ? [{ text: log.moreText || '--more--' }] : []
  return { lines: shown, more, offset }
}
