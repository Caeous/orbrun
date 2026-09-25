import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { initialState, reduce, type GameState, type ServerMessage } from '@orbrun/webtiles'
import {
  LocalWasmConnection,
  channelOf,
  saveDesc,
  startEngine,
  type EngineFactory,
  type EngineInfo,
  type EngineLauncher,
  type RunningEngine,
} from '../src/index.js'

// The real engine, built by engine/build.sh; skipped where nothing is built (CI runs engine/smoke.mjs instead).
const DIST = join(import.meta.dirname, '../../../engine/dist')
const built = ['stable', 'trunk'].filter((c) => existsSync(join(DIST, c, 'engine.json')))

/** Runs an engine in this process, as the worker would. */
const inProcess: EngineLauncher = (channel, args, events) => {
  const dir = join(DIST, 'builds', channel.commit)
  let engine: RunningEngine | null = null
  const queued: (() => void)[] = []
  startEngine({
    source: {
      factory: async () => ((await import(pathToFileURL(join(dir, 'crawl.js')).href)) as { default: EngineFactory }).default,
      read: async (file) => {
        const b = readFileSync(join(dir, file))
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
      },
    },
    saveDir: channel.saveDir,
    args,
    onOutput: events.output,
    onExit: events.exit,
  }).then(
    (e) => {
      engine = e
      for (const f of queued.splice(0)) f()
    },
    (err: unknown) => events.error(String(err)),
  )
  const when = (f: (e: RunningEngine) => void) => (engine ? f(engine) : queued.push(() => f(engine!)))
  return {
    control: (json) => when((e) => e.control(json)),
    keys: (text) => when((e) => e.keys(text)),
    terminate: () => {},
  }
}

async function until(what: string, test: () => boolean, ms = 20000) {
  const start = Date.now()
  while (!test()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 20))
  }
}

describe.skipIf(!built.length).each(built)('offline %s engine through LocalWasmConnection', (name) => {
  it("logs in, starts a character named for the profile, plays it to the map, takes turns, and saves on the way back to the lobby", { timeout: 60000 }, async () => {
    const info = JSON.parse(readFileSync(join(DIST, name, 'engine.json'), 'utf8')) as EngineInfo
    const channel = channelOf(info)
    const notes: [string, string | null][] = []
    const conn = new LocalWasmConnection({
      channels: [channel],
      engineBase: () => '',
      gamedataBase: DIST,
      launch: inProcess,
      saves: { note: (dir, f) => notes.push([dir, saveDesc(f)]), info: async () => null },
    })
    let state: GameState = initialState()
    const seen: ServerMessage[] = []
    conn.onMessage((m) => {
      seen.push(m)
      state = reduce(state, m)
    })
    await new Promise<void>((r) => conn.onOpen(r))
    conn.send({ msg: 'token_login', cookie: 'x' })
    await until('the game links', () => state.lobby.games.length === 1)
    expect(state.lobby.username).toBe('Player')

    conn.send({ msg: 'play', game_id: channel.id })
    // character creation: the first choice on every menu it puts up
    let choices = 0
    await until('the map', () => {
      const asked = seen.filter((m) => m.msg === 'ui-push' && m.type === 'newgame-choice').length
      if (asked > choices) {
        choices = asked
        conn.send({ msg: 'input', text: 'a' })
      }
      return state.phase === 'playing' && state.map.cells.size > 0 && state.player.received
    })
    expect(seen.find((m) => m.msg === 'game_client')).toEqual({ msg: 'game_client', version: info.gamedata, content: '' })
    expect(existsSync(join(DIST, 'gamedata', info.gamedata, 'enums.js'))).toBe(true)
    expect(state.player.name).toBe('Player')
    // crawl's milestones name the character, for the game links' save info
    expect(notes.filter(([, d]) => d).at(-1)).toEqual([channel.saveDir, expect.stringMatching(/^Player, a level 1 \w/)])

    // `s` waits a turn, which a random start always allows (a step can be into a wall, which takes none)
    for (let turn = 0; turn < 4; turn++) {
      const rev = state.rev.player
      conn.send({ msg: 'input', text: 's' })
      await until(`turn ${turn + 1}`, () => state.rev.player > rev)
    }

    conn.send({ msg: 'go_lobby' })
    await until('the game to end', () => state.exit !== null)
    expect(state.exit).toEqual({ reason: 'saved' })
    expect(state.phase).toBe('ended') // go_lobby, then game_ended, as a server sends them
    conn.close()
  })
})
