import { describe, it, expect } from 'vitest'
import { GHOST_ALPHA, GHOST_ALPHA_VISIBLE, GHOST_TINT, crowdInstances, type SpriteInstance } from '../src/sprites.js'
import { cellKey, emptyScene, type Scene, type SceneCell, type TileRect } from '@orbrun/scene'

const RECT: TileRect = { atlas: 'main', sx: 0, sy: 0, w: 32, h: 32, ox: 0, oy: 0, cell: 32 }

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
  const { sprites } = crowdInstances(scene, () => RECT, null)
  const of = (p: SpriteInstance['pass']) => sprites.find((i) => i.pass === p)!
  return { sprite: of('opaque'), ghost: sprites.find((i) => i.pass.startsWith('ghost'))! }
}

describe('ghost tint', () => {
  /**
   * A wall's edge cuts a sprite in two, the near half lit and the far half a
   * ghost. If the ghost were tinted, the seam would run down the middle of the
   * monster — the bug this pins: same colours, no seam.
   */
  it('gives a monster in view a ghost in the sprite\'s own colours', () => {
    const { sprite, ghost } = build(sceneWithMonster('visible'))
    expect(ghost.pass).toBe('ghostVisible')
    expect(ghost.color.slice(0, 3)).toEqual(sprite.color.slice(0, 3))
    expect(ghost.color[3]).toBe(GHOST_ALPHA_VISIBLE)
  })
  it('keeps the cool tint for a monster only remembered', () => {
    const { sprite, ghost } = build(sceneWithMonster('remembered'))
    expect(ghost.pass).toBe('ghostRemembered')
    expect(ghost.color.slice(0, 3)).not.toEqual(sprite.color.slice(0, 3))
    const t = GHOST_TINT.remembered
    expect(ghost.color).toEqual([t.r, t.g, t.b, GHOST_ALPHA])
  })
})
