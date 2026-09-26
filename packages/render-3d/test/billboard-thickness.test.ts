import { describe, it, expect } from 'vitest'
import { stubbed, written } from './bed.js'
import { SPRITE_FRAG } from '../src/shaders.js'
import {
  BB_DEPTH,
  BLOCK_SHADE,
  CLOUD_ALPHA,
  CLOUD_FORWARD,
  LIE_LIFT,
  MODE_BILLBOARD,
  MODE_LIE,
  MODE_SHADE_MAP,
  MODE_THICK,
  SEL_GROW,
  crowdInstances,
  type SpriteInstance,
} from '../src/sprites.js'
import { emptyScene, makeCamera, type Scene, type TileRect, type TileSource } from '@orbrun/scene'

/**
 * Standing sprites have the hands' thickness: behind the front the opaque
 * texels stand up as a block with a shaded rim, and round the block is
 * crawl's ink. None of that is geometry any more — the sprite is one
 * instance of a box and the fragment shader marches it (shaders.ts
 * `SPRITE_FRAG`) — so what these pin is the instance the shader is handed:
 * the tile it draws, the quad it stands on, the block's depth, and the mode
 * bits that say thick, lit, inked or flat.
 */
const RECT: TileRect = { atlas: 'main', sx: 4, sy: 8, w: 4, h: 4, ox: 0, oy: 0, cell: 32 }

const tiles: TileSource = {
  tile: () => RECT,
  atlas: () => ({ width: 16, height: 16 }) as unknown as TexImageSource,
  atlasNames: () => ['main'],
}

function scene(alpha?: number): Scene {
  const s = emptyScene()
  s.revision = s.layoutRevision = 1
  s.playerOnLevel = true
  s.player = { x: 0, y: 0 }
  s.billboards = [{ x: 3, y: 3, tile: 1, kind: 'monster', height: 1, attitude: 'hostile', alpha, statusIcons: [{ tile: 2, ox: 0, oy: 0, at: 'top' }] }]
  return s
}

/** The instances of the one sprite, by pass, as `crowdInstances` works them out. */
function instances(s: Scene, selected: { x: number; y: number } | null = null): Map<string, SpriteInstance[]> {
  const out = new Map<string, SpriteInstance[]>()
  for (const i of crowdInstances(s, () => RECT, selected).sprites) {
    const list = out.get(i.pass) || []
    list.push(i)
    out.set(i.pass, list)
  }
  return out
}

const K = 1 / 32

describe('billboard thickness', () => {
  it('stands the body up in a block a texel deep, turned to the eye', () => {
    const [body] = instances(scene()).get('opaque')!
    const mode = body.misc[0]
    expect(mode & MODE_THICK).toBeTruthy()
    expect(mode & MODE_BILLBOARD).toBeTruthy()
    expect(mode & MODE_SHADE_MAP).toBeTruthy()
    // the front of the block is the sprite's own plane, and it is BB_DEPTH texels deep behind it
    expect(body.z).toEqual([0, BB_DEPTH * K])
    // the texel size the shader marches at is the tile's own
    expect(body.misc[2]).toBe(K)
    // and the ink round it is a texel wide
    expect(body.misc[1]).toBe(1)
  })

  /**
   * The quad the block is marched through is the tile at its own texel
   * scale, standing on the cell: the block's texel boundaries and the art's
   * are the same boundaries, whatever the tile's place in its cell.
   */
  it('draws the tile at the scale the block is built at', () => {
    const [body] = instances(scene()).get('opaque')!
    expect(body.texel).toEqual([RECT.sx, RECT.sy, RECT.w, RECT.h])
    // half sizes: the tile's own width and height in world units
    expect(body.quad[2]).toBeCloseTo((RECT.w * K) / 2, 9)
    expect(body.quad[3]).toBeCloseTo((RECT.h * K) / 2, 9)
    // the art's rect inside the cell puts its centre here, and its foot that far off the floor
    expect(body.quad[0]).toBeCloseTo((RECT.ox + RECT.w / 2 - RECT.cell / 2) * K, 9)
    expect(body.quad[1] - body.quad[3]).toBeCloseTo((RECT.cell - (RECT.oy + RECT.h)) * K, 9)
    expect(body.anchor).toEqual([3.5, 0, 3.5])
    expect(body.cell).toEqual([3, 3])
  })

  /** The shades the march gives the block's faces are the ones the rest of the renderer works in. */
  it('shades the block\'s faces as the shader does', () => {
    const constant = (name: string) => {
      const m = SPRITE_FRAG.match(new RegExp(`const float ${name} = ([0-9.]+);`))
      return Number(m![1])
    }
    expect(constant('SHADE_FRONT')).toBe(BLOCK_SHADE.front)
    expect(constant('SHADE_TOP')).toBe(BLOCK_SHADE.top)
    expect(constant('SHADE_SIDE')).toBe(BLOCK_SHADE.side)
    expect(constant('SHADE_BOTTOM')).toBe(BLOCK_SHADE.bottom)
  })

  /**
   * Crawl draws a black line a texel thick round every sprite and paints the
   * shadow at its feet with the same ink. A badge or a damage bar is a mark
   * on the sprite rather than part of it: standing one up would wall the
   * sprite into its own outline, so they stay flat and wear no ink.
   */
  it('leaves the damage bar and badges, the ghost, and a translucent sprite flat', () => {
    const plain = instances(scene())
    const [, badge] = plain.get('opaque')!
    expect(badge.misc[0] & MODE_THICK).toBe(0)
    expect(badge.misc[1]).toBe(0)
    // a badge stacks a hair in front of the body rather than sharing its plane
    expect(badge.z[0]).toBeGreaterThan(plain.get('opaque')![0].z[0])

    // the ghost pass is a flat quad the depth image tests: no block, and its ink is the flat ring
    const [ghost] = plain.get('ghostRemembered')!
    expect(ghost.misc[0] & MODE_THICK).toBe(0)
    expect(ghost.misc[1]).toBe(1)

    // a translucent sprite blends, so it is flat too, and carries its own light rather than reading the map
    const [glass] = instances(scene(0.5)).get('blend')!
    expect(glass.misc[0] & MODE_THICK).toBe(0)
    expect(glass.misc[0] & MODE_SHADE_MAP).toBe(0)
    expect(glass.color[3]).toBe(0.5)
  })

  /**
   * Smoke over a monster: the cloud's board and the front face of the
   * monster's block stand in the same plane at the cell's middle, and a
   * coplanar board loses the depth test to the block texel for texel — the
   * smoke drew in the gaps of the monster's art and nowhere else. The cloud
   * stands a texel in front of the block instead.
   */
  it('stands a cloud in front of the block of whoever is in it', () => {
    const s = scene()
    s.billboards.push({ x: 3, y: 3, tile: 3, kind: 'cloud', height: 0.9 })
    const by = instances(s)
    const [body] = by.get('opaque')!
    const [cloud] = by.get('blend')!
    expect(cloud.cell).toEqual(body.cell)
    expect(cloud.z[0]).toBeCloseTo(CLOUD_FORWARD, 9)
    expect(cloud.z[0]).toBeGreaterThanOrEqual(body.z[0] + BB_DEPTH * K)
    // and it is the flat, blended board it has always been
    expect(cloud.misc[0] & MODE_THICK).toBe(0)
    expect(cloud.color[3]).toBe(CLOUD_ALPHA)
  })

  it('puts a wider shell round the sprite under the cursor', () => {
    const on = instances(scene(), { x: 3, y: 3 })
    expect(on.get('opaque')![0].misc[1]).toBe(SEL_GROW)
    // the ghost keeps its own one-texel ring, and a badge is never inked
    expect(on.get('ghostRemembered')![0].misc[1]).toBe(1)
    expect(on.get('opaque')![1].misc[1]).toBe(0)
    // a cursor on another cell leaves the sprite alone
    expect(instances(scene(), { x: 4, y: 3 }).get('opaque')![0].misc[1]).toBe(1)
  })

  it('lays a corpse face up on the floor, its block above it and its middle on the cell', () => {
    const s = emptyScene()
    s.playerOnLevel = true
    s.billboards = [{ x: 3, y: 3, tile: 1, kind: 'item', height: 0.8, lying: true }]
    const { sprites, shadows } = crowdInstances(s, () => RECT, null)
    const body = sprites.find((i) => i.pass === 'opaque')!
    const k = 0.8 / 32
    const mode = body.misc[0]
    // lying, fixed to the map's north rather than turned to the eye
    expect(mode & MODE_LIE).toBeTruthy()
    expect(mode & MODE_BILLBOARD).toBeFalsy()
    expect(mode & MODE_THICK).toBeTruthy()
    expect(body.misc[3]).toBe(0)
    // the front is the top face: the block's underside clears the floor's decals
    expect(body.z[0] - body.z[1]).toBeCloseTo(LIE_LIFT)
    // the frame's y is measured from the cell's middle: RECT's 4 rows at the tile's top lie north of it
    expect(body.quad[1]).toBeCloseTo((32 - 4 / 2 - 16) * k)
    expect(body.misc[1]).toBe(1)
    const ghost = sprites.find((i) => i.pass === 'ghostRemembered')!
    expect(ghost.misc[0] & MODE_LIE).toBeTruthy()
    expect(shadows).toHaveLength(0)
  })

  it('stays unbuilt where the atlas pixels cannot be read', () => {
    // the peel is what tells body from ink from air (peel.ts); with no distance field there is nothing to march
    const { r, g } = stubbed({}, tiles)
    g.atlas('main')!.peeled = false
    r.setCamera(makeCamera(0, 0))
    r.setScene(scene())
    r.render()
    expect(g.atlas('main')!.peeled).toBe('failed')
    expect(written(g, 'main', 'opaque')).toHaveLength(0)
    r.destroy()
  })

  it('writes the instances it worked out into the batch of their pass', () => {
    const { r, g } = stubbed({}, tiles)
    r.setCamera(makeCamera(0, 0))
    r.setScene(scene())
    r.render()
    const body = instances(scene()).get('opaque')!
    expect(written(g, 'main', 'opaque').map((w) => w.misc)).toEqual(body.map((i) => i.misc))
    expect(written(g, 'main', 'ghostRemembered')).toHaveLength(2)
    r.destroy()
  })
})
