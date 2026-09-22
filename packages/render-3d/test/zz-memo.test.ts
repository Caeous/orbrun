import { it, expect } from 'vitest'
import { LevelGrid } from '../src/grid.js'
import { insetFootprint, bodyRect } from '../src/footprint.js'
import { emptyScene, cellKey, type SceneCell } from '@orbrun/scene'
it('memo matches direct evaluation on random grids', () => {
  let seed = 7
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  for (let trial = 0; trial < 40; trial++) {
    const s = emptyScene()
    const W = 12, H = 12
    s.bounds = { left: 0, top: 0, right: W - 1, bottom: H - 1 }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const r = rnd()
      if (r < 0.15) continue
      const occ = r < 0.55
      const c = { x, y, kind: occ ? 'wall' : 'floor', visibility: 'visible', occluder: occ, floorTile: 1, flags: {} } as unknown as SceneCell
      if (!occ && rnd() < 0.1) c.feature = { type: 'door', state: 'open' }
      s.cells.set(cellKey(x, y), c)
    }
    const g = new LevelGrid(s)
    const memo = new Map()
    const fo = { inset: 12 / 32 }
    for (let y = -1; y <= H; y++) for (let x = -1; x <= W; x++) {
      if (g.classAt(x, y) === 'floor') continue
      const e = g.footprintAt(x, y, fo, memo)
      expect(e.fp).toEqual(insetFootprint(g.classAt, x, y, fo))
      expect(e.rect).toEqual(bodyRect(g.classAt, x, y, fo))
    }
  }
})
