// Cloudflare's build image exports NPM_CONFIG_INCLUDE=prod and NPM_CONFIG_OMIT=dev,
// which outrank this repo's .npmrc. Its own dependency step therefore installs 8
// packages and no vite, and a build command of `npm install --include=dev` reports
// "up to date" without repairing that tree (npm 10.9.2). Only a fresh `npm ci` does.
//
// The documented build command is `npm ci --include=dev && npm run build`; this hook
// is the fallback for when it isn't, so `npm run build` works on a pruned tree.
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

if (existsSync(new URL('../../node_modules/vite/package.json', import.meta.url))) process.exit(0)

console.log('[build] vite is missing — reinstalling with dev dependencies')
const { status } = spawnSync(
  'npm',
  ['ci', '--include=dev', '--no-audit', '--no-fund', '--progress=false'],
  { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, NPM_CONFIG_OMIT: '', NPM_CONFIG_INCLUDE: 'dev' } },
)
process.exit(status ?? 1)
