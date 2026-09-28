/**
 * A player on this device's rc file reaches crawl itself: the offline server
 * starts the engine with it (`-rc`), as a server starts crawl with the
 * account's. An rc that names the character skips crawl's species and
 * background menus, which only a file crawl has read can do.
 */
import { describe, expect, it } from 'vitest'
import { OfflineServer, type RcBook } from '@orbrun/offline'
import type { ServerMessage } from '@orbrun/webtiles'
import { builtChannels, channel, inProcessEngine } from './engine'

async function firstScreen(rc: string): Promise<ServerMessage[]> {
  const engine = inProcessEngine()
  const out: ServerMessage[] = []
  const rcs: RcBook = { read: () => rc, write: () => {} }
  const ch = channel(builtChannels[0])
  const server = new OfflineServer({ channels: [ch], launch: engine.launch, username: 'e2e', rcs, emit: (msgs) => out.push(...msgs) })
  server.receive({ msg: 'token_login', cookie: 'offline:e2e' })
  server.receive({ msg: 'play', game_id: ch.id })
  const until = Date.now() + 120_000
  // Play reaches the engine a tick or two after it is sent
  await new Promise((r) => setTimeout(r, 200))
  while (!engine.idle() && Date.now() < until) await new Promise((r) => setTimeout(r, 20))
  engine.kill()
  return out
}

describe.skipIf(!builtChannels.length)('the rc file on this device', () => {
  it('is the file crawl starts with', async () => {
    // the new-game menu crawl opens on: its title says how far the choices went
    const title = (msgs: ServerMessage[]) => String(msgs.find((m) => m.msg === 'ui-push' && m.type === 'newgame-choice')?.title ?? '')
    // no file: crawl asks for a species
    const bare = title(await firstScreen(''))
    expect(bare).toContain('Welcome, e2e')
    expect(bare).not.toContain('Minotaur')
    // a file that names the character: species and background are taken, and crawl asks only for the weapon
    expect(title(await firstScreen('species = Minotaur\nbackground = Berserker\n'))).toContain('Welcome, e2e the Minotaur Berserker.')
  })
})
