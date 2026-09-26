/**
 * The site as a search engine sees it: which addresses are pages worth
 * finding, what each is called, and which are the app's own state (a
 * login, a game, a spectate) and stay out of the index.
 *
 * Read by three sides that must agree: the build, which writes every page
 * but the home page (the app) as a web page of its own, and the sitemap
 * beside them (../site-pages.ts); the Worker, which answers an address that
 * is none of these with a 404 (../worker/index.ts); and the app, which names
 * its tab after the page it is on (servers.ts setRoute). Nothing here
 * touches the DOM.
 */

/** the official deployment: canonical addresses, the sitemap and the social cards name it */
export const SITE_URL = 'https://orbrun.app'

export interface Page {
  /** the address, as parseRoute reads it */
  path: string
  /** the tab and the search result's headline; the name and the rest are set apart by a hyphen, as a game's tab is (servers.ts gameTitle) */
  title: string
  /** the search result's snippet: under ~155 characters, so it is not cut */
  description: string
  /** the repository's document the page reads (menu.ts ABOUT_DOCS), from the repository root */
  doc?: string
  /** the heading it has on the About page and in a breadcrumb */
  name: string
  /** the document's sections listed at its head, to jump to (a changelog's releases are not worth it) */
  contents?: boolean
}

export const HOME: Page = {
  path: '/',
  name: 'Orbrun',
  title: 'Orbrun - Dungeon Crawl Stone Soup in first person',
  description:
    'Play Dungeon Crawl Stone Soup (DCSS) in first-person 3D with a gamepad, in your browser. Built for the Steam Deck, on your own WebTiles account.',
}

export const PAGES: Page[] = [
  HOME,
  {
    path: '/about',
    name: 'About',
    doc: 'ABOUT.md',
    title: 'About Orbrun - DCSS in first person',
    description:
      'Orbrun plays Dungeon Crawl Stone Soup in first person with a gamepad, on the public servers with your own account. See it, and what it does.',
  },
  {
    path: '/about/new',
    name: 'What’s new',
    doc: 'CHANGELOG.md',
    title: 'What’s new in Orbrun',
    description: 'Orbrun’s release notes, newest first: what changed in the first-person, gamepad-first client for Dungeon Crawl Stone Soup.',
  },
  {
    path: '/about/steam',
    name: 'Add to Steam',
    doc: 'STEAM.md',
    contents: true,
    title: 'Add Orbrun to Steam on the Steam Deck',
    description:
      'Five steps that put Orbrun, Dungeon Crawl Stone Soup in first person, in your Steam Deck’s library, with artwork and controller support.',
  },
]

/** the front end's screens that belong to no server; a settings group is its name in lower case (settings-rows.ts) */
export const MENU_PATH = /^(settings(\/[a-z]+)?|settings\/controls\/gamepad|accounts(\/add(\/server)?)?|watch(\/add)?)$/

/** the verbs of an address that names a server (`/watch/cdi/bob`); which servers there are is the device's business */
const SERVER_VERBS = new Set(['login', 'register', 'play', 'watch'])

function segments(pathname: string): string[] {
  return pathname.split('/').filter(Boolean)
}

/** addresses that were pages once, and the page each is now: a link from before still lands */
export const MOVED: Record<string, string> = {
  '/about/orbrun': '/about',
}

/** The page at an address, trailing slash or not; null for the app's own state and for nothing at all. */
export function pageAt(pathname: string): Page | null {
  const p = '/' + segments(pathname).join('/').toLowerCase()
  return PAGES.find((page) => page.path === p) ?? null
}

/**
 * What an address is: a page to be found (`page`), a screen of the app
 * that means nothing to a search engine (`app`: settings, a login, a game,
 * a spectate), or none of the app's addresses at all (`none`), which
 * parseRoute would read as the home screen.
 */
export function addressKind(pathname: string): 'page' | 'app' | 'none' {
  if (pageAt(pathname)) return 'page'
  const parts = segments(pathname)
  if (MENU_PATH.test(parts.join('/').toLowerCase())) return 'app'
  if (parts.length >= 2 && SERVER_VERBS.has(parts[0].toLowerCase())) return 'app'
  return 'none'
}

/** The tab's title at an address that is not a game: its page's, or the home screen's. */
export function titleAt(pathname: string): string {
  return (pageAt(pathname) ?? HOME).title
}
