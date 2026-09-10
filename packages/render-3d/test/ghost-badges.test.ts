import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { Render3d } from '../src/index.js'
import { emptyScene, type Scene, type TileRect, type TileSource } from '@orbrun/scene'

const RECT: TileRect = { atlas: 'main', sx: 0, sy: 0, w: 32, h: 32, ox: 0, oy: 0, cell: 32 }

const tiles: TileSource = {
  tile: () => RECT,
  atlas: () => ({ width: 64, height: 64 }) as unknown as TexImageSource,
  atlasNames: () => ['main'],
}

/** A monster on a remembered cell, wearing one status badge. */
function sceneWithBadge(): Scene {
  const s = emptyScene()
  s.playerOnLevel = true
  s.player = { x: 0, y: 0 }
  s.billboards = [
    {
      x: 3,
      y: 3,
      tile: 1,
      kind: 'monster',
      height: 1,
      attitude: 'hostile',
      statusIcons: [{ tile: 2, ox: 0, oy: 0 }],
    },
  ]
  return s
}

function vertexColour(mesh: THREE.Mesh): [number, number, number] {
  const c = mesh.geometry.getAttribute('color') as THREE.BufferAttribute
  return [c.getX(0), c.getY(0), c.getZ(0)]
}

describe('ghost badges', () => {
  it('draws status badges through walls, in their own colours', () => {
    const r = new Render3d() as unknown as {
      setTiles(t: TileSource): void
      billboardGroup: THREE.Group
      rebuildBillboards(s: Scene): void
    }
    r.setTiles(tiles)
    r.rebuildBillboards(sceneWithBadge())

    const holders = r.billboardGroup.children
    const ghost = holders.find((h) => h.userData.kind === 'ghost')
    const sprite = holders.find((h) => h.userData.kind === 'monster')
    expect(ghost && sprite).toBeTruthy()

    // sprite and badge both reach the ghost pass
    const ghostQuads = ghost!.children.filter((c) => (c as THREE.Mesh).geometry)
    const spriteQuads = sprite!.children.filter((c) => (c as THREE.Mesh).geometry && !c.userData.shared)
    expect(ghostQuads.length).toBe(2)
    expect(spriteQuads.length).toBe(2)

    // the remembered tint colours the sprite; the badge keeps its own colours
    expect(vertexColour(ghostQuads[0] as THREE.Mesh).map((v) => +v.toFixed(2))).toEqual([0.55, 0.6, 0.8])
    expect(vertexColour(ghostQuads[1] as THREE.Mesh)).toEqual([1, 1, 1])
    // and the badge stacks over the sprite rather than restarting the z ladder
    expect((ghostQuads[1] as THREE.Mesh).position.z).toBeGreaterThan((ghostQuads[0] as THREE.Mesh).position.z)
  })
})
