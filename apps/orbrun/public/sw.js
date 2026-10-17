// Keeps Orbrun on this device: the app itself, so it opens with no
// connection, and the offline engine (@orbrun/offline EngineStore).
//
// The app's files are listed by the build (shell.ts), which writes them in
// below in place of `null`; under the dev server nothing of the app is kept.
// They are kept at install, all or none, in a cache named after their
// version, copied from an older version where they have not changed. A
// page load of any of the app's addresses, and its files kept under a fixed
// name, go to the network first, so a connected device always runs the
// version just deployed; what is kept answers only when the network
// cannot. The hashed bundles and the fonts never change under their names,
// and come from what is kept. A new deploy installs in the background
// meanwhile. The site's pages and the build's other files go to the
// network as they are.
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

// where a kept version records its files' sums (SHELL.sums), once it is whole
const SUMS = '/.orbrun-sums'

/** the hashed bundles and the fonts never change under their names */
const immutable = (path) => path.startsWith('/assets/') || path.startsWith('/fonts/')

/**
 * Keep this version of the app, unless it is kept already. A file an older
 * version kept with the same sum is copied from it, so a deploy downloads
 * only what changed, and is ready the sooner. addAll keeps every other file
 * or none, the page among them, so a kept page means a whole app.
 */
async function keepApp() {
  if (!appCache) return
  const cache = await caches.open(appCache)
  if (await cache.match('/')) return
  const older = (await caches.keys()).filter((k) => k.startsWith(APP) && k !== appCache).reverse()
  const sums = await Promise.all(older.map(async (k) => (await (await caches.open(k)).match(SUMS))?.json().catch(() => null)))
  const fetched = []
  for (const f of SHELL.files) {
    const from = f === '/' ? -1 : sums.findIndex((s) => s && s[f] === SHELL.sums[f])
    const hit = from >= 0 && (await (await caches.open(older[from])).match(f))
    if (hit) await cache.put(f, hit)
    else fetched.push(f)
  }
  // the rest is asked of the server again
  await cache.addAll(fetched.map((f) => new Request(f, { cache: immutable(f) ? 'default' : 'no-cache' })))
  await cache.put(SUMS, new Response(JSON.stringify(SHELL.sums)))
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

/** `req` as deployed now, unless there is no connection. */
async function deployed(req) {
  if (self.navigator?.onLine === false) return undefined
  const res = await fetch(req).catch(() => undefined)
  return res?.ok ? res : undefined
}

/**
 * One of the app's files: this version's, else an older version's, where an
 * older page's bundles are. Not caches.match alone: it looks in the oldest
 * cache first, which for a file kept under a fixed name (the manifest, the
 * icons, the places) is the last deploy's copy.
 */
async function appFile(url) {
  return (await (await caches.open(appCache)).match(url)) || caches.match(url)
}

/** Whether a page load of `url` is the app's: anything but the site's pages, in any case, and the build's other files, as the Worker has it. */
function isApp(url) {
  const page = '/' + url.pathname.split('/').filter(Boolean).join('/').toLowerCase()
  return !network.has(url.pathname) && !network.has(page)
}

// without a connection the app is not kept, and the engine still is
self.addEventListener('install', (e) => e.waitUntil(keepApp().catch(() => {}).then(() => self.skipWaiting())))
self.addEventListener('activate', (e) => e.waitUntil(Promise.all([self.clients.claim(), pruneApps()])))

// the page asks whether its bundle is this version's: one loaded from the network already is, and need not reload when this version takes over
self.addEventListener('message', (e) => {
  if (e.data?.type === 'keeps') e.ports[0]?.postMessage(appFiles.has(e.data.url))
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (appCache && req.mode === 'navigate' && url.origin === self.location.origin && isApp(url)) {
    const page = deployed(req).then(async (p) => p || (await keptPage()))
    e.respondWith(page.then((p) => p || fetch(req)))
    // an install that failed (no connection, a file that would not come) tries again with this load, even
    // while an older version's page stands in for it: otherwise that older page is what every load gets
    e.waitUntil(page.then(() => keepApp()).catch(() => {}))
    return
  }
  if (appFiles.has(url.origin + url.pathname) || (appCache && url.origin === self.location.origin && url.pathname.startsWith('/assets/'))) {
    const href = url.origin + url.pathname
    if (immutable(url.pathname)) e.respondWith(appFile(href).then((hit) => hit || fetch(req)))
    else e.respondWith(deployed(req).then(async (res) => res || (await appFile(href)) || fetch(req)))
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
