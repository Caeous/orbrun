/**
 * Terminal text: crawl's sixteen colours, a row of coloured spans, and the
 * app's overlay DOM laid out as such rows.
 *
 * happy-dom does no layout, so the overlays (crawl's menus and popups, the
 * text prompts, Orbrun's own sheets) are laid out here from what the DOM
 * says: block elements start lines, inline ones run on, a grid (crawl's
 * new-game menus place their buttons with inline `grid-row`/`grid-column`)
 * becomes columns, `fgN`/`bgN` classes are crawl's colours, and the focused
 * item is lit. The app builds its DOM in code, with no formatting whitespace,
 * so a text node's spaces and newlines are meant and are kept.
 */

/** crawl's sixteen terminal colours (style.css `--color-N`), as RGB */
export const PALETTE: [number, number, number][] = [
  [0, 0, 0], [0, 82, 255], [102, 255, 0], [0, 191, 191], [255, 0, 0], [208, 0, 208], [165, 91, 0], [192, 192, 192],
  [128, 128, 128], [82, 140, 255], [140, 255, 82], [0, 255, 255], [255, 82, 82], [255, 82, 255], [255, 255, 82], [255, 255, 255],
]

export type RGB = [number, number, number]

interface Span {
  text: string
  fg?: RGB
  bg?: RGB
  /** lit: the focused item */
  lit?: boolean
}
export type Line = Span[]

export const lineLength = (l: Line) => l.reduce((n, s) => n + s.text.length, 0)

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

/** `l` wrapped to `width`, at spaces where it can be, each line after the first hung `hang` in */
function wrap(l: Line, width: number, hang = 0): Line[] {
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

const BLOCK = new Set(['DIV', 'P', 'UL', 'OL', 'LI', 'NAV', 'SECTION', 'HEADER', 'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'TABLE', 'TR', 'FORM', 'DL', 'DT', 'DD', 'BLOCKQUOTE', 'HR', 'MAIN', 'ARTICLE', 'ASIDE', 'FIELDSET', 'DETAILS', 'SUMMARY'])
const SKIP = new Set(['CANVAS', 'IMG', 'SVG', 'SCRIPT', 'STYLE', 'TEMPLATE', 'VIDEO', 'AUDIO'])
const LIT = ['focused', 'selected', 'hovered']

function shown(el: Element): boolean {
  const h = el as HTMLElement
  if (h.hidden || el.getAttribute('aria-hidden') === 'true') return false
  // the stylesheet's `.pane:not(.current)`: of a popup's description panes, only the current one shows
  if (el.classList.contains('pane') && !el.classList.contains('current')) return false
  const st = h.style
  return !(st && (st.display === 'none' || st.visibility === 'hidden'))
}

function colours(el: Element, fg?: RGB, bg?: RGB): { fg?: RGB; bg?: RGB } {
  for (const c of Array.from(el.classList)) {
    const m = /^(fg|bg)(\d+)$/.exec(c)
    if (m && +m[2] < 16) {
      if (m[1] === 'fg') fg = PALETTE[+m[2]]
      // crawl's black ground is the console's own: whatever the box behind has
      else bg = +m[2] ? PALETTE[+m[2]] : undefined
    }
  }
  return { fg, bg }
}

function isLit(el: Element) {
  // a tab is lit where it is the current one: crawl's (role tab) and the pack's (a button)
  const tab = el.getAttribute('role') === 'tab' || el.tagName === 'BUTTON'
  return LIT.some((c) => el.classList.contains(c)) || el.getAttribute('aria-selected') === 'true' || (tab && el.classList.contains('current'))
}

/** grid placement from inline style (`grid-row`, `grid-column`, or `grid-area: row / column`), 1-based; 0 where not said */
function cellOf(el: Element): { row: number; col: number } {
  const st = (el as HTMLElement).style
  const area = /grid-area:\s*(\d+)\s*\/\s*(\d+)/.exec(el.getAttribute('style') ?? '')
  if (area) return { row: +area[1], col: +area[2] }
  return { row: parseInt(st?.gridRow || '') || 0, col: parseInt(st?.gridColumn || '') || 0 }
}

/** a custom property of the inline style (`--cols`), as written */
const customProp = (el: Element, name: string) => new RegExp(`${name}:\\s*([^;]*)`).exec(el.getAttribute('style') ?? '')?.[1].trim()

function gridColumns(el: Element): number {
  const t = (el as HTMLElement).style?.gridTemplateColumns || ''
  const rep = /repeat\(\s*(\d+)/.exec(t)
  if (rep) return +rep[1]
  return t.trim() ? t.trim().split(/\s+/).length : 0
}

/** The lines `el` lays out to at `width`, and which of them are lit (the focused item's). */
export function layout(el: Element, width: number): { lines: Line[]; lit: number[] } {
  const lines: Line[] = []
  /** how far in each line's wrapped rest hangs (a `.hang`'s `--hang`) */
  const hangs: number[] = []
  let hang = 0
  let cur: Line = []
  const flush = (force = false) => {
    if (cur.length || force) {
      lines.push(cur)
      hangs.push(hang)
    }
    cur = []
  }
  /** lines laid out whole already, kept from wrapping again */
  const done = new Set<Line>()
  const walk = (node: Node, fg: RGB | undefined, bg: RGB | undefined, lit: boolean) => {
    if (node.nodeType === 3) {
      const parts = (node.nodeValue ?? '').split('\n')
      parts.forEach((p, i) => {
        if (i > 0) flush(true)
        if (p) cur.push({ text: p.replace(/\t/g, '    '), fg, bg, lit })
      })
      return
    }
    if (node.nodeType !== 1) return
    const el = node as Element
    if (SKIP.has(el.tagName) || !shown(el)) return
    const c = colours(el, fg, bg)
    const l = lit || isLit(el)
    if (el.tagName === 'BR') return flush(true)
    // a key named on a prompt's chip, as crawl's console names one
    if (el.tagName === 'KBD') {
      cur.push({ text: `[${el.textContent ?? ''}]`, fg: c.fg ?? PALETTE[15], bg: c.bg, lit: l }, { text: ' ' })
      return
    }
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      const v = (el as HTMLInputElement).value ?? ''
      cur.push({ text: v + '_', fg: c.fg ?? PALETTE[15], bg: [40, 40, 56], lit: l })
      return
    }
    if (el.classList.contains('ctable')) {
      // console.ts's table of crawl's console text: its columns crawl's widths apart (`--cols`), each cell on the row and
      // column it came from, the last column taking what is left and wrapping in itself, under its own start
      flush()
      const widths = (customProp(el, '--cols') ?? '').split(/\s+/).map((w) => parseInt(w)).filter((w) => w > 0)
      const at = widths.reduce<number[]>((a, w) => [...a, a[a.length - 1] + w], [0])
      const cells = (Array.from(el.children) as Element[]).filter(shown).map((k) => ({ ...cellOf(k), line: layout(k, width).lines.flat(), hang: parseInt(customProp(k, '--hang') ?? '') || 0, lit: l || isLit(k) }))
      for (const r of [...new Set(cells.map((x) => x.row))].sort((a, b) => a - b)) {
        let line: Line = []
        let n = 0
        for (const x of cells.filter((y) => y.row === r).sort((a, b) => a.col - b.col)) {
          const from = at[Math.min(x.col - 1, widths.length)]
          if (from > n) line.push({ text: ' '.repeat(from - n), bg: c.bg })
          n = Math.max(n, from)
          const last = x.col > widths.length
          const content = last ? x.line : cut(x.line, Math.max(0, at[x.col] - n))
          if (last) {
            const rows = wrap(content.map((s) => ({ ...s, lit: s.lit || x.lit })), Math.max(8, width - n), x.hang)
            line.push(...rows[0])
            for (const more of rows.slice(1)) {
              lines.push(line), hangs.push(0), done.add(line)
              line = [{ text: ' '.repeat(n) }, ...more]
            }
          } else line.push(...content.map((s) => ({ ...s, lit: s.lit || x.lit })))
          n = lineLength(line)
        }
        lines.push(line), hangs.push(0), done.add(line)
      }
      return
    }
    const block = BLOCK.has(el.tagName) || el.classList.contains('hang')
    const cols = gridColumns(el)
    const kids = Array.from(el.childNodes)
    const gridKids = kids.filter((k) => k.nodeType === 1 && shown(k as Element) && !SKIP.has((k as Element).tagName)) as Element[]
    if (cols > 1 || (gridKids.length > 1 && gridKids.every((k) => cellOf(k).col > 0))) {
      // a grid: each child its own cell, laid out as columns
      flush()
      const n = cols || Math.max(...gridKids.map((k) => cellOf(k).col))
      const cells: { row: number; col: number; line: Line; lit: boolean }[] = []
      let auto = 0
      for (const k of gridKids) {
        const at = cellOf(k)
        const row = at.row || Math.floor(auto / n) + 1
        const col = at.col || (auto % n) + 1
        auto++
        const inner = layout(k, width)
        const line = inner.lines.flat()
        cells.push({ row, col, line, lit: l || isLit(k) || inner.lit.length > 0 })
      }
      const widths = Array.from({ length: n }, (_, i) => Math.max(0, ...cells.filter((x) => x.col === i + 1).map((x) => lineLength(x.line))))
      // squeeze the columns to the width, the widest first
      while (widths.reduce((a, b) => a + b + 2, 0) > width && Math.max(...widths) > 8) widths[widths.indexOf(Math.max(...widths))]--
      const rows = [...new Set(cells.map((x) => x.row))].sort((a, b) => a - b)
      for (const r of rows) {
        const line: Line = []
        for (let i = 0; i < n; i++) {
          const x = cells.find((y) => y.row === r && y.col === i + 1)
          const content = x ? cut(x.line, widths[i]).map((s) => ({ ...s, lit: s.lit || x.lit })) : []
          line.push(...content)
          const pad = widths[i] - lineLength(content) + (i < n - 1 ? 2 : 0)
          if (pad > 0) line.push({ text: ' '.repeat(pad), bg: c.bg })
        }
        lines.push(line)
      }
      return
    }
    if (block) flush()
    const hung = hang
    const own = parseInt(customProp(el, '--hang') ?? '')
    if (own > 0) hang = own
    for (const k of kids) walk(k, c.fg, c.bg, l)
    if (block) flush()
    else if (el.tagName === 'BUTTON' || el.classList.contains('button') || el.classList.contains('chip')) cur.push({ text: '  ' })
    hang = hung
  }
  walk(el, undefined, undefined, false)
  flush()
  const out: Line[] = []
  lines.forEach((l, i) => out.push(...(done.has(l) ? [l] : wrap(l, width, hangs[i]))))
  const lit: number[] = []
  out.forEach((l, i) => {
    if (l.some((s) => s.lit)) lit.push(i)
  })
  return { lines: out, lit }
}
