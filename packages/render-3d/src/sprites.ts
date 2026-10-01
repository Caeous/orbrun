import { cellKey, shadeOf, type Billboard, type Scene, type SceneCell, type TileRect } from '@orbrun/scene'

/**
 * Standing sprites as instances (shaders.ts `SPRITE_VERT`): what a monster,
 * an item, a fixture or a door is drawn from, worked out here with no GL in
 * sight so the tests can read it. One instance per tile layer; a billboard
 * with a doll of six parts and two badges is eight instances.
 */

/** Shade of an extruded block's faces relative to the texel colour. The shader holds the same numbers. */
export const BLOCK_SHADE = { front: 1, top: 0.86, side: 0.7, bottom: 0.5 }
/**
 * Standing sprites are given thickness: behind the front every opaque texel
 * is extruded this many texels deep, with the rim of side faces shaded as
 * the hands' are, so a sprite seen from off-centre reads as a slab rather
 * than a sheet of paper. A texel deep and no more: the extrusion is the same
 * texel grid stood up.
 */
export const BB_DEPTH = 1
/** How tall an upright feature stands, in cells; stairs lower, a mouth in the floor. */
export const FIXTURE_H = 0.9
export const STAIR_H = 0.7
/**
 * How far an upright feature's board stands back from the middle of its cell:
 * whatever stands on the cell reads in front of it rather than through it.
 */
export const FIXTURE_BACK = BB_DEPTH / 32
/** How far a projectile in flight is lifted off the floor, in cells. */
export const PROJECTILE_LIFT = 0.1
/** How far a lying sprite's underside is lifted off the floor, in cells: clear of the floor's decals (level-mesh.ts, up to 0.008). */
export const LIE_LIFT = 0.01
/** How many texels the selected sprite's shell stands out from its body, against the hull's one. */
export const SEL_GROW = 2
/** Remembered knowledge reads like the 2D map's dim tiles: nearly solid, told apart by its cool tint. */
export const GHOST_ALPHA = 0.7
export const GHOST_ALPHA_VISIBLE = 1
/** Tints for what the server is not showing; anything in view keeps the sprite's own colours. */
export const GHOST_TINT = {
  remembered: { r: 0.55, g: 0.6, b: 0.8 },
  item: { r: 0.8, g: 0.8, b: 0.8 },
  projectile: { r: 1, g: 1, b: 1 },
}
const BADGE_TINT = { r: 1, g: 1, b: 1 }
/** A cloud's opacity. */
export const CLOUD_ALPHA = 0.55
/**
 * How far a cloud's board stands forward of the middle of its cell, in cells.
 * A board at the cell's middle is coplanar with the front face of the block
 * of whoever stands in that cell, and loses the depth test to it texel for
 * texel: the smoke over a monster drew nowhere but the gaps in its art. A
 * texel in front, the mirror of `FIXTURE_BACK`, and the smoke reads over
 * whatever it has drifted over.
 */
export const CLOUD_FORWARD = BB_DEPTH / 32

/** Mode bits of an instance (`iMisc.x`). */
export const MODE_BILLBOARD = 1
export const MODE_THICK = 2
export const MODE_HULL_FRONT = 4
export const MODE_RING = 8
export const MODE_SHADE_MAP = 16
export const MODE_FLASH_OVERRIDE = 32
export const MODE_LIE = 64
export const MODE_FACE_EYE = 128

export type Tint = { r: number; g: number; b: number }

/**
 * Which draw an instance belongs to. `fixture` is the level's own standing
 * things, drawn with the masonry and part of the ghosts' depth image; `opaque`
 * the crowd, drawn after the ghosts so a nearer monster covers a farther one's
 * ghost; `blend` what is translucent, last and back to front.
 */
export type SpritePass = 'fixture' | 'opaque' | 'blend' | 'ghostVisible' | 'ghostRemembered'

export interface SpriteInstance {
  atlas: string
  pass: SpritePass
  /** World position of the sprite's origin: the middle of its cell on the floor, lifted for a projectile. */
  anchor: [number, number, number]
  /** The quad in the sprite's frame: centre x, centre y, half width, half height, world units. */
  quad: [number, number, number, number]
  /** The front's z in the sprite's frame, and the block's depth. */
  z: [number, number]
  /** The tile in atlas texels: sx, sy, w, rows (clipped). */
  texel: [number, number, number, number]
  color: [number, number, number, number]
  /** mode bits, hull width in texels, texel size in world units, fixed yaw. */
  misc: [number, number, number, number]
  cell: [number, number]
  /** The monster this instance belongs to, where it may glide (motion.ts). */
  moverId?: number
  /** The cell it stands on, for the cursor's shell and the movers. */
  x: number
  y: number
}

/** One layer of a standing sprite, resolved to its tile. */
export interface SpriteLayer {
  r: TileRect
  ox: number
  oy: number
  ymax?: number
  tint?: Tint
  /** Drawn as a flat quad even on a thick sprite: the status badges and the damage bar are marks on the sprite. */
  flat?: boolean
}

export interface StandOptions {
  height: number
  shade: number
  tint: Tint
  /** Lit by the shade map (else `shade` is in the colour). */
  shadeMap: boolean
  thick: boolean
  pass: SpritePass
  /** Opacity, for the blended passes. */
  alpha?: number
  /** How far the whole sprite stands back from the cell's middle, away from the eye. */
  back?: number
  /** A heading to stand at instead of turning with the camera (an open door in its wall run). */
  yaw?: number
  /** The hull round the block, in texels: 1 the ink, SEL_GROW the selected shell, 0 none. */
  grow?: number
  lift?: number
  /** Laid face up on the floor, the tile's top away from the eye, instead of stood up (a corpse). */
  lie?: boolean
  /**
   * Turned to face the eye where it stands rather than the way it looks, then
   * this share of the way on to where it looks: turning on the spot sways it
   * only so far (a folded way up, whose steps swung round whole would show
   * what is behind them).
   */
  faceEye?: number
  /** The block's depth in cells, where it is more than a texel (a folded way up's side, reaching back under its steps). */
  depth?: number
  moverId?: number
}

/**
 * The instances of one standing sprite at cell (x, y): a layer each, stacked
 * a hair forward of the one under it so a doll's parts and its badges keep
 * their order.
 */
export function stand(x: number, y: number, layers: readonly SpriteLayer[], o: StandOptions): SpriteInstance[] {
  const out: SpriteInstance[] = []
  const scale = o.height
  const back = o.back ?? 0
  let i = 0
  for (const l of layers) {
    const cell = l.r.cell
    let hTex = l.r.h
    if (l.ymax !== undefined && l.ymax < l.r.oy + l.r.h) hTex = Math.max(0, l.ymax - l.r.oy)
    if (hTex <= 0) continue
    const k = scale / cell
    const wq = l.r.w * k
    const hq = hTex * k
    const cx = (l.r.ox + l.ox + l.r.w / 2 - cell / 2) * k
    const bottom = (cell - (l.r.oy + l.oy + hTex)) * k
    // lying, the frame's y runs along the floor from the cell's middle, and its z up off the floor
    const cy = o.lie ? bottom + hq / 2 - scale / 2 : bottom + hq / 2
    const depth = o.depth ?? BB_DEPTH * k
    const lt = l.tint || o.tint
    const solid = o.thick && !l.flat
    const ghost = o.pass === 'ghostVisible' || o.pass === 'ghostRemembered'
    let mode = 0
    if (o.lie) mode |= MODE_LIE
    if (o.faceEye !== undefined) mode |= MODE_FACE_EYE
    else if (o.yaw === undefined) mode |= MODE_BILLBOARD
    if (solid) mode |= MODE_THICK
    if (o.shadeMap) mode |= MODE_SHADE_MAP
    // A board at a heading (an open door in its wall run) is seen from every angle, edge-on as the player walks
    // through it, and there a hull is no line but a band: its back face swings out from the board in parallax and
    // is cut to ribbons against the masonry either side. Its ink is the flat ring instead, in the board's plane.
    // Lying on the floor it is seen from above, and keeps its hull.
    const board = solid && o.yaw !== undefined && !o.lie
    if (board) mode |= MODE_RING
    // the ink: a hull round a block, a flat ring round a ghost; none on a badge, a bar or a board at a heading (which has its ring)
    const grow = l.flat ? 0 : ghost ? 1 : board ? 0 : solid ? (o.grow ?? 1) : (o.grow ?? 0)
    out.push({
      atlas: l.r.atlas,
      pass: o.pass,
      anchor: [x + 0.5, o.lift ?? 0, y + 0.5],
      quad: [cx, cy, wq / 2, hq / 2],
      z: o.lie ? [i * 0.002 + depth + LIE_LIFT, depth] : [i * 0.002 - back, depth],
      texel: [l.r.sx, l.r.sy, l.r.w, hTex],
      color: [o.shade * lt.r, o.shade * lt.g, o.shade * lt.b, o.alpha ?? 1],
      misc: [mode, grow, k, o.faceEye ?? o.yaw ?? 0],
      cell: [x, y],
      moverId: o.moverId,
      x,
      y,
    })
    i++
  }
  return out
}

/** A tile's rect, or null where the source has none. */
export type TileLookup = (id: number) => TileRect | undefined

/** Crawl's client id for the monster a billboard was built from, where it has one. */
export function monsterIdOf(b: Billboard): number | undefined {
  const id = (b.ref as { id?: number } | undefined)?.id
  return typeof id === 'number' ? id : undefined
}

/**
 * The instances of a scene's billboards: the sprite of each, its ghost where
 * it has one (rendering-3d.md II.4: whatever the 2D map shows on the cell
 * shows through walls here), and its shadow. The player is the camera, and
 * whatever shares the cell underfoot is behind it.
 */
export function crowdInstances(scene: Scene, tile: TileLookup, selected: { x: number; y: number } | null): { sprites: SpriteInstance[]; shadows: { x: number; y: number; r: number; moverId?: number }[] } {
  const sprites: SpriteInstance[] = []
  const shadows: { x: number; y: number; r: number; moverId?: number }[] = []
  const tint = scene.level.tint
  for (const b of scene.billboards) {
    if (b.kind === 'player') continue
    if (b.x === scene.player.x && b.y === scene.player.y && scene.playerOnLevel && b.kind !== 'cloud') continue
    const cell = scene.cells.get(cellKey(b.x, b.y))
    const shade = shadeOf(cell, scene)
    const visible = cell?.visibility === 'visible'
    if (b.kind === 'cloud') {
      const r = tile(b.tile)
      if (!r) continue
      // a cloud carries its light in its colour: it blends, and reads no map
      sprites.push(...stand(b.x, b.y, [{ r, ox: 0, oy: 0 }], { height: b.height, shade, tint, shadeMap: false, thick: false, pass: 'blend', alpha: CLOUD_ALPHA, grow: 0, back: -CLOUD_FORWARD }))
      continue
    }
    const layers: SpriteLayer[] = []
    if (b.layers && b.layers.length) {
      for (const l of b.layers) {
        const r = tile(l.tile)
        if (r) layers.push({ r, ox: l.ox || 0, oy: l.oy || 0, ymax: l.ymax })
      }
    } else {
      const r = tile(b.tile)
      if (r) layers.push({ r, ox: 0, oy: 0 })
    }
    if (!layers.length) continue
    const nSprite = layers.length
    if (b.statusIcons) {
      for (const i of b.statusIcons) {
        const r = tile(i.tile)
        if (r) layers.push({ r, ox: i.ox, oy: i.at === 'top' ? -r.oy : i.oy, flat: true })
      }
    }
    const translucent = b.alpha !== undefined && b.alpha < 1
    const lift = b.kind === 'projectile' ? PROJECTILE_LIFT : 0
    const lie = b.lying
    const moverId = b.kind === 'monster' ? monsterIdOf(b) : undefined
    const sel = selected && selected.x === b.x && selected.y === b.y
    sprites.push(
      ...stand(b.x, b.y, layers, {
        height: b.height,
        shade: translucent ? shade : 1,
        tint,
        shadeMap: !translucent,
        thick: !translucent,
        pass: translucent ? 'blend' : 'opaque',
        alpha: translucent ? b.alpha : 1,
        // a translucent sprite is flat and blends; its ink is a flat ring at its own alpha
        grow: sel ? SEL_GROW : 1,
        lift,
        lie,
        moverId,
      }),
    )
    // scenery is the exception to the ghost pass: a plant behind a wall tells you nothing
    if (!b.scenery) {
      const gt = visible ? tint : b.kind === 'monster' ? GHOST_TINT.remembered : b.kind === 'projectile' ? GHOST_TINT.projectile : GHOST_TINT.item
      const ghostLayers = layers.map((l, i) => (i < nSprite ? l : { ...l, tint: BADGE_TINT }))
      sprites.push(
        ...stand(b.x, b.y, ghostLayers, {
          height: b.height,
          shade: 1,
          tint: gt,
          shadeMap: visible,
          thick: false,
          pass: visible ? 'ghostVisible' : 'ghostRemembered',
          alpha: visible ? GHOST_ALPHA_VISIBLE : GHOST_ALPHA,
          lift,
          lie,
          moverId,
        }),
      )
    }
    // what lies on the floor casts no shadow round itself
    if (!lie) shadows.push({ x: b.x, y: b.y, r: Math.max(0.6, b.height), moverId })
  }
  return { sprites, shadows }
}

/**
 * The instances of the level's upright features: statues, trees, altars and
 * open doors, lit by the shade map like the masonry. A framed door stands
 * squared to its wall run, full height, at the cell's middle; every other
 * fixture turns to the eye and stands `FIXTURE_BACK` back. A way down lies in
 * its cell as a corpse does, a block a texel thick, something standing on it
 * or not.
 */
export function fixtureInstances(scene: Scene, tile: TileLookup, framed: ReadonlyMap<number, number>, occupied: ReadonlySet<number>, columns?: StairColumns): SpriteInstance[] {
  const out: SpriteInstance[] = []
  const tint = scene.level.tint
  const stands = (c: SceneCell) => c.stance === 'upright' && !occupied.has(cellKey(c.x, c.y))
  for (const cell of scene.cells.values()) {
    if (cell.kind === 'unknown' || cell.occluder) continue
    if (cell.featureTile === undefined) continue
    const lie = cell.stance === 'lying'
    if (!lie && !stands(cell)) continue
    const r = tile(cell.featureTile)
    if (!r) continue
    if (lie) {
      // laid as the floor paints it, the tile's top to the north, whatever the camera does
      out.push(...stand(cell.x, cell.y, [{ r, ox: 0, oy: 0 }], { height: 1, shade: 1, tint, shadeMap: true, thick: true, pass: 'fixture', lie, yaw: 0 }))
      continue
    }
    const yaw = framed.get(cellKey(cell.x, cell.y))
    if (yaw !== undefined) {
      out.push(...stand(cell.x, cell.y, [{ r, ox: 0, oy: 0 }], { height: 1, shade: 1, tint, shadeMap: true, thick: true, pass: 'fixture', yaw }))
      continue
    }
    const f = cell.feature
    const stairs = f?.type === 'stairs'
    const up = (f?.type === 'stairs' || f?.type === 'hatch') && f.dir === 'up'
    const art = up ? columns?.(r) : undefined
    const folded = art && foldedStairs(cell.x, cell.y, r, art, tint, stairs ? STAIR_H : FIXTURE_H, stairs ? STAIRS_STEPS : HATCH_STEPS, stairs)
    if (folded) {
      out.push(...folded)
      continue
    }
    const h = stairs ? STAIR_H : FIXTURE_H
    out.push(...stand(cell.x, cell.y, [{ r, ox: 0, oy: 0 }], { height: h, shade: 1, tint, shadeMap: true, thick: true, pass: 'fixture', back: FIXTURE_BACK }))
  }
  return out
}

/**
 * A way up's art read column by column: `top` the first body row of each
 * column of the tile's rect (-1 where a column has none), `side` the first row
 * of the stairs' side under the step, where the art falls from the step's lit
 * edge to the side's shadow, `open` the first row under that left open (r.h
 * where none is). Undefined until the art can be read.
 */
export type StairColumns = (r: TileRect) => { top: readonly number[]; side: readonly number[]; open: readonly number[] } | undefined

/** How many columns wide a run of columns starting at the same row must be to be a step. */
const STEP_MIN = 3
/** The share of the camera's turn a folded way up follows, from facing the eye (0) to turning with the camera as a board does (1). */
export const STAIR_SWAY = 0.25
/** How far a folded way up's side stands forward of its steps, in cells. */
const SIDE_FORWARD = 0.002
/** Columns between run [c0, c1) and a step: 0 for the step itself. */
const gap = ([s0, s1]: [number, number], c0: number, c1: number) => Math.max(0, s0 - c1 + 1, c0 - s1 + 1)
/**
 * How many steps art must climb to be folded: crawl draws its stairs in five
 * (fewer is an arch, a gate or the Orcish Mines' palisade), and its escape
 * hatch up as a step-ladder of four.
 */
const STAIRS_STEPS = 5
const HATCH_STEPS = 4

/**
 * A way up folded where its steps meet its side: crawl draws the stairs side
 * on, the side the dark wedge at the bottom of the tile and each step a lit
 * column standing on it. The side stands as any upright feature's board
 * does, but forward of the cell's middle by half the deepest step, so the
 * steps behind it are centred on the cell; each step (a run of at least `STEP_MIN` columns starting at the same
 * row) is laid back flat from the top of the side under it, at its height.
 * Behind the side a block of its texels reaches back under the steps, its end
 * showing as the risers; under the escape hatch only the band under each step
 * does, and its legs are the board alone, to be seen between. Null for art that does not climb in
 * `minSteps` steps or more (sealed and one-way stairs, the branch exits but
 * the hells'), which stands whole.
 */
function foldedStairs(x: number, y: number, r: TileRect, art: { top: readonly number[]; side: readonly number[]; open: readonly number[] }, tint: Tint, height: number, minSteps: number, solid: boolean): SpriteInstance[] | null {
  const { top } = art
  const runs: [number, number][] = []
  for (let c0 = 0; c0 < top.length; ) {
    let c1 = c0 + 1
    while (c1 < top.length && top[c1] === top[c0]) c1++
    if (top[c0] >= 0) runs.push([c0, c1])
    c0 = c1
  }
  // crawl's stairs climb to the left: each step starts lower than the one before it
  const steps = runs.filter(([c0, c1]) => c1 - c0 >= STEP_MIN).map(([c0]) => top[c0])
  if (steps.length < minSteps || steps.some((t, i) => i > 0 && t <= steps[i - 1])) return null
  const out: SpriteInstance[] = []
  const k = height / r.cell
  const o = { height, shade: 1, tint, shadeMap: true, thick: true, pass: 'fixture' as const, faceEye: STAIR_SWAY }
  const part = (c0: number, c1: number, r0: number, r1: number): TileRect => ({ ...r, sx: r.sx + c0, ox: r.ox + c0, w: c1 - c0, sy: r.sy + r0, oy: r.oy + r0, h: r1 - r0 })
  // where each step's side starts: its columns agree but for a stray texel, so the middle one
  const wide = runs.filter(([c0, c1]) => c1 - c0 >= STEP_MIN)
  const folds = wide.map(([c0, c1]) => art.side.slice(c0, c1).sort((p, q) => p - q)[(c1 - c0) >> 1])
  // the steps turn about the cell's middle: standing at the middle, their whole depth behind it, a step's far
  // corner would swing out into the wall beside it, so they stand forward by half the deepest step instead
  const back = -Math.max(...wide.map(([c0], i) => Math.min(r.h, folds[i]) - top[c0])) * k / 2
  // the side's board a hair forward of the block behind it, whose front it would otherwise share
  const side = { ...o, back: back - SIDE_FORWARD }
  // where the art first opens under each step: the escape hatch's band under the step ends there, its legs begin
  const opens = wide.map(([c0, c1]) => Math.min(...art.open.slice(c0, c1)))
  for (const [c0, c1] of runs) {
    const t = top[c0]
    // an empty column beside the run keeps the ink on its outer side, and the empty row above it the ink on its top
    const a = c0 > 0 && top[c0 - 1] < 0 ? c0 - 1 : c0
    const b = c1 < top.length && top[c1] < 0 ? c1 + 1 : c1
    const above = Math.max(0, t - 1)
    // a stray column of the art between steps folds with the nearest step
    let near = 0
    for (let i = 1; i < wide.length; i++) if (gap(wide[i], c0, c1) < gap(wide[near], c0, c1)) near = i
    const fold = Math.min(r.h, folds[near])
    if (fold <= t) {
      out.push(...stand(x, y, [{ r: part(a, b, above, r.h), ox: 0, oy: 0 }], side))
      continue
    }
    // the side under the step: a board a texel thick with its ink, as any upright feature's, and behind it a block
    // of the same texels reaching back under the whole step, whose end between one step and the next is the riser,
    // in the side's own material. The block has no ink: the board's, stretched the block's depth, would lie on the
    // floor and stand beside it as black slabs. Where the art stands on legs to be seen between, the block is only
    // the band down to where the art opens, the legs the board alone.
    if (fold < r.h) out.push(...stand(x, y, [{ r: part(a, b, fold, r.h), ox: 0, oy: 0 }], side))
    const band = solid ? r.h : Math.max(fold, Math.min(r.h, opens[near]))
    if (band > fold) out.push(...stand(x, y, [{ r: part(c0, c1, fold, band), ox: 0, oy: 0 }], { ...o, back, depth: (fold - t) * k, grow: 0 }))
    // the step lies back from the fold, a board at the fold's height
    const up = (r.cell - r.oy - fold) * k
    const oy = r.cell / 2 - back / k - r.oy - fold
    out.push(...stand(x, y, [{ r: part(a, b, above, fold), ox: 0, oy }], { ...o, lie: true, lift: up - LIE_LIFT }))
  }
  return out
}
