import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { networkPaths, shellFiles, withShell } from '../shell'
import { PAGES } from '../src/site'

const here = path.dirname(fileURLToPath(import.meta.url))
const sw = fs.readFileSync(path.join(here, '..', 'public', 'sw.js'), 'utf8')

/** a build's files, as dist has them */
const BUILT = [
  'index.html',
  'about.html',
  'about/new.html',
  'about/hero-1280.webp',
  'assets/index-AbC123.js',
  'assets/index-AbC123.js.map',
  'assets/index-DeF456.css',
  'assets/worker-GhI789.js',
  'fonts/dejavu-sans-mono-400.woff2',
  'fonts/DEJAVU-LICENSE.txt',
  'room/atlas.json',
  'room/atlas.png',
  'room/poster.jpg',
  'room/card.jpg',
  'room/README.md',
  'icons/icon-192.png',
  'steam/grid.png',
  'favicon.svg',
  'orb.png',
  'manifest.webmanifest',
  'robots.txt',
  'sitemap.xml',
  'sw.js',
]

/** Orbrun opens with no connection: the service worker keeps what the app needs to start, and nothing else. */
describe('the app kept on the device', () => {
  it('keeps the page, the bundles, the fonts, the front room and the icons', () => {
    expect(shellFiles(BUILT)).toEqual([
      '/',
      '/assets/index-AbC123.js',
      '/assets/index-DeF456.css',
      '/assets/worker-GhI789.js',
      '/favicon.svg',
      '/fonts/dejavu-sans-mono-400.woff2',
      '/icons/icon-192.png',
      '/manifest.webmanifest',
      '/orb.png',
      '/room/atlas.json',
      '/room/atlas.png',
      '/room/poster.jpg',
    ])
  })

  it('sends a page load of the site’s pages and the build’s other files to the network, not to the app', () => {
    const network = networkPaths(BUILT)
    for (const p of PAGES.filter((p) => p.path !== '/')) expect(network).toContain(p.path)
    expect(network).toContain('/about/orbrun')
    expect(network).toContain('/robots.txt')
    expect(network).toContain('/about/hero-1280.webp')
    expect(network).not.toContain('/')
    expect(network).not.toContain('/assets/index-AbC123.js.map')
    for (const f of shellFiles(BUILT)) expect(network).not.toContain(f)
  })

  it('writes the list into sw.js, which keeps nothing of the app as written', () => {
    expect(sw).toContain('const SHELL = null')
    const out = withShell(sw, { version: 'v1', files: ['/'], network: ['/about'] })
    expect(out).toContain('const SHELL = {"version":"v1","files":["/"],"network":["/about"]}')
    expect(() => withShell('self.addEventListener()', { version: 'v1', files: [], network: [] })).toThrow()
  })
})
