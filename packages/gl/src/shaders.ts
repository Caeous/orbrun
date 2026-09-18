/**
 * The GLSL the renderer compiles: the built-in material's sources, the chunk
 * table its `#include`s resolve against, and the prefix of defines, uniforms
 * and attributes put before every program.
 *
 * The chunks are kept to the letter where they touch a fragment's colour:
 * the frame is compared pixel by pixel with the baseline (tools/build/
 * render-baseline), and the sRGB encode, the alpha test and the order the colour, the
 * map and the vertex colour are multiplied in are all part of that. Chunks
 * that only carry features the renderer never uses (fog, lights, morphs,
 * skinning, clipping planes) are left out of the sources rather than
 * included empty; the preprocessor would have dropped them anyway.
 */

const common = /* glsl */ `
#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6

#ifndef saturate
// <tonemapping_pars_fragment> may have defined saturate() already
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
#define whiteComplement( a ) ( 1.0 - saturate( a ) )

float pow2( const in float x ) { return x*x; }
vec3 pow2( const in vec3 x ) { return x*x; }
float pow3( const in float x ) { return x*x*x; }
float pow4( const in float x ) { float x2 = x*x; return x2*x2; }
float max3( const in vec3 v ) { return max( max( v.x, v.y ), v.z ); }
float average( const in vec3 v ) { return dot( v, vec3( 0.3333333 ) ); }

// expects values in the range of [0,1]x[0,1], returns values in the [0,1] range.
// do not collapse into a single function per: http://byteblacksmith.com/improvements-to-the-canonical-one-liner-glsl-rand-for-opengl-es-2-0/
highp float rand( const in vec2 uv ) {

	const highp float a = 12.9898, b = 78.233, c = 43758.5453;
	highp float dt = dot( uv.xy, vec2( a,b ) ), sn = mod( dt, PI );

	return fract( sin( sn ) * c );

}

#ifdef HIGH_PRECISION
	float precisionSafeLength( vec3 v ) { return length( v ); }
#else
	float precisionSafeLength( vec3 v ) {
		float maxComponent = max3( abs( v ) );
		return length( v / maxComponent ) * maxComponent;
	}
#endif

struct IncidentLight {
	vec3 color;
	vec3 direction;
	bool visible;
};

struct ReflectedLight {
	vec3 directDiffuse;
	vec3 directSpecular;
	vec3 indirectDiffuse;
	vec3 indirectSpecular;
};

vec3 transformDirection( in vec3 dir, in mat4 matrix ) {

	return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );

}

bool isPerspectiveMatrix( mat4 m ) {

	return m[ 2 ][ 3 ] == - 1.0;

}
`

const packing = /* glsl */ `
float viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) {
	// -near maps to 0; -far maps to 1
	return ( viewZ + near ) / ( near - far );
}

float orthographicDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return depth * ( near - far ) - near;
}

// NOTE: https://twitter.com/gonnavis/status/1377183786949959682

float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
	// -near maps to 0; -far maps to 1
	return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}

float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return ( near * far ) / ( ( far - near ) * depth - far );
}
`

const colorspace_pars_fragment = /* glsl */ `

vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}

vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}

vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}

`

/** The chunks an `#include <name>` in a shader source resolves to. */
export const ShaderChunk: Record<string, string> = {
  common,
  packing,
  colorspace_pars_fragment,
  uv_pars_vertex: /* glsl */ `
#if defined( USE_UV ) || defined( USE_ANISOTROPY )

	varying vec2 vUv;

#endif
#ifdef USE_MAP

	uniform mat3 mapTransform;
	varying vec2 vMapUv;

#endif
`,
  uv_vertex: /* glsl */ `
#if defined( USE_UV ) || defined( USE_ANISOTROPY )

	vUv = vec3( uv, 1 ).xy;

#endif
#ifdef USE_MAP

	vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;

#endif
`,
  uv_pars_fragment: /* glsl */ `
#if defined( USE_UV ) || defined( USE_ANISOTROPY )

	varying vec2 vUv;

#endif
#ifdef USE_MAP

	varying vec2 vMapUv;

#endif
`,
  color_pars_vertex: /* glsl */ `
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )

	varying vec4 vColor;

#endif
`,
  color_vertex: /* glsl */ `
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )

	vColor = vec4( 1.0 );

#endif

#ifdef USE_COLOR_ALPHA

	vColor *= color;

#elif defined( USE_COLOR )

	vColor.rgb *= color;

#endif
`,
  color_pars_fragment: /* glsl */ `
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )

	varying vec4 vColor;

#endif
`,
  color_fragment: /* glsl */ `
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )

	diffuseColor *= vColor;

#endif
`,
  map_pars_fragment: /* glsl */ `
#ifdef USE_MAP

	uniform sampler2D map;

#endif
`,
  map_fragment: /* glsl */ `
#ifdef USE_MAP

	vec4 sampledDiffuseColor = texture2D( map, vMapUv );

	#ifdef DECODE_VIDEO_TEXTURE

		// use inline sRGB decode until browsers properly support SRGB8_ALPHA8 with video textures (#26516)

		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );

	#endif

	diffuseColor *= sampledDiffuseColor;

#endif
`,
  alphatest_pars_fragment: /* glsl */ `
#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif
`,
  alphatest_fragment: /* glsl */ `
#ifdef USE_ALPHATEST

	#ifdef ALPHA_TO_COVERAGE

	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;

	#else

	if ( diffuseColor.a < alphaTest ) discard;

	#endif

#endif
`,
  opaque_fragment: /* glsl */ `
#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif

#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif

gl_FragColor = vec4( outgoingLight, diffuseColor.a );
`,
  begin_vertex: /* glsl */ `
vec3 transformed = vec3( position );

#ifdef USE_ALPHAHASH

	vPosition = vec3( position );

#endif
`,
  project_vertex: /* glsl */ `
vec4 mvPosition = vec4( transformed, 1.0 );

#ifdef USE_BATCHING

	mvPosition = batchingMatrix * mvPosition;

#endif

#ifdef USE_INSTANCING

	mvPosition = instanceMatrix * mvPosition;

#endif

mvPosition = modelViewMatrix * mvPosition;

gl_Position = projectionMatrix * mvPosition;
`,
  // no clipping planes: the chunk is a place for a material to hook into, nothing more
  clipping_planes_fragment: '',
  clipping_planes_pars_fragment: '',
  clipping_planes_pars_vertex: '',
  clipping_planes_vertex: '',
  colorspace_fragment: /* glsl */ `
gl_FragColor = linearToOutputTexel( gl_FragColor );
`,
  premultiplied_alpha_fragment: /* glsl */ `
#ifdef PREMULTIPLIED_ALPHA

	gl_FragColor.rgb *= gl_FragColor.a;

#endif
`,
  dithering_fragment: /* glsl */ `
#ifdef DITHERING

	gl_FragColor.rgb = dithering( gl_FragColor.rgb );

#endif
`,
  tonemapping_fragment: /* glsl */ `
#if defined( TONE_MAPPING )

	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );

#endif
`,
}

/** MeshBasicMaterial's sources, with the chunks they never reach left out. */
export const basicVertex = /* glsl */ `
#include <common>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <clipping_planes_pars_vertex>

void main() {

	#include <uv_vertex>
	#include <color_vertex>

	#include <begin_vertex>
	#include <project_vertex>
	#include <clipping_planes_vertex>

}
`

export const basicFragment = /* glsl */ `
uniform vec3 diffuse;
uniform float opacity;

#include <common>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphatest_pars_fragment>
#include <clipping_planes_pars_fragment>

void main() {

	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>

	#include <map_fragment>
	#include <color_fragment>
	#include <alphatest_fragment>

	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );

	// accumulation (baked indirect lighting only)
	reflectedLight.indirectDiffuse += vec3( 1.0 );

	// modulation
	reflectedLight.indirectDiffuse *= diffuseColor.rgb;

	vec3 outgoingLight = reflectedLight.indirectDiffuse;

	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>

}
`

const includePattern = /^[ \t]*#include +<([\w\d./]+)>/gm

/** Replace every `#include <name>` with its chunk, recursively; an unknown name is an error rather than a silent hole. */
export function resolveIncludes(source: string): string {
  return source.replace(includePattern, (_match, include: string) => {
    const chunk = ShaderChunk[include]
    if (chunk === undefined) throw new Error(`shader: unknown include <${include}>`)
    return resolveIncludes(chunk)
  })
}

/** What a program is built for: the material's own defines plus the derived ones. The same parameters compile the same program. */
export interface ProgramParameters {
  shaderType: string
  shaderName: string
  vertexShader: string
  fragmentShader: string
  defines: Record<string, string | number | boolean> | undefined
  map: boolean
  vertexColors: boolean
  vertexAlphas: boolean
  alphaTest: boolean
  opaque: boolean
  doubleSided: boolean
  flipSided: boolean
  premultipliedAlpha: boolean
  /** The material's `defaultAttributeValues`, for attributes the geometry lacks. */
  defaultAttributeValues: Record<string, number[]> | undefined
  customProgramCacheKey: string
  /** The frame is left linear (a render target's texture, unless it says sRGB) rather than encoded to sRGB (the canvas). */
  outputLinear: boolean
  /**
   * Depth alone is wanted (`WebGLRenderer.depthOnly`): the fragment stops after
   * its alpha test, so the shading, encode and colour write are not paid for.
   * A source without `#include <alphatest_fragment>` is compiled whole.
   */
  depthOnly: boolean
}

const ALPHATEST_INCLUDE = /^[ \t]*#include +<alphatest_fragment>[^\n]*\n/m

/** The fragment source cut after its alpha test: what a depth pass needs of it, and nothing it would then throw away. */
export function depthOnlyFragment(source: string): string {
  const m = ALPHATEST_INCLUDE.exec(source)
  if (!m) return source
  return source.slice(0, m.index + m[0].length) + '\n}\n'
}

function generateDefines(defines: Record<string, string | number | boolean> | undefined): string {
  const chunks: string[] = []
  for (const name in defines) {
    const value = defines[name]
    if (value === false) continue
    chunks.push('#define ' + name + ' ' + value)
  }
  return chunks.join('\n')
}

const PRECISION = `precision highp float;
	precision highp int;
	precision highp sampler2D;
	precision highp samplerCube;
	precision highp sampler3D;
	precision highp sampler2DArray;
	precision highp sampler2DShadow;
	precision highp samplerCubeShadow;
	precision highp sampler2DArrayShadow;
	precision highp isampler2D;
	precision highp isampler3D;
	precision highp isamplerCube;
	precision highp isampler2DArray;
	precision highp usampler2D;
	precision highp usampler3D;
	precision highp usamplerCube;
	precision highp usampler2DArray;

#define HIGH_PRECISION`

/** The output encode: linear working space to the frame's sRGB, through an identity primaries matrix. */
const LINEAR_TO_OUTPUT = [
  'vec4 linearToOutputTexel( vec4 value ) {',
  '	return sRGBTransferOETF( vec4( value.rgb * mat3( 1.0000,0.0000,0.0000,0.0000,1.0000,0.0000,0.0000,0.0000,1.0000 ), value.a ) );',
  '}',
].join('\n')

/** The same for a linear frame (a render target's texture): no transfer for a target whose texture is not sRGB. */
const LINEAR_TO_LINEAR = [
  'vec4 linearToOutputTexel( vec4 value ) {',
  '	return LinearTransferOETF( vec4( value.rgb * mat3( 1.0000,0.0000,0.0000,0.0000,1.0000,0.0000,0.0000,0.0000,1.0000 ), value.a ) );',
  '}',
].join('\n')

const LUMINANCE = ['float luminance( const in vec3 rgb ) {', '	const vec3 weights = vec3( 0.2126729, 0.7151522, 0.0721750 );', '	return dot( weights, rgb );', '}'].join('\n')

const notEmpty = (s: string) => s !== ''

/** The full GLSL ES 3.00 sources of a program: the prefixes, then the material's sources with their includes resolved. */
export function buildSources(p: ProgramParameters): { vertex: string; fragment: string } {
  const customDefines = generateDefines(p.defines)
  const prefixVertex =
    [
      PRECISION,
      '#define SHADER_TYPE ' + p.shaderType,
      '#define SHADER_NAME ' + p.shaderName,
      customDefines,
      p.map ? '#define USE_MAP' : '',
      p.map ? '#define MAP_UV uv' : '',
      p.vertexColors ? '#define USE_COLOR' : '',
      p.vertexAlphas ? '#define USE_COLOR_ALPHA' : '',
      p.doubleSided ? '#define DOUBLE_SIDED' : '',
      p.flipSided ? '#define FLIP_SIDED' : '',
      'uniform mat4 modelMatrix;',
      'uniform mat4 modelViewMatrix;',
      'uniform mat4 projectionMatrix;',
      'uniform mat4 viewMatrix;',
      'uniform mat3 normalMatrix;',
      'uniform vec3 cameraPosition;',
      'uniform bool isOrthographic;',
      'attribute vec3 position;',
      'attribute vec3 normal;',
      'attribute vec2 uv;',
      '#if defined( USE_COLOR_ALPHA )',
      '	attribute vec4 color;',
      '#elif defined( USE_COLOR )',
      '	attribute vec3 color;',
      '#endif',
      '\n',
    ]
      .filter(notEmpty)
      .join('\n')
  const prefixFragment =
    [
      PRECISION,
      '#define SHADER_TYPE ' + p.shaderType,
      '#define SHADER_NAME ' + p.shaderName,
      customDefines,
      p.map ? '#define USE_MAP' : '',
      p.alphaTest ? '#define USE_ALPHATEST' : '',
      p.vertexColors ? '#define USE_COLOR' : '',
      p.vertexAlphas ? '#define USE_COLOR_ALPHA' : '',
      p.doubleSided ? '#define DOUBLE_SIDED' : '',
      p.flipSided ? '#define FLIP_SIDED' : '',
      p.premultipliedAlpha ? '#define PREMULTIPLIED_ALPHA' : '',
      'uniform mat4 viewMatrix;',
      'uniform vec3 cameraPosition;',
      'uniform bool isOrthographic;',
      p.opaque ? '#define OPAQUE' : '',
      colorspace_pars_fragment,
      p.outputLinear ? LINEAR_TO_LINEAR : LINEAR_TO_OUTPUT,
      LUMINANCE,
      '\n',
    ]
      .filter(notEmpty)
      .join('\n')
  const versionString = '#version 300 es\n'
  const glsl3Vertex = ['#define attribute in', '#define varying out', '#define texture2D texture'].join('\n') + '\n'
  const glsl3Fragment =
    [
      '#define varying in',
      'layout(location = 0) out highp vec4 pc_fragColor;',
      '#define gl_FragColor pc_fragColor',
      '#define gl_FragDepthEXT gl_FragDepth',
      '#define texture2D texture',
      '#define textureCube texture',
      '#define texture2DProj textureProj',
      '#define texture2DLodEXT textureLod',
      '#define texture2DProjLodEXT textureProjLod',
      '#define textureCubeLodEXT textureLod',
      '#define texture2DGradEXT textureGrad',
      '#define texture2DProjGradEXT textureProjGrad',
      '#define textureCubeGradEXT textureGrad',
    ].join('\n') + '\n'
  const fragmentShader = p.depthOnly ? depthOnlyFragment(p.fragmentShader) : p.fragmentShader
  return {
    vertex: versionString + glsl3Vertex + prefixVertex + resolveIncludes(p.vertexShader),
    fragment: versionString + glsl3Fragment + prefixFragment + resolveIncludes(fragmentShader),
  }
}

/** The program cache key: everything that goes into the sources. */
export function programKey(p: ProgramParameters): string {
  return [
    p.shaderType,
    p.vertexShader,
    p.fragmentShader,
    JSON.stringify(p.defines ?? null),
    p.map ? 1 : 0,
    p.vertexColors ? 1 : 0,
    p.vertexAlphas ? 1 : 0,
    p.alphaTest ? 1 : 0,
    p.opaque ? 1 : 0,
    p.doubleSided ? 1 : 0,
    p.flipSided ? 1 : 0,
    p.premultipliedAlpha ? 1 : 0,
    p.outputLinear ? 1 : 0,
    p.depthOnly ? 1 : 0,
    p.customProgramCacheKey,
  ].join('')
}
