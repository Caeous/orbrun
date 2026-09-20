/**
 * Crawl formatted strings: `<red>text<lightgrey>`, `<bg:blue>`, `<<` escapes.
 * Ported from the official client's util.js so output matches it.
 */

export const COLOUR_NAMES: Record<string, number> = {
  black: 0,
  blue: 1,
  green: 2,
  cyan: 3,
  red: 4,
  magenta: 5,
  brown: 6,
  lightgrey: 7,
  lightgray: 7,
  darkgrey: 8,
  darkgray: 8,
  lightblue: 9,
  lightgreen: 10,
  lightcyan: 11,
  lightred: 12,
  lightmagenta: 13,
  yellow: 14,
  h: 14,
  white: 15,
  w: 15,
}

/** the canonical tag name of each of the sixteen terminal colours, by index */
const COLOUR_TAGS = ['black', 'blue', 'green', 'cyan', 'red', 'magenta', 'brown', 'lightgrey', 'darkgrey', 'lightblue', 'lightgreen', 'lightcyan', 'lightred', 'lightmagenta', 'yellow', 'white']

/**
 * Text as a formatted string in one colour: `<red>text</red>`. Plain text
 * has its `<` doubled so it stays a literal (`formattedStringToText` undoes
 * it); text that is `formatted` already keeps its own tags, which then
 * override the colour inside it. A colour outside the sixteen leaves the
 * text as it was.
 */
export function colouredText(text: string, fg: number, formatted = false): string {
  const name = COLOUR_TAGS[fg]
  const inner = formatted ? text : text.replace(/</g, '<<')
  return name ? '<' + name + '>' + inner + '</' + name + '>' : inner
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function formattedStringToHtml(str: string): string {
  const curFg: number[] = []
  let bgOpen = false
  let filtered = str.replace(/<?<(\/?(bg:)?[a-z]*)>?|>|&/gi, (s: string, p1raw: string | undefined) => {
    let p1 = p1raw === undefined ? '' : p1raw
    let closing = false
    let bg = false
    if (/^\//.test(p1)) {
      p1 = p1.substr(1)
      closing = true
    }
    if (/^bg:/.test(p1)) {
      bg = true
      p1 = p1.substr(3)
    }
    if (p1 in COLOUR_NAMES && !/^<</.test(s) && />$/.test(s)) {
      if (closing) {
        if (bg && bgOpen) {
          bgOpen = false
          return '</span>'
        } else if (curFg.length > 0) {
          curFg.pop()
          if (curFg.length > 0) return "</span><span class='fg" + curFg[curFg.length - 1] + "'>"
          return '</span>'
        }
        return ''
      } else if (bg) {
        let text = "<span class='bg" + COLOUR_NAMES[p1] + "'>"
        if (bgOpen) text = '</span>' + text
        if (curFg.length > 0) text = '</span>' + text + "<span class='fg" + curFg[curFg.length - 1] + "'>"
        bgOpen = true
        return text
      } else {
        let text = "<span class='fg" + COLOUR_NAMES[p1] + "'>"
        if (curFg.length > 0) text = '</span>' + text
        curFg.push(COLOUR_NAMES[p1])
        return text
      }
    } else {
      if (/^<</.test(s)) return escapeHtml(s.substr(1))
      return escapeHtml(s)
    }
  })
  if (curFg.length > 0) filtered += '</span>'
  if (bgOpen) filtered += '</span>'
  return filtered
}

/** Strip colour tags and unescape, for plain-text uses (labels, parsing). */
export function formattedStringToText(str: string): string {
  return str
    .replace(/<<+/g, (m) => m.slice(1))
    .replace(/<\/?(bg:)?[a-z]+>/gi, (m) => {
      const name = m.replace(/[<>/]/g, '').replace(/^bg:/, '')
      return name in COLOUR_NAMES ? '' : m
    })
}

/** A run of a formatted string in one colour: `fg` and `bg` are terminal colour indexes, absent for the default. */
export interface FormattedSpan {
  text: string
  fg?: number
  bg?: number
}

/**
 * A formatted string as runs of one colour, for drawing on a grid of cells
 * rather than as HTML. The same state machine as `formattedStringToHtml`:
 * a colour tag pushes a foreground, its closing tag pops back to the one
 * before, `<bg:...>` opens a background until its closing tag, `<<` is a
 * literal `<`, and a tag that names no colour is text.
 */
export function formattedStringToSpans(str: string): FormattedSpan[] {
  const out: FormattedSpan[] = []
  const fgStack: number[] = []
  let bg: number | undefined
  let text = ''
  const flush = () => {
    if (!text) return
    const span: FormattedSpan = { text }
    const fg = fgStack[fgStack.length - 1]
    if (fg !== undefined) span.fg = fg
    if (bg !== undefined) span.bg = bg
    out.push(span)
    text = ''
  }
  const re = /<?<(\/?(bg:)?[a-z]*)>?/gi
  let last = 0
  for (let m = re.exec(str); m; m = re.exec(str)) {
    text += str.slice(last, m.index)
    last = m.index + m[0].length
    const s = m[0]
    let name = m[1] ?? ''
    const closing = name.startsWith('/')
    if (closing) name = name.slice(1)
    const isBg = name.startsWith('bg:')
    if (isBg) name = name.slice(3)
    if (name in COLOUR_NAMES && !s.startsWith('<<') && s.endsWith('>')) {
      flush()
      if (closing) {
        if (isBg && bg !== undefined) bg = undefined
        else if (fgStack.length) fgStack.pop()
      } else if (isBg) bg = COLOUR_NAMES[name]
      else fgStack.push(COLOUR_NAMES[name])
    } else text += s.startsWith('<<') ? s.slice(1) : s
  }
  text += str.slice(last)
  flush()
  return out
}
