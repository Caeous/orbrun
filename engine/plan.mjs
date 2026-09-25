// Which channel a CI run should build: the first whose live build is not
// upstream's newest commit made with today's recipe. Stable goes first: it
// moves a few times a year, so when it has moved it should not wait behind
// trunk, which moves every day. One channel a run, since a run has 20 minutes
// (Workers Builds); the second of the night's two runs takes the other.
// Prints the channel, or nothing when both are current.
//
//   node engine/plan.mjs <live engine base>
//
// ENGINE_CHANNEL=stable|trunk skips the check and names the channel.

import { execFileSync } from 'node:child_process'
import { recipe } from './recipe.mjs'

const base = (process.argv[2] ?? '').replace(/\/$/, '')
if (!base) {
  console.error('usage: node engine/plan.mjs <live engine base>')
  process.exit(1)
}
if (process.env.ENGINE_CHANNEL) {
  console.log(process.env.ENGINE_CHANNEL)
  process.exit(0)
}

// upstream's heads, as build.sh resolves them: master, and the newest stone_soup-*
const heads = execFileSync(
  'git',
  ['ls-remote', 'https://github.com/crawl/crawl.git', 'refs/heads/master', 'refs/heads/stone_soup-*'],
  { encoding: 'utf8' },
)
  .trim()
  .split('\n')
  .map((line) => line.split('\t'))
  .map(([commit, ref]) => ({ commit, branch: ref.replace('refs/heads/', '') }))
const byVersion = (a, b) => a.localeCompare(b, 'en', { numeric: true })
const stable = heads
  .filter((h) => h.branch.startsWith('stone_soup-'))
  .sort((a, b) => byVersion(a.branch, b.branch))
  .at(-1)
const want = { stable: stable?.commit, trunk: heads.find((h) => h.branch === 'master')?.commit }

const current = recipe()
for (const channel of ['stable', 'trunk']) {
  if (!want[channel]) throw new Error(`no upstream head for ${channel}`)
  const res = await fetch(`${base}/${channel}/engine.json`, { cache: 'no-store' })
  if (!res.ok && res.status !== 404) throw new Error(`${channel}/engine.json: HTTP ${res.status}`)
  const live = res.ok ? await res.json() : null
  const why = !live
    ? 'not published'
    : live.commit !== want[channel]
      ? `crawl ${live.commit.slice(0, 10)} -> ${want[channel].slice(0, 10)}`
      : live.recipe !== current
        ? `recipe ${live.recipe ?? 'none'} -> ${current}`
        : null
  if (why) {
    console.error(`plan: ${channel}: ${why}`)
    console.log(channel)
    process.exit(0)
  }
  console.error(`plan: ${channel}: current (${live.version})`)
}
