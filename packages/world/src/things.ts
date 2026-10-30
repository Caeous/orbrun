import { cellKey, type Billboard, type CellKey, type Scene, type SceneCell, type TileId } from '@orbrun/scene'
import { featureStance, type FeatureStance } from './doors.js'
import { monsterId } from './motion.js'

/** A cloud's opacity: how much of what is behind it it hides. */
export const CLOUD_ALPHA = 0.55
/** How far a projectile in flight is lifted off the floor, in cells. */
export const PROJECTILE_LIFT = 0.1
/** How tall an upright feature stands, in cells; stairs lower, a mouth in the floor. */
export const FIXTURE_H = 0.9
export const STAIR_H = 0.7

/** One layer of what stands: a tile, where it is moved to in its cell, and the row it is cut off at. */
export interface StandingLayer {
  tile: TileId
  ox: number
  oy: number
  ymax?: number
  /** a status badge or the damage bar: a mark on the sprite, flat; `top`, pinned to the top of the cell, whatever its offset */
  badge?: boolean
  top?: boolean
}

/**
 * Something that stands in the level, as every renderer draws it: a
 * monster, an item, a missile in flight or a cloud (from the scene's
 * billboards), or a feature of the level's (a statue, a tree, a way down, a
 * door in its doorway). Each renderer resolves its layers to art itself, and
 * draws what has none it can resolve not at all.
 */
export interface Standing {
  kind: Billboard['kind'] | 'feature'
  x: number
  y: number
  /** its art, bottom first, the badges last */
  layers: StandingLayer[]
  /** how tall it stands, in cells */
  height: number
  /** where it may glide (`Movers`) */
  moverId?: number
  /** how much of it shows, where it shows what is behind it: a cloud, or what is submerged or seen invisible */
  alpha?: number
  /** off the floor, in cells: a missile in flight */
  lift?: number
  /** laid on the floor rather than stood up: a corpse */
  lie?: boolean
  /** plants and fungi: drawn, but neither shown through walls nor named */
  scenery?: boolean
  /** in view now, rather than remembered */
  visible: boolean
  /** shown through what hides it (rendering-3d.md II.4): whatever the 2D map shows on the cell */
  ghost: boolean
  /** the radius of the shadow round its foot, where it casts one */
  shadow?: number
  /** a feature's: how it stands (`featureStance`) */
  stance?: FeatureStance
  /** a monster's name, for a label under it */
  name?: string
  /** crawl's glyph for what is on its cell, and its colour (0..15), for naming it from too far to make out */
  glyph?: string
  colour?: number
}

/** crawl's glyph on a cell, where it names something: not a blank, a floor or a wall */
const named = (c: SceneCell | undefined, blank: RegExp) => (c?.glyph && !blank.test(c.glyph) ? c.glyph : undefined)

/**
 * What stands of the scene's billboards. The player is the camera, and
 * whatever shares the cell underfoot is behind it, but for a cloud; a
 * cloud carries no badges and is neither shown through walls nor shadowed;
 * what is translucent is drawn so; what lies on the floor casts no shadow
 * round itself; scenery is the exception to being shown through walls.
 */
export function crowd(scene: Scene): Standing[] {
  const out: Standing[] = []
  for (const b of scene.billboards) {
    if (b.kind === 'player') continue
    if (b.x === scene.player.x && b.y === scene.player.y && scene.playerOnLevel && b.kind !== 'cloud') continue
    const cell = scene.cells.get(cellKey(b.x, b.y))
    const visible = cell?.visibility === 'visible'
    if (b.kind === 'cloud') {
      out.push({ kind: 'cloud', x: b.x, y: b.y, layers: [{ tile: b.tile, ox: 0, oy: 0 }], height: b.height, alpha: CLOUD_ALPHA, visible, ghost: false })
      continue
    }
    const layers: StandingLayer[] = b.layers?.length ? b.layers.map((l) => ({ tile: l.tile, ox: l.ox || 0, oy: l.oy || 0, ymax: l.ymax })) : [{ tile: b.tile, ox: 0, oy: 0 }]
    for (const i of b.statusIcons ?? []) layers.push({ tile: i.tile, ox: i.ox, oy: i.oy, badge: true, top: i.at === 'top' })
    const monster = b.kind === 'monster'
    const alive = monster && !b.scenery
    out.push({
      kind: b.kind,
      x: b.x,
      y: b.y,
      layers,
      height: b.height,
      moverId: monster ? monsterId(b) : undefined,
      alpha: b.alpha,
      lift: b.kind === 'projectile' ? PROJECTILE_LIFT : undefined,
      lie: b.lying,
      scenery: b.scenery,
      visible,
      ghost: !b.scenery,
      shadow: b.lying ? undefined : Math.max(0.6, b.height),
      name: alive ? ((b.ref as { name?: string } | undefined)?.name ?? b.name) : undefined,
      glyph: named(cell, /^[\s.]$/),
      colour: cell?.colour,
    })
  }
  return out
}

/**
 * What stands of the level's features, a cell at a time (`featureStance`):
 * those upright in their cells, the doors in their doorways, and what lies
 * in its cell as a corpse does. Stairs stand lower than the rest.
 */
export function fixtures(scene: Scene, framed: ReadonlyMap<CellKey, number>, occupied: ReadonlySet<CellKey>): Standing[] {
  const out: Standing[] = []
  for (const c of scene.cells.values()) {
    const stance = featureStance(c, framed, occupied)
    if (stance !== 'upright' && stance !== 'framed' && stance !== 'lying') continue
    const height = stance !== 'upright' ? 1 : c.feature?.type === 'stairs' ? STAIR_H : FIXTURE_H
    out.push({
      kind: 'feature',
      x: c.x,
      y: c.y,
      layers: [{ tile: c.featureTile!, ox: 0, oy: 0 }],
      height,
      lie: stance === 'lying',
      visible: c.visibility === 'visible',
      ghost: false,
      stance,
      glyph: named(c, /^[\s.#]$/),
      colour: c.colour,
    })
  }
  return out
}
