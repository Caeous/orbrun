import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'
import { MOVED, PAGES } from './src/site'

/**
 * The app's own files, kept on the device by the service worker
 * (public/sw.js), so Orbrun opens with no connection: the page, the bundle,
 * the fonts, the places the front screen stands in (their levels and
 * tiles), the two stills the menus stand in and the icons. Not the site's pages and the rest of their pictures, the social cards or the source maps; the engine is kept apart
 * (@orbrun/offline EngineStore).
 *
 * The build writes the list, with a version made from the files' contents,
 * into dist/sw.js in place of its `const SHELL = null`. So each deploy that
 * changes a file is a new sw.js, which the browser installs in the
 * background; the dev server serves sw.js as written, and keeps nothing.
 */

/** the built files the app needs to start, by their path in dist */
const KEPT = [
  /^index\.html$/,
  /^assets\/.+(?<!\.map)$/,
  /^fonts\/.+\.woff2$/,
  // the places the front screen stands in (room/places.ts): each one's level and tiles
  /^room\/places\/[\w-]+\.(json|png)$/,
  // the stills What's new and the account's screens stand in (menu.ts Backdrop), the site's own
  /^about\/(keys-bg|account-bg)\.webp$/,
  /^icons\/.+\.png$/,
  /^(favicon\.svg|orb\.png|manifest\.webmanifest)$/,
]

/**
 * What sw.js is given: the version, the addresses of the files it keeps, and
 * the addresses a page load must not be given the app for: the site's pages
 * and every other file of the build (robots.txt, a still).
 */
export interface Shell {
  version: string
  files: string[]
  network: string[]
}

/** The files of a build (paths in dist, `/`-separated) that the app needs, as the addresses they are served at. */
export function shellFiles(built: string[]): string[] {
  return built
    .filter((f) => KEPT.some((re) => re.test(f)))
    .map((f) => (f === 'index.html' ? '/' : '/' + f))
    .sort()
}

/** The addresses a page load goes to the network for: the site's own pages (and the ones that were), and the build's files the app does not keep. */
export function networkPaths(built: string[]): string[] {
  const pages = [...PAGES.filter((p) => p.path !== '/').map((p) => p.path), ...Object.keys(MOVED)]
  const files = built.filter((f) => !f.endsWith('.map') && !KEPT.some((re) => re.test(f))).map((f) => '/' + f)
  return [...new Set([...pages, ...files])].sort()
}

/** sw.js with the shell written in, in place of its `const SHELL = null`. */
export function withShell(sw: string, shell: Shell): string {
  const at = 'const SHELL = null'
  if (!sw.includes(at)) throw new Error(`sw.js: no \`${at}\` to write the app's files into`)
  return sw.replace(at, `const SHELL = ${JSON.stringify(shell)}`)
}

function walk(dir: string, under = ''): string[] {
  return fs.readdirSync(path.join(dir, under), { withFileTypes: true }).flatMap((e) => {
    const rel = under ? `${under}/${e.name}` : e.name
    return e.isDirectory() ? walk(dir, rel) : [rel]
  })
}

export function keepShell(): Plugin {
  return {
    name: 'orbrun-shell',
    apply: 'build',
    // public/ is copied in before the bundle is written, so by now dist holds everything that is served
    writeBundle(options) {
      const dir = options.dir!
      const built = walk(dir)
      const files = shellFiles(built)
      const hash = createHash('sha256')
      for (const f of files) {
        hash.update(f + '\0')
        hash.update(fs.readFileSync(path.join(dir, f === '/' ? 'index.html' : f.slice(1))))
      }
      const shell: Shell = { version: hash.digest('hex').slice(0, 16), files, network: networkPaths(built) }
      const sw = path.join(dir, 'sw.js')
      fs.writeFileSync(sw, withShell(fs.readFileSync(sw, 'utf8'), shell))
    },
  }
}
