import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { ConfigError, resolveConfig } from '../game/config'
import { pickChannel } from '../game/engine'
import type { OfflineChannel } from '@orbrun/offline'

/** a config directory of its own, with `toml` as its config.toml */
function home(toml?: string): NodeJS.ProcessEnv {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbrun-config-'))
  if (toml !== undefined) {
    fs.mkdirSync(path.join(dir, 'orbrun'))
    fs.writeFileSync(path.join(dir, 'orbrun', 'config.toml'), toml)
  }
  return { XDG_CONFIG_HOME: dir }
}

describe('config', () => {
  it('starts from the defaults where nothing is said', () => {
    const c = resolveConfig([], home())
    expect(c.dcss).toBeUndefined()
    expect(c.fps).toBe(60)
    expect(c.view).toEqual({ mosaic: 'octant', letters: false })
    expect(c.settings).toEqual({})
    expect(c.file).toBeUndefined()
  })

  it('reads the XDG config file, the game settings by either spelling', () => {
    const c = resolveConfig([], home('name = "Ada"\ndcss = "trunk"\nreduced_motion = true\n[view]\nthreads = 3\n[settings]\nfov = 90\neye_height = 0.7\nnearby = "list"\n'))
    expect(c).toMatchObject({ name: 'Ada', dcss: 'trunk', reducedMotion: true, view: { threads: 3 }, settings: { fov: 90, eyeHeight: 0.7, nearby: 'list' } })
  })

  it('weighs the command line over the environment over the file', () => {
    const env = { ...home('fps = 30\n[view]\nmosaic = "sextant"\nthreads = 2\n'), FPS: '60', ORBRUN_TERM_THREADS: '3' }
    expect(resolveConfig([], env)).toMatchObject({ fps: 60, view: { mosaic: 'sextant', threads: 3 } })
    expect(resolveConfig(['--fps', '90', '--mosaic', 'octant', '--letters', '--name', 'Bo', '--set', 'viewmodel=false'], env)).toMatchObject({ fps: 90, name: 'Bo', view: { mosaic: 'octant', letters: true }, settings: { viewmodel: false } })
  })

  it('says what is wrong rather than playing past it', () => {
    expect(() => resolveConfig(['--set', 'fov=wide'], home())).toThrow(/expected a number/)
    expect(() => resolveConfig(['--set', 'colour=red'], home())).toThrow(/no setting colour/)
    expect(() => resolveConfig(['--set', 'nearby=sometimes'], home())).toThrow(/one of list, pips/)
    expect(() => resolveConfig(['--bogus'], home())).toThrow(ConfigError)
    expect(() => resolveConfig(['--mosaic', 'quadrant'], home())).toThrow(/octant or sextant/)
    expect(() => resolveConfig([], home('[view]\nletters = "maybe"\n'))).toThrow(/view.letters: expected true or false/)
    expect(() => resolveConfig([], home('name = \n'))).toThrow(ConfigError)
  })
})

describe('the crawl to play', () => {
  const ch = (slot: string) => ({ id: `offline-${slot}` }) as OfflineChannel
  const built = [ch('0.33'), ch('0.34'), ch('trunk')]
  it('takes stable for the newest release, and trunk or a release by name', () => {
    expect(pickChannel(built, 'stable').id).toBe('offline-0.34')
    expect(pickChannel(built, 'trunk').id).toBe('offline-trunk')
    expect(pickChannel(built, '0.33').id).toBe('offline-0.33')
  })
  it('names those there are for one that is not built', () => {
    expect(() => pickChannel(built, '0.30')).toThrow(/there are: stable, 0.33, 0.34, trunk/)
    expect(() => pickChannel([], 'stable')).toThrow(/no crawl is built/)
  })
})
