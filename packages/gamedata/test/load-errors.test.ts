import { describe, expect, it } from 'vitest'
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
