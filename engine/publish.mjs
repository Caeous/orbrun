// Publishes engine/dist to orbrun-engine (wrangler.jsonc), keeping what is
// live for any channel not built here: a deploy replaces every file, and CI
// builds one channel a run, so the other has to come along. It is staged
// from the live Worker into engine/.publish beside this build, and Wrangler
// uploads only files whose content it does not have, so what comes along is
// never uploaded again.
//
//   node engine/publish.mjs                # stage and deploy
//   node engine/publish.mjs --dry-run      # stage, and check without deploying
//
// ENGINE_LIVE is the live engine base (default: the Worker's own address).

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const ENGINE = import.meta.dirname
const DIST = join(ENGINE, 'dist')
const STAGE = join(ENGINE, '.publish')
const LIVE = (process.env.ENGINE_LIVE ?? 'https://orbrun-engine.angers.workers.dev/engine').replace(/\/$/, '')
const CHANNELS = ['stable', 'trunk']
const dryRun = process.argv.includes('--dry-run')

rmSync(STAGE, { recursive: true, force: true })

async function fetchTo(url, path, size) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = Buffer.from(await res.arrayBuffer())
      if (size !== undefined && body.length !== size) throw new Error(`${body.length} bytes, expected ${size}`)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, body)
      return
    } catch (e) {
      if (attempt === 3) throw new Error(`${url}: ${e.message}`)
    }
  }
}

for (const channel of CHANNELS) {
  const local = join(DIST, channel, 'engine.json')
  let pointer
  if (existsSync(local)) {
    pointer = JSON.parse(readFileSync(local, 'utf8'))
    for (const [file, size] of pointer.files) {
      if (statSync(join(DIST, file)).size !== size) throw new Error(`dist/${file} is not the size engine.json says`)
      mkdirSync(dirname(join(STAGE, file)), { recursive: true })
      copyFileSync(join(DIST, file), join(STAGE, file))
    }
    console.log(`publish: ${channel} ${pointer.version}, built here`)
  } else {
    const res = await fetch(`${LIVE}/${channel}/engine.json`, { cache: 'no-store' })
    if (res.status === 404) {
      console.log(`publish: ${channel} neither built here nor live, left out`)
      continue
    }
    if (!res.ok) throw new Error(`${channel}/engine.json: HTTP ${res.status}`)
    pointer = await res.json()
    // a few at a time: every file must come, or the deploy would drop them
    const queue = [...pointer.files]
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        for (let f; (f = queue.shift()); ) await fetchTo(`${LIVE}/${f[0]}`, join(STAGE, f[0]), f[1])
      }),
    )
    console.log(`publish: ${channel} ${pointer.version}, kept from live`)
  }
  mkdirSync(join(STAGE, channel), { recursive: true })
  writeFileSync(join(STAGE, channel, 'engine.json'), JSON.stringify(pointer) + '\n')
}

execFileSync(
  'npx',
  ['--yes', 'wrangler@4', 'deploy', '-c', join(ENGINE, 'wrangler.jsonc'), ...(dryRun ? ['--dry-run'] : [])],
  { stdio: 'inherit' },
)
