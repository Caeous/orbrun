/**
 * The renderer's GLSL (ES 3.00, WebGL2), as raw shaders: three.js is the GL
 * layer under them and nothing of its material system is used.
 *
 * Every shader that draws into the frame shares `FIELDS`: the shade map (one
 * texel per cell, how bright the cell is drawn) and the flash map (the wash
 * the game lays over a cell), both over the level's bounds. Colour is worked
 * in linear light; the frame's render target is sRGB, so the shaders that draw
 * into it write linear and the hardware encodes, while the ones that draw on
 * the canvas (`OUT_SRGB`) encode themselves.
 */

/** Uniforms and helpers for the cell fields. */
const FIELDS = /* glsl */ `
uniform sampler2D shadeMap;
uniform sampler2D flashMap;
uniform vec2 fieldOrigin;
uniform vec2 fieldSize;
float shadeAt(vec2 cell) {
  return texture(shadeMap, (cell - fieldOrigin + 0.5) / fieldSize).r;
}
vec3 flashed(vec3 c, vec3 world) {
  vec4 flash = texture(flashMap, (world.xz - fieldOrigin) / fieldSize);
  return mix(c, flash.rgb, flash.a);
}`

/** Linear to sRGB, as three encodes for the canvas. */
const ENCODE = /* glsl */ `
vec3 toSRGB(vec3 c) {
  return mix(pow(c, vec3(0.41666)) * 1.055 - vec3(0.055), c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308))));
}
vec4 outColor(vec4 c) {
#ifdef OUT_SRGB
  return vec4(toSRGB(c.rgb), c.a);
#else
  return c;
#endif
}`

// ------------------------------------------------------------------ level

export const LEVEL_VERT = /* glsl */ `
precision highp float;
in vec3 position;
in vec2 uv;
in vec3 color;
in vec2 cell;
in float cut;
uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
out vec2 vUv;
out vec3 vColor;
out vec2 vCell;
out float vCut;
out vec3 vWorld;
void main() {
  vUv = uv;
  vColor = color;
  vCell = cell;
  vCut = cut;
  vWorld = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

/**
 * The level: the tile times the vertex colour (tint and the face's own shade)
 * times the cell's light, washed by the flash. Wall faces wind toward their
 * open neighbour, so a back-facing one is the far side of the wall and is
 * culled. `alphaTest` is 0.5 on the masonry (all or nothing), a sliver on a
 * blended decal, which keeps its texels' alpha.
 */
export const LEVEL_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D map;
uniform float alphaTest;
uniform float opacity;
${FIELDS}
${ENCODE}
in vec2 vUv;
in vec3 vColor;
in vec2 vCell;
in float vCut;
in vec3 vWorld;
out vec4 fragColor;
void main() {
  if (vCut > 0.5 && !gl_FrontFacing) discard;
  vec4 t = texture(map, vUv);
  if (t.a < alphaTest) discard;
  vec3 c = t.rgb * vColor * shadeAt(vCell);
  fragColor = outColor(vec4(flashed(c, vWorld), t.a * opacity));
}`

/** Never-seen space: black, however lit. */
export const VOID_FRAG = /* glsl */ `
precision highp float;
in float vCut;
out vec4 fragColor;
void main() {
  if (vCut > 0.5 && !gl_FrontFacing) discard;
  fragColor = vec4(0.0, 0.0, 0.0, 1.0);
}`

// ---------------------------------------------------------------- sprites

/**
 * Standing sprites (monsters, items, fixtures, doors, the hands) as instances
 * of one box. An instance is a tile clipped to `iTexel` rows (its rect in
 * atlas texels), stood on a quad `iQuad` (centre and half sizes in the
 * sprite's frame, world units), `iZ.x` forward of the sprite's origin and
 * `iZ.y` deep; `iColor` is the tint and light, with the opacity in alpha;
 * `iMisc` is (mode bits, hull width in texels, texel size in world units,
 * fixed yaw); `iCell` the cell whose light it takes.
 *
 * Mode bits: 1 turn to the eye (else stand at the fixed yaw); 2 thick (a
 * block `iZ.y` deep behind the front, with the rim of every opaque texel that
 * borders a transparent one, else a flat quad); 4 hull both sides (the hands,
 * seen from behind as often as in front); 8 inked with a flat ring on the
 * front face instead of a hull, off the tile's edge columns (a board set into
 * a wall run, whose hull would swing out of its doorway and whose edge
 * columns stand in the masonry); 16 lit by the shade map (else the light is
 * in `iColor`); 32 washed by `flashOverride` instead of the flash map (the
 * hands, which stand in no cell).
 *
 * The fragment shader marches the view ray through the texel grid of the
 * block: the first body texel it crosses is the hit, coloured by that texel
 * and the face it came in by; leaving the hull's texels for air, or passing
 * out the back of the block inside them, is the black line round the sprite —
 * crawl's ink put back at the block's depth, a texel wide from every angle,
 * and the wider shell in `shellColor` round the sprite the cursor is on.
 * Depth is written from the hit, so sprites sort against the level and each
 * other. Under `GHOST` the quad is flat, the ring round the body is its ink,
 * and only what the frame's depth hides is drawn, fading with the gap.
 */
export const SPRITE_VERT = /* glsl */ `
precision highp float;
in vec3 position;
in vec3 iAnchor;
in vec4 iQuad;
in vec2 iZ;
in vec4 iTexel;
in vec4 iColor;
in vec4 iMisc;
in vec2 iCell;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat4 modelMatrix;
uniform mat4 modelInverse;
uniform vec3 cameraPosition;
uniform float standYaw;
out vec3 vLocal;
flat out vec3 fEye;
flat out vec3 fAnchor;
flat out vec4 fQuad;
flat out vec2 fZ;
flat out vec4 fTexel;
flat out vec4 fColor;
flat out vec4 fMisc;
flat out vec2 fCell;
flat out float fYaw;
void main() {
  int mode = int(iMisc.x + 0.5);
  float yaw = (mode & 1) != 0 ? standYaw : iMisc.w;
  bool thick = (mode & 2) != 0;
  float x0 = iQuad.x - iQuad.z, x1 = iQuad.x + iQuad.z;
  float y0 = iQuad.y - iQuad.w, y1 = iQuad.y + iQuad.w;
  float z1 = iZ.x, z0 = thick ? iZ.x - iZ.y : iZ.x;
  vec3 local = vec3(mix(x0, x1, position.x), mix(y0, y1, position.y), mix(z0, z1, position.z));
  float c = cos(yaw), s = sin(yaw);
  vec3 world = (modelMatrix * vec4(iAnchor + vec3(c * local.x + s * local.z, local.y, c * local.z - s * local.x), 1.0)).xyz;
  // the eye in the sprite's frame, for the march
  vec3 e = (modelInverse * vec4(cameraPosition, 1.0)).xyz - iAnchor;
  fEye = vec3(c * e.x - s * e.z, e.y, c * e.z + s * e.x);
  vLocal = local;
  fAnchor = iAnchor; fQuad = iQuad; fZ = vec2(z0, z1); fTexel = iTexel; fColor = iColor; fMisc = iMisc; fCell = iCell; fYaw = yaw;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`

export const SPRITE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D map;
uniform sampler2D distMap;
uniform vec2 atlasSize;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat4 modelMatrix;
uniform vec3 shellColor;
uniform vec4 flashOverride;
#ifdef GHOST
uniform sampler2D sceneDepth;
uniform vec2 resolution;
uniform float cameraNear;
uniform float cameraFar;
uniform float fadeStart;
uniform float fadeRange;
#endif
${FIELDS}
${ENCODE}
in vec3 vLocal;
flat in vec3 fEye;
flat in vec3 fAnchor;
flat in vec4 fQuad;
flat in vec2 fZ;
flat in vec4 fTexel;
flat in vec4 fColor;
flat in vec4 fMisc;
flat in vec2 fCell;
flat in float fYaw;
out vec4 fragColor;

const float GHOST_GAP = 0.06;
const float SHADE_FRONT = 1.0;
const float SHADE_TOP = 0.86;
const float SHADE_SIDE = 0.7;
const float SHADE_BOTTOM = 0.5;
const float FAR = 255.0;

/** Whether texel (i, j) of the tile is body: opaque art, inside the tile. */
bool body(ivec2 t) {
  if (t.x < 0 || t.y < 0 || t.x >= int(fTexel.z) || t.y >= int(fTexel.w)) return false;
  return texture(distMap, (vec2(t) + fTexel.xy + 0.5) / atlasSize).r < 0.5 / 255.0;
}
/**
 * How far texel (i, j) stands from this tile's body, counted in axis steps as
 * the art's ink is drawn: 1 beside it, 2 two out, FAR further (or past the
 * hull's width, which is all that is asked). The tile's own body alone: the
 * atlas packs tiles edge to edge, and a neighbour's art must not ink this one.
 */
float hullDist(ivec2 t, float grow) {
  if (body(t + ivec2(1, 0)) || body(t - ivec2(1, 0)) || body(t + ivec2(0, 1)) || body(t - ivec2(0, 1))) return 1.0;
  if (grow < 2.0) return FAR;
  if (body(t + ivec2(2, 0)) || body(t - ivec2(2, 0)) || body(t + ivec2(0, 2)) || body(t - ivec2(0, 2))) return 2.0;
  if (body(t + ivec2(1, 1)) || body(t + ivec2(1, -1)) || body(t + ivec2(-1, 1)) || body(t + ivec2(-1, -1))) return 2.0;
  return FAR;
}
vec4 texelAt(ivec2 t) {
  return texture(map, (vec2(t) + fTexel.xy + 0.5) / atlasSize);
}
float faceShade(int face) {
  return face == 2 ? SHADE_SIDE : face == 3 ? SHADE_TOP : face == 4 ? SHADE_BOTTOM : SHADE_FRONT;
}
float perspectiveDepthToViewZ(float depth, float near, float far) {
  return (near * far) / ((far - near) * depth - far);
}

void main() {
  int mode = int(fMisc.x + 0.5);
  bool thick = (mode & 2) != 0;
  bool hullFront = (mode & 4) != 0;
  bool ring = (mode & 8) != 0;
  float k = fMisc.z;
  float grow = fMisc.y;
  float W = fTexel.z, H = fTexel.w;
  // texel space: column right, row down from the tile's top-left corner, depth into the block from its front
  vec3 origin = vec3(fQuad.x - fQuad.z, fQuad.y + fQuad.w, fZ.y);
  vec3 toTexel = vec3(1.0, -1.0, -1.0) / k;
  vec3 p = (vLocal - origin) * toTexel;
  vec3 dir = normalize(p - (fEye - origin) * toTexel);
  float D = thick ? (fZ.y - fZ.x) / k : 0.0;
  float tHit = 0.0;
  vec3 colour = vec3(0.0);
  float texA = 1.0;
  bool hit = false;
  /** Set when the hit is a hull face: the distance of the hull texel it belongs to (1 ink, 2 shell). */
  float hullHit = 0.0;
  if (!thick) {
    ivec2 t = ivec2(floor(p.xy));
    if (body(t)) {
      vec4 tx = texelAt(t);
      colour = tx.rgb;
      texA = tx.a;
      hit = true;
    } else if (grow > 0.0) {
      float hd = hullDist(t, grow);
      if (hd <= grow) {
        hullHit = hd;
        hit = true;
      }
    }
  } else {
    // the texel the entry point is in, pulled a hair inside the box so a point on its boundary lands right
    vec2 q = clamp(p.xy + 1e-4 * sign(dir.xy), vec2(1e-5), vec2(W, H) - 1e-5);
    ivec2 t = ivec2(floor(q));
    ivec2 stp = ivec2(dir.x >= 0.0 ? 1 : -1, dir.y >= 0.0 ? 1 : -1);
    vec2 tDelta = 1.0 / max(abs(dir.xy), vec2(1e-6));
    vec2 nextEdge = vec2(t) + vec2(stp.x > 0 ? 1.0 : 0.0, stp.y > 0 ? 1.0 : 0.0);
    vec2 tMax = (nextEdge - p.xy) / dir.xy;
    if (abs(dir.x) < 1e-6) tMax.x = 1e9;
    if (abs(dir.y) < 1e-6) tMax.y = 1e9;
    // the face the ray came in by: 0 front, 1 back, 2 side, 3 top, 4 bottom
    int face;
    if (p.z < 1e-3) face = 0;
    else if (p.z > D - 1e-3) face = 1;
    else if (p.x < 1e-3 || p.x > W - 1e-3) face = 2;
    else face = dir.y > 0.0 ? 3 : 4;
    float tNow = 0.0;
    // a board's ink: the ring round its body, flat on either face (a door is walked round), off the edge columns
    if (ring && face <= 1 && t.x > 0 && t.x < int(W) - 1 && !body(t) && hullDist(t, 1.0) <= 1.0) {
      hullHit = 1.0;
      hit = true;
    }
    for (int i = 0; i < 128 && !hit; i++) {
      if (body(t)) {
        vec4 tx = texelAt(t);
        colour = tx.rgb * faceShade(face);
        texA = tx.a;
        tHit = tNow;
        hit = true;
        break;
      }
      float dist = grow > 0.0 ? hullDist(t, grow) : FAR;
      bool hull = dist <= grow;
      float tExit = min(tMax.x, tMax.y);
      float zExit = p.z + dir.z * tExit;
      if (zExit > D || zExit < 0.0) {
        // out of the block through its front or back: black if the hull has a face there
        bool back = zExit > D;
        if (hull && (back || hullFront)) {
          tHit = ((back ? D : 0.0) - p.z) / dir.z;
          hullHit = dist;
          hit = true;
        }
        break;
      }
      if (tMax.x < tMax.y) { t.x += stp.x; tNow = tMax.x; tMax.x += tDelta.x; face = 2; }
      else { t.y += stp.y; tNow = tMax.y; tMax.y += tDelta.y; face = stp.y > 0 ? 3 : 4; }
      if (t.x < 0 || t.y < 0 || t.x >= int(W) || t.y >= int(H)) {
        // out of the tile sideways: the hull's own side face where it ends at the tile's edge
        if (hull) { tHit = tNow; hullHit = dist; hit = true; }
        break;
      }
      if (hull) {
        if (!body(t) && hullDist(t, grow) > grow) {
          // leaving the hull for air: its side face
          tHit = tNow;
          hullHit = dist;
          hit = true;
          break;
        }
      }
    }
  }
  if (!hit) discard;
  vec3 hitLocal = vLocal + (dir * tHit) / toTexel;
  float c = cos(fYaw), s = sin(fYaw);
  vec3 world = (modelMatrix * vec4(fAnchor + vec3(c * hitLocal.x + s * hitLocal.z, hitLocal.y, c * hitLocal.z - s * hitLocal.x), 1.0)).xyz;
  vec3 entry = (modelMatrix * vec4(fAnchor + vec3(c * vLocal.x + s * vLocal.z, vLocal.y, c * vLocal.z - s * vLocal.x), 1.0)).xyz;
#ifdef GHOST
  float sd = texture(sceneDepth, gl_FragCoord.xy / resolution).x;
  float occZ = perspectiveDepthToViewZ(sd, cameraNear, cameraFar);
  float viewZ = (viewMatrix * vec4(world, 1.0)).z;
  float gap = occZ - viewZ;
  // only what stands clear in front hides: a sprite's own layers, its badges and its block are within GHOST_GAP of
  // each other and never ghost through one another, where the next cell's sprite is a whole cell in front
  if (gap <= GHOST_GAP) discard;
  float alpha = fColor.a * texA * (1.0 - smoothstep(fadeStart, fadeRange, gap));
#else
  // The hit's depth: the rasterizer's own depth of the entry point, plus how much deeper the hit is. A hit on
  // the face the ray came in by is exactly the fragment's depth, so a stack of layers two thousandths apart
  // keeps its order; a hit inside the block is offset by the view-depth difference, through the projection's
  // own terms (ndc z = c + d / w), which is exact where a difference of two projected z would cancel.
  float depth = gl_FragCoord.z;
  if (tHit > 0.0) {
    float wE = -(viewMatrix * vec4(entry, 1.0)).z;
    float wH = -(viewMatrix * vec4(world, 1.0)).z;
    depth += 0.5 * projectionMatrix[3][2] * (1.0 / wH - 1.0 / wE);
  }
  gl_FragDepth = depth;
  float alpha = fColor.a * texA;
#endif
  vec3 out3;
  if (hullHit > 0.0) out3 = hullHit > 1.0 ? shellColor : vec3(0.0);
  else {
    out3 = colour * fColor.rgb;
    if ((mode & 16) != 0) out3 *= shadeAt(fCell);
  }
  // the hands stand in a frame of their own, with no world to read the field at: they take the flash handed to them
  out3 = (mode & 32) != 0 ? mix(out3, flashOverride.rgb, flashOverride.a) : flashed(out3, world);
  fragColor = outColor(vec4(out3, alpha));
}`

// ---------------------------------------------------------------- shadows

export const SHADOW_VERT = /* glsl */ `
precision highp float;
in vec3 position;
in vec3 iAnchor;
in float iScale;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
void main() {
  // the disc lies in xy; laid on the floor with y to -z it keeps its winding face up
  vec3 world = iAnchor + vec3(position.x * iScale, 0.003, -position.y * iScale);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`

export const FLAT_FRAG = /* glsl */ `
precision highp float;
uniform vec4 color;
${ENCODE}
out vec4 fragColor;
void main() {
  fragColor = outColor(color);
}`

// ----------------------------------------------------------------- cursor

export const CURSOR_VERT = /* glsl */ `
precision highp float;
in vec3 position;
in vec2 uv;
uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

export const CURSOR_FRAG = /* glsl */ `
precision highp float;
uniform vec4 color;
uniform vec4 uvRect;
#ifdef TILE
uniform sampler2D map;
#endif
${ENCODE}
in vec2 vUv;
out vec4 fragColor;
void main() {
#ifdef TILE
  vec4 t = texture(map, mix(uvRect.xy, uvRect.zw, vUv));
  if (t.a < 0.1) discard;
  fragColor = outColor(t * color);
#else
  fragColor = outColor(color);
#endif
}`

// ------------------------------------------------------------------- blit

export const BLIT_VERT = /* glsl */ `
precision highp float;
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`

export const BLIT_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D map;
in vec2 vUv;
out vec4 fragColor;
void main() {
  fragColor = vec4(texture(map, vUv).rgb, 1.0);
}`
