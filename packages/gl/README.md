# @orbrun/gl

A small scene graph and a WebGL2 backend: what Orbrun's 3D renderer
(`@orbrun/render-3d`) needs and nothing more. It replaced the library the
renderer first stood on, on 2026-09-17 (docs/custom-renderer-plan.md): the
renderer chunk the first visit downloads lost about 106 KB gzipped, and
the switch was a change of imports.

What is here, and only what the renderer needs:

- `math.ts`: `Vector2/3/4`, `Matrix3/4`, `Quaternion`, `Euler`, `Color`
  (sRGB in, linear working space), `Sphere`, `Box3`, `Plane`, `Frustum`,
  `Ray`. Every operation in one fixed order, so a vertex lands on the same
  floating-point place as the baseline's.
- `core.ts`: `Object3D`, `Group`, `Scene`, `Mesh`, `Camera`,
  `PerspectiveCamera`, `BufferGeometry`, `BufferAttribute` (with `version`
  and update ranges), `Layers`, `EventDispatcher` (the `dispose` events the
  renderer frees GL objects on). No DOM at import time: a scene can be stood
  and inspected under vitest.
- `geometry.ts`: `PlaneGeometry`, `CircleGeometry`, `RingGeometry`,
  `ShapeUtils.triangulateShape` over a vendored earcut (`earcut.js`,
  mapbox, ISC).
- `material.ts`: `Material`, `MeshBasicMaterial` (colour × map × vertex
  colour, alpha test, the `onBeforeCompile` hook over the shader's
  `#include` marks) and `ShaderMaterial` (the renderer's own GLSL with the
  built-in uniforms and attributes injected).
- `texture.ts`: `Texture` (with a shared `Source` for clones), `DataTexture`,
  `DepthTexture`, `WebGLRenderTarget`.
- `raycaster.ts`: `Raycaster.setFromCamera` and `intersectObjects` over a
  mesh's triangles, for picking.
- `shaders.ts`: the basic material's GLSL and the chunk table, the program
  prefix and the cache key.
- `renderer.ts`: `WebGLRenderer`. Walks the scene, culls by bounding
  sphere, sorts opaque draws front to back and blended ones back to front
  (the ghosts, the shadows and the cursor lean on that order), draws a
  transparent double-sided basic material in two passes, compiles one program per distinct source, uploads only what
  changed, and rebuilds everything after a lost context comes back.

The contract is the pixel: `tools/build/render-compare.mjs` shoots a fixed
set of poses through `apps/orbrun/testbed/compare.html` and diffs two runs;
the port was accepted at zero differing pixels on every pose at two
viewports. Keep it that way: a change that makes a frame look better is a
diff to explain first.

WebGL2 only. Part of [Orbrun](https://github.com/Caeous/orbrun);
AGPL-3.0-or-later. Parts are ports of permissively licensed code; the
notices are in `LICENSE-THIRD-PARTY.md` beside this file.
