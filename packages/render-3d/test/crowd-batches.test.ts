import { describe, it, expect } from 'vitest'
import { settle, shadowsWritten, stubbed, written } from './bed.js'
import { cellKey, emptyScene, makeCamera, type Scene, type TileRect, type TileSource } from '@orbrun/scene'

/**
 * The crowd is drawn as instances, not as meshes: every standing sprite of
 * one atlas and one pass goes into that pass's batch, one draw call whatever
 * the crowd, with the sprite's place as an instance attribute and the eye's
 * yaw applied in the shader. What used to be a bake — merging a group of
 * holders into chunk meshes — is now nothing at all: the list is written into
 * buffers that are grown, never rebuilt.
 *
 * The passes are draws of their own because their order is the picture: the
 * fixtures with the level, the ghosts of what is in view, then the remembered
 * ghosts, then the crowd over them, then what blends, back to front.
 */
const RECT: TileRect = { atlas: 'main', sx: 0, sy: 0, w: 32, h: 32, ox: 0, oy: 0, cell: 32 }
const tiles: TileSource = {
  tile: () => RECT,
  atlas: () => ({ width: 64, height: 64 }) as unknown as TexImageSource,
  atlasNames: () => ['main'],
}

/** An 8x8 room with a statue, four sprites — one of them translucent — and a cloud. */
function crowd(): Scene {
  const s = emptyScene()
  s.revision = s.layoutRevision = 1
  s.bounds = { left: 0, top: 0, right: 7, bottom: 7 }
  s.playerOnLevel = true
  s.player = { x: 1, y: 1 }
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const wall = x === 0 || y === 0 || x === 7 || y === 7
      s.cells.set(cellKey(x, y), { x, y, kind: wall ? 'wall' : 'floor', visibility: 'visible', occluder: wall, floorTile: 0, wallTile: wall ? 1 : undefined })
    }
  // a cell the player no longer sees: the monster on it is a remembered ghost, the others ghosts of what is in view
  s.cells.get(cellKey(6, 6))!.visibility = 'remembered'
  const statue = s.cells.get(cellKey(6, 1))!
  statue.featureTile = 3
  statue.stance = 'upright'
  statue.feature = { type: 'other', name: 'statue' }
  s.billboards = [
    { x: 3, y: 3, tile: 1, kind: 'monster', height: 1, attitude: 'hostile' },
    { x: 5, y: 2, tile: 1, kind: 'item', height: 0.6 },
    { x: 6, y: 6, tile: 1, kind: 'monster', height: 1, attitude: 'hostile', statusIcons: [{ tile: 2, ox: 0, oy: 0 }] },
    { x: 2, y: 5, tile: 1, kind: 'monster', height: 1, attitude: 'hostile', alpha: 0.5 },
    { x: 4, y: 4, tile: 1, kind: 'cloud', height: 0.9 },
  ]
  return s
}

describe('the crowd as instanced draws', () => {
  it('puts the whole crowd into one draw per pass, in the order the picture needs', () => {
    const bed = stubbed({}, tiles)
    const { r, g } = bed
    r.setCamera(makeCamera(1, 1))
    r.setScene(crowd())
    r.render()
    settle(bed)

    // one atlas, five passes: the fixtures, the crowd, the two kinds of ghost, and what blends
    expect([...g.batches.keys()].sort()).toEqual(['main|blend', 'main|fixture', 'main|ghostVisible', 'main|ghostRemembered', 'main|opaque'].sort())
    const order = (pass: string) => g.batches.get(`main|${pass}`)!.mesh.renderOrder
    expect(order('ghostVisible')).toBeLessThan(order('ghostRemembered'))
    expect(order('ghostRemembered')).toBeLessThan(order('opaque'))
    expect(order('opaque')).toBeLessThan(order('blend'))

    // four sprites and a badge stand, the statue is the one fixture, the cloud and the translucent monster blend
    expect(written(g, 'main', 'opaque')).toHaveLength(4)
    expect(written(g, 'main', 'fixture')).toHaveLength(1)
    expect(written(g, 'main', 'blend')).toHaveLength(2)
    // every sprite but the cloud casts a shadow
    expect(shadowsWritten(g)).toHaveLength(4)
    r.destroy()
  })

  it('carries each sprite\'s place as an instance attribute, the geometry a shared box', () => {
    const bed = stubbed({}, tiles)
    const { r, g } = bed
    r.setCamera(makeCamera(1, 1))
    r.setScene(crowd())
    r.render()
    settle(bed)
    const opaque = g.batches.get('main|opaque')!
    // the base geometry is the unit box, one instance of it per sprite, and never frustum culled:
    // where a sprite really stands is worked out in the shader, from its anchor and the eye's yaw
    expect(opaque.geometry.getAttribute('position').count).toBe(24)
    expect(opaque.geometry.instanceCount).toBe(4)
    expect(opaque.mesh.frustumCulled).toBe(false)
    expect(opaque.mesh.position.toArray()).toEqual([0, 0, 0])
    expect(written(g, 'main', 'opaque').map((w) => w.anchor)).toEqual([
      [3.5, 0, 3.5],
      [5.5, 0, 2.5],
      [6.5, 0, 6.5],
      [6.5, 0, 6.5], // the badge stands on its monster
    ])
    r.destroy()
  })

  it('blends back to front from the eye', () => {
    const bed = stubbed({}, tiles)
    const { r, g } = bed
    const s = crowd()
    s.billboards = [
      { x: 2, y: 1, tile: 1, kind: 'cloud', height: 0.9 },
      { x: 6, y: 1, tile: 1, kind: 'cloud', height: 0.9 },
      { x: 4, y: 1, tile: 1, kind: 'cloud', height: 0.9 },
    ]
    r.setCamera(makeCamera(1, 1))
    r.setScene(s)
    r.render()
    settle(bed)
    // the eye is at (1, 1): the farthest cloud is written first, so the nearer ones blend over it
    expect(written(g, 'main', 'blend').map((w) => w.anchor[0])).toEqual([6.5, 4.5, 2.5])
    r.destroy()
  })

  it('grows its buffers rather than building them again', () => {
    const bed = stubbed({}, tiles)
    const { r, g } = bed
    r.setCamera(makeCamera(1, 1))
    const s = crowd()
    r.setScene(s)
    r.render()
    settle(bed)
    const opaque = g.batches.get('main|opaque')!
    const was = opaque.geometry
    let rebuilt = 0
    was.addEventListener('dispose', () => rebuilt++)
    // a crowd that outgrows the buffers twice over
    for (let n = 1; n <= 40; n++) {
      s.billboards.push({ x: 1 + (n % 6), y: 1 + ((n * 3) % 6), tile: 1, kind: 'monster', height: 1, attitude: 'hostile' })
      s.revision++
      r.setScene(s)
      r.render()
    }
    expect(g.batches.get('main|opaque')!.geometry).toBe(was)
    expect(rebuilt).toBe(0)
    expect(was.instanceCount).toBeGreaterThan(20)
    // and the buffer behind the attribute is at least as long as the instances written into it
    const a = was.getAttribute('iAnchor')
    expect(a.array.length).toBeGreaterThanOrEqual(was.instanceCount * 3)
    r.destroy()
  })
})
