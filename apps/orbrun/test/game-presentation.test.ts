// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cellKey, emptyScene, type Billboard } from '@orbrun/scene'
import { initialState, MouseMode } from '@orbrun/webtiles'
import { Render3d } from '@orbrun/render-3d'
import { CameraController } from '../src/camera'
import { GameScreen } from '../src/game'

/** Real frame/camera/motion wiring, without a socket or WebGL drawing. */
function harness() {
  const state = initialState()
  state.phase = 'playing'
  state.inputMode = MouseMode.COMMAND
  const scene = emptyScene()
  scene.revision = 1
  const monster: Billboard = { kind: 'monster', x: 3, y: -1, tile: 0, attitude: 'hostile', ref: { id: 1 } }
  scene.billboards = [monster]
  scene.cells.set(cellKey(3, -1), {
    x: 3, y: -1, kind: 'floor', visibility: 'visible', occluder: false, floorTile: 0,
    flags: { water: false, lava: false, excluded: false, travelTrail: false, newStair: false, cursor: false },
  })
  const cam = new CameraController()
  const renderer = new Render3d()
  renderer.setScene(scene, 1)
  const session = { state, scene, flushScene: vi.fn(() => false) }
  const screen = Object.assign(Object.create(GameScreen.prototype), {
    session, cam, renderer, lastFrame: 1000,
    awake: () => false, wake: vi.fn(), idleTick: vi.fn(), sceneTime: undefined,
  }) as {
    loop(now: number): void
    advancePresentation(dt: number, now: number): boolean
    sceneTime: number | undefined
  }
  return { screen, state, scene, session, cam, renderer, monster }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('game presentation', () => {
  it('uses the frame timestamp inside scene flush and samples both movers on it', () => {
    vi.useFakeTimers()
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(7)
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    vi.spyOn(performance, 'now').mockReturnValue(888888)
    const h = harness()
    h.session.flushScene.mockImplementationOnce(() => {
      expect(h.screen.sceneTime).toBe(1.05)
      h.scene.player.x = 1
      h.monster.x = 4
      h.scene.revision++
      h.cam.walkTo(1, 0, [{ dx: 1, dy: 0 }], h.screen.sceneTime)
      h.renderer.setScene(h.scene, h.screen.sceneTime)
      return true
    })
    h.screen.loop(1050)
    expect(h.screen.sceneTime).toBeUndefined()
    expect(h.cam.camera.eyeX).toBe(0)
    expect(h.renderer.monsterPosition(h.monster, 1.05).x).toBe(3)
    h.screen.loop(1100)
    expect(h.cam.camera.eyeX).toBeCloseTo(0.875, 12)
    expect(h.renderer.monsterPosition(h.monster, 1.1).x - 3).toBeCloseTo(h.cam.camera.eyeX, 12)
    h.renderer.destroy()
  })

  it('advances the shared clock without sampling the enemy for camera tracking', () => {
    const h = harness()
    h.cam.autofight(h.scene)
    const position = vi.spyOn(h.renderer, 'monsterPosition')
    const update = vi.spyOn(h.cam, 'update')
    h.screen.advancePresentation(0.016, 1.05)
    expect(position).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledExactlyOnceWith(0.016, 1.05)
    h.renderer.destroy()
  })
})
