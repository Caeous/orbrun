#!/usr/bin/env node
/**
 * Session recorder: connects to a WebTiles server, spectates the least idle
 * player and writes every server message to an NDJSON fixture.
 *
 *   node tools/record/record.mjs wss://crawl.dcss.io/socket 60 out.ndjson [username]
 *
 * The fixture names no one: every player the lobby lists is written as
 * `lobby01`, `lobby02`, … in the order they arrive (the one watched as
 * `watched`), wherever their name turns up, and the chat is left out.
 */
import fs from 'node:fs'

const url = process.argv[2] || 'wss://crawl.dcss.io/socket'
const secs = Number(process.argv[3] || 60)
const out = process.argv[4] || 'session.ndjson'
const who = process.argv[5]
const ws = new WebSocket(url, ['no-compression'])
ws.binaryType = 'arraybuffer'
const f = fs.createWriteStream(out)
const t0 = Date.now()
let watched = false
const entries = []
/** every player's name, and what the fixture calls them */
const names = new Map()
const alias = (name) => {
  if (!names.has(name)) names.set(name, `lobby${String(names.size + 1).padStart(2, '0')}`)
  return names.get(name)
}
/** a message with every name in it put as its alias, in any case (a scoring page's URL spells it lower) */
function scrub(m) {
  let s = JSON.stringify(m)
  // whole names only: a player called `Ru` is not every `ru` in a message
  for (const [name, as] of [...names].sort((a, b) => b[0].length - a[0].length)) s = s.replace(new RegExp(`(?<![A-Za-z0-9_])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`, 'gi'), as)
  return s
}
ws.onopen = () => console.log('open', url)
ws.onerror = (e) => console.log('error', e.message || '')
ws.onclose = (e) => {
  console.log('close', e.code, e.reason)
  f.end()
}
function handle(m) {
  if (m.msg === 'lobby_entry' && m.username) alias(m.username)
  if (m.msg !== 'chat') f.write(`{"t":${Date.now() - t0},"m":${scrub(m)}}\n`)
  if (m.msg === 'ping') ws.send(JSON.stringify({ msg: 'pong' }))
  if (m.msg === 'lobby_entry') entries.push(m)
  if (m.msg === 'lobby_complete' && !watched) {
    entries.sort((a, b) => (a.idle_time || 0) - (b.idle_time || 0))
    const e = who ? entries.find((x) => x.username === who) : entries[0]
    if (!e) {
      console.log('nobody to watch')
      ws.close()
      return
    }
    console.log('watching', e.username, e.game_id)
    names.set(e.username, 'watched')
    watched = true
    ws.send(JSON.stringify({ msg: 'watch', username: e.username }))
  }
  if (m.msg === 'game_client') console.log('gamedata version', m.version)
  if (m.msg === 'version') console.log(m.text)
}
ws.onmessage = (ev) => {
  const s = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data)
  let o
  try {
    o = JSON.parse(s)
  } catch {
    return
  }
  if (o.msgs) for (const m of o.msgs) handle(m)
  else handle(o)
}
setTimeout(() => ws.close(), secs * 1000)
