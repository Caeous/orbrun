// Keeps Orbrun on this device: the app itself, so it opens with no
// connection, and the offline engine (@orbrun/offline EngineStore).
//
// The app's files are listed by the build (shell.ts), which writes them in
// below in place of `null`; under the dev server nothing of the app is kept.
// They are kept at install, all or none, in a cache named after their
// version. A page load of any of the app's addresses is answered with the
// kept page at once, connection or not; a new deploy installs in the
// background and is what the next page load gets. The site's pages and the
// build's other files go to the network as they are.
//
// Answers requests for an engine build or its gamedata from the engine cache,
// and keeps what it had to fetch: a first game played online installs its
// build as it goes. Builds are served under their commit and recipe, so a file kept is
// never stale. Every other request goes to the network untouched.
//
// Registered as sw.js?base=<engine base>, the path the builds are served
// under (servers.ts ENGINE_BASE).

const SHELL = null

const CACHE = 'orbrun-engine' // EngineStore ENGINE_CACHE
const base = new URL(new URL(self.location.href).searchParams.get('base') || '/engine/', self.location.origin)
const kept = ['builds/', 'gamedata/'].map((p) => new URL(p, base).href)

const APP = 'orbrun-app-'
const appCache = SHELL && APP + SHELL.version
const appFiles = new Set(SHELL ? SHELL.files.map((f) => new URL(f, self.location.origin).href) : [])
const network = new Set(SHELL ? SHELL.network : [])

/** Keep this version of the app, unless it is kept already. addAll keeps every file or none, so a kept page means a whole app. */
async function keepApp() {
  if (!appCache) return
  const cache = await caches.open(appCache)
  if (await cache.match('/')) return
  // the hashed bundles and the fonts never change under their names; the rest is asked of the server again
  const fresh = (f) => !f.startsWith('/assets/') && !f.startsWith('/fonts/')
  await cache.addAll(SHELL.files.map((f) => new Request(f, { cache: fresh(f) ? 'no-cache' : 'default' })))
}

/**
 * Drop the app's older versions, but the newest of them: a page opened
 * before this deploy may still ask for a bundle of its own, and with no
 * connection this version may not be whole yet.
 */
async function pruneApps() {
  if (!appCache) return
  const older = (await caches.keys()).filter((k) => k.startsWith(APP) && k !== appCache)
  await Promise.all(older.slice(0, -1).map((k) => caches.delete(k)))
}

/** The kept page: this version's, else the last one kept. */
async function keptPage() {
  const own = await (await caches.open(appCache)).match('/')
  if (own) return own
  for (const k of (await caches.keys()).filter((k) => k.startsWith(APP)).reverse()) {
    const hit = await (await caches.open(k)).match('/')
    if (hit) return hit
  }
  return undefined
}

/** Whether a page load of `url` is the app's: anything but the site's pages, in any case, and the build's other files, as the Worker has it. */
function isApp(url) {
  const page = '/' + url.pathname.split('/').filter(Boolean).join('/').toLowerCase()
  return !network.has(url.pathname) && !network.has(page)
}

// without a connection the app is not kept, and the engine still is
self.addEventListener('install', (e) => e.waitUntil(keepApp().catch(() => {}).then(() => self.skipWaiting())))
self.addEventListener('activate', (e) => e.waitUntil(Promise.all([self.clients.claim(), pruneApps()])))

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (appCache && req.mode === 'navigate' && url.origin === self.location.origin && isApp(url)) {
    const page = keptPage()
    e.respondWith(page.then((p) => p || fetch(req)))
    // an install that had no connection tries again with this load
    e.waitUntil(page.then((p) => p || keepApp().catch(() => {})))
    return
  }
  if (appFiles.has(url.origin + url.pathname) || (appCache && url.origin === self.location.origin && url.pathname.startsWith('/assets/'))) {
    // an older page's bundles are found in its version's cache
    e.respondWith(caches.match(url.origin + url.pathname).then((hit) => hit || fetch(req)))
    return
  }
  if (!kept.some((p) => req.url.startsWith(p))) return
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req.url)
      if (hit) return hit
      const res = await fetch(req)
      // whole files only: a range, an error or an opaque answer is passed on and not kept
      if (res.status === 200 && res.type !== 'opaque') e.waitUntil(cache.put(req.url, res.clone()).catch(() => {}))
      return res
    }),
  )
})
