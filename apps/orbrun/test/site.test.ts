import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { describe, expect, it } from 'vitest'
import { HOME, MOVED, PAGES, SITE_URL, addressKind, pageAt, titleAt } from '../src/site'
import { docHtml, robotsTxt, sitePageHtml, sitemapXml } from '../site-pages'

const here = path.dirname(fileURLToPath(import.meta.url))
const template = fs.readFileSync(path.join(here, '..', 'index.html'), 'utf8')

/**
 * The pages a search engine is given, each a web page with its own head and
 * words, and the addresses it is not: the app's own screens say noindex, and anything
 * else is a 404 rather than another copy of the home page.
 */
describe('the site’s pages', () => {
  it('knows a page with or without its trailing slash, in any case', () => {
    expect(pageAt('/')).toBe(HOME)
    expect(pageAt('/about/steam/')?.doc).toBe('STEAM.md')
    expect(pageAt('/About/New')?.doc).toBe('CHANGELOG.md')
    expect(pageAt('/about/nope')).toBeNull()
  })

  it('tells pages from the app’s screens from nothing at all', () => {
    for (const p of ['/', '/about', '/about/new', '/about/steam']) expect(addressKind(p), p).toBe('page')
    for (const p of ['/settings', '/settings/camera', '/accounts/add', '/watch', '/watch/cdi', '/watch/cdi/bob', '/play/cdi/orbrun/dcss-0.34', '/login/cdi', '/register/cko'])
      expect(addressKind(p), p).toBe('app')
    for (const p of ['/wp-admin', '/about/nope', '/about/controls', '/about/how-it-works', '/index.php', '/play', '/settings/controls/gamepad/x']) expect(addressKind(p), p).toBe('none')
  })

  it('sends an address that moved to where it went', () => {
    expect(MOVED['/about/orbrun']).toBe('/about')
    expect(pageAt(MOVED['/about/orbrun'])).not.toBeNull()
    expect(pageAt('/about/orbrun')).toBeNull()
  })

  it('names the tab after the page, and the home page anywhere else', () => {
    expect(titleAt('/about/steam')).toBe('Add Orbrun to Steam on the Steam Deck')
    expect(titleAt('/settings')).toBe(HOME.title)
  })

  it('keeps every title and snippet short enough not to be cut', () => {
    for (const p of PAGES) {
      expect(p.title.length, p.path).toBeLessThanOrEqual(60)
      expect(p.description.length, p.path).toBeLessThanOrEqual(160)
    }
  })

  it('writes the home page’s head in index.html as the page list says it', () => {
    expect(template).toContain(`<title>${HOME.title}</title>`)
    expect(template).toContain(`content="${HOME.description}"`)
    expect(template).toContain(`<link rel="canonical" href="${SITE_URL}/" />`)
  })

  it('writes each other page as a web page of its own: its own head and breadcrumbs, its words, and no app', () => {
    const window = new Window()
    const html = sitePageHtml(pageAt('/about/steam')!, window as never)
    const doc = new window.DOMParser().parseFromString(html, 'text/html')
    expect(doc.title).toBe('Add Orbrun to Steam on the Steam Deck')
    expect(doc.querySelector('link[rel=canonical]')?.getAttribute('href')).toBe(`${SITE_URL}/about/steam`)
    expect(doc.querySelector('meta[property="og:url"]')?.getAttribute('content')).toBe(`${SITE_URL}/about/steam`)
    expect(doc.querySelector('meta[name=description]')?.getAttribute('content')).toBe(pageAt('/about/steam')!.description)
    const data = JSON.parse(doc.querySelector('script[type="application/ld+json"]')!.textContent!)
    expect(data['@graph'][1].itemListElement.map((i: { item: string }) => i.item)).toEqual([`${SITE_URL}/`, `${SITE_URL}/about`, `${SITE_URL}/about/steam`])
    expect(doc.querySelectorAll('h1')).toHaveLength(1)
    expect(doc.querySelector('h1')?.textContent).toBe('@Add to Steam')
    // each step a card of its own, its number set apart, the heading's words as the document has them
    expect(doc.querySelector('.doc h2')?.textContent).toBe('1. Install Chrome and enable the controller')
    expect(doc.querySelector('.doc .part h2 .n')?.textContent).toBe('1.')
    expect(doc.querySelectorAll('.doc .part')).toHaveLength(doc.querySelectorAll('.doc h2').length)
    expect(doc.querySelector('.doc')?.textContent).toContain('flatpak --user override')
    // the page is the site's, not the app's: nothing boots, and Play is a link to it
    expect(doc.getElementById('app')).toBeNull()
    expect(html).not.toContain('/src/main.ts')
    expect(doc.querySelector('.bar a.play')?.getAttribute('href')).toBe('/')
    expect(doc.querySelector('.bar nav a[aria-current=page]')?.textContent).toBe('Add to Steam')
    void window.happyDOM.close()
  })

  it('lists a document’s sections to jump to, each with an address of its own', () => {
    const window = new Window()
    const doc = new window.DOMParser().parseFromString(sitePageHtml(pageAt('/about/steam')!, window as never), 'text/html')
    const jumps = Array.from(doc.querySelectorAll('.contents a'), (a) => a.getAttribute('href'))
    expect(jumps).toContain('#1-install-chrome-and-enable-the-controller')
    for (const id of jumps) expect(doc.querySelector(`.doc h2${id}`), id!).not.toBeNull()
    // a changelog's releases are not worth a list
    const news = new window.DOMParser().parseFromString(sitePageHtml(pageAt('/about/new')!, window as never), 'text/html')
    expect(news.querySelector('.contents')).toBeNull()
    void window.happyDOM.close()
  })

  it('links the site’s own documents on the site, sends links out to a tab, and draws the pad’s buttons as the game does', () => {
    const window = new Window()
    // the whole of ABOUT.md, as a page that read all of it would have it
    const html = docHtml('ABOUT.md', window as never).html
    const words = new window.DOMParser().parseFromString(`<div>${html}</div>`, 'text/html').body.firstElementChild!
    expect(words.querySelector('a[href="/about/steam"]')).not.toBeNull()
    expect(html).not.toContain('blob/main/STEAM.md')
    for (const a of Array.from(words.querySelectorAll<HTMLAnchorElement>('a[href^="http"]'))) expect(a.getAttribute('target'), a.getAttribute('href')!).toBe('_blank')
    expect(words.querySelector('a[href^="mailto:"]')).not.toBeNull()
    expect(words.textContent).not.toContain('STEAM.md')
    // the gamepad's controls as a legend: each line's buttons drawn as the game draws them, in a column of their own
    const legend = words.querySelector('ul.pad-list')!
    const keys = (i: number) => Array.from(legend.children[i].querySelectorAll('.keys .glyph'), (g) => g.getAttribute('aria-label'))
    expect(keys(0)).toEqual(['Left stick', 'D-pad'])
    expect(keys(1)).toEqual(['A'])
    expect(legend.children[1].querySelector('.does')?.textContent).toMatch(/^does what the situation calls for/)
    expect(Array.from(legend.children, (_, i) => keys(i))).toContainEqual(['R3', 'L3'])
    expect(legend.querySelector('.keys svg')).not.toBeNull()
    void window.happyDOM.close()
  })

  it('shows About rather than describing it: acts that each open on a label, stills of real games, the pad, the questions', () => {
    const window = new Window()
    const doc = new window.DOMParser().parseFromString(sitePageHtml(pageAt('/about')!, window as never), 'text/html')
    expect(doc.querySelector('.hero h1')?.textContent).toBe('Orbrun')
    expect(Array.from(doc.querySelectorAll('.label h2'), (h) => h.textContent)).toEqual([
      '@The real game',
      '@Every branch',
      '@Made for a controller',
      '@On the Steam Deck',
      '@The keyboard you know',
      '@And more',
      '@Your account stays yours',
      '@Questions',
    ])
    // every still the page names is one the site ships
    const srcs = Array.from(doc.querySelectorAll('img, source'), (el) => el.getAttribute('src') ?? el.getAttribute('srcset')!).filter((s) => s.startsWith('/about/'))
    expect(srcs.length).toBeGreaterThan(8)
    for (const src of srcs) expect(fs.existsSync(path.join(here, '..', 'public', src)), src).toBe(true)
    // WebTiles and Orbrun, the same moment, one over the other
    expect(doc.querySelectorAll('.compare img')).toHaveLength(2)
    expect(doc.querySelectorAll('.branches figure')).toHaveLength(4)
    // the pad board names each button as the standard mapping does, drawn as the game draws it
    const pads = Array.from(doc.querySelectorAll('.padboard li'), (li) => li.getAttribute('data-pad'))
    expect(pads).toContain('A')
    expect(pads).toContain('LSTICK DPAD')
    expect(doc.querySelectorAll('.padboard li .glyph svg').length).toBeGreaterThanOrEqual(pads.length)
    // the Deck, with the game on its screen
    expect(Array.from(doc.querySelectorAll('.deck img'), (i) => i.getAttribute('src'))).toEqual(['/about/deck.webp', '/about/deck-screen.webp'])
    // the questions, for a search engine too
    const faq = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'), (s) => JSON.parse(s.textContent!)).find((d) => d['@type'] === 'FAQPage')
    expect(faq.mainEntity).toHaveLength(doc.querySelectorAll('.faq details').length)
    // no manual, and the card is the hero
    expect(doc.querySelector('.doc')).toBeNull()
    expect(doc.querySelector('meta[property="og:image"]')?.getAttribute('content')).toBe(`${SITE_URL}/about/card.jpg`)
    expect(Array.from(doc.querySelectorAll('.bar nav a:not([target])'), (a) => a.getAttribute('href'))).toEqual(['/about', '/about/new', '/about/steam'])
    void window.happyDOM.close()
  })

  it('lists every page in the sitemap, and points robots.txt at it', () => {
    const xml = sitemapXml(PAGES)
    for (const p of PAGES) expect(xml).toContain(`<loc>${SITE_URL}${p.path === '/' ? '/' : p.path}</loc>`)
    expect(robotsTxt()).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`)
    expect(robotsTxt()).toMatch(/Disallow: \/gamedata-proxy\//)
  })
})
