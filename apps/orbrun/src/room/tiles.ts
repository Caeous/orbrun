import type { TileId, TileRect, TileSource } from '@orbrun/scene'
import type { TileNames } from '@orbrun/vault'

/**
 * The front room's tiles: one small atlas packed at build time from a pinned
 * DCSS gamedata version (tools/build/pack-room.mjs), served as a static
 * file. The menu draws its room from this before any server is spoken to,
 * and never from a server's gamedata: the room is a build asset, the game
 * is not (ATTRIBUTION.md).
 */
export interface RoomAtlasJson {
  source: { host: string; version: string; atlases: string[]; des: string }
  license: string
  cell: number
  width: number
  height: number
  /** tile name -> base id and how many variants follow it */
  names: Record<string, { id: number; count: number }>
  /** tile id -> where it is in the packed image, with the offsets tileinfo gave it */
  tiles: Record<string, { name: string; from: string; sx: number; sy: number; w: number; h: number; ox: number; oy: number }>
}

const ROOM_ATLAS_URL = '/room/atlas.json'
const ROOM_IMAGE_URL = '/room/atlas.png'
const ATLAS = 'room'

export class RoomTiles implements TileSource, TileNames {
  private rects = new Map<TileId, TileRect>()
  private counts = new Map<TileId, number>()
  private ids = new Map<string, TileId>()

  constructor(
    readonly json: RoomAtlasJson,
    private image: TexImageSource | undefined,
  ) {
    for (const [id, t] of Object.entries(json.tiles)) this.rects.set(Number(id), { atlas: ATLAS, sx: t.sx, sy: t.sy, w: t.w, h: t.h, ox: t.ox, oy: t.oy, cell: json.cell })
    for (const [name, n] of Object.entries(json.names)) {
      this.ids.set(name, n.id)
      this.counts.set(n.id, n.count)
    }
  }

  tile(id: TileId): TileRect | undefined {
    return this.rects.get(id)
  }
  atlas(name: string): TexImageSource | undefined {
    return name === ATLAS ? this.image : undefined
  }
  atlasNames(): string[] {
    return [ATLAS]
  }
  id(name: string): number | undefined {
    return this.ids.get(name)
  }
  tileCount(id: TileId): number {
    return this.counts.get(id) ?? 1
  }
}

/** Fetch the packed atlas and its image. */
export async function loadRoomTiles(): Promise<RoomTiles> {
  const [json, image] = await Promise.all([
    fetch(ROOM_ATLAS_URL).then((r) => {
      if (!r.ok) throw new Error(`room atlas: HTTP ${r.status}`)
      return r.json() as Promise<RoomAtlasJson>
    }),
    loadImage(ROOM_IMAGE_URL),
  ])
  return new RoomTiles(json, image)
}

function loadImage(url: string): Promise<TexImageSource> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`room atlas: could not load ${url}`))
    img.src = url
  })
}
