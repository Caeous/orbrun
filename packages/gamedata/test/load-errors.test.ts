import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadGamedata } from '../src/index'

const SHA = 'acd3d60e20f899c1c8a546953d6ffa0f6c7fe0c8'

const io = (text: string) => ({
  fetchText: async () => text,
  loadImage: async () => {
    throw new Error('no images in this test')
  },
})

describe('loadGamedata failures', () => {
  /**
   * A shell whose gamedata proxy is not serving `/gamedata-proxy/*` answers
   * with its own app shell: HTTP 200, body HTML. The loader used to eval that
   * and surface only `Unexpected token '<'`, which named neither the file nor
   * the cause; the player saw "Could not load game data: Unexpected token
   * '<'" and there was nothing to go on.
   */
  it('names the file and the cause when a gamedata URL answers with an HTML page', async () => {
    const err = await loadGamedata({
      base: '/gamedata-proxy/crawl.dcss.io',
      version: SHA,
      io: io('<!doctype html>\n<html lang="en"><head><title>Orbrun</title></head></html>'),
      skipImages: true,
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    const msg = (err as Error).message
    expect(msg).toContain(`/gamedata-proxy/crawl.dcss.io/gamedata/${SHA}/enums.js`)
    expect(msg).toContain('got an HTML page')
    expect(msg).not.toBe("Unexpected token '<'")
  })

  it('names the file when a gamedata module is JavaScript that will not evaluate', async () => {
    const err = await loadGamedata({
      base: 'https://crawl.dcss.io',
      version: SHA,
      io: io('define(function(){ throw new Error("boom") })'),
      skipImages: true,
    }).catch((e: unknown) => e)
    expect((err as Error).message).toContain(`https://crawl.dcss.io/gamedata/${SHA}/enums.js`)
    expect((err as Error).message).toContain('boom')
  })
})

describe('loadGamedata aborted', () => {
  /** the recorded scripts of one server version, as scene-webtiles' fixtures hold them */
  const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scene-webtiles', 'test', 'fixtures', 'gamedata', SHA)
  const scripts = (url: string) => readFileSync(join(fixtures, url.split('/').pop()!), 'utf8')

  it('stops at the next step after the signal fires, and closes the atlases already decoded', async () => {
    const ac = new AbortController()
    const closed: string[] = []
    let decoded = 0
    const err = await loadGamedata({
      base: 'https://x',
      version: SHA,
      signal: ac.signal,
      io: {
        fetchText: async (url) => scripts(url),
        loadImage: async (url) => {
          // the first atlas lands, then the load is abandoned; the rest land anyway
          if (++decoded === 2) ac.abort(new Error('superseded'))
          return { close: () => closed.push(url) } as unknown as ImageBitmap
        },
      },
    }).catch((e: unknown) => e)
    expect((err as Error).message).toBe('superseded')
    expect(closed).toHaveLength(7)
  })

  it('hands the signal to every fetch, so the requests in flight are cut short too', async () => {
    const ac = new AbortController()
    const signals: (AbortSignal | undefined)[] = []
    await loadGamedata({
      base: 'https://x',
      version: SHA,
      signal: ac.signal,
      skipImages: true,
      io: {
        fetchText: async (url, signal) => {
          signals.push(signal)
          return scripts(url)
        },
        loadImage: async () => {
          throw new Error('no images in this test')
        },
      },
    })
    expect(signals.length).toBeGreaterThan(1)
    expect(signals.every((s) => s === ac.signal)).toBe(true)
  })
})

describe('gamedataUrls', () => {
  it('lists what loadGamedata fetches, scripts before atlases, under the proxied version directory', async () => {
    const { gamedataUrls, ATLASES } = await import('../src/index')
    const urls = gamedataUrls('/gamedata-proxy/crawl.dcss.io/', SHA)
    const root = `/gamedata-proxy/crawl.dcss.io/gamedata/${SHA}/`
    expect(urls.every((u) => u.startsWith(root))).toBe(true)
    expect(urls[0]).toBe(root + 'enums.js')
    expect(urls.slice(-ATLASES.length)).toEqual(ATLASES.map((a) => `${root}${a}.png`))
    expect(urls).toContain(root + 'status-icon-sizes.js')
  })
})
