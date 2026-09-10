import { describe, expect, it } from 'vitest'
import { GAMEDATA_PROXY_PREFIX, MORGUE_PROXY_PREFIX, gamedataUpstream, morgueUpstream, serveGamedata, serveMorgue } from '../gamedata-proxy'

const SHA = 'acd3d60e20f899c1c8a546953d6ffa0f6c7fe0c8'
const OK = `${GAMEDATA_PROXY_PREFIX}crawl.dcss.io/gamedata/${SHA}/enums.js`

describe('gamedata proxy route', () => {
  it('maps a proxy path to the server’s own gamedata URL', () => {
    expect(gamedataUpstream(OK)).toBe(`https://crawl.dcss.io/gamedata/${SHA}/enums.js`)
  })

  it('takes the files the loader asks for, on a host with a port', () => {
    const files = ['enums.js', 'status-icon-sizes.js', 'tileinfo-main.js', 'tileinfo-icons.js', 'player.png', 'icons.png']
    for (const f of files) {
      const p = `${GAMEDATA_PROXY_PREFIX}webzook.net:8080/gamedata/${SHA}/${f}`
      expect(gamedataUpstream(p), f).toBe(`https://webzook.net:8080/gamedata/${SHA}/${f}`)
    }
  })

  it('refuses anything that is not a version’s gamedata file', () => {
    const bad = [
      '/',
      '/index.html',
      `${GAMEDATA_PROXY_PREFIX}crawl.dcss.io/gamedata/${SHA}/`,
      // not a hex version
      `${GAMEDATA_PROXY_PREFIX}crawl.dcss.io/gamedata/trunk/enums.js`,
      // not a file the loader asks for: the proxy is not a general one
      `${GAMEDATA_PROXY_PREFIX}crawl.dcss.io/gamedata/${SHA}/morgue.txt`,
      `${GAMEDATA_PROXY_PREFIX}example.com/gamedata/${SHA}/secrets.js`,
      // no escaping the gamedata directory, no userinfo in the host
      `${GAMEDATA_PROXY_PREFIX}crawl.dcss.io/gamedata/${SHA}/../../enums.js`,
      `${GAMEDATA_PROXY_PREFIX}crawl.dcss.io/socket`,
      `${GAMEDATA_PROXY_PREFIX}user@crawl.dcss.io/gamedata/${SHA}/enums.js`,
    ]
    for (const p of bad) expect(gamedataUpstream(p), p).toBeNull()
  })
})

describe('serveGamedata', () => {
  it('serves upstream JavaScript with CORS and an immutable cache', async () => {
    const res = await serveGamedata(OK, async () => new Response('define(function(){return {}})', { status: 200 }))
    expect(res?.status).toBe(200)
    expect(res?.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(res?.headers.get('Content-Type')).toContain('text/javascript')
    expect(res?.headers.get('Cache-Control')).toContain('immutable')
    expect(await res?.text()).toContain('define')
  })

  it('serves atlases as images', async () => {
    const png = `${GAMEDATA_PROXY_PREFIX}crawl.dcss.io/gamedata/${SHA}/main.png`
    const res = await serveGamedata(png, async () => new Response(new Uint8Array([137, 80, 78, 71]), { status: 200 }))
    expect(res?.headers.get('Content-Type')).toBe('image/png')
  })

  it('returns null for a path that is not the proxy’s, so the caller can serve the app', async () => {
    expect(await serveGamedata('/index.html', async () => new Response('<!doctype html>'))).toBeNull()
  })

  /**
   * The bug this proxy exists to prevent: when the app shell answers a
   * gamedata path with HTML, the loader evals HTML and throws
   * `Unexpected token '<'`. A failure must arrive as a status, never as a
   * 200 body.
   */
  it('passes an upstream failure through as a status, not as a body', async () => {
    const missing = await serveGamedata(OK, async () => new Response('<html>404</html>', { status: 404 }))
    expect(missing?.status).toBe(404)
    expect(missing?.headers.get('Content-Type')).toContain('text/plain')

    const down = await serveGamedata(OK, async () => {
      throw new Error('connect ECONNREFUSED')
    })
    expect(down?.status).toBe(502)
  })
})

describe('morgue proxy route', () => {
  it('maps a proxy path to the server’s own morgue file, wherever the server keeps it', () => {
    expect(morgueUpstream(`${MORGUE_PROXY_PREFIX}crawl.dcss.io/crawl/morgue/caeo/morgue-caeo-20260910-120000.txt`)).toBe('https://crawl.dcss.io/crawl/morgue/caeo/morgue-caeo-20260910-120000.txt')
    expect(morgueUpstream(`${MORGUE_PROXY_PREFIX}crawl.akrasiac.org/rawdata/caeo/caeo.txt`)).toBe('https://crawl.akrasiac.org/rawdata/caeo/caeo.txt')
    expect(morgueUpstream(`${MORGUE_PROXY_PREFIX}webzook.net:8080/morgue/caeo/crash-caeo-1.txt`)).toBe('https://webzook.net:8080/morgue/caeo/crash-caeo-1.txt')
  })

  it('refuses anything that is not a text file on a plain path', () => {
    const bad = [
      '/',
      `${MORGUE_PROXY_PREFIX}crawl.dcss.io/morgue/caeo/`,
      `${MORGUE_PROXY_PREFIX}crawl.dcss.io/morgue/caeo/morgue.html`,
      `${MORGUE_PROXY_PREFIX}crawl.dcss.io/morgue/caeo/../../secrets.txt`,
      `${MORGUE_PROXY_PREFIX}crawl.dcss.io/morgue/caeo/a.txt?x=1`,
      `${MORGUE_PROXY_PREFIX}user@crawl.dcss.io/morgue/caeo/a.txt`,
      `${MORGUE_PROXY_PREFIX}crawl.dcss.io/gamedata/abc/enums.js`,
      `${GAMEDATA_PROXY_PREFIX}crawl.dcss.io/morgue/caeo/a.txt`,
    ]
    for (const p of bad) expect(morgueUpstream(p), p).toBeNull()
  })

  it('serves the file as text with CORS and a short cache, and a failure as a status', async () => {
    const ok = `${MORGUE_PROXY_PREFIX}crawl.dcss.io/crawl/morgue/caeo/caeo.txt`
    const res = await serveMorgue(ok, async () => new Response('Dungeon Crawl Stone Soup version 0.34', { status: 200 }))
    expect(res?.status).toBe(200)
    expect(res?.headers.get('Content-Type')).toContain('text/plain')
    expect(res?.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(res?.headers.get('Cache-Control')).not.toContain('immutable')
    expect(await res?.text()).toContain('Dungeon Crawl')
    const missing = await serveMorgue(ok, async () => new Response('<html>404</html>', { status: 404 }))
    expect(missing?.status).toBe(404)
    expect(await serveMorgue('/index.html', async () => new Response(''))).toBeNull()
  })
})
