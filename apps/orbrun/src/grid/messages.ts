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
/** the text cursor, on the last message while the game reads a line there */
const CURSOR = { text: '_', cls: 'text-cursor' }

export interface PaneRows {
  /** the message rows, oldest first, exactly `rows` long (blank rows at the top when the log is short) */
  lines: Row[]
  /** the `--more--` row: the server's text while a more is pending, else empty */
  more: Row
  /** lines scrolled back past the end of the log, clamped to what the log holds */
  offset: number
}

type LogLine = MessageLog['lines'][number]

/** a message's wrapped rows, kept with what they were wrapped from: the pane is drawn again with every message, the log's old ones unchanged */
const wrapped = new WeakMap<LogLine, { text: string; marker: LogLine['marker']; width: number; rows: Row[] }>()

/** one message as wrapped rows, the marker on the first; `tail` runs on from it */
function wrapLine(l: LogLine, width: number, tail: Row): Row[] {
  const kept = tail.length ? undefined : wrapped.get(l)
  if (kept && kept.text === l.text && kept.marker === l.marker && kept.width === width) return kept.rows
  const marker: Row = [{ text: l.marker ? '_' : ' ', fg: l.marker === 'turn' ? TURN_MARKER : COMMAND_MARKER }]
  const row = fromFormatted(l.text)
  const rows = wrapRow(tail.length ? [...row, ...tail] : row, Math.max(1, width - 1)).map((r, i) => (i === 0 ? [...marker, ...r] : [{ text: ' ' }, ...r]))
  if (!tail.length) wrapped.set(l, { text: l.text, marker: l.marker, width, rows })
  return rows
}

/** every message of the log as wrapped rows, the marker on the first row of each; `tail` runs on from the last message */
function wrappedLog(log: MessageLog, width: number, tail: Row = []): Row[] {
  const out: Row[] = []
  log.lines.forEach((l, at) => {
    for (const r of wrapLine(l, width, at === log.lines.length - 1 ? tail : [])) out.push(r)
  })
  return out
}

/**
 * The pane's rows: the last `rows` wrapped lines of the log, less `offset`
 * scrolled back, the text cursor on the last line while the game reads
 * there, and the more row. `typed` is what has been typed of a line the
 * game reads there (bindings.ts typedInLog): it runs on from the prompt,
 * wrapped with it, the cursor after it.
 */
export function paneRows(log: MessageLog, rows: number, width: number, offset = 0, typed?: string): PaneRows {
  const all = wrappedLog(log, width, typed === undefined ? [] : [{ text: typed }, CURSOR])
  const maxOffset = Math.max(0, all.length - rows)
  offset = Math.max(0, Math.min(offset, maxOffset))
  const end = all.length - offset
  const shown = all.slice(Math.max(0, end - rows), end)
  if (log.textCursor && typed === undefined && offset === 0 && shown.length) shown[shown.length - 1] = [...shown[shown.length - 1], CURSOR]
  while (shown.length < rows) shown.unshift([])
  const more: Row = log.more ? [{ text: log.moreText || '--more--' }] : []
  return { lines: shown, more, offset }
}
