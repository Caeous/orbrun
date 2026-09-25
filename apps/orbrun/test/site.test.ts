import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { describe, expect, it } from 'vitest'
import { HOME, PAGES, SITE_URL, addressKind, pageAt, titleAt } from '../src/site'
import { pageHtml, robotsTxt, sitemapXml } from '../site-pages'

const here = path.dirname(fileURLToPath(import.meta.url))
const template = fs.readFileSync(path.join(here, '..', 'index.html'), 'utf8')

/**
 * The pages a search engine is given, each with its own head and words, and
 * the addresses it is not: the app's own screens say noindex, and anything
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
    for (const p of ['/', '/about', '/about/orbrun', '/about/new', '/about/steam']) expect(addressKind(p), p).toBe('page')
    for (const p of ['/settings', '/settings/camera', '/accounts/add', '/watch', '/watch/cdi', '/watch/cdi/bob', '/play/cdi/orbrun/dcss-0.34', '/login/cdi', '/register/cko'])
      expect(addressKind(p), p).toBe('app')
    for (const p of ['/wp-admin', '/about/nope', '/index.php', '/play', '/settings/controls/gamepad/x']) expect(addressKind(p), p).toBe('none')
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

  it('gives each other page its own head, breadcrumbs and words, and keeps the app that boots', () => {
    const window = new Window()
    const html = pageHtml(template, pageAt('/about/steam')!, window as never)
    const doc = new window.DOMParser().parseFromString(html, 'text/html')
    expect(doc.title).toBe('Add Orbrun to Steam and the Steam Deck')
    expect(doc.querySelector('link[rel=canonical]')?.getAttribute('href')).toBe(`${SITE_URL}/about/steam`)
    expect(doc.querySelector('meta[property="og:url"]')?.getAttribute('content')).toBe(`${SITE_URL}/about/steam`)
    expect(doc.querySelector('meta[name=description]')?.getAttribute('content')).toBe(pageAt('/about/steam')!.description)
    const data = JSON.parse(doc.querySelector('script[type="application/ld+json"]')!.textContent!)
    expect(data['@graph'][1].itemListElement.map((i: { item: string }) => i.item)).toEqual([`${SITE_URL}/`, `${SITE_URL}/about`, `${SITE_URL}/about/steam`])
    const page = doc.getElementById('page')!
    expect(page.querySelectorAll('h1')).toHaveLength(1)
    expect(page.querySelector('h1')?.textContent).toBe('Add Orbrun to Steam')
    expect(page.querySelector('h3')).toBeNull()
    expect(page.textContent).toContain('flatpak --user override')
    expect(doc.getElementById('app')).not.toBeNull()
    void window.happyDOM.close()
  })

  it('links the site’s own documents to their pages, not to GitHub', () => {
    const window = new Window()
    const html = pageHtml(template, pageAt('/about/orbrun')!, window as never)
    expect(html).toContain('<a href="/about/steam">')
    expect(html).not.toContain('blob/main/STEAM.md')
    expect(html).toContain('mailto:')
    void window.happyDOM.close()
  })

  it('lists every page in the sitemap, and points robots.txt at it', () => {
    const xml = sitemapXml(PAGES)
    for (const p of PAGES) expect(xml).toContain(`<loc>${SITE_URL}${p.path === '/' ? '/' : p.path}</loc>`)
    expect(robotsTxt()).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`)
    expect(robotsTxt()).toMatch(/Disallow: \/gamedata-proxy\//)
  })
})
