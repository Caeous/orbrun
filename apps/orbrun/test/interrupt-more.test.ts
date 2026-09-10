import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { initialState, MouseMode, reduce, type GameMessage, type ServerMessage } from '@orbrun/webtiles'
import { linesSince, namedInWarnings } from '../src/warnings'

/**
 * A walk stopped while a --more-- is up: the server ends the interrupt's
 * batch in `input_mode 5`, so a rule that reads the warning only in command
 * mode never sees it (fixtures/explore-more.json, from a CDI session).
 */
describe('an encounter under a --more--', () => {
  const fx = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'explore-more.json'), 'utf8')) as { frames: { msgs: ServerMessage[] }[] }
  const st = initialState()
  let last: GameMessage | undefined
  const flush = () => {
    const lines = st.messages.lines
    const fresh = linesSince(lines, last, st.player.turn)
    last = lines[lines.length - 1]
    return namedInWarnings(fresh)
  }
  const play = (i: number) => {
    for (const m of fx.frames[i].msgs) reduce(st, m)
    return flush()
  }

  it('arrives in one batch that leaves the server in MORE mode, warning included', () => {
    // the slice starts mid-session: the first frame only primes the reader
    play(0)
    expect(st.inputMode).toBe(MouseMode.COMMAND)
    play(1)
    // player, msgs (more: true), map, input_mode 5
    expect(fx.frames[2].msgs.map((m) => m.msg + (m.mode ?? ''))).toEqual(['player', 'msgs', 'map', 'input_mode5'])
    expect(play(2)).toEqual(['Josephine the Decaying Necromancer', 'a wraith'])
    expect(st.inputMode).toBe(MouseMode.MORE)
    expect(st.messages.more).toBe(true)
  })

  it('names nobody once the prompt is dismissed, so the turn must be carried over', () => {
    // input_mode 0, input_mode 1, player, msgs "Josephine shouts!", map
    expect(play(3)).toEqual([])
    expect(st.inputMode).toBe(MouseMode.COMMAND)
    expect(play(4)).toEqual([])
  })
})
