import { describe, expect, it } from 'vitest'
import { BACKOFF_MS, CONNECT_MS, PLAY_MS, Relink, STALE_MARGIN_MS, TRIES, playedElsewhere, type RelinkDeps } from '../src/relink'

/**
 * Getting a game back (relink.ts), against a fake clock and a fake socket.
 * The timings are CDI's (measured 2026-09-22): a clean close then `play` is
 * back in about 1.5 s; a socket left open by a sleep costs `stale_processes`
 * and its 10 s wait.
 */
function rig(opts: { hidden?: boolean; online?: boolean } = {}) {
  let now = 1_000_000
  const timers: { at: number; fn: () => void; id: number }[] = []
  let nextId = 1
  const calls: string[] = []
  const sock = { open: true, closed: false }
  const env = { hidden: opts.hidden ?? false, online: opts.online ?? true }
  const deps: RelinkDeps = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = nextId++
      timers.push({ at: now + ms, fn, id })
      return id
    },
    clearTimeout: (id) => {
      const i = timers.findIndex((t) => t.id === id)
      if (i >= 0) timers.splice(i, 1)
    },
    hidden: () => env.hidden,
    online: () => env.online,
    connect: () => {
      calls.push('connect')
      sock.closed = false
    },
    open: () => sock.open,
    closed: () => sock.closed,
    resume: () => calls.push('resume'),
    close: () => {
      calls.push('close')
      sock.open = false
      sock.closed = true
    },
    forceTerminate: (yes) => calls.push('force ' + yes),
    home: () => calls.push('home'),
  }
  const r = new Relink(deps)
  /** move the clock on, firing what falls due in order */
  const advance = (ms: number) => {
    const end = now + ms
    for (;;) {
      timers.sort((a, b) => a.at - b.at)
      const t = timers[0]
      if (!t || t.at > end) break
      timers.shift()
      now = t.at
      t.fn()
    }
    now = end
  }
  /** the socket went: what main.ts does on the session's `closed` */
  const drop = () => {
    sock.open = false
    sock.closed = true
    r.dropped()
  }
  /** the socket came up (the session logs in on its own) */
  const up = () => {
    sock.open = true
    sock.closed = false
  }
  return { r, calls, advance, drop, up, env, sock }
}

describe('getting a game back', () => {
  it('tries at once after a drop, and plays once logged in', () => {
    const { r, calls, drop, up } = rig()
    drop()
    expect(r.phase.kind).toBe('connecting')
    expect(calls).toEqual(['connect'])
    up()
    r.ready(false)
    expect(calls).toEqual(['connect', 'resume'])
    r.drawn()
    expect(r.phase.kind).toBe('live')
    expect(r.tries).toBe(0)
  })

  it('backs off between tries that fail, then gives up and asks', () => {
    const { r, calls, advance, drop } = rig()
    drop()
    for (let i = 1; i < TRIES; i++) {
      // the socket never opens: its close brings the next try, after the wait for this one
      drop()
      expect(r.phase).toMatchObject({ kind: 'waiting', offline: false })
      advance(BACKOFF_MS[Math.min(i - 1, BACKOFF_MS.length - 1)])
      expect(r.phase.kind).toBe('connecting')
    }
    drop()
    expect(r.phase.kind).toBe('failed')
    expect(calls.filter((c) => c === 'connect')).toHaveLength(TRIES)
    // A tries again from the start
    r.input('confirm')
    expect(r.phase.kind).toBe('connecting')
    expect(r.tries).toBe(1)
  })

  it('gives a socket that never opens its deadline, then closes it for the next try', () => {
    const { r, calls, advance, drop, sock } = rig()
    drop()
    // being made: neither open nor closed
    sock.closed = false
    advance(CONNECT_MS)
    expect(calls).toEqual(['connect', 'close'])
  })

  it('gives `play` its own deadline', () => {
    const { r, calls, advance, drop, up } = rig()
    drop()
    up()
    r.ready(false)
    advance(PLAY_MS - 1)
    expect(calls).toEqual(['connect', 'resume'])
    advance(1)
    expect(calls).toEqual(['connect', 'resume', 'close'])
  })

  it('makes no try from a hidden page, and tries the moment it shows', () => {
    const { r, calls, drop, env } = rig({ hidden: true })
    drop()
    expect(r.phase).toEqual({ kind: 'waiting', at: null, offline: false })
    expect(calls).toEqual([])
    env.hidden = false
    r.wake()
    expect(r.phase.kind).toBe('connecting')
    expect(calls).toEqual(['connect'])
  })

  it('waits for the network rather than spending tries without one', () => {
    const { r, calls, drop, env } = rig({ online: false })
    drop()
    expect(r.phase).toEqual({ kind: 'waiting', at: null, offline: true })
    expect(calls).toEqual([])
    env.online = true
    r.wake()
    expect(calls).toEqual(['connect'])
  })

  it('counts down the server’s stale-process wait, with room after it', () => {
    const { r, calls, advance, drop, up } = rig()
    drop()
    up()
    r.ready(false)
    r.stale(10)
    expect(r.phase.kind).toBe('stale')
    let redraws = 0
    r.on(() => redraws++)
    advance(3000)
    // the countdown moves each second
    expect(redraws).toBe(3)
    // the server polls the old game for a while after its wait: not given up on then
    advance(7000 + STALE_MARGIN_MS - 3001)
    expect(calls).toEqual(['connect', 'resume'])
    r.drawn()
    expect(r.phase.kind).toBe('live')
  })

  it('asks before killing a game that would not stop, and waits for the answer', () => {
    const { r, calls, advance, drop, up } = rig()
    drop()
    up()
    r.ready(false)
    r.stale(10)
    r.force()
    advance(10 * 60_000)
    expect(r.phase.kind).toBe('force')
    r.input('other')
    expect(r.phase.kind).toBe('force')
    r.input('confirm')
    expect(calls).toEqual(['connect', 'resume', 'force true'])
    expect(r.phase.kind).toBe('connecting')
  })

  it('leaves the old game be on a no, and the server takes it from there', () => {
    const { r, calls, drop, up } = rig()
    drop()
    up()
    r.ready(false)
    r.force()
    r.input('cancel')
    expect(calls).toEqual(['connect', 'resume', 'force false'])
  })

  it('takes over a game played elsewhere only on the player’s word', () => {
    const { r, calls, drop, up } = rig()
    drop()
    up()
    r.ready(true)
    expect(r.phase.kind).toBe('elsewhere')
    expect(calls).toEqual(['connect'])
    r.input('confirm')
    expect(calls).toEqual(['connect', 'resume'])
    expect(r.phase.kind).toBe('connecting')
  })

  it('goes home from a game played elsewhere on B', () => {
    const { r, calls, drop, up } = rig()
    drop()
    up()
    r.ready(true)
    r.input('cancel')
    expect(calls).toEqual(['connect', 'home'])
    expect(r.phase.kind).toBe('live')
  })

  it('closes a game left at rest, stays paused through the close, and comes back on a press', () => {
    const { r, calls, drop } = rig()
    r.pause()
    expect(calls).toEqual(['close'])
    drop()
    expect(r.phase.kind).toBe('paused')
    r.wake()
    expect(r.phase.kind).toBe('paused')
    r.input('other')
    expect(r.phase.kind).toBe('connecting')
    expect(calls).toEqual(['close', 'connect'])
  })

  it('keeps a socket that answered the check, and lets the close of one that did not bring the game back', () => {
    const { r, calls, drop } = rig()
    r.checking()
    expect(r.busy).toBe(true)
    expect(r.input('other')).toBe(true)
    r.checked(true)
    expect(r.phase.kind).toBe('live')
    r.checking()
    r.checked(false)
    drop()
    expect(r.phase.kind).toBe('connecting')
    expect(calls).toEqual(['connect'])
  })

  it('lets input through while live', () => {
    const { r } = rig()
    expect(r.input('confirm')).toBe(false)
  })

  it('ignores what the server says once the try is over', () => {
    const { r } = rig()
    r.stale(10)
    r.force()
    r.ready(true)
    expect(r.phase.kind).toBe('live')
  })
})

describe('a game played elsewhere', () => {
  const now = 10_000_000
  const entry = (idle: number) => [{ username: 'caeo', game_id: 'dcss-0.34', idle_time: idle }]

  it('is not the connection’s own game, held by a socket that slept', () => {
    // last heard ten minutes ago, idle ten minutes on the server: the same game, left as it was
    expect(playedElsewhere(entry(600), 'caeo', 'dcss-0.34', now - 600_000, now)).toBe(false)
  })

  it('is one played since this connection last heard its own', () => {
    // last heard ten minutes ago, but played two minutes ago
    expect(playedElsewhere(entry(120), 'caeo', 'dcss-0.34', now - 600_000, now)).toBe(true)
    // played within the last 30 s (idle 0), after a minute away
    expect(playedElsewhere(entry(0), 'caeo', 'dcss-0.34', now - 60_000, now)).toBe(true)
  })

  it('is not read into an idle of 0 after a short drop', () => {
    expect(playedElsewhere(entry(0), 'caeo', 'dcss-0.34', now - 10_000, now)).toBe(false)
  })

  it('is only this account in this game', () => {
    expect(playedElsewhere([{ username: 'caeo', game_id: 'seeded-0.34', idle_time: 0 }], 'caeo', 'dcss-0.34', 0, now)).toBe(false)
    expect(playedElsewhere([{ username: 'other', game_id: 'dcss-0.34', idle_time: 0 }], 'caeo', 'dcss-0.34', 0, now)).toBe(false)
    expect(playedElsewhere([], 'caeo', 'dcss-0.34', 0, now)).toBe(false)
  })
})
