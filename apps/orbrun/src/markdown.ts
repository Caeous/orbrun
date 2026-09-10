import { h, type Child } from './dom'

/**
 * The repository's own documents (ABOUT.md, CHANGELOG.md) drawn in the
 * front end, so About and What's new read in place rather than in a tab.
 *
 * A small reader for what those files use, not a Markdown implementation:
 * headings, paragraphs, bullet lists (with wrapped lines), fenced code,
 * tables, and inline code, emphasis, links and autolinks. Raw HTML and
 * comments are skipped, as is anything that draws nothing on this screen
 * (the logo, screenshots). Links to other files of the repository point at
 * them on GitHub; links within the document are left as words.
 */

/** where a relative link (`LICENSE`, `ATTRIBUTION.md`) is found */
const REPO_BLOB = 'https://github.com/Caeous/orbrun/blob/main/'

/**
 * @param dropTitle leave out the document's own first heading: the screen
 *   it stands on already says what it is
 */
export function renderMarkdown(src: string, opts: { dropTitle?: boolean } = {}): HTMLElement {
  const out = h('div', { class: 'doc' })
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  let i = 0
  const para: string[] = []
  const flush = () => {
    if (!para.length) return
    out.append(h('p', null, ...inline(para.join(' '))))
    para.length = 0
  }
  while (i < lines.length) {
    const line = lines[i]
    // a comment, on one line or many
    if (/^\s*<!--/.test(line)) {
      flush()
      while (i < lines.length && !/-->\s*$/.test(lines[i])) i++
      i++
      continue
    }
    // a block of raw html (the logo, the screenshots): nothing of it is drawn here
    if (/^<[a-zA-Z/]/.test(line)) {
      flush()
      while (i < lines.length && lines[i].trim() !== '') i++
      continue
    }
    if (line.trim() === '') {
      flush()
      i++
      continue
    }
    const fence = /^```/.exec(line)
    if (fence) {
      flush()
      const code: string[] = []
      i++
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++])
      i++
      out.append(h('pre', null, h('code', null, code.join('\n'))))
      continue
    }
    const head = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (head) {
      flush()
      const level = Math.min(head[1].length + 1, 6) as 2 | 3 | 4 | 5 | 6
      out.append(h(`h${level}` as 'h2', null, ...inline(head[2])))
      i++
      continue
    }
    if (/^\s*[-*]\s+/.test(line)) {
      flush()
      const ul = h('ul')
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const item = [lines[i].replace(/^\s*[-*]\s+/, '')]
        i++
        // a wrapped item continues on indented lines up to the next bullet or blank
        while (i < lines.length && /^\s+\S/.test(lines[i]) && !/^\s*[-*]\s+/.test(lines[i])) item.push(lines[i++].trim())
        ul.append(h('li', null, ...inline(item.join(' '))))
        // an empty line between items keeps the list together
        if (i < lines.length && lines[i].trim() === '' && i + 1 < lines.length && /^\s*[-*]\s+/.test(lines[i + 1])) i++
      }
      out.append(ul)
      continue
    }
    if (/^\|/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      flush()
      const cells = (l: string) => l.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim())
      const table = h('table')
      table.append(h('thead', null, h('tr', null, ...cells(line).map((c) => h('th', null, ...inline(c))))))
      const tbody = h('tbody')
      i += 2
      while (i < lines.length && /^\|/.test(lines[i])) tbody.append(h('tr', null, ...cells(lines[i++]).map((c) => h('td', null, ...inline(c)))))
      table.append(tbody)
      out.append(table)
      continue
    }
    para.push(line.trim())
    i++
  }
  flush()
  if (opts.dropTitle && out.firstElementChild?.tagName === 'H2') out.firstElementChild.remove()
  return out
}

/** A link out of the document: another site or another file of the repository, in a new tab. */
function link(text: Child[], href: string): HTMLElement | Child[] {
  // a link within the document has nowhere to go on this screen: its words stand alone
  if (href.startsWith('#')) return text
  const abs = /^[a-z]+:/i.test(href) ? href : REPO_BLOB + href.replace(/^\.?\//, '')
  return h('a', { href: abs, target: '_blank', rel: 'noopener noreferrer' }, ...text)
}

/** Inline marks: code, bold, emphasis, links, autolinks and mail; an image is its alt text. */
function inline(text: string): Child[] {
  const out: Child[] = []
  const re = /(`+)(.+?)\1|!\[([^\]]*)\]\([^)]*\)|\[([^\]]+)\]\(([^)\s]+)\)|<((?:https?:\/\/|mailto:)[^>\s]+)>|<([^\s@>]+@[^\s@>]+)>|\*\*(.+?)\*\*|(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])|(?<![\w_])_(?!\s)(.+?)(?<!\s)_(?![\w_])/g
  let last = 0
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index))
    last = m.index! + m[0].length
    if (m[2] !== undefined) out.push(h('code', null, m[2]))
    else if (m[3] !== undefined) out.push(m[3])
    else if (m[4] !== undefined) out.push(link(inline(m[4]), m[5]))
    else if (m[6] !== undefined) out.push(h('a', { href: m[6], target: '_blank', rel: 'noopener noreferrer' }, m[6].replace(/^mailto:/, '')))
    else if (m[7] !== undefined) out.push(h('a', { href: 'mailto:' + m[7] }, m[7]))
    else if (m[8] !== undefined) out.push(h('strong', null, ...inline(m[8])))
    else if (m[9] !== undefined) out.push(h('em', null, ...inline(m[9])))
    else if (m[10] !== undefined) out.push(h('em', null, ...inline(m[10])))
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
