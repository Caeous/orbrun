// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../src/markdown'

describe('the repository’s documents, drawn in the front end', () => {
  it('draws headings, wrapped paragraphs and lists, fenced code and tables', () => {
    const doc = renderMarkdown([
      '# Title',
      '',
      'One line',
      'and the next, joined.',
      '',
      '## Section',
      '',
      '- an item',
      '  that wraps',
      '- another',
      '',
      '```sh',
      'curl -fsSL https://orbrun.app/deck | sh',
      '```',
      '',
      '| Key | Does |',
      '|-----|------|',
      '| `k` | step |',
    ].join('\n'))
    expect(doc.querySelector('h2')?.textContent).toBe('Title')
    expect(doc.querySelector('p')?.textContent).toBe('One line and the next, joined.')
    expect(doc.querySelector('h3')?.textContent).toBe('Section')
    expect(Array.from(doc.querySelectorAll('li')).map((li) => li.textContent)).toEqual(['an item that wraps', 'another'])
    expect(doc.querySelector('pre code')?.textContent).toBe('curl -fsSL https://orbrun.app/deck | sh')
    expect(doc.querySelector('th')?.textContent).toBe('Key')
    expect(doc.querySelector('td code')?.textContent).toBe('k')
  })

  it('leaves the document’s own title out when the screen already says it', () => {
    const doc = renderMarkdown('# Title\n\nWords.\n\n## Section', { dropTitle: true })
    expect(doc.querySelector('h2')).toBeNull()
    expect(doc.firstElementChild?.textContent).toBe('Words.')
    expect(doc.querySelector('h3')?.textContent).toBe('Section')
  })

  it('marks code, bold and links inline, sends links out in a new tab, and leaves anchors as words', () => {
    const doc = renderMarkdown('See [ABOUT.md](ABOUT.md), [the site](https://orbrun.app), [below](#steam-deck), <https://crawl.develz.org/> and <caeous@gmail.com>: **bold** `code` *em*.')
    const links = Array.from(doc.querySelectorAll('a'))
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['ABOUT.md', 'https://github.com/Caeous/orbrun/blob/main/ABOUT.md'],
      ['the site', 'https://orbrun.app'],
      ['https://crawl.develz.org/', 'https://crawl.develz.org/'],
      ['caeous@gmail.com', 'mailto:caeous@gmail.com'],
    ])
    for (const a of links.slice(0, 3)) expect(a.getAttribute('target')).toBe('_blank')
    expect(doc.textContent).toContain('below')
    expect(doc.querySelector('strong')?.textContent).toBe('bold')
    expect(doc.querySelector('code')?.textContent).toBe('code')
    expect(doc.querySelector('em')?.textContent).toBe('em')
  })

  it('skips raw html and comments, and keeps an underscore or a star inside code as it is', () => {
    const doc = renderMarkdown('<p align="center"><img src="x.svg"></p>\n\n<!-- a note\nover lines -->\n\nSet `VIEW_OPTIONS` in `tileinfo-*.js`.')
    expect(doc.querySelector('img')).toBeNull()
    expect(doc.textContent).not.toContain('a note')
    expect(Array.from(doc.querySelectorAll('code')).map((c) => c.textContent)).toEqual(['VIEW_OPTIONS', 'tileinfo-*.js'])
    expect(doc.querySelector('em')).toBeNull()
  })
})
