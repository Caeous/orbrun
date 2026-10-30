/**
 * Terminal text: crawl's sixteen colours, a row of coloured spans, and what
 * crawl sends to be read as such rows: its formatted strings
 * (`<lightred>…</lightred>`, webtiles format.ts) and the console's own HTML
 * lines (a CRT screen's `<span class='fgN'>`), wrapped at a width as crawl's
 * console wraps them.
 */
import { formattedStringToSpans } from '@orbrun/webtiles'

/** crawl's sixteen terminal colours (style.css `--color-N`), as RGB */
export const PALETTE: [number, number, number][] = [
  [0, 0, 0], [0, 82, 255], [102, 255, 0], [0, 191, 191], [255, 0, 0], [208, 0, 208], [165, 91, 0], [192, 192, 192],
  [128, 128, 128], [82, 140, 255], [140, 255, 82], [0, 255, 255], [255, 82, 82], [255, 82, 255], [255, 255, 82], [255, 255, 255],
]

export type RGB = [number, number, number]

export interface Span {
  text: string
  fg?: RGB
  bg?: RGB
  /** lit: the row under the cursor, or the focused choice */
  lit?: boolean
}
export type Line = Span[]

export const lineLength = (l: Line) => l.reduce((n, s) => n + s.text.length, 0)
export const lineText = (l: Line) => l.map((s) => s.text).join('')

/** `l` cut to `width` characters */
export function cut(l: Line, width: number): Line {
  const out: Line = []
  let n = 0
  for (const s of l) {
    if (n >= width) break
    const t = s.text.slice(0, width - n)
    out.push({ ...s, text: t })
    n += t.length
  }
  return out
}

/** `l` with every span lit, or in `fg` where it says no colour of its own */
export const lit = (l: Line): Line => l.map((s) => ({ ...s, lit: true }))
export const tinted = (l: Line, fg: RGB): Line => l.map((s) => (s.fg ? s : { ...s, fg }))

/** crawl's colour `n` (0..15), its black ground the console's own: whatever the box behind has */
const colour = (n: number | undefined) => (n === undefined ? undefined : PALETTE[n & 15])
const ground = (n: number | undefined) => (n ? PALETTE[n & 15] : undefined)

/** A formatted string as its lines (a newline starts one), each in the colours its tags say. */
export function formatted(str: string): Line[] {
  const out: Line[] = [[]]
  for (const s of formattedStringToSpans(str)) {
    const parts = s.text.split('\n')
    parts.forEach((t, i) => {
      if (i) out.push([])
      if (t) out[out.length - 1].push({ text: t.replace(/\t/g, '    '), fg: colour(s.fg), bg: ground(s.bg) })
    })
  }
  return out
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }
const unescape = (t: string) => t.replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e: string) => ENTITIES[e] ?? (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : m))

/**
 * crawl's console HTML as lines: what a CRT screen's text area sends (tileweb-text.cc `WebTextArea::send`,
 * `<span class='fgN bgM'>`), or a dialog's; `<br>` and a block's end start a line, any other tag is dropped.
 */
export function htmlLines(html: string): Line[] {
  const out: Line[] = [[]]
  const stack: { fg?: RGB; bg?: RGB }[] = [{}]
  const re = /<(\/?)([a-z0-9]+)([^>]*)>|([^<]+)/gi
  for (let m; (m = re.exec(html)); ) {
    if (m[4] !== undefined) {
      const top = stack[stack.length - 1]
      unescape(m[4])
        .split('\n')
        .forEach((t, i) => {
          if (i) out.push([])
          if (t) out[out.length - 1].push({ text: t, fg: top.fg, bg: top.bg })
        })
      continue
    }
    const [, close, tag, attrs] = m
    const name = tag.toLowerCase()
    if (name === 'br') out.push([])
    else if (close) {
      if (stack.length > 1) stack.pop()
      if (/^(div|p|li|tr|h\d)$/.test(name)) out.push([])
    } else {
      const top = { ...stack[stack.length - 1] }
      const cls = /class\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] ?? ''
      for (const c of cls.split(/\s+/)) {
        const k = /^(fg|bg)(\d+)$/.exec(c)
        if (k && +k[2] < 16) {
          if (k[1] === 'fg') top.fg = PALETTE[+k[2]]
          else top.bg = ground(+k[2])
        }
      }
      if (!/\/$/.test(attrs)) stack.push(top)
    }
  }
  return out
}

/** `l` wrapped to `width`, at spaces where it can be, each line after the first hung `hang` in */
export function wrap(l: Line, width: number, hang = 0): Line[] {
  if (width <= 0) return [l]
  hang = Math.min(hang, Math.floor(width / 2))
  const out: Line[] = []
  let cur: Line = []
  let n = 0
  const flush = () => {
    out.push(cur)
    cur = hang ? [{ text: ' '.repeat(hang) }] : []
    n = hang
  }
  for (const s of l) {
    let text = s.text
    while (text.length) {
      const room = width - n
      if (text.length <= room) {
        cur.push({ ...s, text })
        n += text.length
        break
      }
      // break at the last space that fits, or cut a word too long for a line
      let at = text.lastIndexOf(' ', room)
      if (at <= 0) at = n === 0 ? room : 0
      if (at > 0) cur.push({ ...s, text: text.slice(0, at) })
      flush()
      text = text.slice(at).replace(/^ /, '')
    }
  }
  if (cur.length || !out.length) out.push(cur)
  return out
}

/** Each of `lines` wrapped to `width`, a line that starts with crawl's `a - ` hung under its words. */
export function wrapAll(lines: Line[], width: number): Line[] {
  return lines.flatMap((l) => wrap(l, width, /^\s*\S{1,2} [-+#] /.exec(lineText(l))?.[0].length ?? 0))
}
