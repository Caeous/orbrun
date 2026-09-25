import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import type { Plugin, Rollup } from 'vite'
import { renderMarkdown } from './src/markdown'
import { HOME, PAGES, SITE_URL, type Page } from './src/site'

/**
 * The site's pages as HTML of their own (src/site.ts PAGES), so an address
 * a search engine or a link preview asks for says what is there before any
 * script runs: `/about/orbrun` has its own title, description, canonical
 * and card, and the document's words in `#page`, where the one app shell
 * would say "the home page" for every address. The home page is
 * index.html as written; the others are it with their own head and words,
 * so each still boots the whole app, which opens the screen the address
 * names (servers.ts parseRoute).
 *
 * Written as `about/orbrun.html`, which the Worker's static assets serve at
 * `/about/orbrun` (Cloudflare's html_handling), beside `sitemap.xml` and
 * `robots.txt`. A build step only: the dev server serves the shell
 * everywhere, as before.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** where the markdown reader points a link to another file of the repository (markdown.ts REPO_BLOB) */
const REPO_BLOB = 'https://github.com/Caeous/orbrun/blob/main/'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const url = (p: Page) => SITE_URL + (p.path === '/' ? '/' : p.path)

/** `re` in `html` replaced, or the build stops: a template that no longer has it would ship the home page's head */
function swap(html: string, re: RegExp, to: string, what: string): string {
  if (!re.test(html)) throw new Error(`site-pages: index.html has no ${what}`)
  return html.replace(re, () => to)
}

/** the DOM the app's reader draws with (dom.ts `h`): `document` and `Node`, lent from happy-dom for the one call */
type Dom = { document: Document; Node: typeof Node }

/** a document drawn by the app's own reader, its title the page's heading and links to the site's pages kept on the site */
function docHtml(file: string, dom: Dom): string {
  const g = globalThis as Partial<Dom>
  const before = { document: g.document, Node: g.Node }
  Object.assign(g, { document: dom.document, Node: dom.Node })
  const doc = dom.document
  try {
    const el = renderMarkdown(fs.readFileSync(path.join(ROOT, file), 'utf8'))
    // the reader starts at h2, under the screen's own head; on a page of its own the document's title is the h1
    for (const head of [...el.querySelectorAll('h2, h3, h4, h5, h6')]) {
      const up = doc.createElement(`h${Number(head.tagName[1]) - 1}`)
      up.append(...head.childNodes)
      head.replaceWith(up)
    }
    for (const a of el.querySelectorAll('a')) {
      const href = a.getAttribute('href') ?? ''
      const page = href.startsWith(REPO_BLOB) && PAGES.find((p) => p.doc === href.slice(REPO_BLOB.length))
      if (!page) continue
      a.setAttribute('href', page.path)
      a.removeAttribute('target')
      a.removeAttribute('rel')
    }
    return el.innerHTML
  } finally {
    Object.assign(g, before)
  }
}

/** the About page's own words: what the screen says (menu.ts showAbout), with its documents as links */
function aboutHtml(page: Page): string {
  const docs = PAGES.filter((p) => p.doc)
  return [
    `<h1>${esc(page.name)}</h1>`,
    '<p>Orbrun is an unofficial client for Dungeon Crawl Stone Soup on the public servers. Not affiliated with the DCSS team.</p>',
    '<ul>',
    ...docs.map((p) => `<li><a href="${p.path}">${esc(p.name)}</a>: ${esc(p.description)}</li>`),
    '</ul>',
    '<h2>Links out</h2>',
    '<ul>',
    '<li><a href="https://github.com/Caeous/orbrun">Source on GitHub</a></li>',
    '<li><a href="https://crawl.develz.org/">Dungeon Crawl Stone Soup</a></li>',
    '<li><a href="https://pocketzot.app/about">PocketZot</a></li>',
    '</ul>',
  ].join('\n')
}

/** Home › About & credits › the page: the trail a search result shows in place of the address */
function breadcrumbs(page: Page): string {
  const trail = [HOME, ...PAGES.filter((p) => p.path !== '/' && page.path.startsWith(p.path) && (page.path === p.path || page.path[p.path.length] === '/'))]
  return JSON.stringify(
    {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebPage', '@id': url(page), url: url(page), name: page.title, description: page.description, inLanguage: 'en', isPartOf: { '@id': `${SITE_URL}/#website` } },
        {
          '@type': 'BreadcrumbList',
          itemListElement: trail.map((p, i) => ({ '@type': 'ListItem', position: i + 1, name: p.name, item: url(p) })),
        },
      ],
    },
    null,
    2,
  )
}

/** index.html as the page at `page.path` */
export function pageHtml(template: string, page: Page, dom: Dom): string {
  const title = esc(page.title)
  const description = esc(page.description)
  let html = template
  html = swap(html, /<title>[^<]*<\/title>/, `<title>${title}</title>`, 'title')
  html = swap(html, /<meta\s+name="description"\s+content="[^"]*"/, `<meta name="description" content="${description}"`, 'description')
  html = swap(html, /<link rel="canonical" href="[^"]*"/, `<link rel="canonical" href="${url(page)}"`, 'canonical')
  html = swap(html, /<meta property="og:url" content="[^"]*"/, `<meta property="og:url" content="${url(page)}"`, 'og:url')
  html = swap(html, /<meta property="og:title" content="[^"]*"/, `<meta property="og:title" content="${title}"`, 'og:title')
  html = swap(html, /<meta\s+property="og:description"\s+content="[^"]*"/, `<meta property="og:description" content="${description}"`, 'og:description')
  html = swap(html, /<meta name="twitter:title" content="[^"]*"/, `<meta name="twitter:title" content="${title}"`, 'twitter:title')
  html = swap(html, /<meta\s+name="twitter:description"\s+content="[^"]*"/, `<meta name="twitter:description" content="${description}"`, 'twitter:description')
  html = swap(html, /(<script type="application\/ld\+json">)[\s\S]*?(<\/script>)/, `<script type="application/ld+json">\n${breadcrumbs(page)}\n    </script>`, 'structured data')
  const words = page.doc ? docHtml(page.doc, dom) : aboutHtml(page)
  html = swap(html, /<!--page-->[\s\S]*<!--\/page-->/, `<!--page-->\n${words}\n<!--/page-->`, 'page words')
  return html
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

export function sitePages(): Plugin {
  return {
    name: 'orbrun-site-pages',
    apply: 'build',
    enforce: 'post',
    generateBundle: {
      order: 'post',
      handler(_opts, bundle) {
        const index = bundle['index.html'] as Rollup.OutputAsset | undefined
        if (!index) return
        const template = String(index.source)
        const window = new Window()
        try {
          for (const page of PAGES) {
            if (page.path === '/') continue
            this.emitFile({ type: 'asset', fileName: page.path.slice(1) + '.html', source: pageHtml(template, page, window as unknown as Dom) })
          }
        } finally {
          void window.happyDOM.close()
        }
        this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemapXml(PAGES) })
        this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robotsTxt() })
      },
    },
  }
}
