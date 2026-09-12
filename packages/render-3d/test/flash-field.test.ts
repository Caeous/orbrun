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

/** A 3x3 room, the middle row floor; `flash` washes the cells the game flashes. */
function room(flash?: { r: number; g: number; b: number; a: number }): Scene {
  const s = emptyScene()
  s.playerOnLevel = true
  s.player = { x: 1, y: 1 }
  s.bounds = { left: 0, top: 0, right: 2, bottom: 2 }
  for (let y = 0; y <= 2; y++) {
    for (let x = 0; x <= 2; x++) {
      const floor = y === 1
      s.cells.set(cellKey(x, y), {
        x,
        y,
        kind: floor ? 'floor' : 'wall',
        visibility: 'visible',
        occluder: !floor,
        floorTile: 0,
        wallTile: floor ? undefined : 1,
        // the game washes what it can see: here, the floor the player stands on
        flash: floor ? flash : undefined,
      })
    }
  }
  return s
}

type Inner = {
  setTiles(t: TileSource): void
  levelGroup: THREE.Group
  rebuildLevel(s: Scene): void
  updateFields(s: Scene): void
  flashTex: THREE.DataTexture | null
  fieldUniforms: { flashMap: { value: THREE.Texture | null }; fieldOrigin: { value: THREE.Vector2 }; fieldSize: { value: THREE.Vector2 } }
  atlases: Map<string, { ghostMat: THREE.ShaderMaterial; ghostVisibleMat: THREE.ShaderMaterial }>
}

function build(scene: Scene): Inner {
  const r = new Render3d() as unknown as Inner
  r.setTiles(tiles)
  r.rebuildLevel(scene)
  r.updateFields(scene)
  return r
}

/** The flash texel over cell (x, y), rgba 0..255. */
function texel(r: Inner, x: number, y: number): number[] {
  const o = r.fieldUniforms.fieldOrigin.value
  const w = r.fieldUniforms.fieldSize.value.x
  const i = ((y - o.y) * w + (x - o.x)) * 4
  const d = r.flashTex!.image.data as Uint8Array
  return [d[i], d[i + 1], d[i + 2], d[i + 3]]
}

describe('the flash field', () => {
  const PARALYSED = { r: 64, g: 64, b: 255, a: 100 }

  /**
   * The flash is a wash over the whole cell, as WebTiles fills the cell with
   * it in 2D — not a decal on the ground. It rides a field the materials read,
   * so a level that starts flashing builds exactly the same geometry.
   */
  it('adds no geometry: the same level, flashed or not', () => {
    const plain = build(room())
    const flashed = build(room(PARALYSED))
    const count = (r: Inner) => r.levelGroup.children.length
    const tris = (r: Inner) =>
      r.levelGroup.children.reduce((n, c) => n + (((c as THREE.Mesh).geometry?.getIndex()?.count ?? 0) as number), 0)
    expect(count(flashed)).toBe(count(plain))
    expect(tris(flashed)).toBe(tris(plain))
  })

  it('carries the server\'s colour and alpha, cell by cell', () => {
    const r = build(room(PARALYSED))
    expect(texel(r, 1, 1)).toEqual([64, 64, 255, 100])
    // an unwashed cell keeps the colour and drops to nothing: the field is
    // filtered, and a black texel there would fringe the edge of the wash
    expect(texel(r, 1, 0)).toEqual([64, 64, 255, 0])
  })

  it('leaves the field clear when nothing flashes', () => {
    const r = build(room())
    expect(texel(r, 1, 1)).toEqual([0, 0, 0, 0])
  })

  /**
   * Blindness thickens the wash with the distance from the player
   * (view.cc `draw_cell`), so the far end of the view is the hardest to read.
   * The field has to keep that: one alpha per cell, not one for the view.
   */
  it('keeps a wash that thickens with distance', () => {
    const s = room()
    s.cells.get(cellKey(0, 1))!.flash = { r: 255, g: 255, b: 255, a: 1 }
    s.cells.get(cellKey(2, 1))!.flash = { r: 255, g: 255, b: 255, a: 64 }
    const r = build(s)
    expect(texel(r, 0, 1)[3]).toBe(1)
    expect(texel(r, 2, 1)[3]).toBe(64)
  })

  /**
   * The ghosts — the sprites drawn through walls — sample the same field in
   * their own shader. A ghost material built without the field's uniforms
   * reads whatever texture is bound to unit 0 as its flash and comes out as a
   * solid blob of the wrong colour behind every wall.
   */
  it('hands the ghost shaders the field uniforms', () => {
    const r = build(room(PARALYSED))
    const a = r.atlases.get('main')!
    for (const m of [a.ghostMat, a.ghostVisibleMat]) {
      expect(m.uniforms.flashMap).toBe(r.fieldUniforms.flashMap)
      expect(m.uniforms.fieldOrigin).toBe(r.fieldUniforms.fieldOrigin)
      expect(m.uniforms.fieldSize).toBe(r.fieldUniforms.fieldSize)
      expect(m.uniforms.flashMap.value).toBe(r.flashTex)
    }
  })
})
