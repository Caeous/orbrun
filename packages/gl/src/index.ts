/**
 * @orbrun/gl
 *
 * A small scene graph and a WebGL2 backend: what Orbrun's 3D renderer
 * needs and nothing more (docs/custom-renderer-plan.md). Meshes, materials, textures and a camera
 * are built with no GL context, so a scene can be stood and inspected under
 * a test runner; `WebGLRenderer` is the one class that touches the canvas.
 */
export * from './math.js'
export * from './core.js'
export * from './geometry.js'
export * from './material.js'
export * from './texture.js'
export * from './raycaster.js'
export { WebGLRenderer, painterSortStable, reversePainterSortStable, type RenderItem, type WebGLRendererParameters } from './renderer.js'
export { ShaderChunk, resolveIncludes, buildSources, depthOnlyFragment, programKey, type ProgramParameters } from './shaders.js'
