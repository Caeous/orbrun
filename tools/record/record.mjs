#!/usr/bin/env node
/**
 * Session recorder: connects to a WebTiles server, spectates the least idle
 * player and writes every server message to an NDJSON fixture.
 *
 *   node tools/record/record.mjs wss://crawl.dcss.io/socket 60 out.ndjson [username]
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
ws.onopen = () => console.log('open', url)
ws.onerror = (e) => console.log('error', e.message || '')
ws.onclose = (e) => {
  console.log('close', e.code, e.reason)
  f.end()
}
function handle(m) {
  f.write(JSON.stringify({ t: Date.now() - t0, m }) + '\n')
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
