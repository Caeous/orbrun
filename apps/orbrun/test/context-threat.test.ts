import { describe, it, expect } from 'vitest'
import { initialState, reduce, MouseMode, type GameState } from '@orbrun/webtiles'
import { cellKey, emptyScene, type Billboard, type Scene } from '@orbrun/scene'
import { deriveContext } from '../src/context'
import { promptLabels } from '../src/bindings'

/**
 * What counts as a hostile for the fight button and the hostiles-in-view
 * count is what autofight would attack. `l-autofight.cc`
 * `_is_candidate_for_autofight_attack` takes hostiles and rejects
 * `MB_FIREWOOD`, so a plant (hostile attitude, `scenery` on the scene) is
 * never an Attack prompt and never a reason to offer Autofight or to confirm
 * a dangerous action.
 */

function room(): Scene {
  const scene = emptyScene()
  scene.player = { x: 4, y: 4 }
  scene.playerOnLevel = true
  for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) scene.cells.set(cellKey(x, y), { x, y, kind: 'floor', visibility: 'visible', occluder: false, floorTile: 1, label: 'floor' } as never)
  return scene
}

function monster(scene: Scene, x: number, y: number, name: string, scenery = false): Billboard {
  const b = { kind: 'monster', x, y, attitude: 'hostile', scenery: scenery || undefined, ref: { id: scene.billboards.length + 1, name, att: 0 } } as unknown as Billboard
  scene.billboards.push(b)
  return b
}

function playing(): GameState {
  const st = initialState()
  st.phase = 'playing' as GameState['phase']
  st.inputMode = MouseMode.COMMAND
  reduce(st, { msg: 'player', pos: { x: 4, y: 4 }, turn: 100 })
  return st
}

// facing north: the cell ahead is (4, 3)
const cam = { facing: 0 } as never

describe('plants are not hostiles worth fighting', () => {
  it('a plant ahead gets no Attack prompt and counts for nothing', () => {
    const st = playing()
    const scene = room()
    monster(scene, 4, 3, 'plant', true)
    const ctx = deriveContext(st, scene, cam, 'micro')
    expect(ctx.ahead).toMatchObject({ kind: 'monster', hostile: false, label: 'plant' })
    expect(ctx.hostilesInView).toBe(0)
    expect(promptLabels(ctx).find((l) => l.button === 'RT')).toBeUndefined()
    expect(promptLabels(ctx).find((l) => l.button === 'LSTICK_UP')).toBeUndefined()
  })

  it('a plant ahead with a rat in view: RT is Autofight, so Tab goes to the rat', () => {
    const st = playing()
    const scene = room()
    monster(scene, 4, 3, 'plant', true)
    monster(scene, 7, 7, 'rat')
    const ctx = deriveContext(st, scene, cam, 'micro')
    expect(ctx.hostilesInView).toBe(1)
    expect(promptLabels(ctx).find((l) => l.button === 'RT')?.label).toBe('Autofight')
    expect(promptLabels(ctx).find((l) => l.button === 'LSTICK_UP')).toBeUndefined()
  })

  it('lost HP with the room clear is the rest prompt; a rat in view takes it away again', () => {
    const st = playing()
    reduce(st, { msg: 'player', hp: 5, hp_max: 20, mp: 3, mp_max: 3 })
    const scene = room()
    const hurt = deriveContext(st, scene, cam, 'micro')
    expect(hurt.injured).toBe(true)
    expect(promptLabels(hurt).find((l) => l.button === 'LB')).toMatchObject({ label: 'Wait one turn', hold: 'Rest' })
    monster(scene, 7, 7, 'rat')
    const threatened = deriveContext(st, scene, cam, 'micro')
    expect(threatened.injured).toBe(true)
    expect(promptLabels(threatened).find((l) => l.button === 'LB')).toBeUndefined()
    reduce(st, { msg: 'player', hp: 20 })
    expect(deriveContext(st, room(), cam, 'micro').injured).toBeUndefined()
  })

  it('a rat ahead is still the attack', () => {
    const st = playing()
    const scene = room()
    monster(scene, 4, 3, 'rat')
    const ctx = deriveContext(st, scene, cam, 'micro')
    expect(ctx.ahead).toMatchObject({ kind: 'monster', hostile: true, label: 'rat' })
    expect(promptLabels(ctx).find((l) => l.button === 'LSTICK_UP')?.label).toBe('Attack rat')
    expect(promptLabels(ctx).find((l) => l.button === 'RT')?.label).toBe('Autofight')
  })
})
