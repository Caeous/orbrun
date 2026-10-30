/**
 * What the terminal client is told to do: its options from, least to most
 * weight, their defaults, the config file, the environment and the command
 * line. The config file is TOML, `$XDG_CONFIG_HOME/orbrun/config.toml`
 * (`~/.config/orbrun/config.toml`), or `--config <file>`:
 *
 *   name = "Ada"            # the player
 *   dcss = "stable"         # crawl to play straight away: stable, trunk, or a release (0.34); none for the menu
 *   fps = 60
 *   reduced_motion = false
 *
 *   [view]                  # how the view is drawn
 *   mosaic = "octant"       # its cells' glyphs: octant (2x4 dots), or sextant (2x3) for a font without octants
 *   letters = false         # monsters as crawl's letters rather than their sprites
 *   threads = 5
 *
 *   [settings]              # the game's own, as its Settings menu has them
 *   fov = 90
 *   eye_height = 0.6
 *   viewmodel = false
 *
 * The game's settings are written over what it has saved at the start, so
 * the file has the last word over the front screen's Settings.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse } from 'smol-toml'
import { defaultSettings, type Settings } from '../../../apps/orbrun/src/servers'

export interface TermConfig {
  /** the player, whose saves these are */
  name: string
  /** the name was said (the file or the command line), not taken from the login: the account last played as doesn't stand in for it */
  nameSaid?: boolean
  /** the crawl to play straight away: `stable`, `trunk`, or a release (`0.34`); none for the menu of those built */
  dcss?: string
  /** most frames a second */
  fps: number
  /** the player prefers reduced motion: turns and steps land at once, nothing glides */
  reducedMotion: boolean
  /** startup steps, messages and frame rates to `<state>/trace.log` */
  trace: boolean
  view: {
    /** the glyphs the view's cells are drawn in: octants (2x4 dots), or sextants (2x3), which more fonts have */
    mosaic: 'octant' | 'sextant'
    /** monsters drawn as crawl's letters rather than their sprites */
    letters: boolean
    /** threads that draw the view; undefined for the default (`defaultThreads`) */
    threads?: number
    /** how many times taller than wide a cell is, where the terminal says wrong */
    cellAspect?: number
  }
  /** the game's settings to start with */
  settings: Partial<Settings>
  /** where the config was read from, if anywhere */
  file?: string
}

/** The game's settings that take one of a few words, and which. */
const CHOICES: Partial<Record<keyof Settings, readonly string[]>> = {
  renderer: ['3d'],
  nearby: ['list', 'pips'],
  hints: ['adaptive', 'contextual', 'off'],
  leftRightKeys: ['turn', 'strafe'],
  leftRightPad: ['turn', 'strafe'],
  swipeTurn: ['step', 'drag'],
}

export const USAGE = `Play Orbrun in this terminal.

  npm run term -- [options]
  orbrun [options]

With no --dcss, it starts at the front screen, as the browser's: continue the game saved in
a version, or start a new one. The name is the character's, one to a version.

  --name NAME          the player whose saves these are, and the name to start with (default: your login name)
  --dcss VERSION       play NAME in VERSION straight away: stable, trunk, or a release such as 0.34
  --set KEY=VALUE      a game setting, as the Settings menu has it (repeat for more)
  --config FILE        read options from FILE (default: ~/.config/orbrun/config.toml)
  --fps N              most frames a second (60)
  --reduced-motion     turns and steps land at once, nothing glides
  --mosaic KIND        the view's glyphs: octant (default) or sextant, for a font without octants
  --letters            monsters as crawl's letters rather than their sprites
  --threads N          threads that draw the view (0 for none)
  --trace              write frame rates and messages to ~/.cache/orbrun/trace.log
  --settings           list the game's settings and their defaults
  --help

Ctrl-\\ saves and quits.`

/** The game's settings and their defaults, as `--settings` lists them. */
export function settingsList(): string {
  return (Object.keys(defaultSettings) as (keyof Settings)[])
    .map((k) => `  ${snake(k).padEnd(18)} ${String(defaultSettings[k]).padEnd(9)} ${CHOICES[k] ? CHOICES[k]!.join(' | ') : typeof defaultSettings[k]}`)
    .join('\n')
}

/** A problem with what the client was told, to be shown and not played past. */
export class ConfigError extends Error {}

/**
 * The client's options: the config file, then the environment
 * (ORBRUN_TERM_*, FPS), then `argv`, each over the one before.
 */
export function resolveConfig(argv: string[], env: NodeJS.ProcessEnv = process.env): TermConfig & { help?: 'usage' | 'settings' } {
  const c: TermConfig = {
    name: os.userInfo().username.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20) || 'Player',
    fps: 60,
    reducedMotion: false,
    trace: false,
    view: { mosaic: 'octant', letters: false },
    settings: {},
  }

  // the file: --config's, or the XDG one where there is one
  const named = valueOf(argv, '--config')
  const file = named ?? path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'orbrun', 'config.toml')
  if (named || fs.existsSync(file)) {
    let doc: Record<string, unknown>
    try {
      doc = parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
    } catch (e) {
      throw new ConfigError(`${file}: ${(e as Error).message}`)
    }
    c.file = file
    const where = (k: string) => `${file}: ${k}`
    for (const [k, v] of Object.entries(doc)) {
      if (k === 'view' || k === 'settings') continue
      setTop(c, k, v, where(k))
    }
    const view = table(doc.view, where('[view]'))
    for (const [k, v] of Object.entries(view)) setView(c, k, v, where(`view.${k}`))
    const settings = table(doc.settings, where('[settings]'))
    for (const [k, v] of Object.entries(settings)) setSetting(c, k, v, where(`settings.${k}`))
  }

  // the environment
  if (env.FPS) c.fps = number(env.FPS, 'FPS')
  if (env.ORBRUN_TERM_REDUCED_MOTION) c.reducedMotion = env.ORBRUN_TERM_REDUCED_MOTION !== '0'
  if (env.ORBRUN_TERM_TRACE) c.trace = env.ORBRUN_TERM_TRACE !== '0'
  if (env.ORBRUN_TERM_MOSAIC) c.view.mosaic = mosaic(env.ORBRUN_TERM_MOSAIC, 'ORBRUN_TERM_MOSAIC')
  if (env.ORBRUN_TERM_LETTERS) c.view.letters = env.ORBRUN_TERM_LETTERS !== '0'
  if (env.ORBRUN_TERM_THREADS) c.view.threads = number(env.ORBRUN_TERM_THREADS, 'ORBRUN_TERM_THREADS')
  if (env.ORBRUN_TERM_CELL_ASPECT) c.view.cellAspect = number(env.ORBRUN_TERM_CELL_ASPECT, 'ORBRUN_TERM_CELL_ASPECT')

  // the command line
  let help: 'usage' | 'settings' | undefined
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => {
      const v = argv[++i]
      if (v === undefined) throw new ConfigError(`${a} needs a value`)
      return v
    }
    if (a === '--help' || a === '-h') help = 'usage'
    else if (a === '--settings') help = 'settings'
    else if (a === '--config') next()
    else if (a === '--name') (c.name = next()), (c.nameSaid = true)
    else if (a === '--dcss') c.dcss = next()
    // as it was before --dcss
    else if (a === '--trunk') c.dcss = 'trunk'
    else if (a === '--set') {
      const kv = next()
      const eq = kv.indexOf('=')
      if (eq <= 0) throw new ConfigError(`--set ${kv}: expected KEY=VALUE`)
      setSetting(c, kv.slice(0, eq), kv.slice(eq + 1), `--set ${kv}`)
    } else if (a === '--fps') c.fps = number(next(), a)
    else if (a === '--reduced-motion') c.reducedMotion = true
    else if (a === '--mosaic') c.view.mosaic = mosaic(next(), a)
    else if (a === '--letters') c.view.letters = true
    else if (a === '--threads') c.view.threads = number(next(), a)
    else if (a === '--trace') c.trace = true
    else throw new ConfigError(`unknown option ${a} (--help lists them)`)
  }
  if (!/^[A-Za-z0-9_-]{1,20}$/.test(c.name)) throw new ConfigError(`name ${c.name}: letters, digits, _ and -, at most 20`)
  if (!(c.fps > 0)) throw new ConfigError(`fps ${c.fps}: must be more than 0`)
  if (c.view.threads !== undefined && !(c.view.threads >= 0)) throw new ConfigError('threads must be 0 or more')
  return { ...c, help }
}

function setTop(c: TermConfig, k: string, v: unknown, where: string) {
  if (k === 'name') (c.name = string(v, where)), (c.nameSaid = true)
  else if (k === 'dcss') c.dcss = string(v, where)
  else if (k === 'fps') c.fps = number(v, where)
  else if (k === 'reduced_motion' || k === 'reducedMotion') c.reducedMotion = boolean(v, where)
  else if (k === 'trace') c.trace = boolean(v, where)
  else throw new ConfigError(`${where}: not an option`)
}

function setView(c: TermConfig, k: string, v: unknown, where: string) {
  if (k === 'threads') c.view.threads = number(v, where)
  else if (k === 'mosaic') c.view.mosaic = mosaic(v, where)
  else if (k === 'letters') c.view.letters = boolean(v, where)
  else if (k === 'cell_aspect' || k === 'cellAspect') c.view.cellAspect = number(v, where)
  else throw new ConfigError(`${where}: not an option`)
}

/** A game setting by its name (camelCase, or snake_case as TOML has it), as its default's kind; from a string where given one. */
function setSetting(c: TermConfig, name: string, v: unknown, where: string) {
  const key = camel(name) as keyof Settings
  if (!(key in defaultSettings)) throw new ConfigError(`${where}: no setting ${name} (--settings lists them)`)
  const kind = typeof defaultSettings[key]
  let value: unknown
  if (kind === 'number') value = number(v, where)
  else if (kind === 'boolean') value = boolean(v, where)
  else {
    value = string(v, where)
    const ok = CHOICES[key]
    if (ok && !ok.includes(value as string)) throw new ConfigError(`${where}: ${name} is one of ${ok.join(', ')}`)
  }
  ;(c.settings as Record<string, unknown>)[key] = value
}

function table(v: unknown, where: string): Record<string, unknown> {
  if (v === undefined) return {}
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new ConfigError(`${where}: must be a table`)
  return v as Record<string, unknown>
}

function number(v: unknown, where: string): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new ConfigError(`${where}: expected a number`)
  return n
}

function boolean(v: unknown, where: string): boolean {
  if (typeof v === 'boolean') return v
  if (v === 'true' || v === 'on' || v === 'yes' || v === '1') return true
  if (v === 'false' || v === 'off' || v === 'no' || v === '0') return false
  throw new ConfigError(`${where}: expected true or false`)
}

function mosaic(v: unknown, where: string): 'octant' | 'sextant' {
  if (v === 'octant' || v === 'sextant') return v
  throw new ConfigError(`${where}: octant or sextant`)
}

function string(v: unknown, where: string): string {
  if (typeof v !== 'string') throw new ConfigError(`${where}: expected a string`)
  return v
}

function valueOf(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}

const camel = (s: string) => s.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase())
const snake = (s: string) => s.replace(/[A-Z]/g, (ch) => '_' + ch.toLowerCase())
