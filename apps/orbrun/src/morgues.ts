import { profileMorgues, readSaveFile } from '@orbrun/offline'
import { getMorgueDir, setMorgueDir, type ServerInfo } from './servers'
import { morgueDirGuesses, whereisVersion } from './whereis'

/**
 * An account's morgues: the file crawl writes as each game ends (end.cc,
 * `morgue-<name>-<date>-<time>.txt`), read back as a list of games.
 *
 * A server publishes them in the account's morgue directory, beside its
 * `.where` (whereis.ts), as a directory listing the morgue proxy turns into a
 * list of names (gamedata-proxy.ts). Each row comes from the head of its file
 * alone, the first two kilobytes: the score line crawl prints there
 * (hiscores.cc `hiscore_line`, verbose) says who, how it ended and where. A
 * morgue never changes, so what a head says is kept on this device.
 *
 * A game on this device leaves its morgue in its save directory's database
 * instead (@orbrun/offline profileMorgues), whole and to hand.
 */

/** One finished game, as its morgue's head tells it. */
export interface MorgueSummary {
  /** `morgue-orbrun-20260915-155745.txt` */
  file: string
  /** when the game ended, as the file is named: `20260915-155745` */
  stamp: string
  score: number | null
  xl: number | null
  /** `VSEn`, as the lobby's Char column says it */
  char: string
  /** `Vine Stalker Enchanter`, as the morgue says it began */
  began: string
  title: string
  /** `Trog`, or '' for none */
  god: string
  /** `Slain by a gnoll`: how it ended, without the damage */
  end: string
  /** `D:4`, as the lobby's Place column says it; '' for a game that left the dungeon */
  place: string
  turns: number | null
  /** the row it belongs to, as the home screen's game rows are named: `0.34`, `trunk` */
  version: string | null
  /** a wizard-mode or explore-mode game, which scores nothing */
  wiz: boolean
}

/** how much of a morgue its head is: the score line and the overview's title, with room for a long death */
const HEAD_BYTES = 2048

/** a morgue's name: crawl's `morgue-<name>-<date>-<time>.txt` */
const MORGUE_FILE = /^morgue-.+-(\d{8}-\d{6})\.txt$/

/** When the game a morgue's name stands for ended, `20260915-155745`; null for a name that is not a morgue's. */
export function morgueStamp(file: string): string | null {
  return MORGUE_FILE.exec(file)?.[1] ?? null
}

/**
 * Species as the lobby abbreviates them (dat/species/*.yaml `short_name`):
 * the ones with a name of their own, and the old ones a morgue may still
 * name. Every other species is its first two letters.
 */
const SPECIES_ABBR: Record<string, string> = {
  'Deep Elf': 'DE',
  'High Elf': 'HE',
  'Sludge Elf': 'SE',
  'Hill Orc': 'HO',
  'Lava Orc': 'LO',
  'Deep Dwarf': 'DD',
  'Mountain Dwarf': 'MD',
  'Vine Stalker': 'VS',
  'Gale Centaur': 'GC',
  Coglin: 'Co',
  Demigod: 'Dg',
  Demonspawn: 'Ds',
  Armataur: 'At',
  Mayflytaur: 'My',
  Meteoran: 'Me',
  Vampire: 'Vp',
  Djinni: 'Dj',
  Gargoyle: 'Gr',
  Merfolk: 'Mf',
  Octopode: 'Op',
  Poltergeist: 'Po',
  Revenant: 'Re',
  Draconian: 'Dr',
}

/** the colours a Draconian can be: every one is `Dr` */
const DRACONIANS = ['Red', 'White', 'Green', 'Yellow', 'Grey', 'Black', 'Purple', 'Mottled', 'Pale']

/** Backgrounds as the lobby abbreviates them (dat/jobs/*.yaml `short_name`, and the old ones); every other is its first two letters. */
const JOB_ABBR: Record<string, string> = {
  'Air Elementalist': 'AE',
  'Earth Elementalist': 'EE',
  'Fire Elementalist': 'FE',
  'Ice Elementalist': 'IE',
  'Chaos Knight': 'CK',
  'Cinder Acolyte': 'CA',
  'Hedge Wizard': 'HW',
  'Abyssal Knight': 'AK',
  'Death Knight': 'DK',
  'Arcane Marksman': 'AM',
  'Venom Mage': 'VM',
  Conjurer: 'Cj',
  Forgewright: 'Fw',
  Hexslinger: 'Hs',
  Wanderer: 'Wn',
  Warper: 'Wr',
  Wizard: 'Wz',
  Transmuter: 'Tm',
}

/** every species a morgue may begin with, longest first, so `Deep Elf` is not read as `Deep` */
const SPECIES = [...Object.keys(SPECIES_ABBR), ...DRACONIANS.map((c) => c + ' Draconian'), 'Barachi', 'Centaur', 'Felid', 'Formicid', 'Ghoul', 'Gnoll', 'Halfling', 'Human', 'Kenku', 'Kobold', 'Minotaur', 'Mummy', 'Naga', 'Ogre', 'Oni', 'Spriggan', 'Tengu', 'Troll'].sort((a, b) => b.length - a.length)

/**
 * The lobby's Char for a species and background as a morgue words them
 * (`Vine Stalker Enchanter`): `VSEn`. The species is the longest name it
 * starts with; one it does not know is its first word.
 */
export function charOf(began: string): string {
  const species = SPECIES.find((s) => began === s || began.startsWith(s + ' ')) ?? began.split(' ')[0]
  const job = began.slice(species.length).trim()
  const sp = species.endsWith(' Draconian') ? 'Dr' : (SPECIES_ABBR[species] ?? species.slice(0, 2))
  return sp + (job ? (JOB_ABBR[job] ?? job.slice(0, 2)) : '')
}

/** Branches by the name a morgue gives them (branch-data.h's long names), as the lobby's Place says them. */
const BRANCH_ABBR: Record<string, string> = {
  'the Dungeon': 'D',
  'the Ecumenical Temple': 'Temple',
  'the Orcish Mines': 'Orc',
  'the Elven Halls': 'Elf',
  'the Dwarven Hall': 'Dwarf',
  'the Lair of Beasts': 'Lair',
  'the Swamp': 'Swamp',
  'the Shoals': 'Shoals',
  'the Snake Pit': 'Snake',
  'the Spider Nest': 'Spider',
  'the Pits of Slime': 'Slime',
  'the Vaults': 'Vaults',
  'the Hall of Blades': 'Blade',
  'the Crypt': 'Crypt',
  'the Tomb of the Ancients': 'Tomb',
  'the Depths': 'Depths',
  'the Vestibule of Hell': 'Hell',
  'the Iron City of Dis': 'Dis',
  Gehenna: 'Geh',
  Cocytus: 'Coc',
  Tartarus: 'Tar',
  'the Realm of Zot': 'Zot',
  'the Enchanted Forest': 'Forest',
  'the Abyss': 'Abyss',
  Pandemonium: 'Pan',
  'a ziggurat': 'Zig',
  'a Labyrinth': 'Lab',
  'a bazaar': 'Bazaar',
  'a treasure trove': 'Trove',
  'a sewer': 'Sewer',
  'an ossuary': 'Ossuary',
  'a bailey': 'Bailey',
  'a Gauntlet': 'Gauntlet',
  'an ice cave': 'IceCv',
  'a volcano': 'Volcano',
  "a wizard's laboratory": 'WizLab',
  'the Desolation of Salt': 'Desolation',
  'the Arena': 'Arena',
  'the Crucible of Flesh': 'Crucible',
  'the Necropolis': 'Necropolis',
  'a gutter gulch': 'Gulch',
}

/**
 * Where a game ended, as the lobby says it (`D:4`, `Temple`), from the way a
 * morgue says it (place.cc `prep_branch_level_name`): `on level 4 of the
 * Dungeon`, `in the Ecumenical Temple`. Null when it is not a place.
 */
export function placeOf(words: string): string | null {
  const m = /^(?:on level (\d+) of|in) (.+)$/.exec(words)
  if (!m) return null
  const [, depth, name] = m
  const branch = BRANCH_ABBR[name] ?? BRANCH_ABBR['the ' + name] ?? name.replace(/^(?:the|an?) /, '')
  return depth ? `${branch}:${depth}` : branch
}

/** the score line: `545 orbrun the Covert (level 7, 0/33 HPs)`, then `*WIZ*` or `*EXPLORE*` for a game that scores nothing */
const SCORE_LINE = /^(\d+) (\S+)(?: (.+?))? \(level (\d+), -?\d+\/\d+(?: \(\d+\))? HPs\)( \*(?:WIZ|EXPLORE)\*)?$/
/** where the place stands in a line: at its end, after the death's own words or `...`, a vault's description and a date after it */
const PLACE_AT = /(?:^|\.\.\. | )((?:on level \d+ of|in) .+?)(?: \([^)]*\))?(?: on [A-Z][a-z]+ \d+, \d{4})?\.$/

/** What a morgue's head says of its game. A file that is not a morgue (an error page) says nothing but its name. */
export function parseMorgue(file: string, text: string): MorgueSummary {
  const out: MorgueSummary = { file, stamp: morgueStamp(file) ?? '', score: null, xl: null, char: '', began: '', title: '', god: '', end: '', place: '', turns: null, version: null, wiz: false }
  const lines = text.split('\n').map((l) => l.trim())
  const v = /version (\S+)/.exec(lines[0] ?? '')
  if (v) out.version = whereisVersion(v[1])
  const at = lines.findIndex((l) => SCORE_LINE.test(l))
  if (at < 0) return out
  const s = SCORE_LINE.exec(lines[at])!
  out.score = Number(s[1])
  out.title = s[3] ?? ''
  out.xl = Number(s[4])
  out.wiz = !!s[5]
  // the death's lines, up to the game's length or the blank line the score ends at
  const rest: string[] = []
  for (const l of lines.slice(at + 1)) {
    if (!l || l.startsWith('The game lasted')) {
      const t = /\((\d+) turns\)/.exec(l)
      if (t) out.turns = Number(t[1])
      break
    }
    const began = /^Began as an? (.+?) on [A-Z][a-z]+ \d+, \d{4}\.$/.exec(l)
    if (began) {
      out.began = began[1]
      out.char = charOf(began[1])
      continue
    }
    const god = /^Was (?:an? |the )?.*? of (.+?)(?: \(penitent\))?\.$/.exec(l)
    if (god && !rest.length) {
      out.god = god[1]
      continue
    }
    if (/^Was an? (?:Favourite )?Plaything of Xom\.$/.test(l) && !rest.length) {
      out.god = 'Xom'
      continue
    }
    rest.push(l)
  }
  // the place: the last line that ends with one, which for a quit is the death's own line ("Quit the game on level 1 of
  // the Dungeon on Sept 14, 2026.")
  for (let i = rest.length - 1; i >= 0; i--) {
    const p = PLACE_AT.exec(rest[i])
    const place = p ? placeOf(p[1]) : null
    if (!place) continue
    out.place = place
    if (i === 0) rest[0] = rest[0].slice(0, p!.index).trim()
    break
  }
  const end = rest[0] ?? ''
  out.end = end.replace(/ \(\d+ damage\)$/, '').replace(/\.$/, '')
  return out
}

/** Sep 15 (this year), Sep 15, 2025 (another) */
export function morgueDate(stamp: string, now = new Date()): string {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(stamp)
  if (!m) return ''
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1] ?? ''
  const day = `${month} ${Number(m[3])}`
  return Number(m[1]) === now.getFullYear() ? day : `${day}, ${m[1]}`
}

// ------------------------------------------------------------------ on a server

/** The same-origin address of a file in a server's morgue directory, or of the directory itself (a path ending `/`). */
export function morgueProxyUrl(server: ServerInfo, path: string): string | null {
  let u: URL
  try {
    u = new URL(path, server.http)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  return `/morgue-proxy/${u.host}${u.pathname}`
}

/** An account's morgue directory on a server, and the morgues in it, newest first. */
export interface ServerMorgues {
  dir: string
  files: string[]
}

/**
 * The morgues in an account's morgue directory: the one a `game_ended` or a
 * `.where` named (servers.ts getMorgueDir), else each of the layouts
 * dgamelaunch-config ships with until one lists (and is remembered). Null
 * when none does: a server that keeps its morgues elsewhere, or lists none.
 */
export async function serverMorgues(server: ServerInfo, username: string, signal?: AbortSignal): Promise<ServerMorgues | null> {
  const known = getMorgueDir(server.id, username)
  for (const dir of known ? [known] : morgueDirGuesses(username)) {
    const url = morgueProxyUrl(server, dir)
    if (!url) continue
    const r = await fetch(url, { signal })
    if (!r.ok) continue
    const files = (await r.text()).split('\n').filter((f) => morgueStamp(f))
    if (!known) setMorgueDir(server.id, username, dir)
    return { dir, files: files.sort((a, b) => (morgueStamp(b) ?? '').localeCompare(morgueStamp(a) ?? '')) }
  }
  return null
}

const HEADS_KEY = 'orbrun.morgueHeads'
/** how many heads this device keeps: a morgue's head is a few hundred bytes, and the oldest kept go first */
const HEADS_KEPT = 1000

function readHeads(): Record<string, MorgueSummary> {
  try {
    return JSON.parse(localStorage.getItem(HEADS_KEY) ?? '{}') as Record<string, MorgueSummary>
  } catch {
    return {}
  }
}

/** What a morgue's head says, read once and kept (a morgue never changes): the first HEAD_BYTES of the file. */
export async function serverMorgueHead(server: ServerInfo, dir: string, file: string, signal?: AbortSignal): Promise<MorgueSummary> {
  const key = `${server.host}${dir}${file}`
  const kept = readHeads()[key]
  if (kept) return kept
  const url = morgueProxyUrl(server, dir + file)
  if (!url) return parseMorgue(file, '')
  const r = await fetch(url, { signal, headers: { Range: `bytes=0-${HEAD_BYTES - 1}` } })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const head = parseMorgue(file, await r.text())
  // only a head that read as one is kept: a page in its place (a server's error) is asked again another time
  if (head.score !== null) {
    try {
      const all = readHeads()
      all[key] = head
      const keys = Object.keys(all)
      for (const k of keys.slice(0, Math.max(0, keys.length - HEADS_KEPT))) delete all[k]
      localStorage.setItem(HEADS_KEY, JSON.stringify(all))
    } catch {
      // a full or blocked storage keeps nothing, and the head is read again next time
    }
  }
  return head
}

/** A whole morgue from a server. */
export async function serverMorgue(server: ServerInfo, dir: string, file: string, signal?: AbortSignal): Promise<string> {
  const url = morgueProxyUrl(server, dir + file)
  if (!url) throw new Error('not a URL the proxy carries')
  const r = await fetch(url, { signal })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.text()
}

// ------------------------------------------------------------------ on this device

/** A morgue a game on this device left, read whole. */
export interface DeviceMorgueText {
  summary: MorgueSummary
  text: string
}

/** Every morgue an offline account's games left on this device, in every slot, newest first. */
export async function deviceMorgues(profile: string): Promise<DeviceMorgueText[]> {
  const found = await profileMorgues(profile)
  const read = await Promise.all(
    found.map(async ({ db, path }) => {
      const text = await readSaveFile(db, path)
      const file = path.slice(path.lastIndexOf('/') + 1)
      return text === null ? null : { summary: parseMorgue(file, text), text }
    }),
  )
  return read.filter((m): m is DeviceMorgueText => !!m).sort((a, b) => b.summary.stamp.localeCompare(a.summary.stamp))
}

/** The morgue a game on this device names as it ends (@orbrun/offline `game_ended` `dump`: its path less `.txt`). */
export function deviceDump(dump: string): Promise<string | null> {
  const at = dump.indexOf('/morgue/')
  return at > 0 ? readSaveFile(dump.slice(0, at), dump + '.txt') : Promise.resolve(null)
}
