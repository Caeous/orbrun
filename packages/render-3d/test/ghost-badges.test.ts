import { describe, it, expect } from 'vitest'
import { GHOST_TINT, crowdInstances, type SpriteInstance } from '../src/sprites.js'
import { emptyScene, type Scene, type TileRect } from '@orbrun/scene'

const RECT: TileRect = { atlas: 'main', sx: 0, sy: 0, w: 32, h: 32, ox: 0, oy: 0, cell: 32 }

/** A monster on a cell the scene does not hold, so it is remembered, wearing one status badge. */
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

describe('ghost badges', () => {
  it('draws status badges through walls, in their own colours', () => {
    const { sprites } = crowdInstances(sceneWithBadge(), () => RECT, null)
    const of = (p: SpriteInstance['pass']) => sprites.filter((i) => i.pass === p)
    const sprite = of('opaque')
    const ghost = of('ghostRemembered')
    // sprite and badge both reach the ghost pass
    expect(sprite).toHaveLength(2)
    expect(ghost).toHaveLength(2)

    // the remembered tint colours the sprite; the badge keeps its own colours
    const t = GHOST_TINT.remembered
    expect(ghost[0].color.slice(0, 3)).toEqual([t.r, t.g, t.b])
    expect(ghost[1].color.slice(0, 3)).toEqual([1, 1, 1])
    // and the badge stacks over the sprite rather than restarting the z ladder
    expect(ghost[1].z[0]).toBeGreaterThan(ghost[0].z[0])
    // a badge is a mark on the sprite: flat, and never inked
    expect(ghost[1].misc[1]).toBe(0)
    expect(sprite[1].misc[1]).toBe(0)
  })
})
