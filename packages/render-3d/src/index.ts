import { VM_OFFWEAPON_REST, VM_SHIELD_REST, VM_SIZE, VM_WEAPON_REST, handsFootprint, type HandPose, type HandRect } from './hands.js'
import * as THREE from 'three'
import {
  cellKey,
  dirToYaw,
  minibarRects,
  MINIBAR_CELL,
  type Minibars,
  keyToXY,
  orbitShot,
  cameraApproach,
  ORBIT_BACK,
  REST_PITCH,
  type Billboard,
  type Camera,
  type CellKey,
  type OrbitShot,
  type ViewMode,
  type MapRenderer,
  type Scene,
  type SceneCell,
  type SceneCursor,
  type TileRect,
  type TileSource,
  type HandItem,
  type Viewmodel,
  shadeOf,
} from '@orbrun/scene'
import { bodyRect, insetFootprint, sceneClassAt, type FootprintOptions } from './footprint.js'

/**
 * @orbrun/render-3d
 *
 * First-person three.js renderer of a Scene. Depends only on @orbrun/scene
 * and three. Every classification it needs arrives on the Scene.
 *
 * World mapping: cell (x, y) -> world (x, 0, y). North (-y) is -z. Wall
 * height is 1. The camera stands at eye height 0.65 by default (the
 * `eyeHeight` option moves it), or in third person (rendering-3d.md II.11)
 * on a cell behind the player, under the lid.
 */

export interface Render3dOptions {
  /** First person (the eyes) or third person (a cell behind the player). */
  view?: ViewMode
  /** Field of view in degrees. */
  fov?: number
  /**
   * Third person only: how far behind the player the camera stands, in
   * cells. Clamped to what the shot allows (II.11), so a tight shot pulls it
   * in whatever this says.
   */
  camDistance?: number
  /**
   * Third person only: how high the camera stands, in cells (0 is the floor,
   * 1 the lid). Clamped to THIRD_MIN_H..THIRD_MAX_H so it never sits in the
   * floor or in the ceiling.
   */
  camHeight?: number
  /**
   * First person only: how high the eye stands, in cells (0 is the floor, 1
   * the lid). Default EYE; clamped to EYE_MIN..EYE_MAX so it is never in the
   * floor or the lid.
   */
  eyeHeight?: number
  /**
   * Where the camera points at rest, in radians off the horizon (negative
   * looks down): the Camera angle setting. First person takes the pitch
   * straight off the camera, so this only matters in third person, where the
   * shot's own rest pitch comes from its height and the player's glance is
   * measured from this. Default REST_PITCH.
   */
  restPitch?: number
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
   * The player's health and magic bars (scene bars.ts), drawn over the
   * doll's head in third person exactly as a monster's damage bar is; in
   * first person the doll is the camera and the HUD's stats pane carries
   * them. `setMinibars` updates them without rebuilding the level.
   */
  minibars?: Minibars | null
  /**
   * Attack cue: a tiny thrust of the wielded weapon toward the centre on a melee attack. Off under
   * the platform's reduced-motion preference; the hands then never move.
   */
  motion?: boolean
}

// First person: the eye stands EYE up by default; the `eyeHeight` option
// (the Camera height setting, in first person) moves it between EYE_MIN and
// EYE_MAX, the same range the third-person camera has, clear of floor and lid.
const EYE = 0.65
const EYE_MIN = 0.25
const EYE_MAX = 0.9
// Third person (II.11). The camera stands on the facing line, up to
// ORBIT_BACK behind the player and THIRD_H up: under the 1.0 lid, over the
// 0.65 eye, so it never clips a lid or a wall face (a cell centre is half a
// cell from any face). It looks at the floor THIRD_AHEAD cells past the
// player, THIRD_SHOULDER to the right of the facing line, so the doll sits
// left of centre and the cell ahead stays clear. The stick glances from
// there within THIRD_PITCH_MIN..MAX: under a lid there is no more to see.
// THIRD_H is the default; the `camHeight` option (the Camera height setting,
// and Shift+wheel) moves it between THIRD_MIN_H, low enough to read as a
// follow-cam at the doll's waist, and THIRD_MAX_H, well over the lid. Over
// the lid (above LID_H) the level is built without its lids and with every
// wall capped, so the shot looks down into it as onto a model, and nothing
// on the way to the doll needs cutting down.
const THIRD_H = 0.75
const THIRD_MIN_H = 0.25
const THIRD_MAX_H = 3
const LID_H = 1
const THIRD_AHEAD = 2
/**
 * How far back along the facing line the camera stands, in cells: the
 * `camDistance` option (the Camera distance setting, and the mouse wheel),
 * defaulting to THIRD_BACK. It is pulled in from the shot cell's centre so
 * the doll reads at handheld size, and is clamped to the shot: never past
 * the cell the shot cut down, and never nearer than THIRD_MIN_BACK. The near
 * end is an over-the-shoulder shot: the camera is inside the player's own
 * cell, a quarter cell behind the doll, which the shoulder offset keeps left
 * of centre. Nearer than that the camera is in the doll and the view is
 * better off in first person, which is its own setting.
 */
const THIRD_BACK = 0.7
const THIRD_MIN_BACK = 0.25
const THIRD_MAX_BACK = ORBIT_BACK
const THIRD_SHOULDER = 0.35
// the glance runs from a look straight down to a look a little up; under the
// lid the rest pitch keeps it in the lower part of that range on its own
const THIRD_PITCH_MIN = -(Math.PI / 180) * 85
const THIRD_PITCH_MAX = (Math.PI / 180) * 20
/**
 * The player's own doll is drawn at this fraction of the height the builder
 * resolved: at the near camera stops a full-height doll fills the frame and
 * buries the cell ahead. Only the player is scaled; every other actor and item
 * keeps the size the scene gives it, so nothing about what the view tells the
 * player changes. An experiment knob — one number to revert.
 */
const DOLL_SCALE = 0.75
/** Attack cue in third person: the doll lunges this far (cells) along facing and settles back over VM_LIFT_S. */
const DOLL_LUNGE = 0.25
/**
 * The doll stands this far (cells) behind its cell's centre, toward the
 * camera, so it reads a little larger and leaves more of its own cell and
 * the cell ahead in view. Along the live yaw, so it stays put in the frame
 * through a turn rather than skipping between facings. It never comes nearer
 * the camera than THIRD_MIN_BACK: at the near stops the offset shrinks to
 * nothing.
 */
const DOLL_BACK = 0.2
/** Ghost tint of the player's own doll when masonry hides it from the third-person camera. */
const DOLL_GHOST_TINT = { r: 0.85, g: 0.9, b: 1 }
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
/** Shade of the extruded block's faces relative to the texel colour: front, top, side, bottom. */
const VM_SHADE = { front: 1, top: 0.86, side: 0.7, bottom: 0.5 }
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
const DIAGONALS: [number, number][] = [[-1, -1], [1, -1], [-1, 1], [1, 1]]
const PLINTH_H = 3 / 32
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

// The ghost shaders test each fragment against a depth image of the level
// rendered just before the frame. Only fragments that geometry hides pass,
// and their alpha fades with the depth gap to the occluder in front.
const GHOST_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
varying float vViewZ;
void main() {
  vUv = uv;
  vColor = color;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
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
#ifdef GHOST_MAP
  vec4 t = texture2D(map, vUv);
  if (t.a < 0.1) discard;
  c *= t;
#endif
  gl_FragColor = vec4(c.rgb, c.a * opacity * fade);
  #include <colorspace_fragment>
}`

interface AtlasEntry {
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
}

/** Which pass a standing sprite belongs to: the lit sprite itself, or a ghost of it behind the geometry (II.4). */
type GhostKind = 'none' | 'remembered' | 'visible'

interface SpriteLayer {
  r: TileRect
  a: AtlasEntry
  uv: { u0: number; v0: number; u1: number; v1: number }
  ox: number
  oy: number
  ymax?: number
  /** Overrides the holder's tint for this layer alone (status badges keep their own colours in the ghost pass). */
  tint?: { r: number; g: number; b: number }
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

class GeoBuilder {
  positions: number[] = []
  uvs: number[] = []
  colors: number[] = []
  cut: number[] = []
  /** Per vertex, the cell whose light it takes: the level shader reads its shade from the shade map (II.9). */
  cells: number[] = []
  indices: number[] = []
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
    for (const [x, y, z] of p) this.positions.push(x, y, z)
    for (let i = 0; i < n; i++) this.cut.push(cut ? 1 : 0)
    for (let i = 0; i < n; i++) this.cells.push(this.cx, this.cz)
    for (const [u, v] of uv) this.uvs.push(u, v)
    for (let i = 0; i < n; i++) this.colors.push(shade * tint.r, shade * tint.g, shade * tint.b)
    if (n === 4) this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
    else for (const [a, b, c] of triangulateXZ(p)) this.indices.push(base + a, base + b, base + c)
  }
  build(): THREE.BufferGeometry | null {
    if (this.indices.length === 0) return null
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3))
    g.setAttribute('cut', new THREE.Float32BufferAttribute(this.cut, 1))
    g.setAttribute('cell', new THREE.Float32BufferAttribute(this.cells, 2))
    g.setIndex(this.indices)
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
  /** How many ghost sprites the billboards hold: none means no depth pass. */
  private ghostCount = 0
  /** One disc under every actor and item, shared. */
  private shadowGeo = new THREE.CircleGeometry(0.22, 16)
  private shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false })
  private bufferSize = new THREE.Vector2()
  /**
   * Shade map (II.9, Part IV): one texel per cell of the level's bounds, the
   * brightness `shadeOf` gives it. The level shader multiplies by it, so a
   * move or a change of sight repaints this small image and leaves the
   * geometry standing.
   */
  private shadeTex: THREE.DataTexture | null = null
  private shadeUniforms = {
    shadeMap: { value: null as THREE.Texture | null },
    shadeOrigin: { value: new THREE.Vector2(0, 0) },
    shadeSize: { value: new THREE.Vector2(1, 1) },
  }
  /** The billboards need rebuilding for a reason other than a new scene revision (the player's bars changed). */
  private billboardsDirty = false
  /** Flat materials for the bars' rects, one per colour and alpha. */
  private barMats = new Map<string, THREE.MeshBasicMaterial>()
  private plinths = new Set<CellKey>()
  /** Third person: the camera stands over the lid, so the level is built without lids and with capped walls (II.11). */
  private aboveLid = false
  /** Third person: the shot the level was last built for, and the occluders it lowers (II.11). */
  private shot: OrbitShot | null = null
  /** Third person: how far behind the player the camera stands this frame, and the cells the way there cut (II.11). */
  private approach = { back: 0, cut: [] as CellKey[] }
  private cutKey = ''
  /** Third person: the player's doll, moved for the attack lunge. */
  private doll: THREE.Object3D | null = null
  private raycaster = new THREE.Raycaster()
  private pickMeshes: THREE.Mesh[] = []
  private flashMat: THREE.MeshBasicMaterial
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
  /** Extruded icon geometry per item, keyed by its layers. */
  private vmGeos = new Map<string, THREE.BufferGeometry | null>()
  /** Attack lift start, in seconds on the render clock; NaN when at rest. */
  private vmLift = NaN
  constructor(opts: Render3dOptions = {}) {
    this.opts = {
      view: opts.view ?? 'first',
      fov: opts.fov ?? 85,
      camDistance: opts.camDistance ?? THIRD_BACK,
      camHeight: opts.camHeight ?? THIRD_H,
      eyeHeight: opts.eyeHeight ?? EYE,
      restPitch: opts.restPitch ?? REST_PITCH,
      chamfer: opts.chamfer ?? 1 / 32,
      wallInset: opts.wallInset ?? WALL_INSET,
      viewmodel: opts.viewmodel ?? true,
      motion: opts.motion ?? true,
      minibars: opts.minibars ?? null,
    }
    this.cam.fov = this.opts.fov
    this.cam.rotation.order = 'YXZ'
    this.three.add(this.levelGroup, this.billboardGroup, this.overlayGroup)
    this.three.background = new THREE.Color(0x000000)
    const cur = new THREE.RingGeometry(0.34, 0.46, 4)
    cur.rotateX(-Math.PI / 2)
    this.cursorRingMat = new THREE.MeshBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.95, depthTest: false })
    this.cursorMesh = new THREE.Mesh(cur, this.cursorRingMat)
    this.cursorMesh.renderOrder = 11
    this.cursorMesh.visible = false
    this.overlayGroup.add(this.cursorMesh)
    // the WebTiles cursor icon laid flat on the cell; swapped in for the ring when the gamedata has it
    const cq = new THREE.PlaneGeometry(1, 1)
    // +90 about X puts v=1 (the image bottom, flipY off) at the south edge, as the floor decals are
    cq.rotateX(Math.PI / 2)
    this.cursorTileMesh = new THREE.Mesh(cq, this.cursorRingMat)
    this.cursorTileMesh.renderOrder = 11
    this.cursorTileMesh.visible = false
    this.overlayGroup.add(this.cursorTileMesh)
    this.flashMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false })
    this.voidMat = new THREE.MeshBasicMaterial({ color: 0x000000 })
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
  private makeLevelMaterial(tex: THREE.Texture, feature = false, blended = false): THREE.MeshBasicMaterial {
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
    const su = this.shadeUniforms
    m.onBeforeCompile = (shader) => {
      shader.uniforms.shadeMap = su.shadeMap
      shader.uniforms.shadeOrigin = su.shadeOrigin
      shader.uniforms.shadeSize = su.shadeSize
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float cut;\nattribute vec2 cell;\nvarying float vCut;\nvarying vec2 vCell;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvCut = cut;\nvCell = cell;')
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform sampler2D shadeMap;
uniform vec2 shadeOrigin;
uniform vec2 shadeSize;
varying float vCut;
varying vec2 vCell;`,
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
        // the cell's light, from the shade map (the vertex colour carries the tint and the face's own shade)
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= texture2D(shadeMap, (vCell - shadeOrigin + 0.5) / shadeSize).r;')
    }
    return m
  }

  /**
   * Repaint the shade map for this scene: a texel per cell over the bounds
   * (and one cell around them, for the void columns the level builds there),
   * `shadeOf` in 8 bits. A cell outside the map is full bright, as it was
   * when the shade was a vertex colour.
   */
  private updateShadeMap(scene: Scene) {
    const b = scene.bounds
    const ox = b.left - 1, oz = b.top - 1
    const w = Math.max(1, b.right - b.left + 3)
    const h = Math.max(1, b.bottom - b.top + 3)
    let tex = this.shadeTex
    if (!tex || tex.image.width !== w || tex.image.height !== h) {
      tex?.dispose()
      tex = this.shadeTex = new THREE.DataTexture(new Uint8Array(w * h), w, h, THREE.RedFormat, THREE.UnsignedByteType)
      tex.magFilter = THREE.NearestFilter
      tex.minFilter = THREE.NearestFilter
      tex.generateMipmaps = false
      // one byte per texel: rows are not padded to four
      tex.unpackAlignment = 1
      this.shadeUniforms.shadeMap.value = tex
      this.shadeUniforms.shadeSize.value.set(w, h)
    }
    this.shadeUniforms.shadeOrigin.value.set(ox, oz)
    const data = tex.image.data as Uint8Array
    for (let z = 0; z < h; z++) {
      for (let x = 0; x < w; x++) {
        const cell = scene.cells.get(cellKey(ox + x, oz + z))
        data[z * w + x] = Math.round(shadeOf(cell, scene) * 255)
      }
    }
    tex.needsUpdate = true
  }

  /** Footprint options for the inset walls of II.1. */
  private fo(): FootprintOptions {
    return { inset: this.opts.wallInset }
  }

  private makeGhostMaterial(opacity: number, map?: THREE.Texture, fade?: { start: number; range: number }): THREE.ShaderMaterial {
    // the shared uniforms are the same objects in every ghost material (one depth image, one camera);
    // a material with its own fade takes uniforms of its own for that alone
    const u: Record<string, THREE.IUniform> = { ...this.ghostUniforms, opacity: { value: opacity } }
    if (fade) {
      u.fadeStart = { value: fade.start }
      u.fadeRange = { value: fade.range }
    }
    if (map) u.map = { value: map }
    return new THREE.ShaderMaterial({
      uniforms: u,
      defines: map ? { GHOST_MAP: '' } : {},
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
   * The overlays (cursor, flash) are left out, and so are the ghosts
   * themselves: they sample this very depth texture, and a sprite that reads
   * the image it is being drawn into is a framebuffer feedback loop, which
   * GL refuses (`GL_INVALID_OPERATION` on the draw call).
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
    const ghostsWere: THREE.Object3D[] = []
    for (const h of this.billboardGroup.children) {
      if (h.userData.kind !== 'ghost' || !h.visible) continue
      h.visible = false
      ghostsWere.push(h)
    }
    r.setRenderTarget(rt)
    r.clear()
    r.render(this.three, this.cam)
    r.setRenderTarget(prevTarget)
    for (const h of ghostsWere) h.visible = true
    this.overlayGroup.visible = overlaysWere
  }

  setOptions(opts: Render3dOptions) {
    Object.assign(this.opts, opts)
    this.cam.fov = this.opts.fov
    this.cam.updateProjectionMatrix()
    this.builtRevision = -1
    this.builtLayout = -1
  }

  /** A new `player` message: the doll's bars are redrawn on the next frame; the level stands. */
  setMinibars(m: Minibars | null) {
    const before = minibarRects(this.opts.minibars)
    const after = minibarRects(m)
    this.opts.minibars = m
    if (JSON.stringify(before) !== JSON.stringify(after)) this.billboardsDirty = true
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
    }
    this.atlases.clear()
    for (const g of this.vmGeos.values()) g?.dispose()
    this.vmGeos.clear()
    this.vmBuilt = false
    this.builtRevision = -1
    this.builtLayout = -1
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
      texture: tex,
      width: w,
      height: h,
      wallMat: this.makeLevelMaterial(tex),
      featMat: this.makeLevelMaterial(tex, true),
      decalMat: this.makeLevelMaterial(tex, false, true),
      bbMat: new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide, depthWrite: true }),
      // A fragment draws only where the level's depth image is nearer, i.e.
      // exactly the part of the sprite the geometry hides, fading with the
      // depth gap. Fully visible sprites produce nothing.
      ghostMat: this.makeGhostMaterial(GHOST_ALPHA, tex),
      ghostVisibleMat: this.makeGhostMaterial(GHOST_ALPHA_VISIBLE, tex, { start: GHOST_FADE_VISIBLE_START, range: GHOST_FADE_VISIBLE }),
    }
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
    this.cursor = cursor
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
  destroy(): void {
    for (const g of this.vmGeos.values()) g?.dispose()
    this.vmGeos.clear()
    this.vmMat.dispose()
    this.depthTarget?.dispose()
    this.depthTarget = null
    this.shadeTex?.dispose()
    this.shadeTex = null
    this.shadowGeo.dispose()
    this.shadowMat.dispose()
    this.renderer?.dispose()
    this.renderer = null
  }

  /**
   * The lens after the last frame, for the HUD's edge pips (apps/orbrun
   * pips.ts): the vertical half-angle, the aspect, the view's pixel height
   * (so a pip can be drawn the size the sprite would have been) and cell
   * centres in the camera's own space, so what the pips call "off screen" is
   * exactly what this frame did not draw, first or third person, mid-turn or
   * at rest.
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
    // inset by a quarter texel to stop bleeding
    const e = 0.25
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
    const k = cellKey(cur.x, cur.y)
    // the cursor marks a cell, not a wall cap: it lies on the ground even when the cell is solid
    // (its materials skip the depth test, so it shows through the wall at eye level), and rides a
    // lowered wall's plinth so it is not buried inside it
    const h = this.plinths.has(k) ? PLINTH_H : 0
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
        tex.needsUpdate = true
        this.cursorTileMesh.material = mat
      }
      this.cursorTileMesh.visible = true
      this.cursorMesh.visible = false
      this.cursorTileMesh.position.set(cur.x + 0.5, h + 0.012, cur.y + 0.5)
    } else {
      this.cursorTileMesh.visible = false
      this.cursorMesh.visible = true
      this.cursorRingMat.color.set(cur.mode === 'map' ? 0xffffff : 0xff8800)
      this.cursorMesh.position.set(cur.x + 0.5, h + 0.012, cur.y + 0.5)
    }
  }

  private rebuildLevel(scene: Scene) {
    for (const child of [...this.levelGroup.children]) {
      this.levelGroup.remove(child)
      const m = child as THREE.Mesh
      m.geometry?.dispose()
    }
    this.pickMeshes = []
    const tiles = this.tiles
    if (!tiles) return
    // only the third-person camera's approach lowers a wall: the cells it stands in or looks across come down to plinths (II.11)
    this.plinths = new Set()
    if (this.shot) {
      for (const k of this.shot.cut) this.plinths.add(k)
      for (const k of this.approach.cut) this.plinths.add(k)
    }
    const fo = this.fo()
    const classAt = sceneClassAt(scene)
    const builders = new Map<string, GeoBuilder>()
    const decalBuilders = new Map<string, GeoBuilder>()
    const voids = new GeoBuilder()
    const flash = new GeoBuilder()
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
    const tileOf = (id: number) => {
      const r = tiles.tile(id)
      if (!r) return null
      const a = this.atlas(r.atlas)
      if (!a) return null
      return { r, a, uv: this.uvFor(r, a) }
    }
    // over the lid there is no lid: the camera looks down into the level, and every wall gets a cap instead
    const lids = !this.aboveLid
    const levelCeiling = lids && scene.level.ceilingTile !== null ? tileOf(scene.level.ceilingTile) : null
    const ceilingCache = new Map<number, ReturnType<typeof tileOf>>()
    /** The lid over an open cell: its own nearby-wall tile, else the level's; none over the lid. */
    const ceilingOf = (c: SceneCell | undefined) => {
      if (!lids) return null
      if (scene.level.sky !== 'none') return null
      if (!c || c.ceilingTile === undefined) return levelCeiling
      let t = ceilingCache.get(c.ceilingTile)
      if (t === undefined) ceilingCache.set(c.ceilingTile, (t = tileOf(c.ceilingTile)))
      return t
    }
    /**
     * Whether a cell's feature stands as a billboard here. Upright features do
     * — except the one underfoot in first person, where the camera sits in the
     * middle of the sprite: there the tile lies back down on the floor, so a
     * staircase you are standing on still reads as one.
     */
    const onPlayer = (c: SceneCell) => scene.playerOnLevel && c.x === scene.player.x && c.y === scene.player.y
    const stands = (c: SceneCell) => c.stance === 'upright' && !(!this.shot && onPlayer(c))
    const heightOfFeature = (c: SceneCell) => (c.feature?.type === 'stairs' ? STAIR_H : FIXTURE_H)
    const isSolid = (c: SceneCell | undefined) => !c || c.kind === 'unknown' || c.occluder
    const isVoidCell = (c: SceneCell | undefined) => !c || c.kind === 'unknown'
    const heightOf = (c: SceneCell | undefined, k: CellKey) => (isSolid(c) ? (this.plinths.has(k) ? PLINTH_H : 1) : 0)

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
          if (cell.flash && cell.flash.a > 0) {
            flash.at(x, y).quad([[x, 0.01, y + 1], [x + 1, 0.01, y + 1], [x + 1, 0.01, y], [x, 0.01, y]], { u0: 0, v0: 0, u1: 1, v1: 1 }, 1, {
              r: cell.flash.r / 255,
              g: cell.flash.g / 255,
              b: cell.flash.b / 255,
            })
          }
          continue
        }
        // solid: wall, door or void. The body is the footprint of II.1
        // (inset walls): the cell minus the floor grown by the inset, so it
        // meets every neighbour flush. Faces come from the footprint; corner
        // chamfers, plinths and the patches of floor and lid that continue
        // under and over the removed parts are added here.
        const h = heightOf(cell, k)
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
        const facePoints = (d: Dir, t0: number, t1: number, depth: number, y0: number, y1 = h): [number, number, number][] => {
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
          if (h === 1) {
            // full wall: tile stretched from y0..1
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
          } else {
            // plinth skirt: bottom texel row stretched, darker
            const a = wt.a
            const uv = { ...faceU(d, wt.uv, t0, t1), v0: (wt.r.sy + wt.r.h - 1.5) / a.height, v1: (wt.r.sy + wt.r.h - 0.5) / a.height }
            get(wt.r.atlas).at(x, y).quad(p, uv, faceShade * 0.4, tint, undefined, true)
          }
        }
        for (const f of fp.faces) {
          const d: Dir = f.nz < -0.5 ? 'n' : f.nz > 0.5 ? 's' : f.nx < -0.5 ? 'w' : 'e'
          const horizontal = d === 'n' || d === 's'
          let t0 = horizontal ? Math.min(f.a[0], f.b[0]) : Math.min(f.a[1], f.b[1])
          let t1 = horizontal ? Math.max(f.a[0], f.b[0]) : Math.max(f.a[1], f.b[1])
          const depth = d === 'n' ? f.a[1] : d === 's' ? 1 - f.a[1] : d === 'w' ? f.a[0] : 1 - f.a[0]
          let y0 = 0
          if (f.covered) {
            // a boundary the neighbour's body covers: only the part above a lower neighbour (a plinth) shows
            const otherH = heightOf(across[d].other, across[d].ok)
            if (otherH >= h) continue
            y0 = otherH
          }
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
        // under what the inset removed, its lid over it; a plinth's top.
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
          if (h === 1 && ceiling) flat(get(ceiling.r.atlas).at(lx, lz), 1, pts, (fx, fz) => ceilUV(ceiling.uv, fx, fz), false, 0.75)
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
            [x + p1[0], h, y + p1[1]],
            [x + p0[0], h, y + p0[1]],
          ]
          const chShade = (1 + SIDE_SHADE) / 2
          const nsDir: Dir = i >> 1 ? 's' : 'n'
          const u = black ? null : faceU(nsDir, wt.uv, Math.min(C[0], A[0]), Math.max(C[0], A[0]))
          if (black || !u) {
            voids.quad(ch, { u0: 0, v0: 0, u1: 1, v1: 1 }, 0, { r: 0, g: 0, b: 0 })
          } else if (h === 1) {
            get(wt.r.atlas).at(x, y).quad(ch, { ...wt.uv, ...u }, chShade, tint, undefined, true)
          } else {
            const a = wt.a
            get(wt.r.atlas).at(x, y).quad(ch, { ...u, v0: (wt.r.sy + wt.r.h - 1.5) / a.height, v1: (wt.r.sy + wt.r.h - 0.5) / a.height }, chShade * 0.4, tint, undefined, true)
          }
          // the cut-off triangle: floor continues in from the cell across the N/S edge, the lid covers it
          const tri: [number, number][] = (i & 1) === i >> 1 ? [C, A, Bp, Bp] : [C, Bp, A, A]
          patch(tri, i >> 1 ? s : n)
        }
        // top of a plinth: the body outline at plinth height; over the lid
        // every wall is capped the same way, at its full height, so the
        // level reads as solid blocks from above rather than open boxes
        if (h < 1 || !lids) {
          const outline: [number, number][] = []
          for (const i of [0, 1, 3, 2]) {
            const [cx, cz] = cornerPt(i)
            if (rect.cut[i]) {
              if (i === 0) outline.push([0, t], [t, t], [t, 0])
              else if (i === 1) outline.push([1 - t, 0], [1 - t, t], [1, t])
              else if (i === 3) outline.push([1, 1 - t], [1 - t, 1 - t], [1 - t, 1])
              else outline.push([t, 1], [t, 1 - t], [0, 1 - t])
            } else if (cornerOn[i] && Nv[i] > 0) {
              const N = Nv[i]
              const sx = i & 1 ? -1 : 1, sz = i >> 1 ? -1 : 1
              const A: [number, number] = [cx + sx * N, cz]
              const Bp: [number, number] = [cx, cz + sz * N]
              if (i === 0 || i === 3) outline.push(Bp, A)
              else outline.push(A, Bp)
            } else outline.push([cx, cz])
          }
          outline.reverse()
          const ts = black ? 0 : 1
          const top = black ? voids : get(wt.r.atlas).at(x, y)
          const uvOf = (fx: number, fz: number): [number, number] => (black ? [0, 0] : floorUV(wt.uv, fx, fz))
          flat(top, h, outline, uvOf, true, ts)
          // ceiling above a plinth so the room keeps its lid, in the lid of the room it stands in
          const ceiling = isVoid ? null : ceilingOf(openN ? n : openS ? s : openW ? w : e)
          if (ceiling) {
            get(ceiling.r.atlas).at(x, y).quad([[x, 1, y], [x + 1, 1, y], [x + 1, 1, y + 1], [x, 1, y + 1]], ceiling.uv, 0.75, tint)
          }
        }
      }
    }
    for (const [name, gb] of builders) {
      const geo = gb.build()
      if (!geo) continue
      const a = this.atlas(name)
      if (!a) continue
      const mesh = new THREE.Mesh(geo, a.wallMat)
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
      mesh.renderOrder = 1
      this.levelGroup.add(mesh)
    }
    const vg = voids.build()
    if (vg) this.levelGroup.add(new THREE.Mesh(vg, this.voidMat))
    const fg = flash.build()
    if (fg) {
      const m = new THREE.Mesh(fg, this.flashMat)
      m.renderOrder = 5
      this.levelGroup.add(m)
    }
    // upright features stand as billboards built with the level
    for (const cell of scene.cells.values()) {
      if (cell.kind === 'unknown' || cell.occluder) continue
      if (cell.featureTile === undefined || !stands(cell)) continue
      const ft = tileOf(cell.featureTile)
      if (!ft) continue
      // a fixture takes its light from the shade map (featMat), so its vertex colour is the tint alone
      this.addStanding(this.levelGroup, cell.x, cell.y, [{ ...ft, ox: 0, oy: 0 }], heightOfFeature(cell), 1, tint, true)
    }
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
      const geo = new THREE.PlaneGeometry(wq, hq)
      const uvAttr = geo.getAttribute('uv') as THREE.BufferAttribute
      uvAttr.setXY(0, l.uv.u0, l.uv.v0)
      uvAttr.setXY(1, l.uv.u1, l.uv.v0)
      uvAttr.setXY(2, l.uv.u0, v1)
      uvAttr.setXY(3, l.uv.u1, v1)
      uvAttr.needsUpdate = true
      const lt = l.tint || tint
      const colors = new Float32Array(4 * 3)
      for (let j = 0; j < 4; j++) {
        colors[j * 3] = shade * lt.r
        colors[j * 3 + 1] = shade * lt.g
        colors[j * 3 + 2] = shade * lt.b
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      // the cell the sprite stands in, for the level shader's shade map (fixtures)
      const cells = new Float32Array(4 * 2)
      for (let j = 0; j < 4; j++) {
        cells[j * 2] = x
        cells[j * 2 + 1] = y
      }
      geo.setAttribute('cell', new THREE.BufferAttribute(cells, 2))
      const mesh = new THREE.Mesh(geo, ghost === 'visible' ? l.a.ghostVisibleMat : ghost === 'remembered' ? l.a.ghostMat : fixed ? l.a.featMat : l.a.bbMat)
      mesh.position.set(cx, bottom + hq / 2, i * 0.002)
      // ghosts draw before every sprite so a nearer billboard paints over them
      mesh.renderOrder = ghost === 'none' ? 1 + i : -1
      holder.add(mesh)
      i++
    }
    holder.userData.billboard = true
    holder.userData.fixedFacing = fixed
    group.add(holder)
    return holder
  }

  /**
   * The player's health and magic bars on the doll (scene bars.ts): the same
   * rects the 2D renderer paints, as flat quads in the doll's frame, on the
   * top edge where a monster's damage bar now sits. `above` is how many
   * sprite layers the holder already has, so the bars stack over them.
   */
  private addMinibars(holder: THREE.Object3D, scale: number, above: number) {
    const rects = minibarRects(this.opts.minibars)
    if (!rects.length) return
    const cell = MINIBAR_CELL
    let i = above
    for (const r of rects) {
      const key = r.colour + '@' + r.alpha
      let mat = this.barMats.get(key)
      if (!mat) {
        mat = new THREE.MeshBasicMaterial({ color: r.colour, transparent: r.alpha < 1, opacity: r.alpha, depthWrite: false, side: THREE.DoubleSide })
        this.barMats.set(key, mat)
      }
      const wq = (r.w / cell) * scale
      const hq = (r.h / cell) * scale
      const cx = ((r.x + r.w / 2 - cell / 2) / cell) * scale
      const bottom = ((cell - (r.y + r.h)) / cell) * scale
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(wq, hq), mat)
      mesh.position.set(cx, bottom + hq / 2, i * 0.002)
      mesh.renderOrder = 1 + i
      holder.add(mesh)
      i++
    }
  }

  private rebuildBillboards(scene: Scene) {
    this.billboardsDirty = false
    this.ghostCount = 0
    for (const child of [...this.billboardGroup.children]) {
      this.billboardGroup.remove(child)
      child.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.userData.shared) return
        if (m.geometry) m.geometry.dispose()
        if (m.userData.ownMaterial) (m.material as THREE.Material).dispose()
      })
    }
    const tiles = this.tiles
    if (!tiles) return
    const tint = scene.level.tint
    const tileOf = (id: number) => {
      const r = tiles.tile(id)
      if (!r) return null
      const a = this.atlas(r.atlas)
      if (!a) return null
      return { r, a, uv: this.uvFor(r, a) }
    }
    this.doll = null
    const third = this.opts.view === 'third' && !!this.shot
    for (const b of scene.billboards) {
      // in first person the player is the camera and the cell underfoot is behind it; in third person both are in view
      if (b.kind === 'player' && !third) continue
      if (b.x === scene.player.x && b.y === scene.player.y && scene.playerOnLevel && b.kind !== 'cloud' && !third) continue
      const cell = scene.cells.get(cellKey(b.x, b.y))
      const shade = this.shadeFor(cell, scene)
      if (b.kind === 'cloud') {
        const t = tileOf(b.tile)
        if (!t) continue
        const h = this.addStanding(this.billboardGroup, b.x, b.y, [{ ...t, ox: 0, oy: 0 }], b.height, shade, tint, false)
        h.traverse((o) => {
          const m = o as THREE.Mesh
          if (m.material) {
            m.material = (m.material as THREE.Material).clone()
            m.userData.ownMaterial = true
            ;(m.material as THREE.MeshBasicMaterial).opacity = 0.55
            ;(m.material as THREE.MeshBasicMaterial).depthWrite = false
          }
        })
        continue
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
      if (!layers.length) continue
      const nSprite = layers.length
      // status badges sit in the sprite's own frame, at the offsets the builder resolved;
      // one pinned to the top edge (the damage bar) starts its opaque texels on row 0
      if (b.statusIcons) {
        for (const i of b.statusIcons) {
          const t = tileOf(i.tile)
          if (t) layers.push({ ...t, ox: i.ox, oy: i.at === 'top' ? -t.r.oy : i.oy })
        }
      }
      const bh = b.kind === 'player' ? b.height * DOLL_SCALE : b.height
      // scenery monsters (plants, bushes) are fixtures: they stand square like statues and take their light from the shade map
      const holder = this.addStanding(this.billboardGroup, b.x, b.y, layers, bh, b.scenery ? 1 : shade, tint, !!b.scenery)
      holder.userData.kind = b.kind
      if (b.kind === 'player') {
        this.doll = holder
        this.addMinibars(holder, bh, nSprite + (b.statusIcons?.length ?? 0))
      }
      // whatever the 2D map shows on the cell shows through walls here (II.4):
      // the sprite and its status badges, so a sleeping or fleeing monster
      // reads the same behind a wall as in the open
      // what the server shows right now keeps a strong ghost at any depth; remembered knowledge stays a faint hint that fades with the gap
      const ghostKind: GhostKind = cell?.visibility === 'visible' ? 'visible' : 'remembered'
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
              : b.kind === 'player'
                ? DOLL_GHOST_TINT
                : GHOST_TINT.item
      // the badges keep their own colours so a damage bar or a "zzz" reads the same through a wall as in the open
      const ghostLayers = layers.map((l, i) => (i < nSprite ? l : { ...l, tint: BADGE_TINT }))
      const g = this.addStanding(this.billboardGroup, b.x, b.y, ghostLayers, bh, ghostKind === 'visible' ? (b.scenery ? 1 : shade) : 1, gt, false, ghostKind)
      this.ghostCount++
      if (b.kind === 'projectile') g.position.y = PROJECTILE_LIFT
      g.userData.kind = 'ghost'
      if (b.kind === 'projectile') holder.position.y = PROJECTILE_LIFT
      if (b.alpha !== undefined && b.alpha < 1) {
        let k = 0
        holder.traverse((o) => {
          const m = o as THREE.Mesh
          if (!m.material || !m.geometry) return
          if (k++ >= nSprite) return
          m.material = (m.material as THREE.Material).clone()
          m.userData.ownMaterial = true
          ;(m.material as THREE.MeshBasicMaterial).opacity = b.alpha as number
          ;(m.material as THREE.MeshBasicMaterial).depthWrite = false
        })
      }
      // ground shadow: one shared disc, scaled to the sprite
      const sh = new THREE.Mesh(this.shadowGeo, this.shadowMat)
      sh.userData.shared = true
      const sr = Math.max(0.6, bh)
      sh.scale.set(sr, sr, 1)
      sh.rotation.x = -Math.PI / 2
      sh.position.set(0, 0.003, 0)
      holder.add(sh)
    }
  }

  render(): void {
    const r = this.renderer
    const scene = this.scene
    const cam = this.camera
    if (!r || !scene || !cam) return
    // third person: the shot follows the facing goal, and a change of camera
    // cell or of the walls it cuts rebuilds the level with them lowered
    const shot = this.opts.view === 'third' ? orbitShot(scene, cam.facing) : null
    // over the lid nothing stands between the camera and the doll: the walls
    // are a cell high and the camera looks down over them, so none is cut
    const aboveLid = !!shot && this.thirdHeight() > LID_H
    if (shot && aboveLid) shot.cut = []
    // ...and so does the ground the camera really stands on: mid-turn and after
    // a free look the eye is off the facing line, and whatever it stands in or
    // looks across there comes down too, or pulls the camera in if never seen
    if (shot) {
      const dist = Math.hypot(shot.x - scene.player.x, shot.y - scene.player.y)
      const back = Math.max(THIRD_MIN_BACK, Math.min(this.opts.camDistance, THIRD_MAX_BACK, dist))
      this.approach = cameraApproach(scene, cam.yaw, back, THIRD_MIN_BACK)
      if (aboveLid) this.approach.cut = []
    }
    const cutKey = shot ? `${shot.x},${shot.y}:${shot.cut.join(',')}|${this.approach.cut.join(',')}|${aboveLid ? 'over' : 'under'}` : ''
    if (cutKey !== this.cutKey) {
      this.cutKey = cutKey
      this.shot = shot
      this.aboveLid = aboveLid
      this.builtRevision = -1
      this.builtLayout = -1
    }
    if (scene.revision !== this.builtRevision) {
      this.builtRevision = scene.revision
      const bg = scene.level.sky === 'open' ? 0x0b1220 : scene.level.sky === 'dark' ? 0x120818 : 0x000000
      ;(this.three.background as THREE.Color).set(bg)
      // the geometry stands until the layout changes (Part IV); a move, a
      // change of sight or a monster's step repaint the shade map and the
      // billboards, which is cheap, and leave the level's meshes alone
      const t = scene.level.tint
      const tintKey = `${t.r},${t.g},${t.b}`
      if (scene.layoutRevision !== this.builtLayout || tintKey !== this.builtTint) {
        this.builtLayout = scene.layoutRevision
        this.builtTint = tintKey
        this.rebuildLevel(scene)
      }
      this.updateShadeMap(scene)
      this.rebuildBillboards(scene)
    } else if (this.billboardsDirty) this.rebuildBillboards(scene)
    // camera
    if (shot) this.placeThirdPerson(scene, cam)
    else {
      this.cam.position.set(cam.x + 0.5, Math.max(EYE_MIN, Math.min(EYE_MAX, this.opts.eyeHeight)), cam.y + 0.5)
      this.cam.rotation.set(cam.pitch, -cam.yaw, 0)
    }
    // Billboards face the camera (yaw only), and it is the camera's own yaw
    // that counts, not the facing: in third person the shot is aimed a
    // shoulder's width right of the facing line, so the two differ by a few
    // degrees and a billboard squared to the facing stands visibly turned.
    // Squared to the view plane a sprite is never foreshortened, so its
    // texture is sampled head-on and stays as sharp as the art allows.
    const camYaw = this.cam.rotation.y
    for (const h of this.billboardGroup.children) if (h.userData.billboard) h.rotation.y = camYaw
    for (const h of this.levelGroup.children) if (h.userData.billboard) h.rotation.y = camYaw
    this.placeCursor()
    // the ghost pass needs the depth image only when there is a ghost to test against it
    if (this.ghostCount > 0) this.renderOccluderDepth(r)
    r.render(this.three, this.cam)
    this.renderViewmodel(r, scene)
  }

  /** The third-person camera's height, clamped to its range. */
  private thirdHeight(): number {
    return Math.max(THIRD_MIN_H, Math.min(THIRD_MAX_H, this.opts.camHeight))
  }

  /**
   * Third person (II.11). The camera swings on an arc about the player's
   * cell at the shot's distance, so at rest (yaw on a heading) it stands at
   * the centre of the cell behind, and mid-turn it sweeps between two such
   * cells rather than cutting the corner. It aims at the floor THIRD_AHEAD
   * cells ahead of the player, a shoulder's width right of the facing line;
   * the stick's pitch is a glance from that rest, clamped for the lid.
   */
  private placeThirdPerson(scene: Scene, cam: Camera) {
    const px = scene.player.x + 0.5, pz = scene.player.y + 0.5
    const fx = Math.sin(cam.yaw), fz = -Math.cos(cam.yaw)
    const back = this.approach.back
    const ex = px - fx * back, ez = pz - fz * back
    const eh = this.thirdHeight()
    this.cam.position.set(ex, eh, ez)
    // aim point: ahead along facing, offset to the right (right = (cos yaw, sin yaw))
    const ax = px + fx * THIRD_AHEAD + Math.cos(cam.yaw) * THIRD_SHOULDER
    const az = pz + fz * THIRD_AHEAD + Math.sin(cam.yaw) * THIRD_SHOULDER
    const dx = ax - ex, dz = az - ez
    const restYaw = Math.atan2(dx, -dz)
    const restPitch = -Math.atan2(eh, Math.hypot(dx, dz))
    const pitch = Math.max(THIRD_PITCH_MIN, Math.min(THIRD_PITCH_MAX, restPitch + (cam.pitch - this.opts.restPitch)))
    this.cam.rotation.set(pitch, -restYaw, 0)
    // attack cue: the doll lunges along facing and settles back
    if (this.doll) {
      const t = Number.isNaN(this.vmLift) ? NaN : this.liftEnvelope(nowSeconds() - this.vmLift)
      const lunge = Number.isNaN(t) ? 0 : t * DOLL_LUNGE
      if (Number.isNaN(t)) this.vmLift = NaN
      const gx = Math.sin(dirToYaw(cam.facing)), gz = -Math.cos(dirToYaw(cam.facing))
      const off = Math.min(DOLL_BACK, Math.max(0, back - THIRD_MIN_BACK))
      this.doll.position.set(px + gx * lunge - fx * off, 0, pz + gz * lunge - fz * off)
    }
  }

  // ------------------------------------------------------------- viewmodel

  /** Where the hands are drawn, as fractions of the canvas (II.7), so the HUD keeps its corner clear of them; empty when no hand is. */
  handsFootprint(): HandRect[] {
    if (!this.vmVisible) return []
    const vm = this.viewmodel!
    return handsFootprint({ weapon: !!vm.weapon, offhand: vm.offhand ? (vm.offhand.name?.startsWith('HAND2_') ? 'shield' : 'weapon') : 'none' }, this.vmCam.aspect)
  }

  private get vmVisible(): boolean {
    // no hands in third person: the doll is the body
    if (this.shot) return false
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
   * [-depth, 0].
   */
  private extrudeIcon(item: HandItem): THREE.BufferGeometry | null {
    const px = this.paintIcon(item)
    if (!px) return null
    const { w, h, data } = px
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
        face([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], c.r, c.g, c.b, VM_SHADE.front)
        face([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], c.r, c.g, c.b, VM_SHADE.front)
        if (!opaque(x, y - 1)) face([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], c.r, c.g, c.b, VM_SHADE.top)
        if (!opaque(x, y + 1)) face([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], c.r, c.g, c.b, VM_SHADE.bottom)
        if (!opaque(x - 1, y)) face([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], c.r, c.g, c.b, VM_SHADE.side)
        if (!opaque(x + 1, y)) face([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], c.r, c.g, c.b, VM_SHADE.side)
      }
    }
    if (!idx.length) return null
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    g.setIndex(idx)
    return g
  }

  /** One hand: the extruded icon, built once per distinct item. */
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
    group.add(new THREE.Mesh(geo, this.vmMat))
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
    const lift = this.liftEnvelope(nowSeconds() - this.vmLift)
    if (Number.isNaN(lift)) this.vmLift = NaN
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
    // hands take the level's light like everything else in the view
    const tint = scene.level.tint
    this.vmMat.color.setRGB(tint.r, tint.g, tint.b)
    const prevAutoClear = r.autoClear
    r.autoClear = false
    r.clearDepth()
    r.render(this.vmScene, this.vmCam)
    r.autoClear = prevAutoClear
  }
}

function nowSeconds(): number {
  return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000
}

export { keyToXY }
export type { Billboard, Viewmodel }
export * from './footprint.js'
export { handsFootprint, type HandRect, type HandsHeld } from './hands.js'
