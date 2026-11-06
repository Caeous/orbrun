/**
 * What the app's code asks of a browser that it needs in node, and no more:
 * there is no page. The game runs on the app's Session and its rules, which
 * take no DOM; the terminal draws everything itself.
 *
 *  - Gamedata is read from disk: `fetch` of a path (not a URL) reads the file,
 *    and `createImageBitmap` decodes a PNG to an `RgbaBitmap` that carries its
 *    pixels, which the view draws from.
 *  - localStorage (settings, the offline player, the saved view) is kept in a
 *    JSON file, so it lasts from one run to the next.
 *
 * Install this before anything of the app's runs.
 */
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

/** A decoded image with its pixels, standing in for an ImageBitmap. */
export interface RgbaBitmap {
  width: number
  height: number
  rgba: Uint8Array
  close(): void
}

export function isRgbaBitmap(x: unknown): x is RgbaBitmap {
  return !!x && typeof x === 'object' && (x as RgbaBitmap).rgba instanceof Uint8Array
}

export function installNode(stateDir: string) {
  const g = globalThis as Record<string, unknown>

  // localStorage lasts across runs: kept in memory, written a moment after each change
  const storeFile = path.join(stateDir, 'storage.json')
  let items: Record<string, string> = {}
  try {
    items = JSON.parse(fs.readFileSync(storeFile, 'utf8')) as Record<string, string>
  } catch {
    /* first run */
  }
  let storeTimer: NodeJS.Timeout | null = null
  const persist = () => {
    if (storeTimer) clearTimeout(storeTimer)
    storeTimer = null
    fs.mkdirSync(stateDir, { recursive: true })
    fs.writeFileSync(storeFile, JSON.stringify(items))
  }
  const later = () => {
    storeTimer ??= setTimeout(persist, 200)
  }
  const storage: Storage = {
    get length() {
      return Object.keys(items).length
    },
    key: (i) => Object.keys(items)[i] ?? null,
    getItem: (k) => (k in items ? items[k] : null),
    setItem: (k, v) => {
      items[k] = String(v)
      later()
    },
    removeItem: (k) => {
      delete items[k]
      later()
    },
    clear: () => {
      items = {}
      later()
    },
  }
  g.localStorage = storage

  // gamedata from disk
  const netFetch = globalThis.fetch.bind(globalThis)
  g.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.startsWith('/') && fs.existsSync(url.split('?')[0])) {
      const file = url.split('?')[0]
      const type = file.endsWith('.png') ? 'image/png' : file.endsWith('.json') ? 'application/json' : 'text/javascript'
      return new Response(fs.readFileSync(file), { headers: { 'content-type': type } })
    }
    return netFetch(input as string, init)
  }
  g.createImageBitmap = async (blob: Blob): Promise<RgbaBitmap> => {
    const { data, info } = await sharp(Buffer.from(await blob.arrayBuffer())).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    return { width: info.width, height: info.height, rgba: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), close() {} }
  }

  return { persist }
}
