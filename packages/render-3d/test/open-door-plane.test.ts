import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { Render3d } from '../src/index.js'
import { cellKey, emptyScene, type Scene, type TileRect, type TileSource } from '@orbrun/scene'

const RECT: TileRect = { atlas: 'main', sx: 0, sy: 0, w: 32, h: 32, ox: 0, oy: 0, cell: 32 }

const tiles: TileSource = {
  tile: () => RECT,
  atlas: () => ({ width: 64, height: 64 }) as unknown as TexImageSource,
  atlasNames: () => ['main'],
}

type Priv = { setTiles(t: TileSource): void; levelGroup: THREE.Group; rebuildLevel(s: Scene): void; atlas(name: string): { mask?: Uint8Array | null } }

function render(scene: Scene): Priv {
  const r = new Render3d() as unknown as Priv
  r.setTiles(tiles)
  r.rebuildLevel(scene)
  return r
}

/**
 * A corridor running `along` with an open door in the middle of it. 'x' walls
 * the door east and west, 'z' walls it north and south; 'none' opens every
 * side, so there is no wall run to read.
 */
function corridor(along: 'x' | 'z' | 'none'): Scene {
  const s = emptyScene()
  s.playerOnLevel = true
  s.player = { x: 1, y: 3 }
  s.bounds = { left: 0, top: 0, right: 2, bottom: 4 }
  for (let y = 0; y <= 4; y++) {
    for (let x = 0; x <= 2; x++) {
      const door = x === 1 && y === 2
      const wall = !door && (along === 'x' ? x !== 1 : along === 'z' ? y !== 2 : false)
      s.cells.set(cellKey(x, y), {
        x,
        y,
        kind: wall ? 'wall' : 'floor',
        visibility: 'visible',
        occluder: wall,
        floorTile: 0,
        wallTile: wall ? 1 : undefined,
        featureTile: door ? 5 : undefined,
        stance: door ? 'upright' : undefined,
        feature: door ? { type: 'door', state: 'open' } : undefined,
      })
    }
  }
  return s
}

function build(scene: Scene): THREE.Object3D[] {
  return render(scene).levelGroup.children.filter((c) => c.userData.fixedFacing)
}

/** How far east the level's masonry reaches inside the door's row (world x), the door's own board aside. */
function jambReach(r: Priv): number {
  let max = 0
  for (const child of r.levelGroup.children) {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) continue
    const pos = mesh.geometry.getAttribute('position')
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
      // the masonry itself, not the floor patch that continues under what the inset removed
      if (y <= 1e-6 || x > 1 + 1e-6 || z < 2 - 1e-6 || z > 3 + 1e-6) continue
      max = Math.max(max, x)
    }
  }
  return max
}

describe('an open door', () => {
  /**
   * A door hangs in its doorway. A board that turned with the camera would
   * pull the leaves and their arch off the walls they are set into, so the
   * door stands squared to the wall run instead and never turns.
   */
  it('stands in the plane of the wall run it is set into', () => {
    const [x] = build(corridor('x'))
    expect(x.userData.billboard).toBe(false)
    expect(x.rotation.y).toBe(0)
    const [z] = build(corridor('z'))
    expect(z.userData.billboard).toBe(false)
    expect(z.rotation.y).toBeCloseTo(Math.PI / 2)
  })

  /** Full height, like the closed door's block, and in the wall plane rather than standing back from it. */
  it('fills its doorway', () => {
    const [door] = build(corridor('x'))
    const mesh = door.children[0] as THREE.Mesh
    mesh.geometry.computeBoundingBox()
    const bb = mesh.geometry.boundingBox!
    // (the quad is inset a quarter texel by UV_INSET)
    expect(mesh.position.y + bb.max.y).toBeCloseTo(1, 1)
    expect(mesh.position.z).toBe(0)
  })

  /**
   * The wall run keeps its full thickness up to the doorway rather than
   * stepping back by the inset either side of it: a board one cell wide fills
   * an opening one cell wide, and the door meets the walls it hangs between.
   */
  it('is met by the wall run it hangs in', () => {
    expect(jambReach(render(corridor('x')))).toBeCloseTo(1, 5)
  })

  /** With no wall run to read, there is no plane to stand in: the board faces the eye as any fixture does. */
  it('faces the camera where there is no doorway', () => {
    const [door] = build(corridor('none'))
    expect(door.userData.billboard).toBe(true)
  })

  /**
   * Seen from every side and edge-on as the player walks through, a hull round
   * the door is a band, not a line: its back swings out from the board in
   * parallax and it pokes into the masonry either side. The door's ink is the
   * flat ring in the board's plane instead, black on both faces.
   */
  it('wears its ink as a flat ring in its plane, not a hull', () => {
    const r = new Render3d() as unknown as Priv
    r.setTiles(tiles)
    // a 2x2 body in the middle of the 32x32 tile
    const mask = new Uint8Array(64 * 64)
    for (const [x, y] of [[15, 15], [16, 15], [15, 16], [16, 16]]) mask[y * 64 + x] = 1
    r.atlas('main').mask = mask
    r.rebuildLevel(corridor('x'))
    const [door] = r.levelGroup.children.filter((c) => c.userData.fixedFacing)
    const ink = door.children.find((c) => c.userData.hull) as THREE.Mesh
    expect(ink).toBeTruthy()
    const mat = ink.material as THREE.MeshBasicMaterial
    expect(mat.side).toBe(THREE.DoubleSide)
    expect(mat.color.getHex()).toBe(0)
    const pos = ink.geometry.getAttribute('position') as THREE.BufferAttribute
    // the eight texels round the body as four flat faces (the row above, the row below, the two columns beside), all in the board's plane
    expect(pos.count).toBe(4 * 4)
    for (let i = 0; i < pos.count; i++) expect(pos.getZ(i)).toBe(0)
  })

  /**
   * The board is stretched a wall inset each way into the run, so the tile's
   * edge columns lie on the reveal faces either side of the doorway; ink there
   * straddles the masonry and tears up the wall. The ring keeps off them.
   */
  it('keeps its ink off the tile\'s edge columns, which stand in the masonry', () => {
    const r = new Render3d() as unknown as Priv
    r.setTiles(tiles)
    // a body one texel in from the tile's left edge: its ring would reach column 0
    const mask = new Uint8Array(64 * 64)
    mask[15 * 64 + 1] = 1
    r.atlas('main').mask = mask
    r.rebuildLevel(corridor('x'))
    const [door] = r.levelGroup.children.filter((c) => c.userData.fixedFacing)
    const ink = door.children.find((c) => c.userData.hull) as THREE.Mesh
    const pos = ink.geometry.getAttribute('position') as THREE.BufferAttribute
    // above, below and right of the body, not left
    expect(pos.count).toBe(3 * 4)
    let x0 = Infinity
    for (let i = 0; i < pos.count; i++) x0 = Math.min(x0, pos.getX(i))
    expect(x0).toBeCloseTo(-0.5 + 1 / 32, 6)
  })

  /**
   * The board fills its cell, so where its art reaches the tile's edge the
   * block's rim faces lie in the planes of the reveals either side, the
   * ceiling and the floor, and tear against them. Those faces are left out.
   */
  it('has no rim face on the tile\'s boundary', () => {
    const r = new Render3d() as unknown as Priv
    r.setTiles(tiles)
    // art over the whole tile: every rim face would be on the boundary
    const mask = new Uint8Array(64 * 64)
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) mask[y * 64 + x] = 1
    r.atlas('main').mask = mask
    r.rebuildLevel(corridor('x'))
    const [door] = r.levelGroup.children.filter((c) => c.userData.fixedFacing)
    const board = door.children.find((c) => !c.userData.hull) as THREE.Mesh
    expect((board.geometry.getAttribute('position') as THREE.BufferAttribute).count).toBe(4)
  })
})
