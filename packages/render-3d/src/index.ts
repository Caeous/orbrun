import { VM_OFFWEAPON_REST, VM_SHIELD_REST, VM_SIZE, VM_WEAPON_REST, handsFootprint, type HandPose, type HandRect } from './hands.js'
import * as THREE from 'three'
import {
  cellKey,
  dirToYaw,
  keyToXY,
  type Billboard,
  type Camera,
  type CellKey,
  type MapRenderer,
  type Scene,
  type SceneCell,
  type SceneCursor,
  type TileRect,
  type TileSource,
  type HandItem,
  type Viewmodel,
  shadeOf,
  flashOf,
  getCell,
} from '@orbrun/scene'
import { bodyRect, insetFootprint, sceneClassAt, type ClassAt, type FootprintOptions } from './footprint.js'
import { Crowd, type CrowdStats } from './crowd.js'
import { extrudeFaces, runs } from './mesh.js'

/**
 * @orbrun/render-3d
 *
 * First-person three.js renderer of a Scene. Depends only on @orbrun/scene
 * and three. Every classification it needs arrives on the Scene.
 *
 * World mapping: cell (x, y) -> world (x, 0, y). North (-y) is -z. Wall
 * height is 1. The camera stands at eye height 0.65 by default (the
 * `eyeHeight` option moves it).
 */

export interface Render3dOptions {
  /** Field of view in degrees. */
  fov?: number
  /**
   * How high the eye stands, in cells (0 is the floor, 1 the lid). Default
   * EYE; clamped to EYE_MIN..EYE_MAX so it is never in the floor or the lid.
   */
  eyeHeight?: number
  /**
   * Truncated corners (II.1): every convex wall corner is cut off by a
   * diagonal face this far back along each edge, in cells, clamped to half
   * the shorter body edge. Default 1/32 of a cell.
   */
  chamfer?: number
  /**
   * Inset walls (II.1): how far the wall surface stands back from the
   * floor, in cells, one value for the whole level and strictly under 0.5.
   * 0 gives full-cell walls. Default WALL_INSET.
   */
  wallInset?: number
  /**
   * Viewmodel (rendering-3d.md II.7): the wielded weapon and the off-hand
   * item drawn from their item tiles in the lower corners. On by default.
   */
  viewmodel?: boolean
  /**
   * Attack cue: a tiny thrust of the wielded weapon toward the centre on a melee attack. Off under
   * the platform's reduced-motion preference; the hands then never move.
   */
  motion?: boolean
}

// The eye stands EYE up by default; the `eyeHeight` option (the Camera height
// setting) moves it between EYE_MIN and EYE_MAX, clear of floor and lid.
const EYE = 0.65
const EYE_MIN = 0.25
const EYE_MAX = 0.9
// Viewmodel (II.7). The hands sit in their own perspective overlay, framed so
// the view is two units tall at the hands' depth; a full 32-texel icon is
// VM_SIZE units high. Each icon is extruded from its texels into a block
// VM_DEPTH texels thick with shaded sides; the icon's opaque extent is scaled
// to VM_FILL of that so a 12-texel paperdoll shield and a 30-texel sword come
// out about the same size in the hand. A pose is a roll in the icon's plane,
// a pitch of the tip away from the player and a yaw toward the middle of the
// view, applied in that order; the hands are held flat, facing the player. A
// weapon tile is the profile seen from the wielder's outer side, so the
// wielded weapon is turned half a circle and its blade heads up-left from a
// grip low right. A shield is held as drawn.
// VM_SIZE and the rest poses live in hands.ts, so the HUD can ask where the hands stand (`handsFootprint`).
const VM_DEPTH = 2
const VM_FILL = 0.9
const VM_FOV = 40
/** Shade of an extruded block's faces relative to the texel colour: front, top, side, bottom. The hands and the standing sprites share it. */
const BLOCK_SHADE = { front: 1, top: 0.86, side: 0.7, bottom: 0.5 }
/**
 * Standing sprites (monsters, items, doors and statues) are given
 * thickness: behind the front quad every opaque texel is extruded this many
 * texels deep, with the rim of side faces shaded as the hands' are, so a
 * sprite seen from off-centre or from above reads as a slab rather than a
 * sheet of paper. A texel deep and no more: the extrusion is the same texel
 * grid stood up, so a block's sides are square and the rim reads as one texel
 * of depth rather than a smear the eye takes for a second column of art. (The
 * hands are held close and lit in their own overlay, so they keep VM_DEPTH.)
 * The front quad is untouched, so what the sprite shows is exactly what it
 * showed flat. Ghosts, clouds and translucent sprites stay flat: they blend,
 * and a rim behind a blended face doubles up. So do the status badges and the
 * damage bar: they are marks on the sprite.
 */
const BB_DEPTH = 1
/**
 * How far `uvFor` insets a tile's uv rect, in texels, so a sample never
 * reaches the neighbouring tile in the atlas. Whatever is mapped with those
 * uvs must be inset by the same, or the tile is stretched over the quad and
 * what it draws no longer lines up with what is built on the texel grid.
 */
const UV_INSET = 0.25
/** Texel alpha at or above which a texel is opaque, bbMat's alpha test (0.1) in 8 bits. */
const OPAQUE_ALPHA = 26
/**
 * The art's ink: an opaque texel this dark in every channel is the black line
 * crawl draws round a sprite and the shadow it paints at its feet, not the
 * body of the thing.
 */
const INK_LEVEL = 24
/**
 * The ink the eye can reach from outside a sprite is peeled off before the
 * atlas is drawn (`atlasMask`), up to this many texels deep. 2D needs that
 * line to tell a monster from the cell it stands on; in 3D the thing stands in
 * the world, lit and cast on the floor by its own shadow, and the line is a
 * black band round it that gains depth with the block, stands up where the art
 * painted a shadow at its feet, and fills the holes the art leaves. Peeling
 * eats only ink, so a body texel stops it: the eyes, the mouth and the lines
 * drawn inside a sprite are not reachable and stay. Deep enough for the
 * shadow crawl paints at a monster's feet, shallow enough that a sprite drawn
 * in ink all through keeps most of itself.
 */
const INK_PEEL = 4
/** Attack cue: the weapon thrusts this far (view units) toward the centre of the view and settles back over this many seconds. */
const VM_LIFT_S = 0.22
const VM_LIFT = 0.07
/**
 * Inset walls (II.1): the wall surface stands this far back from the floor,
 * in cells (12 texels of 32), leaving a one-thick wall an 8-texel core and
 * a lone wall cell an 8-texel post.
 */
export const WALL_INSET = 12 / 32
/** The four diagonal neighbour offsets. */
/**
 * How tall an upright feature stands, in cells. Stairs stand lower than a
 * door or a statue: they are a mouth in the floor, and a full-height board
 * would hide what walks behind them.
 */
const FIXTURE_H = 0.9
const STAIR_H = 0.7
/**
 * How far an upright feature's board stands back from the middle of its cell,
 * in cells. Actors and items stand at the cell's middle too, and
 * every standing sprite faces the camera, so a board left there is coplanar
 * with whatever stands on it: the two z-fight, and a character on a staircase
 * is sliced by its steps. A sprite's own block deep is enough to put the
 * board behind the whole block, and it is well inside the inset wall face
 * (WALL_INSET), so a fixture against a wall never sinks into it. 2D draws the
 * feature first and the actor over it; this is the same order in depth.
 */
const FIXTURE_BACK = BB_DEPTH / 32
const DIAGONALS: [number, number][] = [[-1, -1], [1, -1], [-1, 1], [1, 1]]
// Ghost pass (rendering-3d.md II.4): anything the 2D client would show on the
// map but the geometry hides shows through as its own sprite, dimmed and
// tinted by what it is, so the 3D view never hides what the server reports.
/**
 * Remembered knowledge reads like the 2D map's dim tiles: nearly solid, told
 * apart by its cool tint and its short fade, not by being washed out. At the
 * 0.6 it started from an item behind a lit wall all but disappeared while the
 * 2D view drew it plainly.
 */
const GHOST_ALPHA = 0.7
/** Status badges are drawn in their own colours, ghost or not. */
const BADGE_TINT = { r: 1, g: 1, b: 1 }
/** Tints for what the server is not showing; anything in view keeps the sprite's own colours. */
const GHOST_TINT = {
  /** Monster on a remembered cell: sensed or detected, not in view. */
  remembered: { r: 0.55, g: 0.6, b: 0.8 },
  item: { r: 0.8, g: 0.8, b: 0.8 },
  projectile: { r: 1, g: 1, b: 1 },
}
/**
 * How far a projectile in flight is lifted off the floor, in cells. The sprite
 * is half a cell tall, so its centre sits at this plus a quarter: low enough
 * to read as leaving the hands rather than the eye at EYE.
 */
const PROJECTILE_LIFT = 0.1
/**
 * Where the cursor sits in the transparent pass. It skips the depth test, so
 * order is all that holds it down: after the level and a sprite's ground
 * shadow (0), before the sprites themselves (1 and up), so whoever stands on
 * the marked cell is drawn over the far arm of the marker instead of under it
 * — the cursor rings the cell rather than the monster's face.
 */
const CURSOR_ORDER = 0.5
/**
 * Where the ghosts draw, ring and body, by kind: the ghosts of what the
 * server shows right now first, ink then body, then remembered knowledge
 * over them, ink then body. Within a kind a ring is never over a body; a
 * remembered hint (its ring included) lies over a visible ghost where the
 * two overlap behind a wall. The crowd is baked in chunks (crowd.ts), and
 * three.js orders their meshes by draw order first, so these hold across
 * chunks exactly as they held when the crowd was one mesh per material
 * drawn in this order.
 */
const GHOST_ORDER = { visible: { ink: -4, body: -3 }, remembered: { ink: -2, body: -1 } }

/** The cursor's ring. */
const CURSOR_COLOUR = 0xff8800
/** The cursor's colour on the level map, where it marks a cell rather than a target. */
const CURSOR_MAP_COLOUR = 0xffffff
/** The shell round the sprite the cursor stands on (`SEL_GROW`, `hullSelMat`). */
const HULL_SEL_COLOUR = 0xffdd33
/**
 * How many texels the selected sprite's shell stands out from its body, against
 * the hull's one. The black hull keeps its texel between the art and the yellow,
 * so the highlight is a line beside the sprite rather than a glow over it.
 */
const SEL_GROW = 2
/**
 * How much deeper than the hull the selected shell's back sits, in texels. The
 * shell is the whole hull grown a texel further, not a ring of the difference,
 * so over the body the two lie in one plane; this puts the black in front,
 * leaving only what the shell adds outside the hull's silhouette showing.
 */
const SEL_BACK = 0.1
/**
 * Ghost fade: a ghost holds full strength until it sits `GHOST_FADE_START`
 * cells behind its occluder, then falls to nothing by `GHOST_FADE`. Sight
 * reaches seven cells, so everything at fighting range reads as a sprite; only
 * what lies deeper thins out, and the whole explored level still does not pile
 * up behind every wall.
 */
const GHOST_FADE_START = 5
const GHOST_FADE = 14
/**
 * The same fade for anything the server currently shows, which is never
 * allowed to disappear: a monster in view can stand at the edge of sight
 * behind the wall hiding it and would fade at the remembered range —
 * invisible in 3D while the 2D view draws it plainly. Over this range it stays
 * readable well past sight, which is what II.4 asks for: the 3D view never
 * hides what the server reports.
 */
const GHOST_FADE_VISIBLE_START = 8
const GHOST_FADE_VISIBLE = 30
/**
 * A ghost of something the server shows right now is drawn at this alpha
 * rather than `GHOST_ALPHA`: sight and memory are the one distinction the
 * ghost pass has to make readable, so what is in view reads as a sprite behind
 * the wall while remembered knowledge stays a hint. Solid, because a wall's
 * edge can cut a sprite between its lit half and its ghost half, and anything
 * short of solid shows as a seam there.
 */
const GHOST_ALPHA_VISIBLE = 1
const SIDE_SHADE = 0.82
/**
 * Ghost depth pass (II.4): the level's depth image is rendered at this
 * fraction of the frame's size. The ghosts fade over cells, not pixels, so a
 * coarser image costs nothing to look at and a quarter of the fill to make.
 */
const GHOST_DEPTH_SCALE = 0.5

/**
 * The layer of everything that never enters the ghosts' depth image: the
 * ghosts themselves (a draw that reads the image it writes is a feedback
 * loop), and whatever writes no depth anyway — the shadow discs, the
 * translucent sprites and clouds, the blended decals. The frame's camera sees
 * both layers; the depth pass sees layer 0 alone, and so skips every one of
 * these meshes without a traversal to hide them and another to show them.
 */
const LAYER_NO_DEPTH = 1

/**
 * The flash field: the colour the game washes a cell in — blue while
 * paralysed, grey while petrified, red while berserk, and while blind the
 * colour of whatever blinded you, thickening with the distance out to the
 * edge of sight. WebTiles' 2D view fills the whole cell with it
 * (cell_renderer.js `render_flash`), so in 3D it belongs to the whole cube and
 * not to the ground alone: every material lays it over its fragment, so the
 * walls, the lid, the sprites standing in the cell and the hands all take it,
 * and what is far off in a blind view is washed out until it can barely be
 * read.
 *
 * The field is sampled by world position and filtered, not stepped cell by
 * cell: a flash that thickens with distance would otherwise band into visible
 * squares across a floor running away from the eye.
 */
const FLASH_PARS = /* glsl */ `
uniform sampler2D flashMap;
uniform vec2 fieldOrigin;
uniform vec2 fieldSize;
varying vec3 vWorldPos;`
const FLASH_VERT_PARS = /* glsl */ `
varying vec3 vWorldPos;`
/** Set `vWorldPos` from the vertex three has already transformed (`transformed`). */
const FLASH_VERT = /* glsl */ `
vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
/**
 * A merged standing mesh (`bakeStanding`): every sprite's vertices are in the
 * sprite's own frame, and `anchor` is where it stands. The vertex shader turns
 * the sprite to the eye's yaw about its anchor and stands it there, so one
 * mesh holds a whole crowd of billboards and still faces the camera as each
 * holder did on its own.
 */
const STAND_VERT_PARS = /* glsl */ `
#ifdef MERGED
attribute vec3 anchor;
uniform float standYaw;
#endif`
/** Rotate `transformed` about y by `standYaw` (three's `makeRotationY`) and put it on its anchor. */
const STAND_VERT = /* glsl */ `
#ifdef MERGED
{
  float c = cos(standYaw), s = sin(standYaw);
  transformed = anchor + vec3(c * transformed.x + s * transformed.z, transformed.y, c * transformed.z - s * transformed.x);
}
#endif`
/**
 * The `cell` attribute a shade-map shader reads its light through (`makeLevelMaterial`),
 * declared where a sprite carries one: a merged sprite does not, its cell is under its
 * anchor (`CELL_VERT`), so a crowd's buffers hold no cell per vertex.
 */
const CELL_VERT_PARS = /* glsl */ `
#ifndef MERGED
attribute vec2 cell;
#endif
varying vec2 vCell;`
/**
 * Set `vCell`: a merged sprite's anchor stands half a cell into its cell (`addStanding`),
 * so its floor is the cell exactly, as the attribute held it; anything else carries the attribute.
 */
const CELL_VERT = /* glsl */ `
#ifdef MERGED
vCell = floor(anchor.xz);
#else
vCell = cell;
#endif`
/** Wash `c` in the flash standing over this fragment. */
function flashApply(c: string): string {
  return /* glsl */ `
{
  vec4 flash = texture2D(flashMap, (vWorldPos.xz - fieldOrigin) / fieldSize);
  ${c}.rgb = mix(${c}.rgb, flash.rgb, flash.a);
}`
}

// The ghost shaders test each fragment against a depth image of the level
// rendered just before the frame. Only fragments that geometry hides pass,
// and their alpha fades with the depth gap to the occluder in front.
const GHOST_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
varying float vViewZ;
#ifdef GHOST_SHADE
${CELL_VERT_PARS}
#endif
${FLASH_VERT_PARS}
${STAND_VERT_PARS}
void main() {
  vUv = uv;
  vColor = color;
#ifdef GHOST_SHADE
${CELL_VERT}
#endif
  vec3 transformed = vec3(position);
  ${STAND_VERT}
  vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
  vViewZ = mv.z;
  gl_Position = projectionMatrix * mv;
}`
const GHOST_FRAG = /* glsl */ `
#include <packing>
uniform sampler2D sceneDepth;
uniform vec2 resolution;
uniform float cameraNear;
uniform float cameraFar;
uniform float fadeStart;
uniform float fadeRange;
uniform float opacity;
#ifdef GHOST_MAP
uniform sampler2D map;
#endif
#ifdef GHOST_SHADE
uniform sampler2D shadeMap;
varying vec2 vCell;
#endif
${FLASH_PARS}
varying vec2 vUv;
varying vec3 vColor;
varying float vViewZ;
void main() {
  float d = texture2D(sceneDepth, gl_FragCoord.xy / resolution).x;
  float occZ = perspectiveDepthToViewZ(d, cameraNear, cameraFar);
  // view Z is negative going away; a nearer occluder has the larger value
  float gap = occZ - vViewZ;
  if (gap <= 0.002) discard;
  float fade = 1.0 - smoothstep(fadeStart, fadeRange, gap);
  vec4 c = vec4(vColor, 1.0);
#ifdef GHOST_SHADE
  // a ghost of something in view is lit as the sprite is: by its cell's entry in the shade map
  c.rgb *= texture2D(shadeMap, (vCell - fieldOrigin + 0.5) / fieldSize).r;
#endif
#ifdef GHOST_MAP
  vec4 t = texture2D(map, vUv);
  if (t.a < 0.1) discard;
  c *= t;
#endif
  gl_FragColor = vec4(c.rgb, c.a * opacity * fade);
${flashApply('gl_FragColor')}
  #include <colorspace_fragment>
}`

interface AtlasEntry {
  /** the tile source's name for it */
  name: string
  texture: THREE.Texture
  width: number
  height: number
  wallMat: THREE.MeshBasicMaterial
  /** Upright features (statues, trees, altars): the level material without the wall's back-face cull. */
  featMat: THREE.MeshBasicMaterial
  /**
   * Translucent decals (the travel-exclusion X): the level material blended
   * instead of alpha-tested, drawn after the level over the floor or wall face
   * it marks, without writing depth.
   */
  decalMat: THREE.MeshBasicMaterial
  /** Ghost pass, remembered knowledge: sprite fragments the level hides, faded by depth gap. */
  ghostMat: THREE.ShaderMaterial
  /** The same for a cell in view: stronger, and over `GHOST_FADE_VISIBLE`, so what the server shows keeps its ghost however deep behind the wall it stands. */
  ghostVisibleMat: THREE.ShaderMaterial
  bbMat: THREE.MeshBasicMaterial
  /** The merged (`MERGED`) twins of `featMat`, `bbMat`, `ghostMat` and `ghostVisibleMat`, for the baked crowd (`bakeStanding`). */
  merged: THREE.Material[]
  /**
   * One byte per texel, 1 where the atlas is opaque, for the rim of a
   * standing sprite's block; undefined until first asked for, null where the
   * atlas's pixels cannot be read (no 2D canvas, an atlas that is not an image).
   */
  mask?: Uint8Array | null
  /**
   * The colour of a texel of the peeled atlas, packed rgba, read from the
   * canvas `atlasMask` drew it into; undefined where the pixels cannot be
   * read. Two rim faces whose texels hold the same colour sample the same
   * thing, so `rimTemplate` builds them as one.
   */
  texel?: (x: number, y: number) => number
}

/**
 * The rim of a standing sprite's block, in texel units relative to the tile's
 * top-left corner (y up, z toward the viewer, the front face at z = 0): the
 * side faces of every opaque texel that border a transparent one, with a
 * texel-centre uv and the face's shade. Built once per tile and clip height,
 * then placed and coloured per sprite.
 */
interface RimTemplate {
  pos: Float32Array
  uv: Float32Array
  shade: Float32Array
  index: number[]
}

/**
 * The outline of a standing sprite's block, in the rim's units: a hull one
 * texel wider than the body on every side, as deep as the block, with a back
 * and sides but no front. Drawn black with its front faces culled, only the
 * faces that turn away from the eye show, and of those only what pokes out
 * past the body's own silhouette — a line a texel wide round the sprite from
 * every angle, crawl's ink put back after `peelInk` took it off the art.
 */
interface HullTemplate {
  pos: Float32Array
  index: number[]
}

/**
 * The same line for the ghost pass (II.4), where a sprite is a flat quad with
 * no block and its shader is the depth test: the ring of texels round the
 * body, one flat face each in the quad's own plane, disjoint from the body
 * so the two never blend over each other. Drawn black with the ghost's own
 * material, it is hidden, faded and cut by the level exactly as the ghost is.
 */
interface RingTemplate {
  pos: Float32Array
  index: number[]
}

/** Which pass a standing sprite belongs to: the lit sprite itself, or a ghost of it behind the geometry (II.4). */
type GhostKind = 'none' | 'remembered' | 'visible'

/**
 * What the selected shell of a standing layer is built from (`syncSelection`):
 * the layer and its clip, the quad it is placed on, and where the layer's mesh
 * stands in its holder. Recorded as the sprite is built, so the cursor landing
 * on it later builds the shell alone and leaves the crowd standing.
 */
interface ShellSource {
  l: SpriteLayer
  hTex: number
  wq: number
  hq: number
  k: number
  room: number
  position: THREE.Vector3
  renderOrder: number
}

/**
 * One billboard of the scene as the renderer stands it (`syncBillboards`): its
 * holders (the sprite, and its ghost when it has one), what its selected
 * shells are built from, and the key of everything it was built from. A scene
 * that carries the same billboard again matches the key and the record stands
 * as it is; one that does not drops it and builds a new one.
 */
interface SpriteRecord {
  key: string
  x: number
  y: number
  holders: THREE.Object3D[]
  shells: ShellSource[]
  /** Where the sprite's holder stands (a projectile is lifted). */
  position: THREE.Vector3
  ghost: boolean
}

/** Work counters the test bed and the regression tests read. Rendering never does. */
export interface RenderStats extends CrowdStats {
  /** Level geometry rebuilt from scratch. */
  levelBuilds: number
  /** Billboard syncs against a scene: the diff itself, whatever it found. */
  crowdSyncs: number
  /** Sprites built (a sprite and its ghost count once). */
  spriteBuilds: number
  /** Sprites dropped. */
  spriteDrops: number
  /** Selected shells rebuilt. */
  selectionBuilds: number
  /** Shade and flash fields repainted. */
  fieldUpdates: number
}

interface SpriteLayer {
  r: TileRect
  a: AtlasEntry
  uv: { u0: number; v0: number; u1: number; v1: number }
  ox: number
  oy: number
  ymax?: number
  /** Overrides the holder's tint for this layer alone (status badges keep their own colours in the ghost pass). */
  tint?: { r: number; g: number; b: number }
  /** Drawn as a flat quad even on a thick sprite: the status badges and damage bar are marks on the sprite, not part of its body. */
  flat?: boolean
}

/** The four corner uvs of a quad in point order: the first point takes (u0, v1). */
function quadUVs(uv: { u0: number; v0: number; u1: number; v1: number }, uvOrder?: number[]): [number, number][] {
  const uvl: [number, number][] = [
    [uv.u0, uv.v1],
    [uv.u1, uv.v1],
    [uv.u1, uv.v0],
    [uv.u0, uv.v0],
  ]
  return (uvOrder || [0, 1, 2, 3]).map((i) => uvl[i])
}

/** A typed array that grows as it is pushed to: the level's vertex streams, written once per rebuild. */
class Stream<T extends Float32Array | Uint32Array> {
  length = 0
  constructor(public array: T) {}
  private room(n: number): T {
    let a = this.array
    if (this.length + n > a.length) {
      let size = a.length * 2
      while (size < this.length + n) size *= 2
      const next = new (a.constructor as new (n: number) => T)(size)
      next.set(a)
      this.array = a = next
    }
    return a
  }
  push2(x: number, y: number): void {
    const a = this.room(2)
    const i = this.length
    a[i] = x
    a[i + 1] = y
    this.length = i + 2
  }
  push3(x: number, y: number, z: number): void {
    const a = this.room(3)
    const i = this.length
    a[i] = x
    a[i + 1] = y
    a[i + 2] = z
    this.length = i + 3
  }
  push1(x: number): void {
    const a = this.room(1)
    a[this.length++] = x
  }
  /** The written part, as an array of its own. */
  take(): T {
    return this.array.slice(0, this.length) as T
  }
}

/**
 * Gathers a level mesh's vertices. The streams are typed arrays written in
 * place: a rebuild of an explored level pushes hundreds of thousands of
 * values, and a number array grown by `push` and copied into a typed array at
 * the end cost more than the geometry it built. A value written to a
 * Float32Array rounds exactly as the copy did, so the buffers are the same.
 */
class GeoBuilder {
  private positions = new Stream(new Float32Array(3 * 256))
  private uvs = new Stream(new Float32Array(2 * 256))
  private colors = new Stream(new Float32Array(3 * 256))
  private cut = new Stream(new Float32Array(256))
  /** Per vertex, the cell whose light it takes: the level shader reads its shade from the shade map (II.9). */
  private cells = new Stream(new Float32Array(2 * 256))
  private indices = new Stream(new Uint32Array(6 * 128))
  private cx = 0
  private cz = 0
  /** The cell the next faces are lit as. */
  at(x: number, z: number): this {
    this.cx = x
    this.cz = z
    return this
  }
  quad(
    p: [number, number, number][],
    uv: { u0: number; v0: number; u1: number; v1: number },
    shade: number,
    tint: { r: number; g: number; b: number },
    uvOrder?: number[],
    /** Wall face: back side culled. */
    cut = false,
  ) {
    this.poly(p, quadUVs(uv, uvOrder), shade, tint, cut)
  }
  /** Polygon with explicit per-vertex uvs: a quad (a triangle when two points coincide), or a larger horizontal outline. */
  poly(
    p: [number, number, number][],
    uv: [number, number][],
    shade: number,
    tint: { r: number; g: number; b: number },
    cut = false,
  ) {
    const base = this.positions.length / 3
    const n = p.length
    const c = cut ? 1 : 0
    const r = shade * tint.r, g = shade * tint.g, b = shade * tint.b
    for (let i = 0; i < n; i++) {
      const q = p[i]
      this.positions.push3(q[0], q[1], q[2])
      this.cut.push1(c)
      this.cells.push2(this.cx, this.cz)
      this.uvs.push2(uv[i][0], uv[i][1])
      this.colors.push3(r, g, b)
    }
    if (n === 4) {
      this.indices.push3(base, base + 1, base + 2)
      this.indices.push3(base, base + 2, base + 3)
    } else for (const [a, b, c] of triangulateXZ(p)) this.indices.push3(base + a, base + b, base + c)
  }
  build(): THREE.BufferGeometry | null {
    if (this.indices.length === 0) return null
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(this.positions.take(), 3))
    g.setAttribute('uv', new THREE.BufferAttribute(this.uvs.take(), 2))
    g.setAttribute('color', new THREE.BufferAttribute(this.colors.take(), 3))
    g.setAttribute('cut', new THREE.BufferAttribute(this.cut.take(), 1))
    g.setAttribute('cell', new THREE.BufferAttribute(this.cells.take(), 2))
    // 16-bit indices while every one fits, as `setIndex` picks for a number array
    const idx = this.indices.take()
    let wide = false
    for (let i = idx.length - 1; i >= 0; --i) if (idx[i] >= 65535) { wide = true; break }
    g.setIndex(new THREE.BufferAttribute(wide ? idx : new Uint16Array(idx), 1))
    return g
  }
}

/**
 * Visit every cell the ground-plane segment from (ax, az) to (bx, bz)
 * touches, in order from the start, until `visit` returns true.
 */
export function gridWalk(ax: number, az: number, bx: number, bz: number, visit: (x: number, z: number, k: CellKey) => boolean | void) {
  let x = Math.floor(ax), z = Math.floor(az)
  const dx = bx - ax, dz = bz - az
  const sx = Math.sign(dx), sz = Math.sign(dz)
  const tdx = dx === 0 ? Infinity : Math.abs(1 / dx)
  const tdz = dz === 0 ? Infinity : Math.abs(1 / dz)
  let tx = dx === 0 ? Infinity : (sx > 0 ? x + 1 - ax : ax - x) / Math.abs(dx)
  let tz = dz === 0 ? Infinity : (sz > 0 ? z + 1 - az : az - z) / Math.abs(dz)
  for (let i = 0; i < 128; i++) {
    if (visit(x, z, cellKey(x, z))) return
    // no boundary left before the end: the segment ends in this cell
    if (tx > 1 && tz > 1) return
    if (tx < tz) { x += sx; tx += tdx } else { z += sz; tz += tdz }
  }
}

/**
 * The open doors that hang in a doorway, and the heading each stands at.
 *
 * A door is a hole in a wall run, and the run tells the door which way it
 * faces: walls east and west of it and the doorway faces north/south (yaw 0,
 * the heading a billboard stands at when the camera looks down -z), walls
 * north and south and it faces east/west. A door with no run to read — a
 * corner, an opening broken through on both axes — has no plane to stand in
 * and is left to face the eye like any other fixture.
 *
 * A closed door is a solid cell and is built as one; only the open ones are
 * here, as their cell is floor with the door tile standing on it.
 */
function framedDoors(scene: Scene): Map<CellKey, number> {
  const solid = (x: number, y: number) => {
    const c = scene.cells.get(cellKey(x, y))
    return !c || c.kind === 'unknown' || c.occluder
  }
  const out = new Map<CellKey, number>()
  for (const c of scene.cells.values()) {
    if (c.feature?.type !== 'door' || c.kind === 'unknown' || c.occluder) continue
    const alongX = solid(c.x - 1, c.y) && solid(c.x + 1, c.y)
    const alongZ = solid(c.x, c.y - 1) && solid(c.x, c.y + 1)
    if (alongX === alongZ) continue
    out.set(cellKey(c.x, c.y), alongX ? 0 : Math.PI / 2)
  }
  return out
}

/** Triangulate a horizontal polygon given as world points, keeping the polygon's own winding. */
function triangulateXZ(p: [number, number, number][]): number[][] {
  const pts = p.map(([px, , pz]) => new THREE.Vector2(px, pz))
  let area = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) area += (pts[j].x - pts[i].x) * (pts[j].y + pts[i].y)
  const tris = THREE.ShapeUtils.triangulateShape(pts, [])
  for (const t of tris) {
    const [a, b, c] = t.map((i) => pts[i])
    const ta = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
    if (ta * area < 0) [t[1], t[2]] = [t[2], t[1]]
  }
  return tris
}

export class Render3d implements MapRenderer {
  private renderer: THREE.WebGLRenderer | null = null
  private three = new THREE.Scene()
  private cam = new THREE.PerspectiveCamera(75, 1, 0.05, 200)
  private tiles: TileSource | null = null
  private scene: Scene | null = null
  private camera: Camera | null = null
  private cursor: SceneCursor | null = null
  private atlases = new Map<string, AtlasEntry>()
  private levelGroup = new THREE.Group()
  private billboardGroup = new THREE.Group()
  private overlayGroup = new THREE.Group()
  private cursorMesh: THREE.Mesh
  private cursorRingMat: THREE.MeshBasicMaterial
  private cursorTileMesh: THREE.Mesh
  private cursorTileId = -1
  private cursorTileMats = new Map<string, THREE.MeshBasicMaterial>()
  private width = 1
  private height = 1
  private opts: Required<Render3dOptions>
  private builtRevision = -1
  /** The layout revision the level geometry stands for, and the tint it was coloured with (Part IV). */
  private builtLayout = -1
  private builtTint = ''
  /** Which upright features were standing when the level was built (`occupiedFeatures`). */
  private builtOccupied = ''
  /** How many ghost sprites the billboards hold: none means no depth pass. */
  private ghostCount = 0
  /** One disc under every actor and item, shared. */
  private shadowGeo = new THREE.CircleGeometry(0.22, 16)
  private shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false })
  /**
   * Every material a standing sprite's mesh may wear, to its `MERGED` twin: the
   * same shading with the yaw applied in the vertex shader, for the meshes
   * `bakeStanding` merges a crowd of holders into. A mesh whose material has no
   * twin here (a cloned translucent one) stays a holder of its own.
   */
  private mergedMats = new Map<THREE.Material, THREE.Material>()
  /** The eye's yaw, read by every merged material to turn its sprites (`STAND_VERT`). */
  private standUniforms = { standYaw: { value: 0 } }
  private bufferSize = new THREE.Vector2()
  /**
   * Shade map (II.9, Part IV): one texel per cell of the level's bounds, the
   * brightness `shadeOf` gives it. The level shader multiplies by it, so a
   * move or a change of sight repaints this small image and leaves the
   * geometry standing.
   */
  private shadeTex: THREE.DataTexture | null = null
  /**
   * Flash field: the same grid again, rgba per cell, the wash the game
   * lays over everything in the cell. Filtered, not stepped, so the thickening
   * of a blind view reads as haze rather than as squares.
   */
  private flashTex: THREE.DataTexture | null = null
  /** The two cell fields and the grid they share: origin and size in cells. */
  private fieldUniforms = {
    shadeMap: { value: null as THREE.Texture | null },
    flashMap: { value: null as THREE.Texture | null },
    fieldOrigin: { value: new THREE.Vector2(0, 0) },
    fieldSize: { value: new THREE.Vector2(1, 1) },
  }
  /** The billboards need syncing for a reason other than a new scene revision (the player's bars changed). */
  private crowdDirty = false
  /** Every billboard standing, by the key it was built from (`syncBillboards`). */
  private records = new Map<string, SpriteRecord>()
  /** The level's tint the records were built under; a new one drops them all. */
  private recordsTint = ''
  /** The baked crowds: the scene's billboards, and the level's upright features (`bakeStanding`). */
  private billboardCrowd: Crowd
  private levelCrowd: Crowd
  /**
   * The standing fixtures by what they are built from (`fixtureKey`). A layout rebuild
   * replaces the level's meshes, but a fixture whose key still holds stands as it was:
   * its holder stays in the crowd, and the chunk's bake finds its slots in place.
   */
  private fixtures = new Map<string, THREE.Object3D>()
  /** The holders wearing the selected shells (`syncSelection`), and the cell they stand on. */
  private selected: THREE.Object3D[] = []
  private selectionDirty = false
  readonly stats: RenderStats = { levelBuilds: 0, crowdSyncs: 0, spriteBuilds: 0, spriteDrops: 0, selectionBuilds: 0, fieldUpdates: 0, chunkBakes: 0, chunkAllocs: 0, bakedVertices: 0, keptVertices: 0 }
  private raycaster = new THREE.Raycaster()
  private pickMeshes: THREE.Mesh[] = []
  private voidMat: THREE.MeshBasicMaterial
  /** Depth image of the level geometry, rendered before each frame for the ghost shaders. */
  private depthTarget: THREE.WebGLRenderTarget | null = null
  private ghostUniforms = {
    sceneDepth: { value: null as THREE.Texture | null },
    resolution: { value: new THREE.Vector2(1, 1) },
    cameraNear: { value: 0.05 },
    cameraFar: { value: 200 },
    fadeStart: { value: GHOST_FADE_START },
    fadeRange: { value: GHOST_FADE },
  }
  /** Viewmodel (II.7): the hands, in their own overlay drawn over the frame. */
  private viewmodel: Viewmodel | null = null
  private vmKey = ''
  private vmBuilt = false
  private vmScene = new THREE.Scene()
  private vmCam = new THREE.PerspectiveCamera(VM_FOV, 1, 0.1, 20)
  private vmHands = { weapon: new THREE.Group(), offhand: new THREE.Group() }
  private vmMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })
  /**
   * The flash over the cell the player stands in, rgba. The hands are
   * drawn in a frame of their own, with no world to read the field at, so they
   * take the one cell that is always under them.
   */
  private vmFlash = { value: new THREE.Vector4(0, 0, 0, 0) }
  /** Extruded icon geometry per item, keyed by its layers. */
  /** A hand's block and the ink round it (`HullTemplate`), per distinct item; null where the icon paints nothing. */
  private vmGeos = new Map<string, { block: THREE.BufferGeometry; hull: THREE.BufferGeometry | null } | null>()
  /** Rim templates of the standing sprites' blocks, by tile and clip height (`rimTemplate`). */
  private rims = new Map<string, RimTemplate | null>()
  private hulls = new Map<string, HullTemplate | null>()
  private rings = new Map<string, RingTemplate | null>()
  /**
   * The vertex arrays of the standing sprites, shared by every sprite built
   * from the same inputs (`sharedAttr`): a crowd of fifty of one tile at one
   * height stands on one set of positions, uvs, colours and indices, where
   * each once carried a copy of its own (its cell is under its anchor, or
   * given to a holder that stands alone: `giveCells`). The arrays are never written after they are built, so a geometry that
   * holds one can be disposed as before: the renderer's buffers are the
   * geometry's, and the array stays for the next sprite. Keyed by everything
   * the array is computed from, and cleared with the templates it derives from.
   */
  private spriteAttrs = new Map<string, THREE.BufferAttribute>()
  /** The ink round a ghost (`RingTemplate`): the ghost material with no map, coloured by the ring's black vertices. */
  private ghostInkMat!: THREE.ShaderMaterial
  private ghostVisibleInkMat!: THREE.ShaderMaterial
  /** The ink round every standing sprite (`HullTemplate`): black, back faces only. */
  private hullMat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide })
  /**
   * The ink round the sprite standing on the cursor's cell. WebTiles picks a
   * cell out with its cursor alone; here the ring under a monster's feet is
   * covered by the monster, so what is examined or targeted says so in its own
   * line instead — the hull's black swapped for HULL_SEL_COLOUR.
   */
  private hullSelMat = new THREE.MeshBasicMaterial({ color: HULL_SEL_COLOUR, side: THREE.BackSide })
  /** The ink on a sprite that does not turn to the eye (an open door): a flat ring (`RingTemplate`) in its plane. */
  private inkMat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide })
  /** Attack lift start, in seconds on the render clock; NaN when at rest. */
  private vmLift = NaN
  /** This frame's attack lift, 0..1 (`liftEnvelope`), or NaN with none running: read once per frame in `render`, so the doll and the hands agree on it. */
  private lift = NaN
  constructor(opts: Render3dOptions = {}) {
    this.ghostInkMat = this.makeGhostMaterial(GHOST_ALPHA)
    this.ghostVisibleInkMat = this.makeGhostMaterial(GHOST_ALPHA_VISIBLE, undefined, { start: GHOST_FADE_VISIBLE_START, range: GHOST_FADE_VISIBLE })
    this.twin(this.ghostInkMat, this.makeGhostMaterial(GHOST_ALPHA, undefined, undefined, true))
    this.twin(this.ghostVisibleInkMat, this.makeGhostMaterial(GHOST_ALPHA_VISIBLE, undefined, { start: GHOST_FADE_VISIBLE_START, range: GHOST_FADE_VISIBLE }, true))
    this.twin(this.hullMat, this.makeStandingMaterial(this.hullMat))
    this.twin(this.hullSelMat, this.makeStandingMaterial(this.hullSelMat))
    this.twin(this.shadowMat, this.makeStandingMaterial(this.shadowMat))
    this.opts = {
      fov: opts.fov ?? 85,
      eyeHeight: opts.eyeHeight ?? EYE,
      chamfer: opts.chamfer ?? 1 / 32,
      wallInset: opts.wallInset ?? WALL_INSET,
      viewmodel: opts.viewmodel ?? true,
      motion: opts.motion ?? true,
    }
    this.cam.fov = this.opts.fov
    this.cam.rotation.order = 'YXZ'
    this.cam.layers.enable(LAYER_NO_DEPTH)
    const twin = (m: THREE.Material) => this.mergedMats.get(m)
    this.billboardCrowd = new Crowd(this.billboardGroup, twin, this.stats)
    this.levelCrowd = new Crowd(this.levelGroup, twin, this.stats)
    this.three.add(this.levelGroup, this.billboardGroup, this.overlayGroup)
    this.three.background = new THREE.Color(0x000000)
    const cur = new THREE.RingGeometry(0.34, 0.46, 4)
    cur.rotateX(-Math.PI / 2)
    this.cursorRingMat = new THREE.MeshBasicMaterial({ color: CURSOR_COLOUR, transparent: true, opacity: 0.95, depthTest: false })
    this.cursorMesh = new THREE.Mesh(cur, this.cursorRingMat)
    this.cursorMesh.renderOrder = CURSOR_ORDER
    this.cursorMesh.visible = false
    this.overlayGroup.add(this.cursorMesh)
    // the WebTiles cursor icon laid flat on the cell; swapped in for the ring when the gamedata has it
    const cq = new THREE.PlaneGeometry(1, 1)
    // +90 about X puts v=1 (the image bottom, flipY off) at the south edge, as the floor decals are
    cq.rotateX(Math.PI / 2)
    this.cursorTileMesh = new THREE.Mesh(cq, this.cursorRingMat)
    this.cursorTileMesh.renderOrder = CURSOR_ORDER
    this.cursorTileMesh.visible = false
    this.overlayGroup.add(this.cursorTileMesh)
    this.voidMat = new THREE.MeshBasicMaterial({ color: 0x000000 })
    this.vmMat.onBeforeCompile = (shader) => {
      shader.uniforms.flash = this.vmFlash
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec4 flash;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, flash.rgb, flash.a);')
    }
    this.vmScene.add(this.vmHands.weapon, this.vmHands.offhand)
    // the overlay frame is two units tall where the hands stand (z = 0)
    this.vmCam.position.z = 1 / Math.tan((VM_FOV * Math.PI) / 360)
  }

  mount(target: HTMLCanvasElement | OffscreenCanvas): void {
    this.renderer = new THREE.WebGLRenderer({ canvas: target as HTMLCanvasElement, antialias: false, alpha: false })
    this.renderer.setClearColor(0x000000, 1)
  }

  /**
   * Level material: the plain textured material, lit by the cell's own entry
   * in the shade map. Wall faces wind toward their open neighbour, so a
   * back-facing one is the far side of the wall and never meant to show; it is
   * culled. Nothing here opens a hole for what stands behind it — a fixture
   * (statue, tree, plant) hides a monster exactly as masonry does, and the
   * ghost pass (II.4) is the one rule that shows it again.
   */
  private makeLevelMaterial(tex: THREE.Texture, feature = false, blended = false, merged = false): THREE.MeshBasicMaterial {
    // Opaque both ways: every fragment is all-or-nothing under the alpha test,
    // so the level takes the opaque pass (front to back, no blending, the
    // depth test rejecting what a nearer wall hides before it is shaded) and
    // writes the depth the ghost pass reads. An upright sprite is seen from
    // either side, so it keeps both faces and a sprite-sized alpha test.
    // A blended decal keeps its texels' alpha instead: it is see-through art
    // laid on geometry already drawn, so it neither needs nor writes depth of its own.
    const m = blended
      ? new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, transparent: true, alphaTest: 0.02, depthWrite: false, side: THREE.DoubleSide })
      : new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, alphaTest: feature ? 0.1 : 0.5, side: THREE.DoubleSide })
    if (feature) m.defines = { UPRIGHT_SPRITE: '' }
    if (merged) m.defines = { ...m.defines, MERGED: '' }
    const fu = this.fieldUniforms
    const su = this.standUniforms
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, fu, su)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nattribute float cut;\nvarying float vCut;${CELL_VERT_PARS}${FLASH_VERT_PARS}${STAND_VERT_PARS}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>${STAND_VERT}`)
        .replace('#include <project_vertex>', `#include <project_vertex>\nvCut = cut;${CELL_VERT}${FLASH_VERT}`)
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform sampler2D shadeMap;
varying float vCut;
varying vec2 vCell;
${FLASH_PARS}`,
        )
        .replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
#ifndef UPRIGHT_SPRITE
// Wall faces wind toward their open neighbour, so a back-facing one is the far
// side of the wall; it is never meant to show. Cull it.
if (vCut > 0.5 && !gl_FrontFacing) discard;
#endif`,
        )
        // the cell's light comes from the shade map, stepped cell by cell (`vCell`),
        // and the vertex colour carries the tint and the face's own shade; the flash
        // over it is a smooth field, read at the fragment's own place in the world
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
diffuseColor.rgb *= texture2D(shadeMap, (vCell - fieldOrigin + 0.5) / fieldSize).r;${flashApply('diffuseColor')}`,
        )
    }
    return m
  }

  /**
   * Billboard material: a sprite takes its light from its cell's entry in the
   * shade map, as the level does (`CELL_VERT`), so a move that relights
   * the crowd repaints that small image and leaves every sprite's geometry
   * standing; its vertex colour carries the tint and the face's own shade.
   * The flash field washes it as it does everything in the cell — a monster
   * standing in a cell the game has washed blue is washed with it, as it is
   * in the 2D view. (A cloned copy — a cloud, a translucent sprite — keeps
   * none of this shader: it is lit by its vertex colour alone.)
   */
  private makeBillboardMaterial(tex: THREE.Texture, merged = false): THREE.MeshBasicMaterial {
    const m = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide, depthWrite: true })
    if (merged) m.defines = { MERGED: '' }
    const fu = this.fieldUniforms
    const su = this.standUniforms
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, fu, su)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>${CELL_VERT_PARS}${FLASH_VERT_PARS}${STAND_VERT_PARS}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>${STAND_VERT}`)
        .replace('#include <project_vertex>', `#include <project_vertex>${CELL_VERT}${FLASH_VERT}`)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nuniform sampler2D shadeMap;\nvarying vec2 vCell;\n${FLASH_PARS}`)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
diffuseColor.rgb *= texture2D(shadeMap, (vCell - fieldOrigin + 0.5) / fieldSize).r;${flashApply('diffuseColor')}`,
        )
    }
    return m
  }

  /**
   * Repaint the cell fields for this scene: a texel per cell over the bounds
   * (and one cell around them, for the void columns the level builds there).
   * The shade map holds `shadeOf` in 8 bits, stepped per cell; a cell outside
   * the map is full bright, as it was when the shade was a vertex colour. The
   * flash map holds `flashOf` as rgba, filtered smooth, and carries the flash
   * colour into every texel — including the unwashed ones, whose alpha is
   * zero: a texel left black there would filter into a dark fringe around the
   * edge of the wash.
   */
  private updateFields(scene: Scene) {
    this.stats.fieldUpdates++
    const b = scene.bounds
    const ox = b.left - 1, oz = b.top - 1
    const w = Math.max(1, b.right - b.left + 3)
    const h = Math.max(1, b.bottom - b.top + 3)
    let shade = this.shadeTex
    let flash = this.flashTex
    if (!shade || !flash || shade.image.width !== w || shade.image.height !== h) {
      shade?.dispose()
      flash?.dispose()
      shade = this.shadeTex = new THREE.DataTexture(new Uint8Array(w * h), w, h, THREE.RedFormat, THREE.UnsignedByteType)
      shade.magFilter = THREE.NearestFilter
      shade.minFilter = THREE.NearestFilter
      shade.generateMipmaps = false
      // one byte per texel: rows are not padded to four
      shade.unpackAlignment = 1
      flash = this.flashTex = new THREE.DataTexture(new Uint8Array(w * h * 4), w, h, THREE.RGBAFormat, THREE.UnsignedByteType)
      flash.magFilter = THREE.LinearFilter
      flash.minFilter = THREE.LinearFilter
      flash.generateMipmaps = false
      this.fieldUniforms.shadeMap.value = shade
      this.fieldUniforms.flashMap.value = flash
      this.fieldUniforms.fieldSize.value.set(w, h)
    }
    this.fieldUniforms.fieldOrigin.value.set(ox, oz)
    const sd = shade.image.data as Uint8Array
    const fd = flash.image.data as Uint8Array
    // the colour the wash is in, for the texels it does not reach: one flash
    // covers the view, so the first cell wearing one speaks for all of them
    let hue = { r: 0, g: 0, b: 0 }
    for (const cell of scene.cells.values()) {
      if (!cell.flash || cell.flash.a <= 0) continue
      hue = { r: cell.flash.r, g: cell.flash.g, b: cell.flash.b }
      break
    }
    // every texel starts as a cell the map does not know (full bright, the hue unflashed), and the
    // cells it does know write over theirs: a walk over the cells, not over the field's every texel
    sd.fill(255)
    for (let i = 0; i < w * h; i++) {
      fd[i * 4] = hue.r
      fd[i * 4 + 1] = hue.g
      fd[i * 4 + 2] = hue.b
      fd[i * 4 + 3] = 0
    }
    for (const cell of scene.cells.values()) {
      const x = cell.x - ox, z = cell.y - oz
      if (x < 0 || x >= w || z < 0 || z >= h) continue
      const i = z * w + x
      sd[i] = Math.round(shadeOf(cell, scene) * 255)
      const f = cell.flash
      if (f?.a) {
        fd[i * 4] = f.r
        fd[i * 4 + 1] = f.g
        fd[i * 4 + 2] = f.b
        fd[i * 4 + 3] = Math.min(255, f.a)
      }
    }
    shade.needsUpdate = true
    flash.needsUpdate = true
  }

  /** Footprint options for the inset walls of II.1. */
  private fo(): FootprintOptions {
    return { inset: this.opts.wallInset }
  }

  /** Register `merged` as the `MERGED` twin of `mat` (`mergedMats`), and hand it back. */
  private twin<M extends THREE.Material>(mat: THREE.Material, merged: M): M {
    this.mergedMats.set(mat, merged)
    return merged
  }

  /**
   * The `MERGED` twin of a plain material (the hull inks, the shadow disc): the
   * same colour and faces, with the standing yaw applied in the vertex shader.
   */
  private makeStandingMaterial(of: THREE.MeshBasicMaterial): THREE.MeshBasicMaterial {
    const m = of.clone()
    m.defines = { MERGED: '' }
    const su = this.standUniforms
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, su)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>${STAND_VERT_PARS}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>${STAND_VERT}`)
    }
    return m
  }

  private makeGhostMaterial(opacity: number, map?: THREE.Texture, fade?: { start: number; range: number }, merged = false, shade = false): THREE.ShaderMaterial {
    // the shared uniforms are the same objects in every ghost material (one depth image, one camera);
    // a material with its own fade takes uniforms of its own for that alone
    // the ghost lays the flash over itself like every other material, and reads it from the shared field uniforms
    const u: Record<string, THREE.IUniform> = { ...this.ghostUniforms, ...this.fieldUniforms, ...this.standUniforms, opacity: { value: opacity } }
    if (fade) {
      u.fadeStart = { value: fade.start }
      u.fadeRange = { value: fade.range }
    }
    if (map) u.map = { value: map }
    const defines: Record<string, string> = {}
    if (map) defines.GHOST_MAP = ''
    if (merged) defines.MERGED = ''
    // a ghost of what is in view is lit as the sprite is, from the shade map; remembered knowledge keeps its own tint unlit
    if (shade) defines.GHOST_SHADE = ''
    return new THREE.ShaderMaterial({
      uniforms: u,
      defines,
      vertexShader: GHOST_VERT,
      fragmentShader: GHOST_FRAG,
      vertexColors: true,
      transparent: true,
      side: THREE.DoubleSide,
      // the shader is the depth test; it compares against the level's depth image
      depthTest: false,
      depthWrite: false,
    })
  }

  /**
   * Render the frame's occluders into the depth image the ghost shaders
   * sample: the level, and the sprites that stand in it. A plant or a statue
   * hides a monster as surely as a wall does, so it belongs in this image —
   * that is what lets one rule (II.4) cover everything the geometry hides.
   * The overlays (the cursor) are left out, and so are the ghosts
   * themselves: they sample this very depth texture, and a sprite that reads
   * the image it is being drawn into is a framebuffer feedback loop, which
   * GL refuses (`GL_INVALID_OPERATION` on the draw call).
   */
  /**
   * Render the frame's occluders into the depth image the ghost shaders
   * sample: the level, and the sprites that stand in it. A plant or a statue
   * hides a monster as surely as a wall does, so it belongs in this image —
   * that is what lets one rule (II.4) cover everything the geometry hides.
   * The overlays (the cursor) are left out, and so is everything on
   * `LAYER_NO_DEPTH`: the ghosts themselves, since a sprite that reads the
   * image it is being drawn into is a framebuffer feedback loop, which GL
   * refuses (`GL_INVALID_OPERATION` on the draw call), and the shadows,
   * decals and translucent sprites, which write no depth and so would only
   * cost their draw calls here.
   */
  private renderOccluderDepth(r: THREE.WebGLRenderer) {
    const size = r.getDrawingBufferSize(this.bufferSize)
    const w = Math.max(1, Math.ceil(size.x * GHOST_DEPTH_SCALE))
    const h = Math.max(1, Math.ceil(size.y * GHOST_DEPTH_SCALE))
    let rt = this.depthTarget
    if (!rt || rt.width !== w || rt.height !== h) {
      rt?.dispose()
      const depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType)
      rt = this.depthTarget = new THREE.WebGLRenderTarget(w, h, { depthTexture, depthBuffer: true, stencilBuffer: false })
      this.ghostUniforms.sceneDepth.value = depthTexture
    }
    // the ghost shader maps its own fragment coordinate, in frame pixels, onto the image
    this.ghostUniforms.resolution.value.set(Math.max(1, size.x), Math.max(1, size.y))
    this.ghostUniforms.cameraNear.value = this.cam.near
    this.ghostUniforms.cameraFar.value = this.cam.far
    const prevTarget = r.getRenderTarget()
    const overlaysWere = this.overlayGroup.visible
    this.overlayGroup.visible = false
    const layersWere = this.cam.layers.mask
    this.cam.layers.set(0)
    r.setRenderTarget(rt)
    r.clear()
    r.render(this.three, this.cam)
    r.setRenderTarget(prevTarget)
    this.cam.layers.mask = layersWere
    this.overlayGroup.visible = overlaysWere
  }

  setOptions(opts: Render3dOptions) {
    Object.assign(this.opts, opts)
    this.cam.fov = this.opts.fov
    this.cam.updateProjectionMatrix()
    this.builtRevision = -1
    this.builtLayout = -1
  }

  setTiles(tiles: TileSource): void {
    this.tiles = tiles
    for (const a of this.atlases.values()) {
      a.texture.dispose()
      a.wallMat.dispose()
      a.featMat.dispose()
      a.decalMat.dispose()
      a.ghostMat.dispose()
      a.ghostVisibleMat.dispose()
      a.bbMat.dispose()
      for (const m of a.merged) m.dispose()
      for (const m of [a.featMat, a.bbMat, a.ghostMat, a.ghostVisibleMat]) this.mergedMats.delete(m)
    }
    this.atlases.clear()
    this.rims.clear()
    this.hulls.clear()
    this.rings.clear()
    this.spriteAttrs.clear()
    for (const g of this.vmGeos.values()) {
      g?.block.dispose()
      g?.hull?.dispose()
    }
    this.vmGeos.clear()
    this.vmBuilt = false
    // the cursor's icon was a copy of an atlas that is gone
    for (const m of this.cursorTileMats.values()) {
      m.map?.dispose()
      m.dispose()
    }
    this.cursorTileMats.clear()
    this.cursorTileId = -1
    // every sprite standing, and every fixture, was built from the old atlases
    this.dropRecords()
    this.dropFixtures()
    this.builtRevision = -1
    this.builtLayout = -1
  }

  /** Drop every standing billboard and its selection; the next sync builds the crowd afresh. */
  private dropRecords() {
    for (const rec of this.records.values()) this.dropRecord(rec)
    this.records.clear()
    // nothing stands: the chunks' meshes and the shells go too, rather than waiting for a bake to find them empty
    this.billboardCrowd.clear()
    this.clearSelection()
    this.ghostCount = 0
    this.selectionDirty = true
  }

  private atlas(name: string): AtlasEntry | null {
    let a = this.atlases.get(name)
    if (a) return a
    const img = this.tiles?.atlas(name)
    if (!img) return null
    const tex = new THREE.Texture(img as HTMLImageElement)
    tex.magFilter = THREE.NearestFilter
    tex.minFilter = THREE.NearestFilter
    tex.generateMipmaps = false
    tex.colorSpace = THREE.SRGBColorSpace
    tex.flipY = false
    tex.needsUpdate = true
    const w = (img as { width: number }).width
    const h = (img as { height: number }).height
    a = {
      name,
      texture: tex,
      width: w,
      height: h,
      wallMat: this.makeLevelMaterial(tex),
      featMat: this.makeLevelMaterial(tex, true),
      decalMat: this.makeLevelMaterial(tex, false, true),
      bbMat: this.makeBillboardMaterial(tex),
      // A fragment draws only where the level's depth image is nearer, i.e.
      // exactly the part of the sprite the geometry hides, fading with the
      // depth gap. Fully visible sprites produce nothing.
      ghostMat: this.makeGhostMaterial(GHOST_ALPHA, tex),
      ghostVisibleMat: this.makeGhostMaterial(GHOST_ALPHA_VISIBLE, tex, { start: GHOST_FADE_VISIBLE_START, range: GHOST_FADE_VISIBLE }, false, true),
      merged: [],
    }
    a.merged = [
      this.twin(a.featMat, this.makeLevelMaterial(tex, true, false, true)),
      this.twin(a.bbMat, this.makeBillboardMaterial(tex, true)),
      this.twin(a.ghostMat, this.makeGhostMaterial(GHOST_ALPHA, tex, undefined, true)),
      this.twin(a.ghostVisibleMat, this.makeGhostMaterial(GHOST_ALPHA_VISIBLE, tex, { start: GHOST_FADE_VISIBLE_START, range: GHOST_FADE_VISIBLE }, true, true)),
    ]
    this.atlases.set(name, a)
    return a
  }

  setScene(scene: Scene): void {
    this.scene = scene
  }
  setCamera(cam: Camera): void {
    this.camera = cam
  }
  setCursor(cursor: SceneCursor | null): void {
    // the sprite on the cursor's cell wears the highlight ink (`hullSelMat`): a cursor that
    // moves between cells rebuilds that shell alone (`syncSelection`), never the crowd
    const before = this.cursor ? `${this.cursor.x},${this.cursor.y}` : ''
    this.cursor = cursor
    if ((cursor ? `${cursor.x},${cursor.y}` : '') !== before) this.selectionDirty = true
  }
  /** What the hands hold. The overlay rebuilds only when the items change. */
  setViewmodel(vm: Viewmodel | null): void {
    this.viewmodel = vm
    const key = vm ? JSON.stringify([vm.weapon?.layers, vm.offhand?.layers]) : ''
    if (key !== this.vmKey) {
      this.vmKey = key
      this.vmBuilt = false
    }
  }
  /** A melee attack: the wielded weapon thrusts a touch toward the centre and settles back. */
  attack(): void {
    if (!this.opts.motion) return
    this.vmLift = nowSeconds()
  }
  /** True while the attack lift is running, so the host keeps rendering frames. */
  get animating(): boolean {
    return !Number.isNaN(this.vmLift)
  }
  resize(width: number, height: number, dpr: number): void {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    if (this.renderer) {
      this.renderer.setPixelRatio(dpr)
      this.renderer.setSize(this.width, this.height, false)
    }
    this.cam.aspect = this.width / this.height
    this.cam.updateProjectionMatrix()
    this.vmCam.aspect = this.cam.aspect
    this.vmCam.updateProjectionMatrix()
  }
  /**
   * Release everything this renderer owns: the level's and the crowd's
   * geometry, the atlases and every material made from them, the fields, the
   * depth image, the cursor's and the bars' materials, the hands. The scene's
   * `Scene` and the tiles are the caller's and are left alone. Safe to call
   * again: a second call finds nothing left to release.
   */
  destroy(): void {
    this.dropRecords()
    this.clearSelection()
    this.billboardCrowd.clear()
    this.levelCrowd.clear()
    this.fixtures.clear()
    for (const child of [...this.levelGroup.children]) {
      this.levelGroup.remove(child)
      child.traverse((o) => (o as THREE.Mesh).geometry?.dispose())
    }
    for (const child of [...this.billboardGroup.children]) this.billboardGroup.remove(child)
    this.pickMeshes = []
    for (const g of this.vmGeos.values()) {
      g?.block.dispose()
      g?.hull?.dispose()
    }
    this.vmGeos.clear()
    this.vmBuilt = false
    for (const hand of [this.vmHands.weapon, this.vmHands.offhand]) hand.clear()
    this.rims.clear()
    this.hulls.clear()
    this.rings.clear()
    this.spriteAttrs.clear()
    for (const a of this.atlases.values()) {
      a.texture.dispose()
      for (const m of [a.wallMat, a.featMat, a.decalMat, a.ghostMat, a.ghostVisibleMat, a.bbMat, ...a.merged]) m.dispose()
    }
    this.atlases.clear()
    for (const m of this.cursorTileMats.values()) {
      m.map?.dispose()
      m.dispose()
    }
    this.cursorTileMats.clear()
    this.cursorTileId = -1
    this.cursorMesh.geometry.dispose()
    this.cursorTileMesh.geometry.dispose()
    this.cursorRingMat.dispose()
    this.vmMat.dispose()
    this.voidMat.dispose()
    this.hullMat.dispose()
    this.hullSelMat.dispose()
    this.inkMat.dispose()
    this.ghostInkMat.dispose()
    this.ghostVisibleInkMat.dispose()
    for (const m of this.mergedMats.values()) m.dispose()
    this.mergedMats.clear()
    this.depthTarget?.dispose()
    this.depthTarget = null
    this.ghostUniforms.sceneDepth.value = null
    this.shadeTex?.dispose()
    this.shadeTex = null
    this.flashTex?.dispose()
    this.flashTex = null
    this.fieldUniforms.shadeMap.value = null
    this.fieldUniforms.flashMap.value = null
    this.shadowGeo.dispose()
    this.shadowMat.dispose()
    this.renderer?.dispose()
    this.renderer = null
    this.builtRevision = -1
    this.builtLayout = -1
  }

  /**
   * The lens after the last frame, for the HUD's edge pips (apps/orbrun
   * pips.ts): the vertical half-angle, the aspect, the view's pixel height
   * (so a pip can be drawn the size the sprite would have been) and cell
   * centres in the camera's own space, so what the pips call "off screen" is
   * exactly what this frame did not draw, mid-turn or at rest.
   */
  projector(): { tanHalfY: number; aspect: number; height: number; toCamera(x: number, y: number, h: number): { x: number; y: number; z: number } } {
    const cam = this.cam
    cam.updateMatrixWorld()
    const inv = cam.matrixWorld.clone().invert()
    const v = new THREE.Vector3()
    return {
      tanHalfY: Math.tan((cam.fov * Math.PI) / 360),
      aspect: cam.aspect,
      height: this.height,
      toCamera: (x, y, h) => {
        v.set(x + 0.5, h, y + 0.5).applyMatrix4(inv)
        return { x: v.x, y: v.y, z: v.z }
      },
    }
  }

  pick(px: number, py: number): CellKey | null {
    if (!this.renderer || !this.scene) return null
    const ndc = new THREE.Vector2((px / this.width) * 2 - 1, -(py / this.height) * 2 + 1)
    this.raycaster.setFromCamera(ndc, this.cam)
    const hits = this.raycaster.intersectObjects(this.pickMeshes, false)
    if (!hits.length) return null
    const p = hits[0].point
    return cellKey(Math.floor(p.x), Math.floor(p.z))
  }

  // -------------------------------------------------------------------------

  private uvFor(rect: TileRect, a: AtlasEntry) {
    const e = UV_INSET
    return {
      u0: (rect.sx + e) / a.width,
      v0: (rect.sy + e) / a.height,
      u1: (rect.sx + rect.w - e) / a.width,
      v1: (rect.sy + rect.h - e) / a.height,
    }
  }

  /** A billboard's light: baked into its vertex colours, since billboards are rebuilt with every scene anyway. */
  private shadeFor(cell: SceneCell | undefined, scene: Scene): number {
    return shadeOf(cell, scene)
  }

  /** Cursor (WebTiles icon or ring) on its cell. */
  private placeCursor() {
    const cur = this.cursor
    if (!cur) {
      this.cursorMesh.visible = this.cursorTileMesh.visible = false
      return
    }
    // the cursor marks a cell, not a wall cap: it lies on the ground even when the cell is solid
    // (its materials skip the depth test, so it shows through the wall at eye level, though a
    // sprite on the cell still covers it, CURSOR_ORDER)
    const h = 0
    const rect = cur.tile !== undefined && this.tiles ? this.tiles.tile(cur.tile) : undefined
    const a = rect ? this.atlas(rect.atlas) : null
    if (rect && a) {
      if (this.cursorTileId !== cur.tile) {
        this.cursorTileId = cur.tile!
        let mat = this.cursorTileMats.get(rect.atlas)
        if (!mat) {
          mat = new THREE.MeshBasicMaterial({ map: a.texture.clone(), transparent: true, alphaTest: 0.1, depthTest: false, side: THREE.DoubleSide })
          this.cursorTileMats.set(rect.atlas, mat)
        }
        // the icon's rect in the atlas, as a repeat/offset on a copy of the texture
        const uv = this.uvFor(rect, a)
        const tex = mat.map!
        tex.offset.set(uv.u0, uv.v0)
        tex.repeat.set(uv.u1 - uv.u0, uv.v1 - uv.v0)
        this.cursorTileMesh.material = mat
      }
      this.cursorTileMesh.visible = true
      this.cursorMesh.visible = false
      this.cursorTileMesh.position.set(cur.x + 0.5, h + 0.012, cur.y + 0.5)
    } else {
      this.cursorTileMesh.visible = false
      this.cursorMesh.visible = true
      this.cursorRingMat.color.set(cur.mode === 'map' ? CURSOR_MAP_COLOUR : CURSOR_COLOUR)
      this.cursorMesh.position.set(cur.x + 0.5, h + 0.012, cur.y + 0.5)
    }
  }

  /**
   * The cells with an upright feature that something stands on. A board in
   * such a cell is a board through whoever stands there: however the two are
   * ordered in depth, a staircase's steps and its black outline run across a
   * monster and the pair read as one jumble. Those features lie back down on
   * the floor instead — the answer first person already gives for the cell
   * underfoot — and what the player sees is 2D's own order, the feature under
   * the actor. Clouds and things in flight pass over a cell rather than stand
   * on it, and leave its feature standing.
   *
   * In first person the cell underfoot counts too, whether or not the doll is
   * among the billboards: the camera sits in the middle of that sprite. A step
   * onto or off such a cell is the only way a move changes the level's
   * geometry, so this set is what a move rebuilds on, not the layout revision.
   */
  private occupiedFeatures(scene: Scene): Set<CellKey> {
    const out = new Set<CellKey>()
    const upright = (k: CellKey) => {
      const c = scene.cells.get(k)
      return c?.stance === 'upright' && c.featureTile !== undefined
    }
    for (const b of scene.billboards) {
      if (b.kind === 'cloud' || b.kind === 'projectile') continue
      const k = cellKey(b.x, b.y)
      if (upright(k)) out.add(k)
    }
    if (scene.playerOnLevel) {
      const k = cellKey(scene.player.x, scene.player.y)
      if (upright(k)) out.add(k)
    }
    return out
  }

  private rebuildLevel(scene: Scene) {
    this.stats.levelBuilds++
    // the level's own meshes go; the fixtures (`fixtures`) and the crowd's baked meshes stand until the loop below says otherwise
    for (const child of [...this.levelGroup.children]) {
      if (!child.userData.level) continue
      this.levelGroup.remove(child)
      ;(child as THREE.Mesh).geometry.dispose()
    }
    this.pickMeshes = []
    const tiles = this.tiles
    if (!tiles) {
      this.dropFixtures()
      return
    }
    const fo = this.fo()
    const framed = framedDoors(scene)
    // A framed door's cell counts as wall for the footprint rule: the wall run
    // it is set into keeps its full thickness up to the doorway instead of
    // stepping back by the inset on either side, so the opening is exactly the
    // cell wide and the door's own board fills it. Without this the run recedes
    // WALL_INSET each way and the door hangs in the middle of a gap wider than
    // itself. What is left either side is a reveal the corridor's own cells
    // still chamfer back, so the doorway splays out into the room it opens on.
    const base = sceneClassAt(scene)
    const classAt: ClassAt = (x, z) => (framed.has(cellKey(x, z)) ? 'wall' : base(x, z))
    const builders = new Map<string, GeoBuilder>()
    const decalBuilders = new Map<string, GeoBuilder>()
    const voids = new GeoBuilder()
    const tint = scene.level.tint
    const get = (name: string) => {
      let b = builders.get(name)
      if (!b) builders.set(name, (b = new GeoBuilder()))
      return b
    }
    /** The blended builder for a translucent decal (SceneCell.translucent), else the level's. */
    const getDecal = (name: string, cell: SceneCell, id: number) => {
      if (!cell.translucent?.includes(id)) return get(name)
      let b = decalBuilders.get(name)
      if (!b) decalBuilders.set(name, (b = new GeoBuilder()))
      return b
    }
    // a tile's rect and uvs are looked up once per rebuild: every floor cell asks for its tile, and a level has far more cells than tiles
    const tileCache = new Map<number, { r: TileRect; a: AtlasEntry; uv: ReturnType<Render3d['uvFor']> } | null>()
    const tileOf = (id: number) => {
      let t = tileCache.get(id)
      if (t !== undefined) return t
      const r = tiles.tile(id)
      const a = r ? this.atlas(r.atlas) : null
      t = r && a ? { r, a, uv: this.uvFor(r, a) } : null
      tileCache.set(id, t)
      return t
    }
    const levelCeiling = scene.level.ceilingTile !== null ? tileOf(scene.level.ceilingTile) : null
    const ceilingCache = new Map<number, ReturnType<typeof tileOf>>()
    /** The lid over an open cell: its own nearby-wall tile, else the level's. */
    const ceilingOf = (c: SceneCell | undefined) => {
      if (scene.level.sky !== 'none') return null
      if (!c || c.ceilingTile === undefined) return levelCeiling
      let t = ceilingCache.get(c.ceilingTile)
      if (t === undefined) ceilingCache.set(c.ceilingTile, (t = tileOf(c.ceilingTile)))
      return t
    }
    /**
     * Whether a cell's feature stands as a billboard here. Upright features do
     * — except the one underfoot, where the camera sits in the middle of the
     * sprite, and any a monster or an item stands on:
     * there the tile lies back down on the floor, so a staircase you or a
     * centaur are standing on still reads as one.
     */
    const occupied = this.occupiedFeatures(scene)
    const stands = (c: SceneCell) => c.stance === 'upright' && !occupied.has(cellKey(c.x, c.y))
    const heightOfFeature = (c: SceneCell) => (c.feature?.type === 'stairs' ? STAIR_H : FIXTURE_H)
    const isSolid = (c: SceneCell | undefined) => !c || c.kind === 'unknown' || c.occluder
    const isVoidCell = (c: SceneCell | undefined) => !c || c.kind === 'unknown'

    // iterate over bounds so void columns bordering known space exist
    const b = scene.bounds
    for (let y = b.top - 1; y <= b.bottom + 1; y++) {
      for (let x = b.left - 1; x <= b.right + 1; x++) {
        const k = cellKey(x, y)
        const cell = scene.cells.get(k)
        const solid = isSolid(cell)
        const n = scene.cells.get(cellKey(x, y - 1))
        const s = scene.cells.get(cellKey(x, y + 1))
        const w = scene.cells.get(cellKey(x - 1, y))
        const e = scene.cells.get(cellKey(x + 1, y))
        if (!solid && cell) {
          // floor; the cell's light comes from the shade map, the vertex colour is the tint
          const ft = tileOf(cell.floorTile)
          if (ft) get(ft.r.atlas).at(x, y).quad([[x, 0, y + 1], [x + 1, 0, y + 1], [x + 1, 0, y], [x, 0, y]], ft.uv, 1, tint)
          // ground decals, bottom up: underlays, decal feature, overlays, badges.
          // A decal's rect is trimmed to its opaque texels (shores, blood, badges),
          // so it covers only its own patch of the cell, at its ox/oy, as in 2D.
          const decal = (id: number, lift: number) => {
            const ot = tileOf(id)
            if (!ot) return
            const c = ot.r.cell
            const x0 = x + ot.r.ox / c, x1 = x + (ot.r.ox + ot.r.w) / c
            const z0 = y + ot.r.oy / c, z1 = y + (ot.r.oy + ot.r.h) / c
            getDecal(ot.r.atlas, cell, id).at(x, y).quad([[x0, lift, z1], [x1, lift, z1], [x1, lift, z0], [x0, lift, z0]], ot.uv, 1, tint)
          }
          if (cell.underlays) for (const o of cell.underlays) decal(o, 0.002)
          if (cell.featureTile !== undefined && !stands(cell)) decal(cell.featureTile, 0.004)
          // not the wall shadows: the walls here are geometry, and 2D's shadow
          // gradient at the cell edge would read as a grout line beside an inset wall.
          // Not the shorelines either: a one-texel wave line laid flat is a scratch at eye height.
          if (cell.overlays)
            for (const o of cell.overlays) if (!cell.wallShadows?.includes(o) && !cell.shorelines?.includes(o)) decal(o, 0.006)
          if (cell.icons) for (const o of cell.icons) decal(o, 0.008)
          // ceiling
          const ceiling = ceilingOf(cell)
          if (ceiling) get(ceiling.r.atlas).at(x, y).quad([[x, 1, y], [x + 1, 1, y], [x + 1, 1, y + 1], [x, 1, y + 1]], ceiling.uv, 0.75, tint)
          continue
        }
        // solid: wall, door or void. The body is the footprint of II.1
        // (inset walls): the cell minus the floor grown by the inset, so it
        // meets every neighbour flush. Faces come from the footprint; corner
        // chamfers and the patches of floor and lid that continue under and
        // over the removed parts are added here.
        const isVoid = isVoidCell(cell)
        const openN = !isSolid(n)
        const openS = !isSolid(s)
        const openW = !isSolid(w)
        const openE = !isSolid(e)
        // a void cell with nothing open around it, diagonals included, shows nothing
        if (isVoid && !(openN || openS || openW || openE) && DIAGONALS.every(([dx, dz]) => isSolid(scene.cells.get(cellKey(x + dx, y + dz))))) continue
        const fp = insetFootprint(classAt, x, y, fo)
        const rect = bodyRect(classAt, x, y, fo)
        if (!rect || fp.poly.length === 0) continue
        const wt = !isVoid && cell?.wallTile !== undefined ? tileOf(cell.wallTile) : null
        const black = isVoid || !wt
        const lerp = (a: number, b: number, t: number) => a + (b - a) * t
        type Dir = 'n' | 's' | 'w' | 'e'
        const across: Record<Dir, { other: SceneCell | undefined; ok: CellKey; side: boolean }> = {
          n: { other: n, ok: cellKey(x, y - 1), side: true },
          s: { other: s, ok: cellKey(x, y + 1), side: true },
          w: { other: w, ok: cellKey(x - 1, y), side: false },
          e: { other: e, ok: cellKey(x + 1, y), side: false },
        }
        // A face is parametrised by t0..t1 along its edge (x for N/S, z for
        // W/E), its depth in from the cell edge it faces away from, and the
        // height it starts at.
        const facePoints = (d: Dir, t0: number, t1: number, depth: number, y0: number, y1 = 1): [number, number, number][] => {
          switch (d) {
            case 'n': { const z = y + depth; return [[x + t1, y0, z], [x + t0, y0, z], [x + t0, y1, z], [x + t1, y1, z]] }
            case 's': { const z = y + 1 - depth; return [[x + t0, y0, z], [x + t1, y0, z], [x + t1, y1, z], [x + t0, y1, z]] }
            case 'w': { const px = x + depth; return [[px, y0, y + t0], [px, y0, y + t1], [px, y1, y + t1], [px, y1, y + t0]] }
            case 'e': { const px = x + 1 - depth; return [[px, y0, y + t1], [px, y0, y + t0], [px, y1, y + t0], [px, y1, y + t1]] }
          }
        }
        // u range for a face segment: the first quad point takes u0. N and E
        // faces run against t (the viewer's left is +x for N, +z for E). The
        // tile stays anchored to the cell, so a run of cells tiles continuously.
        const faceU = (d: Dir, uv: { u0: number; u1: number }, t0: number, t1: number) =>
          d === 'n' || d === 'e'
            ? { u0: lerp(uv.u0, uv.u1, 1 - t1), u1: lerp(uv.u0, uv.u1, 1 - t0) }
            : { u0: lerp(uv.u0, uv.u1, t0), u1: lerp(uv.u0, uv.u1, t1) }
        // Convex body corners: both cell sides meeting there are open.
        // Indexed nw, ne, sw, se (bit 0 east, bit 1 south). Each is chamfered
        // by the global depth, void in black, clamped to half the shorter
        // body edge so two on one edge never cross and a post keeps a face.
        const maxNotch = Math.min(rect.x1 - rect.x0, rect.z1 - rect.z0) / 2
        const notch = this.opts.chamfer > 0 && maxNotch > 1e-6
        const cornerOn = [notch && openN && openW, notch && openN && openE, notch && openS && openW, notch && openS && openE]
        const cornerPt = (i: number): [number, number] => [i & 1 ? rect.x1 : rect.x0, i >> 1 ? rect.z1 : rect.z0]
        // corner depths (nw, ne, sw, se) in cells, 0 for a square corner
        const Nv: [number, number, number, number] = [0, 0, 0, 0]
        for (let i = 0; i < 4; i++) if (cornerOn[i]) Nv[i] = Math.min(this.opts.chamfer, maxNotch)
        const emitFace = (d: Dir, t0: number, t1: number, depth: number, y0: number) => {
          const p = facePoints(d, t0, t1, depth, y0)
          const faceShade = across[d].side ? 1 : SIDE_SHADE
          if (black) {
            voids.quad(p, { u0: 0, v0: 0, u1: 1, v1: 1 }, 0, { r: 0, g: 0, b: 0 })
            return
          }
          // the tile stretched from y0..1
          const uv = { ...wt.uv, ...faceU(d, wt.uv, t0, t1) }
          uv.v1 = wt.uv.v1 - (wt.uv.v1 - wt.uv.v0) * y0
          get(wt.r.atlas).at(x, y).quad(p, uv, faceShade, tint, undefined, true)
          // decals on the face (blood, silence), pushed a hair off the
          // masonry. A decal's rect is trimmed to its opaque texels and sits
          // at its ox/oy in the tile, so it covers only that patch of the
          // face, clipped to this segment; the face's u runs against t on N
          // and E (see faceU).
          if (cell?.wallOverlays) {
            const nx = d === 'w' ? -0.003 : d === 'e' ? 0.003 : 0
            const nz = d === 'n' ? -0.003 : d === 's' ? 0.003 : 0
            const flip = d === 'n' || d === 'e'
            for (const o of cell.wallOverlays) {
              const ot = tileOf(o)
              if (!ot) continue
              const c = ot.r.cell
              const fx0 = ot.r.ox / c, fx1 = (ot.r.ox + ot.r.w) / c
              const fy0 = 1 - (ot.r.oy + ot.r.h) / c, fy1 = 1 - ot.r.oy / c
              const tA = Math.max(t0, flip ? 1 - fx1 : fx0), tB = Math.min(t1, flip ? 1 - fx0 : fx1)
              const yA = Math.max(y0, fy0), yB = Math.min(1, fy1)
              if (tB - tA < 1e-6 || yB - yA < 1e-6) continue
              const fu = (tx: number) => lerp(ot.uv.u0, ot.uv.u1, (tx - fx0) / (fx1 - fx0))
              const fv = (wy: number) => lerp(ot.uv.v0, ot.uv.v1, (1 - wy - ot.r.oy / c) / (ot.r.h / c))
              const ouv = { u0: fu(flip ? 1 - tB : tA), u1: fu(flip ? 1 - tA : tB), v0: fv(yB), v1: fv(yA) }
              const pd = facePoints(d, tA, tB, depth, yA, yB).map(([px, py, pz]) => [px + nx, py, pz + nz] as [number, number, number])
              getDecal(ot.r.atlas, cell, o).at(x, y).quad(pd, ouv, faceShade, tint, undefined, true)
            }
          }
        }
        for (const f of fp.faces) {
          const d: Dir = f.nz < -0.5 ? 'n' : f.nz > 0.5 ? 's' : f.nx < -0.5 ? 'w' : 'e'
          const horizontal = d === 'n' || d === 's'
          let t0 = horizontal ? Math.min(f.a[0], f.b[0]) : Math.min(f.a[1], f.b[1])
          let t1 = horizontal ? Math.max(f.a[0], f.b[0]) : Math.max(f.a[1], f.b[1])
          const depth = d === 'n' ? f.a[1] : d === 's' ? 1 - f.a[1] : d === 'w' ? f.a[0] : 1 - f.a[0]
          // A boundary the neighbour's body covers shows nothing between two walls of one height. Across a
          // framed door it is the reveal: the door's cell counts as wall for the footprint rule (`classAt`)
          // so the run keeps its thickness up to the doorway, but the cell is floor, and the run's cut end
          // stands open to it from the floor up, on either side of the board that hangs in the middle.
          if (f.covered && !framed.has(across[d].ok)) continue
          const y0 = 0
          // a notched corner at either end of the face shortens it
          for (let i = 0; i < 4; i++) {
            if (!cornerOn[i] || Nv[i] === 0) continue
            const [cx, cz] = cornerPt(i)
            if (horizontal ? Math.abs(cz - f.a[1]) > 1e-9 : Math.abs(cx - f.a[0]) > 1e-9) continue
            const at = horizontal ? cx : cz
            if (Math.abs(at - t0) < 1e-9) t0 = Math.min(t1, t0 + Nv[i])
            else if (Math.abs(at - t1) < 1e-9) t1 = Math.max(t0, t1 - Nv[i])
          }
          emitFace(d, t0, t1, depth, y0)
        }
        // Horizontal patches of the cell in local [0,1]^2 (fx along x, fz
        // along z): the floor of the open cell across the edge continues
        // under what the inset removed, its lid over it.
        const floorUV = (uv: { u0: number; v0: number; u1: number; v1: number }, fx: number, fz: number): [number, number] => [lerp(uv.u0, uv.u1, fx), lerp(uv.v0, uv.v1, fz)]
        const ceilUV = (uv: { u0: number; v0: number; u1: number; v1: number }, fx: number, fz: number): [number, number] => [lerp(uv.u0, uv.u1, fx), lerp(uv.v1, uv.v0, fz)]
        // horizontal polygon at height py; `pts` wound to face up (counter-clockwise on the map), reversed for a lid
        const flat = (gb: GeoBuilder, py: number, pts: [number, number][], uvOf: (fx: number, fz: number) => [number, number], up: boolean, sh: number) => {
          const q = up ? pts : [...pts].reverse()
          gb.poly(
            q.map(([fx, fz]) => [x + fx, py, y + fz] as [number, number, number]),
            q.map(([fx, fz]) => uvOf(fx, fz)),
            sh,
            tint,
          )
        }
        const patch = (pts: [number, number][], other: SceneCell | undefined) => {
          // lit as the cell the floor continues from
          const lx = other ? other.x : x, lz = other ? other.y : y
          const ft = other && other.floorTile !== undefined ? tileOf(other.floorTile) : null
          if (ft) flat(get(ft.r.atlas).at(lx, lz), 0, pts, (fx, fz) => floorUV(ft.uv, fx, fz), true, 1)
          const ceiling = ceilingOf(other)
          if (ceiling) flat(get(ceiling.r.atlas).at(lx, lz), 1, pts, (fx, fz) => ceilUV(ceiling.uv, fx, fz), false, 0.75)
        }
        const { x0, x1, z0, z1, t } = rect
        if (openN) patch([[0, z0], [1, z0], [1, 0], [0, 0]], n)
        if (openS) patch([[0, 1], [1, 1], [1, z1], [0, z1]], s)
        if (openW) patch([[0, z1], [x0, z1], [x0, z0], [0, z0]], w)
        if (openE) patch([[x1, z1], [1, z1], [1, z0], [x1, z0]], e)
        // corner cuts: the diagonal cell's floor continues in
        const diag = (i: number) => scene.cells.get(cellKey(x + (i & 1 ? 1 : -1), y + (i >> 1 ? 1 : -1)))
        if (rect.cut[0]) patch([[0, t], [t, t], [t, 0], [0, 0]], diag(0))
        if (rect.cut[1]) patch([[1 - t, t], [1, t], [1, 0], [1 - t, 0]], diag(1))
        if (rect.cut[2]) patch([[0, 1], [t, 1], [t, 1 - t], [0, 1 - t]], diag(2))
        if (rect.cut[3]) patch([[1 - t, 1], [1, 1], [1, 1 - t], [1 - t, 1 - t]], diag(3))
        // notched corners: the chamfer face and the triangle it frees
        for (let i = 0; i < 4; i++) {
          if (!cornerOn[i] || Nv[i] === 0) continue
          const N = Nv[i]
          const [cx, cz] = cornerPt(i)
          const sx = i & 1 ? -1 : 1, sz = i >> 1 ? -1 : 1
          // A on the N/S edge, B on the W/E edge, C the cut-off corner
          const A: [number, number] = [cx + sx * N, cz]
          const Bp: [number, number] = [cx, cz + sz * N]
          const C: [number, number] = [cx, cz]
          // chamfer face: normal points out of the corner
          const [p0, p1] = (i & 1) === i >> 1 ? [A, Bp] : [Bp, A]
          const ch: [number, number, number][] = [
            [x + p0[0], 0, y + p0[1]],
            [x + p1[0], 0, y + p1[1]],
            [x + p1[0], 1, y + p1[1]],
            [x + p0[0], 1, y + p0[1]],
          ]
          const chShade = (1 + SIDE_SHADE) / 2
          const nsDir: Dir = i >> 1 ? 's' : 'n'
          const u = black ? null : faceU(nsDir, wt.uv, Math.min(C[0], A[0]), Math.max(C[0], A[0]))
          if (black || !u) {
            voids.quad(ch, { u0: 0, v0: 0, u1: 1, v1: 1 }, 0, { r: 0, g: 0, b: 0 })
          } else {
            get(wt.r.atlas).at(x, y).quad(ch, { ...wt.uv, ...u }, chShade, tint, undefined, true)
          }
          // the cut-off triangle: floor continues in from the cell across the N/S edge, the lid covers it
          const tri: [number, number][] = (i & 1) === i >> 1 ? [C, A, Bp, Bp] : [C, Bp, A, A]
          patch(tri, i >> 1 ? s : n)
        }
      }
    }
    for (const [name, gb] of builders) {
      const geo = gb.build()
      if (!geo) continue
      const a = this.atlas(name)
      if (!a) continue
      const mesh = new THREE.Mesh(geo, a.wallMat)
      mesh.userData.level = true
      this.levelGroup.add(mesh)
      this.pickMeshes.push(mesh)
    }
    // translucent decals after the level, blended over the faces they mark
    for (const [name, gb] of decalBuilders) {
      const geo = gb.build()
      if (!geo) continue
      const a = this.atlas(name)
      if (!a) continue
      const mesh = new THREE.Mesh(geo, a.decalMat)
      mesh.userData.level = true
      mesh.renderOrder = 1
      mesh.layers.set(LAYER_NO_DEPTH)
      this.levelGroup.add(mesh)
    }
    const vg = voids.build()
    if (vg) {
      const mesh = new THREE.Mesh(vg, this.voidMat)
      mesh.userData.level = true
      this.levelGroup.add(mesh)
    }
    // Upright features stand as billboards built with the level. One whose key still holds
    // (the same tile on the same cell, at the same height, heading and tint) is left standing;
    // the rest are built, and whatever stood that the level no longer asks for comes down.
    const tintKey = `${tint.r},${tint.g},${tint.b}`
    const wanted = new Set<string>()
    for (const cell of scene.cells.values()) {
      if (cell.kind === 'unknown' || cell.occluder) continue
      if (cell.featureTile === undefined || !stands(cell)) continue
      const ft = tileOf(cell.featureTile)
      if (!ft) continue
      const doorYaw = framed.get(cellKey(cell.x, cell.y))
      const key = `${cell.x},${cell.y}|${cell.featureTile}|${doorYaw ?? ''}|${doorYaw !== undefined ? 1 : heightOfFeature(cell)}|${tintKey}`
      wanted.add(key)
      if (this.fixtures.has(key)) continue
      // An open door hangs in its doorway, not on the eye: its cell is a hole
      // in a wall run, and a board that turns with the camera pulls the leaves
      // and their arch off the two walls they are set into — from any angle but
      // head-on the frame floats free of the opening. Squared to the wall it
      // fills the gap, full height like the closed door's block, and needs no
      // FIXTURE_BACK: it is in the wall plane, not in the way of what walks
      // through it.
      const yaw = doorYaw
      if (yaw !== undefined) {
        const door = this.addStanding(this.levelGroup, cell.x, cell.y, [{ ...ft, ox: 0, oy: 0 }], 1, 1, tint, true, 'none', true, 0, yaw)
        this.giveCells(door, cell.x, cell.y)
        this.fixtures.set(key, door)
        continue
      }
      // a fixture takes its light from the shade map (featMat), so its vertex colour is the tint alone;
      // it stands FIXTURE_BACK back, so whatever stands on the cell reads in front of it rather than through it
      const h = this.addStanding(this.levelGroup, cell.x, cell.y, [{ ...ft, ox: 0, oy: 0 }], heightOfFeature(cell), 1, tint, true, 'none', true, FIXTURE_BACK)
      this.fixtures.set(key, h)
      if (this.levelCrowd.mergeable(h)) this.levelCrowd.add(h, cell.x, cell.y)
      else this.giveCells(h, cell.x, cell.y)
    }
    for (const [key, h] of this.fixtures) {
      if (wanted.has(key)) continue
      this.fixtures.delete(key)
      this.dropFixture(h)
    }
    // every chunk is baked again, its holders taken back to front from where the eye stands at this
    // rebuild, as they always were; a holder whose slot is unchanged costs the bake nothing (crowd.ts `write`)
    this.levelCrowd.invalidate()
  }

  /** Take a fixture down: out of the crowd or the group, its geometry released. */
  private dropFixture(h: THREE.Object3D) {
    this.levelCrowd.remove(h)
    if (h.parent === this.levelGroup) this.levelGroup.remove(h)
    h.traverse((o) => (o as THREE.Mesh).geometry?.dispose())
  }

  /** Every fixture down and the crowd's meshes with them: the next rebuild builds them afresh. */
  private dropFixtures() {
    for (const h of this.fixtures.values()) this.dropFixture(h)
    this.fixtures.clear()
    this.levelCrowd.clear()
  }

  private addStanding(
    group: THREE.Group,
    x: number,
    y: number,
    layers: SpriteLayer[],
    height: number,
    shade: number,
    tint: { r: number; g: number; b: number },
    fixed: boolean,
    ghost: GhostKind = 'none',
    thick = ghost === 'none',
    /** How far the whole sprite stands back from the cell's middle, away from the eye (FIXTURE_BACK). */
    back = 0,
    /** A heading to stand at instead of turning with the camera (an open door in its wall run). */
    yaw?: number,
    /** Filled with what each layer's selected shell (`SEL_GROW`) is built from, for when the cursor lands on the sprite. */
    shells?: ShellSource[],
  ): THREE.Object3D {
    const holder = new THREE.Group()
    holder.position.set(x + 0.5, 0, y + 0.5)
    const scale = height
    let i = 0
    for (const l of layers) {
      const cell = l.r.cell
      let hTex = l.r.h
      let v1 = l.uv.v1
      if (l.ymax !== undefined && l.ymax < l.r.oy + l.r.h) {
        hTex = Math.max(0, l.ymax - l.r.oy)
        v1 = (l.r.sy + hTex - 0.25) / l.a.height
      }
      if (hTex <= 0) continue
      const wq = (l.r.w / cell) * scale
      const hq = (hTex / cell) * scale
      const cx = ((l.r.ox + (l.ox || 0) + l.r.w / 2 - cell / 2) / cell) * scale
      const bottom = ((cell - (l.r.oy + (l.oy || 0) + hTex)) / cell) * scale
      const lt = l.tint || tint
      const solid = thick && !l.flat
      const geo = this.standingGeometry(l, hTex, v1, wq, hq, scale / cell, { r: shade * lt.r, g: shade * lt.g, b: shade * lt.b }, solid, yaw !== undefined)
      const mesh = new THREE.Mesh(geo, ghost === 'visible' ? l.a.ghostVisibleMat : ghost === 'remembered' ? l.a.ghostMat : fixed ? l.a.featMat : l.a.bbMat)
      mesh.position.set(cx, bottom + hq / 2, i * 0.002 - back)
      // ghosts draw before every sprite so a nearer billboard paints over them
      mesh.renderOrder = ghost === 'none' ? 1 + i : GHOST_ORDER[ghost].body
      if (ghost !== 'none') mesh.layers.set(LAYER_NO_DEPTH)
      // a ghost's ink is a flat ring in its plane (`RingTemplate`), drawn before the bodies of its kind (GHOST_ORDER)
      // so that no ring of that kind lies over a body of it, whatever chunk (crowd.ts) either stands in
      const ring = ghost !== 'none' && !l.flat ? this.ringGeometry(l, hTex, wq, hq, scale / cell) : null
      if (ring) {
        const ink = new THREE.Mesh(ring, ghost === 'visible' ? this.ghostVisibleInkMat : this.ghostInkMat)
        ink.position.copy(mesh.position)
        ink.renderOrder = GHOST_ORDER[ghost as Exclude<GhostKind, 'none'>].ink
        ink.layers.set(LAYER_NO_DEPTH)
        ink.userData.hull = true
        holder.add(ink)
      }
      holder.add(mesh)
      // The ink round the block (`HullTemplate`), in the block's own frame; a badge or a bar has no block and no
      // line. A sprite that stands at a heading instead of turning to the eye (an open door in its wall run) is
      // seen from every angle, edge-on as the player walks through it, and there a hull is no line but a band:
      // its back face swings out from the board by the block's depth in parallax, and a texel wider than the
      // cell it pokes into the masonry either side and is cut to ribbons against it. Its ink is the flat ring
      // instead — the art's own line, in the board's plane, drawn on it from any side.
      // The board is stretched a wall inset each way into the run, so the tile's edge columns lie on the reveal
      // faces either side of the doorway: ink there straddles the masonry and shows as a torn black strip up
      // the wall. The door's ring keeps off those columns.
      const hull = !solid ? null : yaw === undefined ? this.hullGeometry(l, hTex, wq, hq, scale / cell) : this.ringGeometry(l, hTex, wq, hq, scale / cell, true)
      if (hull) {
        const ink = new THREE.Mesh(hull, yaw === undefined ? this.hullMat : this.inkMat)
        ink.position.copy(mesh.position)
        ink.renderOrder = mesh.renderOrder
        ink.userData.hull = true
        holder.add(ink)
      }
      // The shell round the sprite the cursor stands on (`syncSelection`): the same hull grown SEL_GROW
      // texels instead of one, so what shows outside the black is a second line of ink beside it —
      // the sprite picked out where the ring on the cell is hidden under the sprite itself.
      // A sprite that stands at a heading is inked with a flat ring, which has no shell.
      // the shell may only grow below the art as far as the sprite stands off the ground: `bottom` is
      // where the tile's last row sits, and below that is the floor
      if (shells && solid && yaw === undefined) {
        const room = Math.max(0, Math.min(SEL_GROW - 1, Math.round((bottom / scale) * cell)))
        shells.push({ l, hTex, wq, hq, k: scale / cell, room, position: mesh.position.clone(), renderOrder: mesh.renderOrder })
      }
      i++
    }
    if (yaw !== undefined) holder.rotation.y = yaw
    holder.userData.billboard = yaw === undefined
    holder.userData.fixedFacing = fixed
    group.add(holder)
    return holder
  }

  /**
   * One standing layer's geometry: the front quad (the four corners first, in
   * PlaneGeometry's order, with the tile's uvs), and behind it, where the
   * atlas's pixels can be read, the rim of a block `BB_DEPTH` texels deep.
   * The vertex colour carries the sprite's light and tint times the face's
   * shade. The cell the sprite stands in, which the shade-map shaders light it
   * by, is not here: a baked sprite's is under its anchor (`CELL_VERT`), and a
   * holder that stands on its own is given one (`giveCells`). `k` is the world
   * size of a texel.
   */
  private standingGeometry(
    l: SpriteLayer,
    hTex: number,
    v1: number,
    wq: number,
    hq: number,
    k: number,
    c: { r: number; g: number; b: number },
    thick: boolean,
    /** Leave out the rim faces on the tile's own boundary (a board set into a wall run, see `rimTemplate`). */
    offEdges = false,
  ): THREE.BufferGeometry {
    const rim = thick ? this.rimTemplate(l, hTex, offEdges) : null
    const nRim = rim ? rim.pos.length / 3 : 0
    const n = 4 + nRim
    const hw = wq / 2, hh = hq / 2
    // The uvs are inset a quarter texel (`uvFor`), so the quad they are mapped across is inset by the same:
    // stretched over the whole tile instead, the art is drawn a shade larger than the tile it came from and
    // every texel boundary drifts outward, away from the rim, which stands on the texel grid itself. On a
    // sprite two texels wide — a tail, a chain — that drift is a quarter of its width and it comes off its block.
    const e = UV_INSET * k
    const qw = hw - e, qh = hh - e
    // what the arrays are computed from: the block's shape (the rim's key, or a flat quad), and per array its own inputs
    const shape = rim ? this.rimKey(l, hTex, offEdges) : 'flat'
    const pos = this.sharedAttr(`sp|${shape}|${wq},${hq},${k}`, 3, () => {
      const pos = new Float32Array(n * 3)
      pos.set([-qw, qh, 0, qw, qh, 0, -qw, -qh, 0, qw, -qh, 0])
      if (rim) {
        for (let i = 0; i < nRim; i++) {
          pos[(4 + i) * 3] = -hw + rim.pos[i * 3] * k
          pos[(4 + i) * 3 + 1] = hh + rim.pos[i * 3 + 1] * k
          pos[(4 + i) * 3 + 2] = rim.pos[i * 3 + 2] * k
        }
      }
      return pos
    })
    const uv = this.sharedAttr(`su|${shape}|${l.uv.u0},${l.uv.v0},${l.uv.u1},${v1}`, 2, () => {
      const uv = new Float32Array(n * 2)
      uv.set([l.uv.u0, l.uv.v0, l.uv.u1, l.uv.v0, l.uv.u0, v1, l.uv.u1, v1])
      if (rim) uv.set(rim.uv, 8)
      return uv
    })
    const col = this.sharedAttr(`sc|${shape}|${c.r},${c.g},${c.b}`, 3, () => {
      const col = new Float32Array(n * 3)
      for (let j = 0; j < n; j++) {
        const f = j < 4 ? BLOCK_SHADE.front : rim!.shade[j - 4]
        col[j * 3] = c.r * f
        col[j * 3 + 1] = c.g * f
        col[j * 3 + 2] = c.b * f
      }
      return col
    })
    const index = this.sharedIndex(`si|${shape}`, () => {
      const index = [0, 2, 1, 2, 3, 1]
      if (rim) for (const i of rim.index) index.push(4 + i)
      return index
    })
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', pos)
    geo.setAttribute('uv', uv)
    geo.setAttribute('color', col)
    geo.setIndex(index)
    return geo
  }

  /**
   * Give a holder that stands on its own — the doll, an open door in its wall
   * run, a sprite wearing a material of its own — the `cell` attribute its
   * shade-map shaders read (`CELL_VERT`): every vertex of each of its layers
   * is on cell (x, y). A baked holder needs none, its cell is under its
   * anchor, and the crowd's buffers carry none. The layers are the meshes with
   * uvs; the inks and the shared shadow disc have no cell to read.
   */
  private giveCells(h: THREE.Object3D, x: number, y: number): void {
    for (const c of h.children) {
      const m = c as THREE.Mesh
      if (m.userData.shared || !m.geometry || !m.geometry.getAttribute('uv')) continue
      const n = m.geometry.getAttribute('position').count
      const cells = new Float32Array(n * 2)
      for (let j = 0; j < n; j++) {
        cells[j * 2] = x
        cells[j * 2 + 1] = y
      }
      m.geometry.setAttribute('cell', new THREE.BufferAttribute(cells, 2))
    }
  }

  /** The shared vertex array under `key` (`spriteAttrs`), built by `make` the first time it is asked for. */
  private sharedAttr(key: string, itemSize: number, make: () => Float32Array): THREE.BufferAttribute {
    let a = this.spriteAttrs.get(key)
    if (!a) this.spriteAttrs.set(key, (a = new THREE.BufferAttribute(make(), itemSize)))
    return a
  }

  /** The shared index under `key`: 16-bit while every index fits, as `setIndex` picks for a number array. */
  private sharedIndex(key: string, make: () => number[]): THREE.BufferAttribute {
    let a = this.spriteAttrs.get(key)
    if (!a) {
      const index = make()
      let wide = false
      for (let i = 0; i < index.length; i++) if (index[i] >= 65535) { wide = true; break }
      this.spriteAttrs.set(key, (a = new THREE.BufferAttribute(wide ? new Uint32Array(index) : new Uint16Array(index), 1)))
    }
    return a
  }

  /**
   * The hull's geometry placed on the same quad the rim is (`standingGeometry`); null where
   * there is no rim to line. `grow` wider than a texel is the selected sprite's shell, which
   * also sits SEL_BACK deeper so the hull inside it paints over the part they share.
   */
  private hullGeometry(l: SpriteLayer, hTex: number, wq: number, hq: number, k: number, grow = 1, down = grow - 1): THREE.BufferGeometry | null {
    const t = this.hullTemplate(l, hTex, grow, down)
    if (!t) return null
    const shape = this.hullKey(l, hTex, grow, down)
    const pos = this.sharedAttr(`hp|${shape}|${wq},${hq},${k}`, 3, () => {
      const n = t.pos.length / 3
      const pos = new Float32Array(n * 3)
      const hw = wq / 2, hh = hq / 2
      for (let i = 0; i < n; i++) {
        pos[i * 3] = -hw + t.pos[i * 3] * k
        pos[i * 3 + 1] = hh + t.pos[i * 3 + 1] * k
        pos[i * 3 + 2] = (t.pos[i * 3 + 2] - (grow > 1 ? SEL_BACK : 0)) * k
      }
      return pos
    })
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', pos)
    geo.setIndex(this.sharedIndex(`hi|${shape}`, () => t.index))
    return geo
  }

  /** The ring's geometry placed on the same quad the ghost is; null where the atlas's pixels cannot be read. */
  private ringGeometry(l: SpriteLayer, hTex: number, wq: number, hq: number, k: number, offEdges = false): THREE.BufferGeometry | null {
    const t = this.ringTemplate(l, hTex, offEdges)
    if (!t) return null
    const n = t.pos.length / 3
    const shape = this.rimKey(l, hTex, offEdges)
    const pos = this.sharedAttr(`rp|${shape}|${wq},${hq},${k}`, 3, () => {
      const pos = new Float32Array(n * 3)
      const hw = wq / 2, hh = hq / 2
      for (let i = 0; i < n; i++) {
        pos[i * 3] = -hw + t.pos[i * 3] * k
        pos[i * 3 + 1] = hh + t.pos[i * 3 + 1] * k
        pos[i * 3 + 2] = 0
      }
      return pos
    })
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', pos)
    // the ghost shader reads its colour from the vertices: the ink is black
    geo.setAttribute('color', this.sharedAttr(`rc|${n}`, 3, () => new Float32Array(n * 3)))
    geo.setIndex(this.sharedIndex(`ri|${shape}`, () => t.index))
    return geo
  }

  /** What a rim and a ring are built from: the tile's rect in its atlas, the clip height, and whether the edge faces are left out. */
  private rimKey(l: SpriteLayer, hTex: number, offEdges: boolean): string {
    return `${l.r.atlas}:${l.r.sx},${l.r.sy},${l.r.w},${hTex}${offEdges ? ':off' : ''}`
  }

  /** What a hull is built from: the rim's inputs, and how far out and down it grows. */
  private hullKey(l: SpriteLayer, hTex: number, grow: number, down: number): string {
    return `${l.r.atlas}:${l.r.sx},${l.r.sy},${l.r.w},${hTex},${grow},${down}`
  }

  /**
   * The ring of texels round this tile's body (`RingTemplate`), from the
   * cache: the hull's footprint less the body, flat. `offEdges` leaves the
   * tile's first and last columns out of it (a board set into a wall run).
   */
  private ringTemplate(l: SpriteLayer, hTex: number, offEdges = false): RingTemplate | null {
    const mask = this.atlasMask(l.a)
    if (!mask) return null
    const { sx, sy, w } = l.r
    const key = this.rimKey(l, hTex, offEdges)
    let t = this.rings.get(key)
    if (t !== undefined) return t
    const aw = l.a.width
    const body = (tx: number, ty: number) => tx >= 0 && ty >= 0 && tx < w && ty < hTex && mask[(sy + ty) * aw + sx + tx] === 1
    const tx0 = offEdges ? 1 : 0, tx1 = offEdges ? w - 1 : w
    const ring = (tx: number, ty: number) => !body(tx, ty) && (body(tx - 1, ty) || body(tx + 1, ty) || body(tx, ty - 1) || body(tx, ty + 1))
    // one flat face per run of ring texels rather than one per texel (mesh.ts): the same black, the same coverage
    const pos: number[] = []
    const index: number[] = []
    for (const f of extrudeFaces(ring, tx0, tx1, 0, hTex, 0, 0, { back: false, front: true }, false)) {
      const base = pos.length / 3
      pos.push(...f)
      index.push(base, base + 1, base + 2, base, base + 2, base + 3)
    }
    t = index.length ? { pos: new Float32Array(pos), index } : null
    this.rings.set(key, t)
    return t
  }

  /**
   * The hull round this tile's block (`HullTemplate`), from the cache. The
   * body grown a texel on each of its four sides, kept inside the tile — the
   * art's own line never left it — and built like the rim: the back at
   * BB_DEPTH and a side wherever a texel of the hull borders one outside it,
   * every face wound outward. No front: from the front it would be culled
   * anyway, and from behind (an open door, which stands in its wall and can
   * be walked round) it would paint over the art at the same depth.
   * `grow` is how many texels out it reaches — one for the ink, SEL_GROW for
   * the shell round the sprite the cursor stands on — and `down` how many of
   * those it may take below the tile, which is the sprite's own base: a
   * standing sprite's art runs to the bottom of its rect, so a shell that grew
   * there would lie under the floor and come back as a torn fringe where it
   * fights the floor for the same depth.
   */
  private hullTemplate(l: SpriteLayer, hTex: number, grow = 1, down = grow - 1): HullTemplate | null {
    const mask = this.atlasMask(l.a)
    if (!mask) return null
    const { sx, sy, w } = l.r
    const key = this.hullKey(l, hTex, grow, down)
    let t = this.hulls.get(key)
    if (t !== undefined) return t
    const aw = l.a.width
    const body = (tx: number, ty: number) => tx >= 0 && ty >= 0 && tx < w && ty < hTex && mask[(sy + ty) * aw + sx + tx] === 1
    // a texel of the hull is one within `grow` steps of the body, counted along the axes as the ink is
    const near = (tx: number, ty: number, d: number): boolean =>
      body(tx, ty) || (d > 0 && (near(tx - 1, ty, d - 1) || near(tx + 1, ty, d - 1) || near(tx, ty - 1, d - 1) || near(tx, ty + 1, d - 1)))
    // The ink is kept inside the tile: the art's own line never left it, and a sprite whose art
    // reaches the edge is inked along it. The shell has no such bound — it carries no texels of
    // the atlas, only its own colour — and a clipped one would break off wherever the art came
    // near the edge, so it is allowed the texels it needs outside, `down` of them below.
    const pad = grow - 1
    const inked = (tx: number, ty: number) => tx >= -pad && ty >= -pad && tx < w + pad && ty < hTex + down && near(tx, ty, grow)
    // The faces are merged exactly (mesh.ts): the back is one black plane however many texels it covers, and each
    // run of exposed texel edges is one side. What the eye sees is the same silhouette, line and depth.
    const pos: number[] = []
    const index: number[] = []
    for (const f of extrudeFaces(inked, -pad, w + pad, -pad, hTex + down, -BB_DEPTH, 0, { back: true, front: false })) {
      const base = pos.length / 3
      pos.push(...f)
      index.push(base, base + 1, base + 2, base, base + 2, base + 3)
    }
    t = index.length ? { pos: new Float32Array(pos), index } : null
    this.hulls.set(key, t)
    return t
  }

  /**
   * The rim of this tile's block, clipped to `hTex` rows, from the cache; null
   * where the atlas's pixels cannot be read. `offEdges` leaves out the faces
   * that lie on the tile's own boundary: a board set into a wall run fills its
   * cell, so where its art reaches the tile's edge those faces lie in the
   * planes of the reveals either side, the ceiling and the floor, and tear
   * against them.
   */
  private rimTemplate(l: SpriteLayer, hTex: number, offEdges = false): RimTemplate | null {
    const mask = this.atlasMask(l.a)
    if (!mask) return null
    const { sx, sy, w } = l.r
    const key = this.rimKey(l, hTex, offEdges)
    let t = this.rims.get(key)
    if (t !== undefined) return t
    const aw = l.a.width, ah = l.a.height
    /** The block is exactly what the sprite draws: `atlasMask` has already peeled the art's outline off both. */
    const body = (tx: number, ty: number) => tx >= 0 && ty >= 0 && tx < w && ty < hTex && mask[(sy + ty) * aw + sx + tx] === 1
    const pos: number[] = []
    const uv: number[] = []
    const shade: number[] = []
    const index: number[] = []
    const face = (p: number[], u: number, v: number, f: number) => {
      const base = pos.length / 3
      pos.push(...p)
      for (let i = 0; i < 4; i++) {
        uv.push(u, v)
        shade.push(f)
      }
      index.push(base, base + 1, base + 2, base, base + 2, base + 3)
    }
    const z0 = -BB_DEPTH, z1 = 0
    // every face wears its own texel: the block is body all through, so there is no line to step off.
    // Neighbouring faces along an edge whose texels hold the very same colour sample the very same thing,
    // so they are built as one face wearing the first's texel (mesh.ts `runs`); where the colours cannot
    // be read, every texel keeps its own face
    const colour = l.a.texel
    const same = (ax: number, ay: number, bx: number, by: number) => !!colour && colour(sx + ax, sy + ay) === colour(sx + bx, sy + by)
    const edge = (on: boolean) => offEdges && on
    const uvAt = (tx: number, ty: number): [number, number] => [(sx + tx + 0.5) / aw, (sy + ty + 0.5) / ah]
    /** The runs along `a0..a1` of texels `on` (a face here) that share their colour with the run's first. */
    const sameRuns = (on: (t: number) => boolean, at: (t: number) => [number, number], a0: number, a1: number): [number, number][] => {
      const out: [number, number][] = []
      for (const [r0, r1] of runs(on, a0, a1)) {
        let start = r0
        for (let t = r0 + 1; t <= r1; t++) {
          if (t < r1 && same(...at(start), ...at(t))) continue
          out.push([start, t])
          start = t
        }
      }
      return out
    }
    for (let ty = 0; ty < hTex; ty++) {
      const y1 = -ty, y0 = y1 - 1
      const row = (tx: number): [number, number] => [tx, ty]
      if (!edge(ty === 0)) for (const [a, b] of sameRuns((tx) => body(tx, ty) && !body(tx, ty - 1), row, 0, w)) face([a, y1, z1, b, y1, z1, b, y1, z0, a, y1, z0], ...uvAt(a, ty), BLOCK_SHADE.top)
      if (!edge(ty === hTex - 1)) for (const [a, b] of sameRuns((tx) => body(tx, ty) && !body(tx, ty + 1), row, 0, w)) face([a, y0, z0, b, y0, z0, b, y0, z1, a, y0, z1], ...uvAt(a, ty), BLOCK_SHADE.bottom)
    }
    for (let tx = 0; tx < w; tx++) {
      const x0 = tx, x1 = tx + 1
      const col = (ty: number): [number, number] => [tx, ty]
      if (!edge(tx === 0)) for (const [a, b] of sameRuns((ty) => body(tx, ty) && !body(tx - 1, ty), col, 0, hTex)) face([x0, -b, z0, x0, -b, z1, x0, -a, z1, x0, -a, z0], ...uvAt(tx, a), BLOCK_SHADE.side)
      if (!edge(tx === w - 1)) for (const [a, b] of sameRuns((ty) => body(tx, ty) && !body(tx + 1, ty), col, 0, hTex)) face([x1, -b, z1, x1, -b, z0, x1, -a, z0, x1, -a, z1], ...uvAt(tx, a), BLOCK_SHADE.side)
    }
    t = index.length ? { pos: new Float32Array(pos), uv: new Float32Array(uv), shade: new Float32Array(shade), index } : null
    this.rims.set(key, t)
    return t
  }

  /**
   * The atlas's opacity, one byte per texel, read once; null where its pixels
   * cannot be read. Reading the pixels is also where the art's outline comes
   * off: the ink reachable from outside a sprite is cleared (`INK_PEEL`), the
   * cleaned image becomes what the atlas draws, and the mask is the opacity of
   * what is left — so the sprite, its block and its silhouette are all the one
   * shape.
   */
  private atlasMask(a: AtlasEntry): Uint8Array | null {
    if (a.mask !== undefined) return a.mask
    a.mask = null
    const img = a.texture.image as TexImageSource | undefined
    if (!img) return null
    try {
      let canvas: HTMLCanvasElement | OffscreenCanvas
      if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(a.width, a.height)
      else if (typeof document !== 'undefined') {
        canvas = document.createElement('canvas')
        canvas.width = a.width
        canvas.height = a.height
      } else return null
      const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null
      if (!ctx) return null
      ctx.drawImage(img as CanvasImageSource, 0, 0)
      const image = ctx.getImageData(0, 0, a.width, a.height)
      const mask = peelInk(image.data, a.width, a.height, OPAQUE_ALPHA, this.tiles?.spriteRects?.(a.name))
      ctx.putImageData(image, 0, 0)
      a.texture.image = canvas as unknown as TexImageSource
      a.texture.needsUpdate = true
      a.mask = mask
      // a tile's colours are read back from the canvas as its rim is built, not kept for the whole atlas
      const rows = new Map<number, Uint8ClampedArray>()
      a.texel = (x, y) => {
        let row = rows.get(y)
        if (!row) {
          if (rows.size > 64) rows.clear()
          rows.set(y, (row = ctx.getImageData(0, y, a.width, 1).data))
        }
        return ((row[x * 4] << 24) | (row[x * 4 + 1] << 16) | (row[x * 4 + 2] << 8) | row[x * 4 + 3]) >>> 0
      }
    } catch {
      a.mask = null
    }
    return a.mask
  }

  /**
   * The key of everything a billboard's holders are built from: the sprite
   * itself, where it stands, how it is lit where its light is baked (a cloud
   * or a translucent sprite wears a material of its own that reads no shade
   * map), whether its cell is in view (its ghost's strength and tint), and for
   * whether its cell is in view. Two scenes that give the same key give the
   * same holders, so the ones standing are kept.
   */
  private spriteKey(b: Billboard, shade: number, ghostKind: GhostKind): string {
    const layers = b.layers ? b.layers.map((l) => `${l.tile},${l.ox || 0},${l.oy || 0},${l.ymax ?? ''}`).join(';') : ''
    const icons = b.statusIcons ? b.statusIcons.map((i) => `${i.tile},${i.ox},${i.oy},${i.at || ''}`).join(';') : ''
    const own = b.kind === 'cloud' || (b.alpha !== undefined && b.alpha < 1)
    return `${b.kind}|${b.x},${b.y}|${b.tile}|${b.height}|${b.alpha ?? ''}|${b.scenery ? 1 : 0}|${layers}|${icons}|${ghostKind}|${own ? shade : ''}`
  }

  /**
   * Stand the scene's billboards: every one the scene carries that is not
   * standing yet is built, and every one standing that the scene no longer
   * carries is dropped. A scene that carries the same billboards as the last
   * — a new revision for a message that moved nothing, a cursor, a step that
   * only relit the crowd — leaves every holder and every baked chunk as it
   * is. Whatever a billboard's holders are built from is in its key
   * (`spriteKey`); a change to any of it is a drop and a build.
   */
  private syncBillboards(scene: Scene): boolean {
    this.stats.crowdSyncs++
    this.crowdDirty = false
    const tiles = this.tiles
    if (!tiles) {
      const had = this.records.size > 0
      this.dropRecords()
      return had
    }
    const t = scene.level.tint
    const tintKey = `${t.r},${t.g},${t.b}`
    if (tintKey !== this.recordsTint) {
      this.recordsTint = tintKey
      this.dropRecords()
    }
    const wanted = new Map<string, { b: Billboard; cell: SceneCell | undefined; shade: number; ghostKind: GhostKind }>()
    for (const b of scene.billboards) {
      // the player is the camera, and the cell underfoot is behind it
      if (b.kind === 'player') continue
      if (b.x === scene.player.x && b.y === scene.player.y && scene.playerOnLevel && b.kind !== 'cloud') continue
      const cell = scene.cells.get(cellKey(b.x, b.y))
      const shade = this.shadeFor(cell, scene)
      const ghostKind: GhostKind = cell?.visibility === 'visible' ? 'visible' : 'remembered'
      let key = this.spriteKey(b, shade, ghostKind)
      // two of a kind on one cell (a scene may carry them): each keeps a record of its own
      while (wanted.has(key)) key += '#'
      wanted.set(key, { b, cell, shade, ghostKind })
    }
    let changed = false
    for (const [key, rec] of this.records) {
      if (wanted.has(key)) continue
      this.dropRecord(rec)
      this.records.delete(key)
      changed = true
    }
    for (const [key, spec] of wanted) {
      if (this.records.has(key)) continue
      const rec = this.buildRecord(scene, key, spec.b, spec.cell, spec.shade, spec.ghostKind)
      if (rec) this.records.set(key, rec)
      changed = true
    }
    if (changed) this.selectionDirty = true
    return changed
  }

  /** Take a billboard down: its holders out of the crowd or the group, their geometry and any material of their own released. */
  private dropRecord(rec: SpriteRecord) {
    this.stats.spriteDrops++
    for (const h of rec.holders) {
      this.billboardCrowd.remove(h)
      if (h.parent) h.parent.remove(h)
      h.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.userData.shared) return
        if (m.geometry) m.geometry.dispose()
        if (m.userData.ownMaterial) (m.material as THREE.Material).dispose()
      })
    }
    if (rec.ghost) this.ghostCount--
  }

  /** Stand one billboard: its holder, its ghost where it has one (II.4), its shadow. */
  private buildRecord(scene: Scene, key: string, b: Billboard, cell: SceneCell | undefined, shade: number, ghostKind: GhostKind): SpriteRecord | null {
    const tiles = this.tiles!
    const tint = scene.level.tint
    const tileOf = (id: number) => {
      const r = tiles.tile(id)
      if (!r) return null
      const a = this.atlas(r.atlas)
      if (!a) return null
      return { r, a, uv: this.uvFor(r, a) }
    }
    const group = this.billboardGroup
    /** A holder into the crowd where it can be baked; a holder of its own (its own material) stays in the group. */
    const stand = (h: THREE.Object3D, bake: boolean) => {
      if (bake && this.billboardCrowd.mergeable(h)) this.billboardCrowd.add(h, b.x, b.y)
      else this.giveCells(h, b.x, b.y)
    }
    if (b.kind === 'cloud') {
      const t = tileOf(b.tile)
      if (!t) return null
      // a cloud wears a material of its own, so its light is in its vertex colour
      const h = this.addStanding(group, b.x, b.y, [{ ...t, ox: 0, oy: 0 }], b.height, shade, tint, false, 'none', false)
      h.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.material) {
          m.material = (m.material as THREE.Material).clone()
          m.userData.ownMaterial = true
          ;(m.material as THREE.MeshBasicMaterial).opacity = 0.55
          ;(m.material as THREE.MeshBasicMaterial).depthWrite = false
          m.layers.set(LAYER_NO_DEPTH)
        }
      })
      h.userData.kind = b.kind
      this.stats.spriteBuilds++
      return { key, x: b.x, y: b.y, holders: [h], shells: [], position: h.position.clone(), ghost: false }
    }
    const layers: SpriteLayer[] = []
    if (b.layers && b.layers.length) {
      for (const l of b.layers) {
        const t = tileOf(l.tile)
        if (t) layers.push({ ...t, ox: l.ox || 0, oy: l.oy || 0, ymax: l.ymax })
      }
    } else {
      const t = tileOf(b.tile)
      if (t) layers.push({ ...t, ox: 0, oy: 0 })
    }
    if (!layers.length) return null
    const nSprite = layers.length
    // status badges sit in the sprite's own frame, at the offsets the builder resolved;
    // one pinned to the top edge (the damage bar) starts its opaque texels on row 0
    if (b.statusIcons) {
      for (const i of b.statusIcons) {
        const t = tileOf(i.tile)
        if (t) layers.push({ ...t, ox: i.ox, oy: i.at === 'top' ? -t.r.oy : i.oy, flat: true })
      }
    }
    const bh = b.height
    // scenery monsters (plants, bushes) are fixtures: they stand square like statues and take their light from the shade map
    const translucent = b.alpha !== undefined && b.alpha < 1
    // a sprite's light comes from the shade map (`makeBillboardMaterial`); only a translucent one,
    // which wears a cloned material that reads no map, carries it in its vertex colour
    const shells: ShellSource[] = []
    const holder = this.addStanding(group, b.x, b.y, layers, bh, translucent ? shade : 1, tint, !!b.scenery, 'none', !translucent, 0, undefined, shells)
    holder.userData.kind = b.kind
    const holders = [holder]
    // whatever the 2D map shows on the cell shows through walls here (II.4):
    // the sprite and its status badges, so a sleeping or fleeing monster
    // reads the same behind a wall as in the open.
    // Scenery is the exception: a plant, a bush or a tree is a fixture, not
    // news. The ghost pass exists so the geometry never hides something the
    // server is telling you about, and a plant behind a wall tells you
    // nothing — showing it only puts foliage through the masonry.
    let ghost = false
    if (!b.scenery) {
      // what the server shows right now keeps a strong ghost at any depth; remembered knowledge stays a faint hint that fades with the gap
      // A ghost of something in view wears the sprite's own colours and light.
      // A wall's edge cuts a sprite in two — the near half lit, the far half a
      // ghost — and a tint there is a seam down the middle of a monster: the
      // same rat brown one side and red the other. Only what the server is not
      // showing takes a tint, where nothing lit stands beside it to clash and
      // the tint is all that says how it is known.
      const gt =
        ghostKind === 'visible'
          ? tint
          : b.kind === 'monster'
            ? GHOST_TINT.remembered
            : b.kind === 'projectile'
              ? GHOST_TINT.projectile
              : GHOST_TINT.item
      // the badges keep their own colours so a damage bar or a "zzz" reads the same through a wall as in the open
      const ghostLayers = layers.map((l, i) => (i < nSprite ? l : { ...l, tint: BADGE_TINT }))
      // a visible ghost's light comes from the shade map too (`GHOST_SHADE`); a remembered one is its tint alone
      const g = this.addStanding(group, b.x, b.y, ghostLayers, bh, 1, gt, false, ghostKind)
      ghost = true
      this.ghostCount++
      if (b.kind === 'projectile') g.position.y = PROJECTILE_LIFT
      g.userData.kind = 'ghost'
      holders.push(g)
    }
    if (b.kind === 'projectile') holder.position.y = PROJECTILE_LIFT
    if (translucent) {
      let k = 0
      holder.traverse((o) => {
        const m = o as THREE.Mesh
        if (!m.material || !m.geometry) return
        if (k++ >= nSprite) return
        m.material = (m.material as THREE.Material).clone()
        m.userData.ownMaterial = true
        ;(m.material as THREE.MeshBasicMaterial).opacity = b.alpha as number
        ;(m.material as THREE.MeshBasicMaterial).depthWrite = false
        m.layers.set(LAYER_NO_DEPTH)
      })
    }
    // ground shadow: one shared disc, scaled to the sprite
    const sh = new THREE.Mesh(this.shadowGeo, this.shadowMat)
    sh.userData.shared = true
    sh.layers.set(LAYER_NO_DEPTH)
    const sr = Math.max(0.6, bh)
    sh.scale.set(sr, sr, 1)
    sh.rotation.x = -Math.PI / 2
    sh.position.set(0, 0.003, 0)
    holder.add(sh)
    for (const h of holders) stand(h, true)
    this.stats.spriteBuilds++
    return { key, x: b.x, y: b.y, holders, shells, position: holder.position.clone(), ghost }
  }

  /**
   * The shell round the sprite the cursor stands on (`SEL_GROW`, `hullSelMat`):
   * built from what its record kept (`ShellSource`) as a holder of its own
   * beside the crowd, turned to the eye as every holder is, so the cursor
   * moving between cells builds a shell or takes one down and touches
   * nothing else. A cell can stand more than one sprite (a projectile over a
   * monster); each gets its shell.
   */
  private syncSelection() {
    this.selectionDirty = false
    this.clearSelection()
    const cur = this.cursor
    if (!cur) return
    for (const rec of this.records.values()) {
      if (rec.x !== cur.x || rec.y !== cur.y || !rec.shells.length) continue
      const holder = new THREE.Group()
      holder.position.copy(rec.position)
      holder.userData.billboard = true
      holder.userData.selection = true
      holder.userData.kind = 'selection'
      for (const s of rec.shells) {
        const shell = this.hullGeometry(s.l, s.hTex, s.wq, s.hq, s.k, SEL_GROW, s.room)
        if (!shell) continue
        const sel = new THREE.Mesh(shell, this.hullSelMat)
        sel.position.copy(s.position)
        sel.renderOrder = s.renderOrder
        sel.userData.hull = true
        sel.userData.shell = true
        holder.add(sel)
      }
      if (!holder.children.length) continue
      this.billboardGroup.add(holder)
      this.selected.push(holder)
      this.stats.selectionBuilds++
    }
  }

  private clearSelection() {
    for (const h of this.selected) {
      this.billboardGroup.remove(h)
      for (const c of h.children) (c as THREE.Mesh).geometry.dispose()
    }
    this.selected = []
  }

  /**
   * Bake the group's standing holders into the crowd's chunk meshes
   * (crowd.ts): every chunk a holder joined or left since the last bake is
   * written again, its holders taken back to front from the eye; the rest
   * stand as they are. Left as holders: a sprite standing at a heading of its
   * own (an open door), the selected shells, and anything wearing a material
   * of its own (a translucent sprite, a cloud).
   */
  private bakeStanding(group: THREE.Group, eye: { x: number; y: number }) {
    const crowd = group === this.levelGroup ? this.levelCrowd : this.billboardCrowd
    crowd.bake(eye)
  }
  render(): void {
    const r = this.renderer
    const scene = this.scene
    const cam = this.camera
    if (!r || !scene || !cam) return
    // the attack lift runs on the clock, not on what shows it: it is over when its time is, whether the hands
    // are drawn or not (no viewmodel, empty hands), so `animating` cannot stick and keep the host rendering
    this.lift = Number.isNaN(this.vmLift) ? NaN : this.liftEnvelope(nowSeconds() - this.vmLift)
    if (Number.isNaN(this.lift)) this.vmLift = NaN
    if (scene.revision !== this.builtRevision) {
      this.builtRevision = scene.revision
      const bg = scene.level.sky === 'open' ? 0x0b1220 : scene.level.sky === 'dark' ? 0x120818 : 0x000000
      ;(this.three.background as THREE.Color).set(bg)
      // the geometry stands until the layout changes (Part IV); a move, a
      // change of sight or a monster's step repaint the shade map and the
      // billboards, which is cheap, and leave the level's meshes alone
      const t = scene.level.tint
      const tintKey = `${t.r},${t.g},${t.b}`
      // a step onto or off a staircase, the player's or a monster's, changes which features stand and which
      // lie flat (`occupiedFeatures`), which is part of the geometry; it is as rare as a layout change, and the
      // rest of a walk still leaves the level's meshes alone
      const occKey = [...this.occupiedFeatures(scene)].sort().join('|')
      if (scene.layoutRevision !== this.builtLayout || tintKey !== this.builtTint || occKey !== this.builtOccupied) {
        this.builtLayout = scene.layoutRevision
        this.builtTint = tintKey
        this.builtOccupied = occKey
        this.rebuildLevel(scene)
        this.bakeStanding(this.levelGroup, { x: cam.eyeX, y: cam.eyeY })
      }
      this.updateFields(scene)
      // the crowd is synced against the scene, not rebuilt: what still stands is left standing
      if (this.syncBillboards(scene)) this.bakeStanding(this.billboardGroup, { x: cam.eyeX, y: cam.eyeY })
    } else if (this.crowdDirty) {
      if (this.syncBillboards(scene)) this.bakeStanding(this.billboardGroup, { x: cam.eyeX, y: cam.eyeY })
    }
    // the selected shell follows the cursor and the sprites, on its own
    if (this.selectionDirty) this.syncSelection()
    // camera: the eased eye (camera.ts `walkTo`), not the cell: mid-glide it is between the two
    this.cam.position.set(cam.eyeX + 0.5, Math.max(EYE_MIN, Math.min(EYE_MAX, this.opts.eyeHeight)), cam.eyeY + 0.5)
    this.cam.rotation.set(cam.pitch, -cam.yaw, 0)
    // Billboards face the camera (yaw only), and it is the camera's own yaw
    // that counts, not the facing: mid-turn the two differ, and a billboard
    // squared to the facing would stand visibly turned.
    // Squared to the view plane a sprite is never foreshortened, so its
    // texture is sampled head-on and stays as sharp as the art allows.
    // The baked crowd (`bakeStanding`) turns in the shader; the holders left standing turn here.
    const camYaw = this.cam.rotation.y
    this.standUniforms.standYaw.value = camYaw
    for (const h of this.billboardGroup.children) if (h.userData.billboard) h.rotation.y = camYaw
    for (const h of this.levelGroup.children) if (h.userData.billboard) h.rotation.y = camYaw
    // the crowd's blended chunks draw back to front from where the eye stands this frame
    this.billboardCrowd.order({ x: cam.eyeX, y: cam.eyeY })
    this.levelCrowd.order({ x: cam.eyeX, y: cam.eyeY })
    this.placeCursor()
    // the ghost pass needs the depth image only when there is a ghost to test against it
    if (this.ghostCount > 0) this.renderOccluderDepth(r)
    r.render(this.three, this.cam)
    this.renderViewmodel(r, scene)
  }

  // ------------------------------------------------------------- viewmodel

  /** Where the hands are drawn, as fractions of the canvas (II.7), so the HUD keeps its corner clear of them; empty when no hand is. */
  handsFootprint(): HandRect[] {
    if (!this.vmVisible) return []
    const vm = this.viewmodel!
    return handsFootprint({ weapon: !!vm.weapon, offhand: vm.offhand ? (vm.offhand.name?.startsWith('HAND2_') ? 'shield' : 'weapon') : 'none' }, this.vmCam.aspect)
  }

  private get vmVisible(): boolean {
    return this.opts.viewmodel && !!this.viewmodel && (!!this.viewmodel.weapon || !!this.viewmodel.offhand)
  }

  /**
   * Lift envelope at time `t` since the attack: up fast, back on an ease.
   * Returns 0..1, or NaN once it is over.
   */
  private liftEnvelope(t: number): number {
    const p = t / VM_LIFT_S
    if (!(p >= 0) || p >= 1) return NaN
    if (p < 0.3) return p / 0.3
    const q = (p - 0.3) / 0.7
    return 1 - q * q * (3 - 2 * q)
  }

  /**
   * The item's icon layers painted into one cell-sized pixel grid, in order,
   * as WebTiles composes an inventory icon. Null where pixels cannot be read
   * (no 2D canvas, an atlas that is not an image).
   */
  private paintIcon(item: HandItem): { w: number; h: number; data: Uint8ClampedArray } | null {
    if (!this.tiles) return null
    let canvas: HTMLCanvasElement | OffscreenCanvas
    if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(1, 1)
    else if (typeof document !== 'undefined') canvas = document.createElement('canvas')
    else return null
    let cell = 32
    const rects: { r: TileRect; h: number; img: TexImageSource }[] = []
    for (const l of item.layers) {
      const r = this.tiles.tile(l.tile, l.layer)
      if (!r) continue
      const img = this.tiles.atlas(r.atlas)
      if (!img) continue
      let h = r.h
      if (l.ymax !== undefined && l.ymax < r.oy + r.h) h = Math.max(0, l.ymax - r.oy)
      if (h <= 0) continue
      cell = r.cell
      rects.push({ r, h, img })
    }
    if (!rects.length) return null
    canvas.width = cell
    canvas.height = cell
    const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null
    if (!ctx) return null
    ctx.imageSmoothingEnabled = false
    try {
      for (const { r, h, img } of rects) ctx.drawImage(img as CanvasImageSource, r.sx, r.sy, r.w, h, r.ox, r.oy, r.w, h)
      return { w: cell, h: cell, data: ctx.getImageData(0, 0, cell, cell).data }
    } catch {
      return null
    }
  }

  /**
   * The icon extruded into a block: every opaque texel becomes a VM_DEPTH-texel
   * deep column, coloured by the texel, with only the faces that border a
   * transparent texel (or the front and back) emitted, shaded per direction so
   * the thickness reads. The origin is the bottom centre of the opaque texels'
   * bounding box (not the cell's), so an icon drawn off-centre in its cell,
   * such as a paperdoll part, still hangs from the hand; the block spans z in
   * [-depth, 0]. With it comes the hull that lines it, the standing sprites'
   * (`hullTemplate`) at the hand's own scale: the block grown a texel each
   * way and closed, for the black material to draw back faces only.
   */
  private extrudeIcon(item: HandItem): { block: THREE.BufferGeometry; hull: THREE.BufferGeometry | null } | null {
    const px = this.paintIcon(item)
    if (!px) return null
    const { w, h, data } = px
    // the hands are the same art as the world's sprites, so they lose the same outline (`peelInk`):
    // the icon is measured and extruded from what is left, and the block is the whole of what it draws
    peelInk(data, w, h, 128)
    const opaque = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3] >= 128
    let bx0 = w, bx1 = -1, by0 = h, by1 = -1
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (opaque(x, y)) {
          if (x < bx0) bx0 = x
          if (x > bx1) bx1 = x
          if (y < by0) by0 = y
          if (y > by1) by1 = y
        }
    if (bx1 < 0) return null
    const cx = (bx0 + bx1 + 1) / 2
    const bottom = by1 + 1
    // world size per texel: the opaque extent fills VM_FILL of the hand's height
    const s = (VM_SIZE * VM_FILL) / Math.max(bx1 - bx0 + 1, by1 - by0 + 1)
    const depth = VM_DEPTH * s
    const pos: number[] = []
    const col: number[] = []
    const idx: number[] = []
    const face = (p: [number, number, number][], r: number, g: number, b: number, shade: number) => {
      const base = pos.length / 3
      for (const [x, y, z] of p) pos.push(x, y, z)
      for (let i = 0; i < 4; i++) col.push(r * shade, g * shade, b * shade)
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!opaque(x, y)) continue
        const o = (y * w + x) * 4
        // texel colours are sRGB; the material's vertex colours are read as linear
        const c = new THREE.Color(data[o] / 255, data[o + 1] / 255, data[o + 2] / 255).convertSRGBToLinear()
        const x0 = (x - cx) * s, x1 = x0 + s
        const y1 = (bottom - y) * s, y0 = y1 - s
        const z0 = -depth, z1 = 0
        face([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], c.r, c.g, c.b, BLOCK_SHADE.front)
        face([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], c.r, c.g, c.b, BLOCK_SHADE.front)
        if (!opaque(x, y - 1)) face([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], c.r, c.g, c.b, BLOCK_SHADE.top)
        if (!opaque(x, y + 1)) face([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], c.r, c.g, c.b, BLOCK_SHADE.bottom)
        if (!opaque(x - 1, y)) face([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], c.r, c.g, c.b, BLOCK_SHADE.side)
        if (!opaque(x + 1, y)) face([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], c.r, c.g, c.b, BLOCK_SHADE.side)
      }
    }
    if (!idx.length) return null
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    g.setIndex(idx)
    // the ink: the hull round the block, kept inside the icon's canvas as the art's own line was. Closed on both
    // sides, unlike a standing sprite's: a hand is posed with its back to the eye as often as its front (the
    // weapon's rest yaw is a half turn), and the block's own front and back keep either hull face off the art
    const inked = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < w && y < h &&
      (opaque(x, y) || opaque(x - 1, y) || opaque(x + 1, y) || opaque(x, y - 1) || opaque(x, y + 1))
    const hpos: number[] = []
    const hidx: number[] = []
    // in texel units, then to the hand's scale: x across from the icon's centre, y up from its base (mesh.ts merges the faces exactly)
    for (const f of extrudeFaces(inked, 0, w, 0, h, -depth, 0, { back: true, front: true })) {
      const base = hpos.length / 3
      for (let i = 0; i < 12; i += 3) hpos.push((f[i] - cx) * s, (f[i + 1] + bottom) * s, f[i + 2])
      hidx.push(base, base + 1, base + 2, base, base + 2, base + 3)
    }
    let hull: THREE.BufferGeometry | null = null
    if (hidx.length) {
      hull = new THREE.BufferGeometry()
      hull.setAttribute('position', new THREE.Float32BufferAttribute(hpos, 3))
      hull.setIndex(hidx)
    }
    return { block: g, hull }
  }

  /** One hand: the extruded icon and the ink round it, built once per distinct item. */
  private buildHand(group: THREE.Group, item: HandItem | null) {
    group.clear()
    if (!item) return
    const key = JSON.stringify(item.layers)
    let geo = this.vmGeos.get(key)
    if (geo === undefined) {
      geo = this.extrudeIcon(item)
      this.vmGeos.set(key, geo)
    }
    if (!geo) return
    group.add(new THREE.Mesh(geo.block, this.vmMat))
    if (geo.hull) {
      const ink = new THREE.Mesh(geo.hull, this.hullMat)
      ink.userData.hull = true
      group.add(ink)
    }
  }

  private renderViewmodel(r: THREE.WebGLRenderer, scene: Scene) {
    if (!this.vmVisible) return
    const vm = this.viewmodel!
    if (!this.vmBuilt && this.tiles) {
      this.vmBuilt = true
      this.buildHand(this.vmHands.weapon, vm.weapon)
      this.buildHand(this.vmHands.offhand, vm.offhand)
    }
    const asp = this.vmCam.aspect
    const lift = this.lift
    // `push` slides the hand from its rest toward the centre of the view, by that fraction of the distance
    const pose = (g: THREE.Group, p: HandPose, push = 0) => {
      const len = Math.hypot(p.x * asp, p.y) || 1
      g.position.set(p.x * asp * (1 - push / len), p.y * (1 - push / len), 0)
      // roll first, then pitch, then yaw: Euler 'YXZ' applies Z, then X, then Y
      g.rotation.set(p.pitch, p.yaw, p.roll, 'YXZ')
    }
    const w = this.vmHands.weapon
    w.visible = !!vm.weapon
    pose(w, VM_WEAPON_REST, (lift || 0) * VM_LIFT)
    const o = this.vmHands.offhand
    o.visible = !!vm.offhand
    pose(o, vm.offhand?.name?.startsWith('HAND2_') ? VM_SHIELD_REST : VM_OFFWEAPON_REST)
    // hands take the level's light like everything else in the view, and the
    // flash over the cell the player stands in washes over them
    const tint = scene.level.tint
    this.vmMat.color.setRGB(tint.r, tint.g, tint.b)
    const flash = flashOf(getCell(scene, scene.player.x, scene.player.y))
    this.vmFlash.value.set(flash.r, flash.g, flash.b, flash.a)
    const prevAutoClear = r.autoClear
    r.autoClear = false
    r.clearDepth()
    r.render(this.vmScene, this.vmCam)
    r.autoClear = prevAutoClear
  }
}

/**
 * Peel the art's outline off `data` in place: the ink the eye can reach from
 * outside is cleared, `INK_PEEL` layers deep, and what is left comes back as
 * opacity, one byte per texel. Peeling eats only ink, so a body texel stops
 * it: the eyes, the mouth and the lines drawn inside a sprite are not
 * reachable and stay. `alphaMin` is the alpha at which a texel counts as
 * drawn at all.
 *
 * `sprites`, when given, is where the sprite art is (`TileSource.spriteRects`):
 * only ink inside those rects is peeled, and the edge of a rect reaches it as
 * the image's edge does. Crawl's atlases hold one kind each, so its sprite
 * atlases are peeled whole and its floor and wall atlases never asked; an
 * atlas that packs floors beside sprites would otherwise lose the dark edge
 * of a floor tile that touches a gap or the image's border, and show the
 * clear colour through the floor as a black line between cells.
 */
export function peelInk(data: Uint8ClampedArray, w: number, h: number, alphaMin: number, sprites?: ReadonlyArray<{ sx: number; sy: number; w: number; h: number }>): Uint8Array {
  // 0 clear, 1 body, 2 ink
  const mask = new Uint8Array(w * h)
  for (let i = 0; i < mask.length; i++) {
    if (data[i * 4 + 3] < alphaMin) mask[i] = 0
    else mask[i] = data[i * 4] < INK_LEVEL && data[i * 4 + 1] < INK_LEVEL && data[i * 4 + 2] < INK_LEVEL ? 2 : 1
  }
  // 1 where ink may be peeled: everywhere, or the sprite rects
  let art: Uint8Array | null = null
  if (sprites) {
    art = new Uint8Array(w * h)
    for (const r of sprites) for (let y = Math.max(0, r.sy); y < Math.min(h, r.sy + r.h); y++) art.fill(1, y * w + Math.max(0, r.sx), y * w + Math.min(w, r.sx + r.w))
  }
  for (let pass = 0; pass < INK_PEEL; pass++) {
    const peeled: number[] = []
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (mask[i] !== 2 || (art && !art[i])) continue
        const reached =
          x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
          mask[i - 1] === 0 || mask[i + 1] === 0 || mask[i - w] === 0 || mask[i + w] === 0 ||
          (art !== null && (!art[i - 1] || !art[i + 1] || !art[i - w] || !art[i + w]))
        if (reached) peeled.push(i)
      }
    }
    if (!peeled.length) break
    for (const i of peeled) {
      mask[i] = 0
      data[i * 4 + 3] = 0
    }
  }
  // what is left of the ink is inside the art — an eye, a mouth, a line between limbs — and is body like any other texel
  for (let i = 0; i < mask.length; i++) if (mask[i] === 2) mask[i] = 1
  return mask
}

function nowSeconds(): number {
  return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000
}

export type { Billboard, Viewmodel }
export * from './footprint.js'
