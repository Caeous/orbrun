import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { Render3d } from '../src/index.js'
import { cellKey, emptyScene, type Scene, type SceneCell, type TileRect, type TileSource } from '@orbrun/scene'

const RECT: TileRect = { atlas: 'main', sx: 0, sy: 0, w: 32, h: 32, ox: 0, oy: 0, cell: 32 }

const tiles: TileSource = {
  tile: () => RECT,
  atlas: () => ({ width: 64, height: 64 }) as unknown as TexImageSource,
  atlasNames: () => ['main'],
}

/** A hostile monster at (3, 3), on a cell of the given visibility. */
function sceneWithMonster(visibility: SceneCell['visibility']): Scene {
  const s = emptyScene()
  s.playerOnLevel = true
  s.player = { x: 0, y: 0 }
  s.cells.set(cellKey(3, 3), { x: 3, y: 3, kind: 'floor', visibility, occluder: false, floorTile: 0 })
  s.billboards = [{ x: 3, y: 3, tile: 1, kind: 'monster', height: 1, attitude: 'hostile' }]
  return s
}

function build(scene: Scene) {
  const r = new Render3d() as unknown as {
    setTiles(t: TileSource): void
    billboardGroup: THREE.Group
    rebuildBillboards(s: Scene): void
  }
  r.setTiles(tiles)
  r.rebuildBillboards(scene)
  const quad = (kind: string) => {
    const h = r.billboardGroup.children.find((c) => c.userData.kind === kind)!
    const m = h.children.find((c) => (c as THREE.Mesh).geometry && !c.userData.shared) as THREE.Mesh
    const c = m.geometry.getAttribute('color') as THREE.BufferAttribute
    return [c.getX(0), c.getY(0), c.getZ(0)]
  }
  return { sprite: quad('monster'), ghost: quad('ghost') }
}

describe('ghost tint', () => {
  /**
   * A wall's edge cuts a sprite in two, the near half lit and the far half a
   * ghost. If the ghost were tinted, the seam would run down the middle of the
   * monster — the bug this pins: same colours, no seam.
   */
  it('gives a monster in view a ghost in the sprite\'s own colours', () => {
    const { sprite, ghost } = build(sceneWithMonster('visible'))
    expect(ghost).toEqual(sprite)
  })
  it('keeps the cool tint for a monster only remembered', () => {
    const { sprite, ghost } = build(sceneWithMonster('remembered'))
    expect(ghost).not.toEqual(sprite)
    expect(ghost.map((v) => +v.toFixed(2))).toEqual([0.55, 0.6, 0.8])
  })
})
