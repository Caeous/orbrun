import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { Render3d } from '../src/index.js'
import { cellKey, emptyScene, type Billboard, type Scene, type TileRect, type TileSource } from '@orbrun/scene'

const RECT: TileRect = { atlas: 'main', sx: 0, sy: 0, w: 32, h: 32, ox: 0, oy: 0, cell: 32 }

const tiles: TileSource = {
  tile: () => RECT,
  atlas: () => ({ width: 64, height: 64 }) as unknown as TexImageSource,
  atlasNames: () => ['main'],
}

type Priv = {
  setTiles(t: TileSource): void
  levelGroup: THREE.Group
  billboardGroup: THREE.Group
  rebuildLevel(s: Scene): void
  rebuildBillboards(s: Scene): void
}

/** A 3x3 room, the middle row floor, an upright staircase on (2, 1) with `on` standing on it. */
function stairsUnder(on: Billboard[]): Scene {
  const s = emptyScene()
  s.playerOnLevel = true
  s.player = { x: 1, y: 1 }
  s.bounds = { left: 0, top: 0, right: 2, bottom: 2 }
  for (let y = 0; y <= 2; y++) {
    for (let x = 0; x <= 2; x++) {
      const floor = y === 1
      const stairs = floor && x === 2
      s.cells.set(cellKey(x, y), {
        x,
        y,
        kind: floor ? 'floor' : 'wall',
        visibility: 'visible',
        occluder: !floor,
        floorTile: 0,
        wallTile: floor ? undefined : 1,
        featureTile: stairs ? 5 : undefined,
        stance: stairs ? 'upright' : undefined,
      })
    }
  }
  s.billboards = on
  return s
}

function build(scene: Scene): Priv {
  const r = new Render3d() as unknown as Priv
  r.setTiles(tiles)
  r.rebuildLevel(scene)
  r.rebuildBillboards(scene)
  return r
}

function holders(g: THREE.Group): THREE.Object3D[] {
  return g.children.filter((c) => c.userData.billboard)
}

/** The nearest face of a holder's first quad, in its own frame: the eye looks down -z of it. */
function front(h: THREE.Object3D): number {
  return (h.children[0] as THREE.Mesh).position.z
}

const monster: Billboard = { x: 2, y: 1, tile: 9, kind: 'monster', height: 1, attitude: 'hostile' }
const cloud: Billboard = { x: 2, y: 1, tile: 9, kind: 'cloud', height: 1 }

describe('an upright feature and what stands on it', () => {
  /**
   * A board and the monster on it stand at the same place and both face the
   * camera, so the steps and their black outline run right through the
   * monster whichever wins the depth test. The feature lies back down on the
   * floor instead, as it already does underfoot in first person.
   */
  it('lays the feature flat under a monster', () => {
    expect(holders(build(stairsUnder([])).levelGroup)).toHaveLength(1)
    expect(holders(build(stairsUnder([monster])).levelGroup)).toHaveLength(0)
  })

  /**
   * A cloud drifts over a cell rather than standing on it, so the staircase
   * under it keeps standing — and stands back far enough that the whole of
   * the sprite in the cell reads in front of it.
   */
  it('stands a feature back from a cloud passing over it', () => {
    const r = build(stairsUnder([cloud]))
    const [feature] = holders(r.levelGroup)
    const [drift] = holders(r.billboardGroup)
    expect(feature.position).toEqual(drift.position)
    // the sprite's block is BB_DEPTH texels of its own scale deep; the board clears all of it
    expect(front(feature)).toBeLessThanOrEqual(front(drift) - 2 / 32)
  })
})
