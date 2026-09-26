import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import type { Plugin } from 'vite'
import { glyph, type GlyphName } from './src/glyphs'
import { renderMarkdown } from './src/markdown'
import { HOME, PAGES, SITE_URL, pageAt, type Page } from './src/site'

/**
 * The site's pages (src/site.ts PAGES) as web pages of their own: About &
 * credits and its documents, for a reader who arrived from a search or a
 * link and has never played. No app in them: the words, the front room's
 * poster, and a way to Play. The home page is the app, index.html as
 * written, with its own words for crawlers in `#page`.
 *
 * Each is written as `about/steam.html`, which the Worker's static assets
 * serve at `/about/steam` (Cloudflare's html_handling), beside
 * `sitemap.xml` and `robots.txt`. The dev server draws them on each request,
 * so an edit to a document or to site/ shows on a reload.
 *
 * The look is site/site.css; site/site.js is the pad and the window of our
 * own. Both are inlined: a page is one request, and small.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')

/** where the markdown reader points a link to another file of the repository (markdown.ts REPO_BLOB) */
const REPO_BLOB = 'https://github.com/Caeous/orbrun/blob/main/'
const SOURCE = 'https://github.com/Caeous/orbrun'

/** the poster's words, as index.html's card has them */
const POSTER_ALT = 'A stone hall in Dungeon Crawl Stone Soup’s tiles: a down staircase between two granite statues, plants, an altar and a fountain'

/** the pad's buttons as the documents name them in bold, and the app's glyph for each (glyphs.ts) */
const PAD_BUTTONS: Record<string, GlyphName> = { A: 'A', B: 'B', X: 'X', Y: 'Y', LB: 'LB', RB: 'RB', LT: 'LT', RT: 'RT', L3: 'L3', R3: 'R3', Select: 'SELECT', Start: 'START' }

/** the words a line of the controls opens on when it is about the sticks and the d-pad, not a button */
const MOVE_LINE = /^Left stick or d-pad\b/

/** The site draws the buttons as the game draws an Xbox-style pad's, the Steam Deck's own layout. */
const PAD_KIND = 'xbox'

/** the front room's packed tiles (public/room, tools/build/pack-room.mjs), which the About page's list stands its lines on */
interface Atlas {
  cell: number
  width: number
  names: Record<string, { id: number }>
  tiles: Record<string, { sx: number; sy: number; w: number; h: number; ox: number; oy: number }>
}

/** how many screen pixels a tile's pixel is on the About page */
const TILE_SCALE = 1.5

/**
 * One of the room's tiles by its name (`DNGN_STONE_STAIRS_DOWN`), drawn from
 * the atlas the room already ships: its trimmed rect put back where it stands
 * in its cell, every pixel square.
 */
function tileHtml(name: string): string {
  const atlas = JSON.parse(fs.readFileSync(path.join(HERE, 'public/room/atlas.json'), 'utf8')) as Atlas
  const id = atlas.names[name]?.id
  const t = id === undefined ? undefined : atlas.tiles[id]
  if (!t) throw new Error(`site-pages: the room's atlas has no ${name}; pack it (npm run room:pack) or pick another tile`)
  const k = TILE_SCALE
  const box = `width:${atlas.cell * k}px;height:${atlas.cell * k}px`
  const art = `left:${t.ox * k}px;top:${t.oy * k}px;width:${t.w * k}px;height:${t.h * k}px;background-position:${-t.sx * k}px ${-t.sy * k}px;background-size:${atlas.width * k}px auto`
  return `<span class="tile" style="${box}" aria-hidden="true"><span style="${art}"></span></span>`
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const url = (p: Page) => SITE_URL + (p.path === '/' ? '/' : p.path)

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/** the DOM the app's reader and glyphs draw with (dom.ts `h`, glyphs.ts): `document` and `Node`, lent from happy-dom */
type Dom = { document: Document; Node: typeof Node }

/** `fn` with the DOM lent as the app's own code expects to find it */
function withDom<T>(dom: Dom, fn: () => T): T {
  const g = globalThis as Partial<Dom>
  const before = { document: g.document, Node: g.Node }
  Object.assign(g, { document: dom.document, Node: dom.Node })
  try {
    return fn()
  } finally {
    Object.assign(g, before)
  }
}

/** a pad button as the game draws it, with its name for a reader who cannot see it */
function glyphEl(dom: Dom, name: GlyphName, label: string): HTMLElement {
  const el = dom.document.createElement('span')
  el.className = 'glyph'
  el.setAttribute('role', 'img')
  el.setAttribute('aria-label', label)
  el.append(withDom(dom, () => glyph(name, PAD_KIND)))
  return el
}

const glyphHtml = (dom: Dom, name: GlyphName, label: string) => glyphEl(dom, name, label).outerHTML

/**
 * A list of what the pad's buttons do, as a legend: each line's buttons in a
 * column of their own, drawn as the game draws them, and what they do beside
 * them. A list is one when most of its lines open on a button.
 */
function padLegend(list: HTMLUListElement, dom: Dom) {
  const isGlyph = (n: ChildNode | null) => n?.nodeType === 1 && (n as Element).classList.contains('glyph')
  const isGap = (n: ChildNode | null) => n?.nodeType === 3 && /^\s*(or)?\s*$/.test(n.textContent ?? '')
  const items = [...list.children] as HTMLElement[]
  const lines = items.filter((li) => isGlyph(li.firstChild) || MOVE_LINE.test(li.textContent ?? ''))
  if (lines.length < items.length / 2) return
  list.classList.add('pad-list')
  for (const li of items) {
    const keys = dom.document.createElement('span')
    keys.className = 'keys'
    if (MOVE_LINE.test(li.textContent ?? '')) keys.append(glyphEl(dom, 'LSTICK', 'Left stick'), glyphEl(dom, 'DPAD', 'D-pad'))
    // the buttons the line opens on, and the "or" between two of them
    else
      while (isGlyph(li.firstChild) || (isGap(li.firstChild) && isGlyph(li.firstChild!.nextSibling))) {
        const node = li.firstChild!
        if (isGlyph(node)) keys.append(node)
        else node.remove()
      }
    const words = dom.document.createElement('span')
    words.className = 'does'
    words.append(...li.childNodes)
    if (words.firstChild?.nodeType === 3) words.firstChild.textContent = words.firstChild.textContent!.trimStart()
    li.append(keys, words)
  }
}

/**
 * A document drawn by the app's own reader for a page of its own: its title
 * is the page's (left out here), its sections are h2 with an address each,
 * the site's own documents are linked on the site, a link out opens a tab,
 * and a pad button named in bold is drawn as a button.
 */
export function docHtml(file: string, dom: Dom, only?: string[]): { html: string; sections: { id: string; name: string }[] } {
  const doc = dom.document
  const el = withDom(dom, () => renderMarkdown(fs.readFileSync(path.join(ROOT, file), 'utf8'), { dropTitle: true }))
  // only some of its sections (the reader's h3, a `##`): the words before the first, and every other section, go
  if (only) {
    let keep = false
    for (const node of [...el.children]) {
      if (node.tagName === 'H3') keep = only.includes(node.textContent ?? '')
      if (!keep) node.remove()
    }
    const missing = only.filter((name) => ![...el.querySelectorAll('h3')].some((h) => h.textContent === name))
    if (missing.length) throw new Error(`site-pages: ${file} has no section ${missing.join(', ')}`)
  }
  {
    // the reader starts at h2, under the screen's own head; here the page's head is the h1, so its sections are h2
    for (const head of [...el.querySelectorAll('h3, h4, h5, h6')]) {
      const up = doc.createElement(`h${Number(head.tagName[1]) - 1}`)
      up.append(...head.childNodes)
      head.replaceWith(up)
    }
    const sections: { id: string; name: string }[] = []
    for (const h2 of el.querySelectorAll('h2')) {
      let id = slug(h2.textContent ?? '')
      while (sections.some((s) => s.id === id)) id += '-'
      h2.id = id
      sections.push({ id, name: h2.textContent ?? '' })
    }
    for (const a of el.querySelectorAll('a')) {
      const href = a.getAttribute('href') ?? ''
      const page = href.startsWith(REPO_BLOB) && PAGES.find((p) => p.doc === href.slice(REPO_BLOB.length))
      const local = page ? page.path : href.startsWith(SITE_URL) ? href.slice(SITE_URL.length) || '/' : null
      if (local) {
        // a link that names the file (`STEAM.md`) names the page it is here
        if (page && a.textContent === page.doc) a.textContent = page.name
        a.setAttribute('href', local)
        a.removeAttribute('target')
        a.removeAttribute('rel')
      } else if (/^https?:/.test(href)) {
        a.setAttribute('target', '_blank')
        a.setAttribute('rel', 'noopener')
      }
    }
    for (const b of [...el.querySelectorAll('strong')]) {
      const name = b.textContent ?? ''
      if (name in PAD_BUTTONS) b.replaceWith(glyphEl(dom, PAD_BUTTONS[name], name))
    }
    for (const list of [...el.querySelectorAll('ul')]) padLegend(list as HTMLUListElement, dom)
    return { html: el.innerHTML, sections }
  }
}

/** Home › About & credits › the page: the trail a search result shows in place of the address */
function structuredData(page: Page): string {
  const trail = [HOME, ...PAGES.filter((p) => p.path !== '/' && (page.path === p.path || page.path.startsWith(p.path + '/')))]
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebPage', '@id': url(page), url: url(page), name: page.title, description: page.description, inLanguage: 'en', isPartOf: { '@id': `${SITE_URL}/#website` } },
      { '@type': 'BreadcrumbList', itemListElement: trail.map((p, i) => ({ '@type': 'ListItem', position: i + 1, name: p.name, item: url(p) })) },
    ],
  }).replace(/</g, '\\u003c')
}

function head(page: Page, css: string): string {
  const title = esc(page.title)
  const description = esc(page.description)
  return `<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#000000" />
<meta name="color-scheme" content="dark" />
<title>${title}</title>
<meta name="description" content="${description}" />
<link rel="canonical" href="${url(page)}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Orbrun" />
<meta property="og:locale" content="en_US" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${description}" />
<meta property="og:url" content="${url(page)}" />
<meta property="og:image" content="${SITE_URL}/room/poster.jpg" />
<meta property="og:image:type" content="image/jpeg" />
<meta property="og:image:width" content="1280" />
<meta property="og:image:height" content="720" />
<meta property="og:image:alt" content="${esc(POSTER_ALT)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${title}" />
<meta name="twitter:description" content="${description}" />
<meta name="twitter:image" content="${SITE_URL}/room/poster.jpg" />
<script type="application/ld+json">${structuredData(page)}</script>
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
<link rel="preload" href="/fonts/grenze-gotisch-700-latin.woff2" as="font" type="font/woff2" crossorigin />
<link rel="preload" href="/fonts/dejavu-sans-mono-700.woff2" as="font" type="font/woff2" crossorigin />
<style>
${css}
</style>
</head>`
}

function bar(page: Page): string {
  const docs = PAGES.filter((p) => p.path !== '/')
  return `<header class="bar solid">
  <a class="brand" href="/"><img src="/orb.png" alt="" width="32" height="32" />Orbrun</a>
  <nav aria-label="About Orbrun">
    ${docs.map((p) => `<a href="${p.path}"${p === page ? ' aria-current="page"' : ''}>${esc(p.name)}</a>`).join('\n    ')}
    <a href="${SOURCE}" target="_blank" rel="noopener">Source</a>
  </nav>
  <a class="btn play" href="/">▶ Play</a>
</header>`
}

const poster = `<img src="/room/poster.jpg" alt="${esc(POSTER_ALT)}" width="1280" height="720" fetchpriority="high" />`

/** About & credits: what Orbrun is, big, and the parts of ABOUT.md a newcomer wants */
function aboutMain(page: Page, dom: Dom): string {
  const { html } = docHtml(page.doc!, dom, page.sections)
  return `<section class="hero">
  ${poster}
  <div>
    <h1><img src="/orb.png" alt="" width="32" height="32" />Orbrun</h1>
    <p class="tag">Dungeon Crawl Stone Soup, in first person.</p>
    <p class="lede">An unofficial client for the public DCSS servers, built to be played with a gamepad, on the Steam Deck first. Your account, your rc file, your keys. Nothing to install.</p>
    <div class="actions">
      <a class="btn play" href="/">▶ Play in your browser</a>
      <a class="btn ghost" href="/about/steam">Add to Steam</a>
    </div>
    <span class="small-print">Free and open source · AGPL-3.0 · Not affiliated with the DCSS team</span>
  </div>
</section>

<section class="things" aria-label="In short">
  <div class="thing">${tileHtml('DNGN_STONE_STAIRS_DOWN')}<div><h3>Inside the dungeon</h3><p>The live game in first-person 3D, drawn from the server’s own tiles.</p></div></div>
  <div class="thing">${tileHtml('POTION_OFFSET')}<div><h3>Made for a controller</h3><p>A contextual ${glyphHtml(dom, 'A', 'A')}, command menus, an on-screen keyboard, and hints that teach as you play.</p></div></div>
  <div class="thing">${tileHtml('SCROLL')}<div><h3>Your WebTiles, as it is</h3><p>Same servers, same account, same rc file. Every release and trunk build, the day it lands.</p></div></div>
</section>

<article class="doc wide">
${html}
</article>`
}

/** a document's page: its name over the room, its sections, its words */
function docMain(page: Page, dom: Dom): string {
  const { html, sections } = docHtml(page.doc!, dom)
  const contents =
    page.contents && sections.length > 2
      ? `<nav class="contents" aria-label="On this page">
  <h2>On this page</h2>
  <ul>
    ${sections.map((s) => `<li><a href="#${s.id}">${esc(s.name)}</a></li>`).join('\n    ')}
  </ul>
</nav>`
      : ''
  return `<section class="hero band">
  ${poster}
  <div>
    <h1>${esc(page.name)}</h1>
    <p class="lede">${esc(page.description)}</p>
  </div>
</section>
${contents}
<article class="doc">
${html}
</article>`
}

/** A page of the site at `page.path`, whole. */
export function sitePageHtml(page: Page, dom: Dom): string {
  const css = fs.readFileSync(path.join(HERE, 'site/site.css'), 'utf8')
  const js = fs.readFileSync(path.join(HERE, 'site/site.js'), 'utf8')
  return `<!doctype html>
<html lang="en">
${head(page, css)}
<body>
<a class="skip" href="#main">Skip to the words</a>
${bar(page)}
<main id="main">
${page.path === '/about' ? aboutMain(page, dom) : `${docMain(page, dom)}
<section class="cta">
  <p>The dungeon is waiting.</p>
  <a class="btn play" href="/">▶ Play Orbrun</a>
</section>`}
</main>
<footer>
  <div class="links">
    <a href="/about">About &amp; credits</a>
    <a href="${SOURCE}" target="_blank" rel="noopener">Source on GitHub</a>
    <a href="https://crawl.develz.org/" target="_blank" rel="noopener">Dungeon Crawl Stone Soup</a>
    <a href="https://pocketzot.app/about" target="_blank" rel="noopener">PocketZot</a>
    <a href="${SOURCE}/issues" target="_blank" rel="noopener">Report a bug</a>
  </div>
  Orbrun is an unofficial client for Dungeon Crawl Stone Soup on the public servers. Not affiliated with the DCSS team.
</footer>
<div class="prompts" aria-hidden="true">
  <span class="chip">${glyphHtml(dom, 'A', 'A')}Open</span>
  ${page.doc ? `<span class="chip">${glyphHtml(dom, 'LB', 'LB')}${glyphHtml(dom, 'RB', 'RB')}Sections</span>` : ''}
  <span class="chip">${glyphHtml(dom, 'B', 'B')}Back to the game</span>
</div>
<script>
${js}
</script>
</body>
</html>
`
}

/** when a document last changed, from git; nothing when the checkout is shallow and every file would read as today */
function lastmod(file: string): string | null {
  try {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    if (git('rev-parse', '--is-shallow-repository') !== 'false') return null
    return git('log', '-1', '--format=%cs', '--', file) || null
  } catch {
    return null
  }
}

export function sitemapXml(pages: Page[]): string {
  const entries = pages.map((p) => {
    const mod = p.doc ? lastmod(p.doc) : null
    return `  <url>\n    <loc>${url(p)}</loc>${mod ? `\n    <lastmod>${mod}</lastmod>` : ''}\n  </url>`
  })
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`
}

/** the proxies and the engine are plumbing, not pages; the app's own screens say `noindex` for themselves (worker/index.ts) */
export function robotsTxt(): string {
  return ['User-agent: *', 'Disallow: /gamedata-proxy/', 'Disallow: /morgue-proxy/', 'Disallow: /engine/', '', `Sitemap: ${SITE_URL}/sitemap.xml`, ''].join('\n')
}

/** each of the site's pages, drawn with a DOM of its own that is closed after */
function drawPages(pages: Page[], each: (page: Page, html: string) => void) {
  const window = new Window()
  try {
    for (const page of pages) each(page, sitePageHtml(page, window as unknown as Dom))
  } finally {
    void window.happyDOM.close()
  }
}

export function sitePages(): Plugin {
  return {
    name: 'orbrun-site-pages',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const at = new URL(req.url ?? '/', 'http://dev').pathname
        const page = pageAt(at)
        if (!page || page.path === '/' || at !== page.path || (req.method !== 'GET' && req.method !== 'HEAD')) return next()
        drawPages([page], (_, html) => {
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          res.end(html)
        })
      })
    },
    generateBundle() {
      drawPages(
        PAGES.filter((p) => p.path !== '/'),
        (page, html) => this.emitFile({ type: 'asset', fileName: page.path.slice(1) + '.html', source: html }),
      )
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemapXml(PAGES) })
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robotsTxt() })
    },
  }
}
