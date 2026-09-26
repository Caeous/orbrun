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
 * link and has never played. No app in them: the words, stills of real
 * games, and a way to Play. The home page is the app, index.html as
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
export function docHtml(file: string, dom: Dom): { html: string; sections: { id: string; name: string }[] } {
  const doc = dom.document
  const el = withDom(dom, () => renderMarkdown(fs.readFileSync(path.join(ROOT, file), 'utf8'), { dropTitle: true }))
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
    // each section a part of its own, drawn as a card; a step's number and a release's date set apart from its name (the words stay as they read)
    for (const h2 of [...el.querySelectorAll('h2')]) {
      const part = doc.createElement('section')
      part.className = 'part'
      h2.before(part)
      part.append(h2)
      while (part.nextSibling && (part.nextSibling as Element).tagName !== 'H2') part.append(part.nextSibling)
      const text = h2.textContent ?? ''
      const step = /^(\d+)\.\s+(.*)$/.exec(text)
      const release = /^(.+?) — (.+)$/.exec(text)
      if (step) h2.innerHTML = `<span class="n">${esc(step[1])}<span class="sep">.</span></span> ${esc(step[2])}`
      else if (release) h2.innerHTML = `<span class="ver">${esc(release[1])}</span><span class="sep"> — </span><span class="when">${esc(release[2])}</span>`
    }
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
  // About's card is its hero, a still of a real game; the documents' is the room they stand in
  const card = page.path === '/about' ? { src: '/about/card.jpg', alt: HERO_ALT } : { src: '/room/poster.jpg', alt: POSTER_ALT }
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
<meta property="og:image" content="${SITE_URL}${card.src}" />
<meta property="og:image:type" content="image/jpeg" />
<meta property="og:image:width" content="1280" />
<meta property="og:image:height" content="720" />
<meta property="og:image:alt" content="${esc(card.alt)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${title}" />
<meta name="twitter:description" content="${description}" />
<meta name="twitter:image" content="${SITE_URL}${card.src}" />
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

/** About's hero, a still of Lair:3 */
const HERO_ALT = 'First person on Lair:3: a cane toad on the left and a catoblepas on the right, blood on the grass between them, a polearm held in the lower corner'

/** where the About page's stills are (public/about, taken in testbed/film.html from recorded games, the HUD left out; the Deck's screen is the one with it, deckHtml) */
const STILLS = '/about'

/** a still, lazily: none of them is needed for the first screen but the hero */
const still = (name: string, alt: string, w: number, h: number) =>
  `<img src="${STILLS}/${name}.webp" alt="${esc(alt)}" width="${w}" height="${h}" loading="lazy" decoding="async" />`

/**
 * A section's label, as the app's menu marks the row the cursor is on: the
 * gold wash and the @, over a line of small capitals. Every section of the
 * About page opens on one.
 */
const label = (id: string, name: string, sub: string) =>
  `<header class="label"><h2 id="${id}"><span aria-hidden="true">@</span>${esc(name)}</h2><p>${esc(sub)}</p></header>`

/** the pad's buttons and what each does, as the About page draws the pad (ABOUT.md "Gamepad" has the whole of it) */
const PAD_BOARD: { buttons: GlyphName[]; name: string; does: string }[] = [
  { buttons: ['A'], name: 'A', does: 'Does what the moment calls for: stairs, doors, attack, pick up, step' },
  { buttons: ['B'], name: 'B', does: 'Back out' },
  { buttons: ['X'], name: 'X', does: 'Wait a turn; hold to rest' },
  { buttons: ['Y'], name: 'Y', does: 'Your gear, pack first' },
  { buttons: ['LB'], name: 'LB', does: 'Actions' },
  { buttons: ['RB'], name: 'RB', does: 'Aim your quivered action, then fire' },
  { buttons: ['LT'], name: 'LT', does: 'Autoexplore' },
  { buttons: ['RT'], name: 'RT', does: 'Autofight' },
  { buttons: ['L3', 'R3'], name: 'L3 or R3', does: 'Examine' },
  { buttons: ['SELECT'], name: 'Select', does: 'Travel' },
  { buttons: ['START'], name: 'Start', does: 'Character and system' },
  { buttons: ['LSTICK', 'DPAD'], name: 'Left stick or d-pad', does: 'Step, turn and strafe; hold to run' },
]

/**
 * A Steam Deck, face on (`deck.webp`, Valve's picture, cut to the
 * device), and the game on its screen: a still at the panel's
 * own 1280 × 800, the HUD on (`deck-screen`), stood over the lit part of the
 * glass, which is where these pixels of the picture say it is.
 */
const DECK = { w: 1395, h: 571, panel: { x: 342, y: 65, w: 712, h: 446 } }

function deckHtml(): string {
  const { w, h, panel: p } = DECK
  const pct = (v: number, of: number) => `${+((v / of) * 100).toFixed(3)}%`
  return `<div class="deck">
    <img class="device" src="${STILLS}/deck.webp" alt="" width="${w}" height="${h}" loading="lazy" decoding="async" />
    <img class="screen" src="${STILLS}/deck-screen.webp" alt="${esc(DECK_ALT)}" width="1280" height="800" loading="lazy" decoding="async" style="left: ${pct(p.x, w)}; top: ${pct(p.y, h)}; width: ${pct(p.w, w)}; height: ${pct(p.h, h)}" />
  </div>`
}

const DECK_ALT = 'Orbrun on a Steam Deck: first person on Dungeon:1, a wounded hobgoblin within reach of a spear, the stats, map and message log around the view, and the pad’s prompts along the foot of the screen'

/** the questions a player of WebTiles asks first, answered as ABOUT.md answers them */
const FAQ: { q: string; a: string }[] = [
  {
    q: 'Does it change the game?',
    a: 'No. The server runs the game exactly as it does for WebTiles; Orbrun draws it and sends your keys. Every key but the direction keys goes to the server untouched.',
  },
  {
    q: 'Do my saves and rc file carry over?',
    a: 'Yes. They live on the server, with your macros, morgues and scoreboard entries. Orbrun reads your rc options from the server each time and never overrides them.',
  },
  {
    q: 'Can I switch back to WebTiles?',
    a: 'Any time. Save and exit from the Orbrun menu and continue in WebTiles: it is the same game on the same server.',
  },
  {
    q: 'Which versions does it play?',
    a: 'Whatever the server runs, stable or trunk. Orbrun reads each server’s own game data when it connects, so a new release works the day a server has it.',
  },
  {
    q: 'Do offline games count?',
    a: 'They are real games of the current release or trunk, run in your browser, but they never reach a scoreboard. Your saves stay on your device.',
  },
  {
    q: 'What does it cost?',
    a: 'Nothing. Orbrun is free and open source under the AGPL-3.0, and it is not affiliated with the DCSS team.',
  },
]

/** the FAQ as a search engine reads one */
const faqData = () =>
  JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  }).replace(/</g, '\\u003c')

/**
 * About: Orbrun shown rather than described, for a reader who has never
 * played. Each section opens on the same label and stands in a place of the
 * dungeon (a still from a real game, the HUD left out) or on the Deck.
 */
function aboutMain(dom: Dom): string {
  const g = (name: GlyphName, label: string) => glyphHtml(dom, name, label)
  return `<section class="hero stage">
  <picture>
    <source media="(max-width: 700px)" srcset="${STILLS}/hero-portrait.webp" />
    <img src="${STILLS}/hero-2560.webp" srcset="${STILLS}/hero-1280.webp 1280w, ${STILLS}/hero-2560.webp 2560w" sizes="100vw" alt="${esc(HERO_ALT)}" width="2560" height="1440" fetchpriority="high" />
  </picture>
  <div class="title">
    <h1><img src="/orb.png" alt="" width="32" height="32" />Orbrun</h1>
    <p class="tag">Dungeon Crawl Stone Soup · in first person</p>
    <p class="lede">Play on the public servers with the account, rc file and keys you already have. Built for a gamepad and the Steam Deck, with nothing to install.</p>
    <div class="actions">
      <a class="btn play" href="/">▶ Play in your browser</a>
      <a class="btn ghost" href="/about/steam">Add to Steam</a>
    </div>
    <span class="small-print">Free and open source · AGPL-3.0 · Unofficial</span>
  </div>
</section>

<section class="act">
  ${label('the-real-game', 'The real game', 'Same servers · same account · same rc file')}
  <figure class="compare" style="--x: 50%">
    <img src="${STILLS}/compare-3d.webp" alt="Orbrun: abominations and chaos spawn coming down a stone corridor, seen in first person" width="1600" height="900" loading="lazy" decoding="async" />
    <div class="flat"><img src="${STILLS}/compare-2d.webp" alt="WebTiles: the same moment from above, the player at the foot of the corridor with the crowd above, badges and all" width="1600" height="900" loading="lazy" decoding="async" /></div>
    <span class="tag-l">WebTiles</span><span class="tag-r">Orbrun</span>
    <input type="range" min="0" max="100" value="50" aria-label="Slide between WebTiles and Orbrun" />
    <figcaption>The same moment on Depths:1, drawn by WebTiles and by Orbrun. Drag to compare.</figcaption>
  </figure>
  <p class="say">Orbrun is a WebTiles client, not a port. Log in to CDI, CDO or any public server with the account you already have. Your saves, macros, morgues and scoreboard entries stay on the server, and a new release works the day a server runs it.</p>
</section>

<section class="act">
  ${label('every-branch', 'Every branch', 'Drawn from the server’s own tiles')}
  <div class="branches">
    <figure>${still('branch-dungeon', 'A centaur with a bow in a dark stone hall', 900, 1200)}<figcaption><b>D:14</b>The Dungeon</figcaption></figure>
    <figure>${still('branch-lair', 'A naga with a short sword on bloodied grass', 900, 1200)}<figcaption><b>Lair:3</b>The Lair of Beasts</figcaption></figure>
    <figure>${still('branch-depths', 'An iron troll and a deep troll in a stone corridor', 900, 1200)}<figcaption><b>Depths:1</b>The Depths</figcaption></figure>
    <figure>${still('branch-abyss', 'The Abyss: crystal walls on a blue floor under a violet sky', 900, 1200)}<figcaption><b>Abyss:3</b>The Abyss</figcaption></figure>
  </div>
  <p class="say">Every level is built around you from the tiles the server sends: the walls, the floor, the monsters and the items you would see from above. The map, the monster list, the stats and the message log are all still there. Anything the server does not publish is left undrawn, never guessed.</p>
</section>

<section class="act field lair">
  ${still('pad-bg', '', 1920, 1080).replace('alt=""', 'alt="" class="ground"')}
  ${label('made-for-a-controller', 'Made for a controller', 'Everything one button away')}
  <ul class="padboard">
    ${PAD_BOARD.map((b) => `<li data-pad="${b.buttons.join(' ')}"><span class="keys">${b.buttons.map((n) => g(n, n === 'LSTICK' ? 'Left stick' : n === 'DPAD' ? 'D-pad' : n)).join('')}</span><span class="does">${esc(b.does)}</span></li>`).join('\n    ')}
  </ul>
  <p class="say">A bar at the foot of the screen shows what each button does right now, and an on-screen keyboard covers prompts, inscriptions and chat. <span class="padnote">Your pad is connected: press a button to see it here.</span></p>
</section>

<section class="act deck-act">
  ${label('on-the-steam-deck', 'On the Steam Deck', 'Where it was built to be played')}
  <figure>
    ${deckHtml()}
    <figcaption>Dungeon:1 at the Deck’s own 1280 × 800, a hobgoblin in reach. The prompt beneath it says what the stick does now.</figcaption>
  </figure>
  <p class="say">The Deck came first: the whole game on its buttons, and nothing drawn while nothing on screen moves, to spare the battery. <a href="/about/steam">Add Orbrun to Steam</a> in five steps, artwork included, and it opens from your library like any other game.</p>
</section>

<section class="act field depths">
  ${still('keys-bg', '', 1920, 1080).replace('alt=""', 'alt="" class="ground"')}
  ${label('the-keyboard-you-know', 'The keyboard you know', 'With one change')}
  <div class="keycaps" aria-label="k steps forward, h and l turn, j steps back">
    <span class="cap"><kbd>k</kbd><small>forward</small></span>
    <span class="cap"><kbd>h</kbd><small>turn left</small></span>
    <span class="cap"><kbd>j</kbd><small>back</small></span>
    <span class="cap"><kbd>l</kbd><small>turn right</small></span>
  </div>
  <p class="say">Direction keys follow the way you face. Every other key goes to the server untouched, in the same modes, with the same results as on WebTiles.</p>
</section>

<section class="act">
  ${label('and-more', 'And more', 'Wherever you play')}
  <div class="pair">
    <figure>${still('grid-offline', 'A bullfrog between yellow rock walls in the Lair, a polearm in hand', 1200, 750)}<figcaption><h3>Offline</h3>The current release or trunk runs in your browser with no server at all, and your saves stay on your device.</figcaption></figure>
    <figure>${still('grid-spectate', 'A red one-eyed imp and another imp in a corridor, more monsters behind', 1200, 750)}<figcaption><h3>Spectate</h3>Watch any game on the server in first person, from a link you can share.</figcaption></figure>
  </div>
</section>

<section class="act">
  ${label('your-account', 'Your account stays yours', 'No Orbrun account · nothing stored')}
  <ul class="promises">
    <li>Your browser talks to the DCSS server you pick, over an encrypted WebSocket, as the official client does.</li>
    <li>Your password goes only in the login message and is never stored. A saved login keeps the server’s token, as WebTiles keeps a cookie.</li>
    <li>orbrun.app counts page views anonymously: no cookies, no fingerprinting, nothing about your game.</li>
  </ul>
</section>

<section class="act">
  ${label('questions', 'Questions', 'Asked by WebTiles players')}
  <div class="faq">
    ${FAQ.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('\n    ')}
  </div>
  <script type="application/ld+json">${faqData()}</script>
</section>

<section class="cta">
  <p>The dungeon is waiting.</p>
  <a class="btn play" href="/">▶ Play Orbrun</a>
</section>`
}

/**
 * How each document's page stands, as About's acts do: a still of a real
 * game under its name, tinted as the act that stands on it is, and a line
 * of small capitals.
 */
const DOC_LOOK: Record<string, { still: string; tint: string; sub: () => string }> = {
  '/about/new': { still: 'keys-bg', tint: 'depths', sub: () => latestRelease() },
  '/about/steam': { still: 'pad-bg', tint: 'lair', sub: () => 'Five steps · a few minutes · nothing to install' },
}

/** the changelog's newest release, as its heading names it: "Version 0.2.1 · 2026-09-25" */
function latestRelease(): string {
  const head = /^## (.+?) — (\d{4}-\d{2}-\d{2})/m.exec(fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8'))
  return head ? `Version ${head[1]} · ${head[2]}` : 'Newest first'
}

/** a document's page: its name over a still, as About's acts open, its sections as cards */
function docMain(page: Page, dom: Dom): string {
  const look = DOC_LOOK[page.path]
  if (!look) throw new Error(`site-pages: no look for ${page.path}`)
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
  return `<section class="hero band ${look.tint}">
  <img src="${STILLS}/${look.still}.webp" alt="" width="1920" height="1080" fetchpriority="high" />
  <div class="title">
    <header class="label"><h1><span aria-hidden="true">@</span>${esc(page.name)}</h1><p>${esc(look.sub())}</p></header>
    <p class="lede">${esc(page.description)}</p>
  </div>
</section>
${contents}
<article class="doc ${slug(page.doc!.replace(/\.md$/, ''))}">
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
${page.path === '/about' ? aboutMain(dom) : `${docMain(page, dom)}
<section class="cta">
  <p>The dungeon is waiting.</p>
  <a class="btn play" href="/">▶ Play Orbrun</a>
</section>`}
</main>
<footer>
  <div class="links">
    <a href="/about">About</a>
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
  ${page.path === '/about' ? `<span class="chip">${glyphHtml(dom, 'RSTICK', 'Right stick')}Scroll</span>` : ''}
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
