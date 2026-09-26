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
    for (const p of ['/wp-admin', '/about/nope', '/index.php', '/play', '/settings/controls/gamepad/x']) expect(addressKind(p), p).toBe('none')
  })

  it('sends an address that moved to where it went', () => {
    expect(MOVED['/about/orbrun']).toBe('/about')
    expect(pageAt(MOVED['/about/orbrun'])).not.toBeNull()
    expect(pageAt('/about/orbrun')).toBeNull()
  })

  it('names the tab after the page, and the home page anywhere else', () => {
    expect(titleAt('/about/steam')).toBe('Add Orbrun to Steam and the Steam Deck')
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
    expect(doc.title).toBe('Add Orbrun to Steam and the Steam Deck')
    expect(doc.querySelector('link[rel=canonical]')?.getAttribute('href')).toBe(`${SITE_URL}/about/steam`)
    expect(doc.querySelector('meta[property="og:url"]')?.getAttribute('content')).toBe(`${SITE_URL}/about/steam`)
    expect(doc.querySelector('meta[name=description]')?.getAttribute('content')).toBe(pageAt('/about/steam')!.description)
    const data = JSON.parse(doc.querySelector('script[type="application/ld+json"]')!.textContent!)
    expect(data['@graph'][1].itemListElement.map((i: { item: string }) => i.item)).toEqual([`${SITE_URL}/`, `${SITE_URL}/about`, `${SITE_URL}/about/steam`])
    expect(doc.querySelectorAll('h1')).toHaveLength(1)
    expect(doc.querySelector('h1')?.textContent).toBe('Add to Steam')
    expect(doc.querySelector('.doc h2')?.textContent).toBe('1. Get a browser')
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
    expect(jumps).toContain('#1-get-a-browser')
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

  it('gives About the whole pitch, the parts of ABOUT.md a newcomer wants, and no list of the other documents or closing call to play', () => {
    const window = new Window()
    const doc = new window.DOMParser().parseFromString(sitePageHtml(pageAt('/about')!, window as never), 'text/html')
    expect(doc.querySelector('.hero h1')?.textContent).toBe('Orbrun')
    // what Orbrun is, three lines each stood on one of the room's own tiles
    expect(Array.from(doc.querySelectorAll('.things h3'), (h) => h.textContent)).toEqual(['Inside the dungeon', 'Made for a controller', 'Your WebTiles, as it is'])
    expect(doc.querySelectorAll('.things .tile > span[style*="background-position"]')).toHaveLength(3)
    expect(Array.from(doc.querySelectorAll('.doc h2'), (h) => h.textContent)).toEqual(pageAt('/about')!.sections)
    // the manual's other parts stay in ABOUT.md: its opening (the hero says it), the features, the Steam steps, the version notes
    const words = doc.querySelector('.doc')!.textContent!
    expect(words).not.toContain('If you play WebTiles, this is your game')
    expect(words).not.toContain('direction keys are relative to where you are facing')
    expect(words).not.toContain('Most of the code was written')
    // the bar already links them, and its Play button stands in for a closing one
    expect(doc.querySelector('.read')).toBeNull()
    expect(doc.querySelector('.cta')).toBeNull()
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
