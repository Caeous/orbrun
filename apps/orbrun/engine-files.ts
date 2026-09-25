import type { Plugin } from 'vite'
import { createReadStream, statSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'

/**
 * Serves the offline engine as built locally (engine/build.sh writes
 * engine/dist) at /engine/, for dev and preview. A missing file is a 404, not
 * the app's index.html, so a channel that was never built reads as absent
 * (@orbrun/offline `loadChannels`).
 */
const ROOT = join(import.meta.dirname, '../../engine/dist')
const PREFIX = '/engine/'

const TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.png': 'image/png',
}

export function engineFiles(): Plugin {
  const serve = (url: string | undefined, res: import('node:http').ServerResponse, next: () => void) => {
    const path = url?.split('?')[0]
    if (!path?.startsWith(PREFIX)) return next()
    const file = normalize(join(ROOT, decodeURIComponent(path.slice(PREFIX.length))))
    let size = -1
    try {
      if (file.startsWith(ROOT + sep)) {
        const st = statSync(file)
        if (st.isFile()) size = st.size
      }
    } catch {
      /* missing */
    }
    if (size < 0) {
      res.statusCode = 404
      res.end()
      return
    }
    res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream')
    res.setHeader('Content-Length', size)
    res.setHeader('Cache-Control', 'no-cache')
    createReadStream(file).pipe(res)
  }
  return {
    name: 'orbrun-engine-files',
    configureServer(server) {
      server.middlewares.use((req, res, next) => serve(req.url, res, next))
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => serve(req.url, res, next))
    },
  }
}
