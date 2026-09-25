// Keeps the offline engine on this device (@orbrun/offline EngineStore).
//
// Answers requests for an engine build or its gamedata from the engine cache,
// and keeps what it had to fetch: a first game played online installs its
// build as it goes. Builds are served under their commit, so a file kept is
// never stale. Every other request goes to the network untouched.
//
// Registered as sw.js?base=<engine base>, the path the builds are served
// under (servers.ts ENGINE_BASE).

const CACHE = 'orbrun-engine' // EngineStore ENGINE_CACHE
const base = new URL(new URL(self.location.href).searchParams.get('base') || '/engine/', self.location.origin)
const kept = ['builds/', 'gamedata/'].map((p) => new URL(p, base).href)

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('fetch', (e) => {
  const url = e.request.url
  if (e.request.method !== 'GET' || !kept.some((p) => url.startsWith(p))) return
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(url)
      if (hit) return hit
      const res = await fetch(e.request)
      // whole files only: a range, an error or an opaque answer is passed on and not kept
      if (res.status === 200 && res.type !== 'opaque') e.waitUntil(cache.put(url, res.clone()).catch(() => {}))
      return res
    }),
  )
})
