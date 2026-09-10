/**
 * @orbrun/gamedata
 *
 * Loads a WebTiles server's own version-specific data (enums.js,
 * tileinfo-*.js, atlas images) at runtime and exposes tile lookups, flag
 * decoding and name indices. Nothing version-specific is hardcoded here, and
 * nothing here depends on a renderer: `Gamedata` satisfies `@orbrun/scene`'s
 * `TileSource` contract structurally, through the types below.
 */

/** A tile id, as the server's tileinfo modules number them. */
export type TileId = number

/** Where a tile is drawn from: a source rect in an atlas image. */
export interface TileRect {
  atlas: string
  /** Source rect in texels. */
  sx: number
  sy: number
  w: number
  h: number
  /** Offset of the drawn rect within a 32x32 cell, in texels. */
  ox: number
  oy: number
  /** Nominal cell size the tile was authored for. */
  cell: number
}

/** What a renderer needs from a tile provider. */
export interface TileSource {
  tile(id: TileId, layer?: string): TileRect | undefined
  atlas(name: string): TexImageSource | undefined
  atlasNames(): string[]
}

export interface TileInfoRaw {
  w: number
  h: number
  ox: number
  oy: number
  sx: number
  sy: number
  ex: number
  ey: number
}

export interface TileModule {
  /** module exports: NAME -> id, plus get_tile_info, tile_count, basetile, get_img */
  exports: Record<string, unknown>
  get_tile_info(idx: number): TileInfoRaw | undefined
  tile_count(idx: number): number
  basetile(idx: number): number
  get_img(idx: number): string
  /** first id (inclusive) and end (exclusive) */
  first: number
  end: number
  atlas: string
}

export interface FlagWord extends Array<number> {
  value: number
  [flag: string]: unknown
}

export interface Enums {
  prepare_fg_flags(word: number | number[] | FlagWord): FlagWord
  prepare_bg_flags(word: number | number[] | FlagWord): FlagWord
  mouse_mode: Record<string, number>
  menu_flag: Record<string, number>
  texture: Record<string, number>
  /** UI states (tileweb.h): NORMAL, CRT, VIEW_MAP. */
  ui?: Record<string, number>
  [key: string]: unknown
}

/**
 * The official client's `status-icon-sizes.js` (generated from
 * rltiles/icon-sizes.txt): how a server `icons` entry lays out in the status
 * row. -1 = not drawn, 0 = drawn at its fixed position without shifting the
 * row, n = drawn at the row's current shift and the row moves by n texels.
 */
export type StatusIconSize = (icon: number) => number

export interface NameIndex {
  name(id: number): string | undefined
  id(name: string): number | undefined
  /** canonical name of the base tile (variations resolve to their base) */
  baseName(id: number): string | undefined
}

export interface GamedataFetch {
  fetchText(url: string): Promise<string>
  loadImage(url: string): Promise<TexImageSource>
}

export const ATLASES = ['floor', 'wall', 'feat', 'main', 'player', 'gui', 'icons'] as const
export type AtlasName = (typeof ATLASES)[number]

const TILEINFO_ORDER: AtlasName[] = ['floor', 'wall', 'feat', 'main', 'player', 'gui', 'icons']

/** Evaluate an AMD module source with the given resolved dependencies. */
function evalAmd(src: string, resolve: (dep: string) => unknown): unknown {
  let result: unknown
  const define = (a: unknown, b?: unknown) => {
    let deps: string[] = []
    let factory: unknown
    if (typeof a === 'function') factory = a
    else {
      deps = a as string[]
      factory = b
    }
    const args = deps.map(resolve)
    result = (factory as (...x: unknown[]) => unknown)(...args)
  }
  const fn = new Function('define', 'window', 'assert', 'requirejs', 'require', src)
  fn(define, {}, () => {}, undefined, undefined)
  return result
}

/**
 * Evaluate one gamedata module, saying which URL failed when it will not.
 *
 * A shell whose gamedata proxy is missing answers these URLs with its own
 * app shell: a 200 whose body is HTML. Without this the only sign is the
 * SyntaxError from the eval below (`Unexpected token '<'`), which names
 * neither the file nor the reason.
 */
function evalGamedata(url: string, src: string, resolve: (dep: string) => unknown): unknown {
  if (/^\s*(<!|<html|<\?xml)/i.test(src)) {
    throw new Error(`gamedata ${url}: expected JavaScript, got an HTML page (is the gamedata proxy serving this path?)`)
  }
  try {
    return evalAmd(src, resolve)
  } catch (e) {
    throw new Error(`gamedata ${url}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

function makeNameIndex(mods: TileModule[]): NameIndex {
  const names = new Map<number, string>()
  const ids = new Map<string, number>()
  // Each module's `*_MAX` sentinel is the id of the next module's first tile
  // (TILE_WALL_MAX is DNGN_TREE, TILE_FEAT_MAX is UNRAND_AIR, ...), so a
  // sentinel only names an id when nothing else does.
  const sentinels: [number, string][] = []
  for (const m of mods) {
    for (const [k, v] of Object.entries(m.exports)) {
      if (typeof v !== 'number') continue
      ids.set(k, v)
      if (/_MAX$/.test(k)) sentinels.push([v, k])
      else if (!names.has(v)) names.set(v, k)
    }
  }
  for (const [v, k] of sentinels) if (!names.has(v)) names.set(v, k)
  const find = (id: number) => mods.find((m) => id >= m.first && id < m.end)
  return {
    name: (id) => names.get(id),
    id: (name) => ids.get(name),
    baseName: (id) => {
      const m = find(id)
      if (!m) return names.get(id)
      let base = id
      try {
        base = m.basetile(id)
      } catch {
        base = id
      }
      return names.get(base) ?? names.get(id)
    },
  }
}

const TEXTURE_ATLAS: Record<string, AtlasName> = {
  FLOOR: 'floor',
  WALL: 'wall',
  FEAT: 'feat',
  PLAYER: 'player',
  DEFAULT: 'main',
  MAIN: 'main',
  GUI: 'gui',
  ICONS: 'icons',
}

/** Atlas per texture index from `enums.texture`; the tiles.h order when the server publishes none. */
function textureOrderFrom(enums: Enums | undefined): (AtlasName | undefined)[] {
  const out: (AtlasName | undefined)[] = []
  const tex = enums?.texture
  if (tex && typeof tex === 'object') {
    for (const [k, v] of Object.entries(tex)) {
      const atlas = TEXTURE_ATLAS[k]
      if (atlas && typeof v === 'number') out[v] = atlas
    }
  }
  if (out.length === 0) return ['floor', 'wall', 'feat', 'player', 'main', 'gui', 'icons']
  return out
}

/**
 * Compare a table of constants a client hardcodes against what the server's
 * enums.js publishes. Returns one line per mismatch or missing name, so the
 * caller can log a clear diagnostic instead of silently drifting.
 */
export function verifyEnums(gd: Gamedata, expected: Record<string, Record<string, number> | undefined>): string[] {
  const out: string[] = []
  for (const [group, table] of Object.entries(expected)) {
    if (!table) continue
    const published = group === '' ? (gd.enums as Record<string, unknown>) : (gd.enums[group] as Record<string, unknown> | undefined)
    if (!published || typeof published !== 'object') {
      out.push(`enums.js does not publish ${group || 'top-level constants'}`)
      continue
    }
    for (const [name, value] of Object.entries(table)) {
      const got = published[name]
      if (got === undefined) out.push(`enums.js has no ${group ? group + '.' : ''}${name} (client assumes ${value})`)
      else if (got !== value) out.push(`enums.js ${group ? group + '.' : ''}${name} = ${String(got)}, client assumes ${value}`)
    }
  }
  return out
}

export class Gamedata implements TileSource {
  readonly version: string
  readonly fingerprint: string
  readonly enums: Enums
  readonly modules: Record<AtlasName, TileModule>
  private images = new Map<string, TexImageSource>()
  private iconSizes: StatusIconSize | null = null
  /** atlas name per texture index, from enums.texture */
  private textureOrder: (AtlasName | undefined)[]
  readonly dngn: NameIndex
  readonly main: NameIndex
  readonly player: NameIndex
  readonly icons: NameIndex
  readonly gui: NameIndex
  /** range boundaries in the global tile id space */
  readonly ranges: {
    floorMax: number
    wallMax: number
    featMax: number
    mainMax: number
    playerMax: number
    guiMax: number
    iconsMax: number
    firstTransparent: number
    mcacheStart: number
  }

  constructor(version: string, enums: Enums, modules: Record<AtlasName, TileModule>, fingerprint: string) {
    this.version = version
    this.enums = enums
    this.modules = modules
    this.fingerprint = fingerprint
    const f = modules.floor.exports
    const w = modules.wall.exports
    this.ranges = {
      floorMax: modules.floor.end,
      wallMax: modules.wall.end,
      featMax: modules.feat.end,
      mainMax: modules.main.end,
      playerMax: modules.player.end,
      guiMax: modules.gui.end,
      iconsMax: modules.icons.end,
      firstTransparent: (w.DNGN_FIRST_TRANSPARENT as number) ?? modules.wall.end,
      mcacheStart: (modules.player.exports.MCACHE_START as number) ?? modules.player.end,
    }
    void f
    this.textureOrder = textureOrderFrom(enums)
    this.dngn = makeNameIndex([modules.floor, modules.wall, modules.feat])
    this.main = makeNameIndex([modules.main])
    this.player = makeNameIndex([modules.player])
    this.gui = makeNameIndex([modules.gui])
    this.icons = makeNameIndex([modules.icons])
  }

  moduleFor(id: TileId): TileModule | undefined {
    for (const name of TILEINFO_ORDER) {
      const m = this.modules[name]
      if (id >= m.first && id < m.end) return m
    }
    return undefined
  }

  /**
   * Module by the server's texture index (tiles.h TextureID). The order comes
   * from the server's own `enums.texture` (FLOOR, WALL, FEAT, PLAYER, DEFAULT,
   * GUI, ICONS); it is not the tileinfo dependency order.
   */
  moduleForTexture(tex: number): TileModule | undefined {
    const name = this.textureOrder[tex]
    return name ? this.modules[name] : undefined
  }

  /**
   * Layout size of a status icon in the shifting row (see StatusIconSize).
   * Falls back to the icon's own width when the server does not publish
   * `status-icon-sizes.js`, which is what older clients did.
   */
  statusIconSize(id: TileId): number {
    if (this.iconSizes) {
      try {
        const n = this.iconSizes(id)
        if (typeof n === 'number' && !Number.isNaN(n)) return n
      } catch {
        /* fall through */
      }
    }
    return this.tile(id)?.w ?? 0
  }

  /** Whether the server published `status-icon-sizes.js`. */
  get hasStatusIconSizes(): boolean {
    return this.iconSizes !== null
  }

  /** `tile` answers, by layer and id: the level builder asks for the same few hundred tiles thousands of times a build. */
  private tileCache = new Map<string, TileRect | undefined>()

  tile(id: TileId, layer?: string): TileRect | undefined {
    const ck = (layer ?? '') + ':' + id
    if (this.tileCache.has(ck)) return this.tileCache.get(ck)
    const rect = this.tileUncached(id, layer)
    this.tileCache.set(ck, rect)
    return rect
  }

  private tileUncached(id: TileId, layer?: string): TileRect | undefined {
    let m: TileModule | undefined
    if (layer && /^\d+$/.test(layer)) m = this.moduleForTexture(Number(layer))
    else if (layer && layer in this.modules) m = this.modules[layer as AtlasName]
    else m = this.moduleFor(id)
    if (!m) return undefined
    let info: TileInfoRaw | undefined
    try {
      info = m.get_tile_info(id)
    } catch {
      return undefined
    }
    if (!info) return undefined
    return {
      atlas: m.atlas,
      sx: info.sx,
      sy: info.sy,
      w: info.ex - info.sx,
      h: info.ey - info.sy,
      ox: info.ox + (32 / 2 - info.w / 2),
      oy: info.oy + (32 - info.h),
      cell: 32,
    }
  }

  tileCount(id: TileId): number {
    const m = this.moduleFor(id)
    if (!m) return 1
    try {
      return m.tile_count(id) || 1
    } catch {
      return 1
    }
  }

  atlas(name: string): TexImageSource | undefined {
    return this.images.get(name)
  }

  atlasNames(): string[] {
    return [...ATLASES]
  }

  setAtlas(name: string, img: TexImageSource) {
    this.images.set(name, img)
  }

  setStatusIconSizes(fn: StatusIconSize | null) {
    this.iconSizes = fn
  }

  fg(word: number | number[] | FlagWord | undefined): FlagWord {
    return this.enums.prepare_fg_flags(word || 0)
  }

  bg(word: number | number[] | FlagWord | undefined): FlagWord {
    return this.enums.prepare_bg_flags(word || 0)
  }
}

async function fnv1a(text: string): Promise<string> {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

export interface LoadGamedataOptions {
  /** e.g. `https://host` or `/gamedata-proxy/host`; the version segment is appended. */
  base: string
  version: string
  io: GamedataFetch
  onProgress?: (done: number, total: number, what: string) => void
  /** Skip atlas images (headless / tests). */
  skipImages?: boolean
  /** Non-fatal problems (an optional file missing, a constant differing). */
  onDiagnostic?: (text: string, detail?: unknown) => void
}

/** Load enums, tileinfo modules and atlases for one server version. */
export async function loadGamedata(opts: LoadGamedataOptions): Promise<Gamedata> {
  const { base, version, io } = opts
  const root = `${base.replace(/\/$/, '')}/gamedata/${version}`
  const files = ['enums.js', ...TILEINFO_ORDER.map((n) => `tileinfo-${n}.js`)]
  const total = files.length + 1 + (opts.skipImages ? 0 : ATLASES.length)
  let done = 0
  const texts = await Promise.all(
    files.map(async (f) => {
      const t = await io.fetchText(`${root}/${f}`)
      opts.onProgress?.(++done, total, f)
      return t
    }),
  )
  const enums = evalGamedata(`${root}/${files[0]}`, texts[0], () => undefined) as Enums
  const modules = {} as Record<AtlasName, TileModule>
  let prev: Record<string, unknown> | undefined
  let fp = ''
  for (let i = 0; i < TILEINFO_ORDER.length; i++) {
    const name = TILEINFO_ORDER[i]
    const src = texts[i + 1]
    const p = prev
    const exports = evalGamedata(`${root}/${files[i + 1]}`, src, () => p) as Record<string, unknown>
    const get_tile_info = exports.get_tile_info as (idx: number) => TileInfoRaw | undefined
    const tile_count = exports.tile_count as (idx: number) => number
    const basetile = exports.basetile as (idx: number) => number
    const get_img = exports.get_img as (idx: number) => string
    // the first id of the module is the previous module's MAX, or 0
    const maxKey = Object.keys(exports).find((k) => /^(FLOOR|WALL|FEAT|MAIN|PLAYER|GUI|ICONS)_MAX$/.test(k))
    const end = (maxKey ? (exports[maxKey] as number) : 0) || 0
    const first = p ? (Object.entries(p).find(([k]) => /_MAX$/.test(k) && /^(TILE|TILEP|TILEG|TILEI)_/.test(k))?.[1] as number) ?? 0 : 0
    modules[name] = {
      exports,
      get_tile_info,
      tile_count,
      basetile,
      get_img,
      first: modules[TILEINFO_ORDER[i - 1]]?.end ?? first ?? 0,
      end,
      atlas: name,
    }
    fp += `${name}:${end};`
    prev = exports
  }
  const gd = new Gamedata(version, enums, modules, await fnv1a(fp))
  // status-icon-sizes.js is generated with the tiles; a server may predate it
  try {
    const src = await io.fetchText(`${root}/status-icon-sizes.js`)
    const mod = evalGamedata(`${root}/status-icon-sizes.js`, src, () => modules.icons.exports) as
      | { status_icon_size?: StatusIconSize }
      | undefined
    if (mod && typeof mod.status_icon_size === 'function') gd.setStatusIconSizes(mod.status_icon_size)
    else opts.onDiagnostic?.('status-icon-sizes.js has no status_icon_size; status icons shift by their own width')
  } catch (e) {
    opts.onDiagnostic?.('status-icon-sizes.js not available; status icons shift by their own width', e)
  }
  opts.onProgress?.(++done, total, 'status-icon-sizes.js')
  if (!opts.skipImages) {
    await Promise.all(
      ATLASES.map(async (a) => {
        const img = await io.loadImage(`${root}/${a}.png`)
        gd.setAtlas(a, img)
        opts.onProgress?.(++done, total, `${a}.png`)
      }),
    )
  }
  return gd
}

/** Default browser IO: fetch text and CORS images. */
export function browserIo(): GamedataFetch {
  return {
    async fetchText(url) {
      const r = await fetch(url)
      if (!r.ok) throw new Error(`gamedata ${url}: HTTP ${r.status}`)
      return r.text()
    },
    async loadImage(url) {
      const r = await fetch(url)
      if (!r.ok) throw new Error(`gamedata ${url}: HTTP ${r.status}`)
      const blob = await r.blob()
      // same trap as the modules: a missing proxy answers with an app shell,
      // and createImageBitmap's error names neither the file nor the reason
      if (blob.type && !blob.type.startsWith('image/')) {
        throw new Error(`gamedata ${url}: expected an image, got ${blob.type} (is the gamedata proxy serving this path?)`)
      }
      return createImageBitmap(blob)
    },
  }
}
