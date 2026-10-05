import { describe, it, expect } from 'vitest'
import { stubbed } from './bed.js'
import { cellKey, emptyScene, makeCamera, type Scene, type TileRect, type TileSource } from '@orbrun/scene'

const RECT: TileRect = { atlas: 'main', sx: 0, sy: 0, w: 32, h: 32, ox: 0, oy: 0, cell: 32 }
const tiles: TileSource = {
  tile: () => RECT,
  atlas: () => ({ width: 64, height: 64 }) as unknown as TexImageSource,
  atlasNames: () => ['main'],
}

/** An open floor 9 cells square, the player in the middle of its south edge. */
function room(): Scene {
  const s = emptyScene()
  s.revision = s.layoutRevision = 1
  s.bounds = { left: 0, top: 0, right: 8, bottom: 8 }
  s.playerOnLevel = true
  s.player = { x: 4, y: 8 }
  for (let y = 0; y <= 8; y++)
    for (let x = 0; x <= 8; x++) s.cells.set(cellKey(x, y), { x, y, kind: 'floor', visibility: 'visible', occluder: false, floorTile: 0 })
  return s
}

/** A 120×200 upright view with 40 px of foot behind the log, `top` px more above it under the band. */
function view(top: number) {
  const bed = stubbed({ fov: 110, viewmodel: true }, tiles)
  bed.r.resize(120, 200 + top, 1)
  bed.r.setUpright(true)
  bed.r.setLensTop(top)
  bed.r.setLensFoot(40)
  bed.r.setCamera(makeCamera(4, 8, 0))
  bed.r.setScene(room())
  bed.r.setViewmodel({ weapon: { layers: [1] }, offhand: { name: 'HAND2_BUCKLER', layers: [2] } } as unknown as Parameters<typeof bed.r.setViewmodel>[0])
  bed.r.render()
  return bed
}

/**
 * Held upright, the 3D view runs on up under the minimap's band (game.ts
 * relayout): what was in sight below the band stays where it was, the same
 * size, and the HUD reads the same lens off it.
 */
describe('a view running on up under the band', () => {
  it('picks the same cell at the same place below the band', () => {
    const short = view(0)
    const tall = view(60)
    for (const [x, y] of [[60, 80], [20, 120], [100, 150], [60, 190]]) expect(tall.r.pick(x, y + 60)).toBe(short.r.pick(x, y))
    short.r.destroy()
    tall.r.destroy()
  })

  it('lends the HUD the same lens', () => {
    const short = view(0).r.projector()
    const tall = view(60).r.projector()
    expect(tall.tanHalfY).toBeCloseTo(short.tanHalfY)
    expect(tall.aspect).toBeCloseTo(short.aspect)
    expect(tall.shiftY).toBeCloseTo(short.shiftY)
    expect(tall.height).toBe(short.height)
  })

  it('keeps the hands where they were across', () => {
    const short = view(0).r.handsFootprint()
    const tall = view(60).r.handsFootprint()
    expect(short).toHaveLength(2)
    expect(tall).toEqual(short)
  })
})
