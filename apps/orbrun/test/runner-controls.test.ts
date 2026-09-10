import { describe, expect, it, vi } from 'vitest'
import { initialState, MouseMode } from '@orbrun/webtiles'
import { emptyScene } from '@orbrun/scene'
import { Runner, type RunnerHooks } from '../src/runner'
import type { Session } from '../src/session'
import type { CameraController } from '../src/camera'
import type { Context } from '../src/context'

function setup() {
  const send = vi.fn()
  const ui = vi.fn()
  const state = initialState()
  state.inputMode = MouseMode.COMMAND
  const ctx: Context = {
    mode: 'command', layer: 'micro', hostilesInView: 1,
    ahead: { kind: 'monster', label: 'ogre', hostile: true, monster: {} as never },
    under: { kind: 'none', label: '' },
  }
  const session = { watching: false, send, state, scene: emptyScene() } as unknown as Session
  const cam = { autofight: () => false } as unknown as CameraController
  const hooks = { context: () => ctx, ui, confirmDangerous: () => false, now: () => 0 } as unknown as RunnerHooks
  return { runner: new Runner(session, cam, hooks), ctx, send, ui }
}

describe('controller combat and interaction', () => {
  it('autofight sends Tab even with a hostile directly ahead, never a bypassing melee step', () => {
    const h = setup()
    h.runner.fight()
    expect(h.send).toHaveBeenCalledExactlyOnceWith({ msg: 'key', keycode: 9 })
  })

  it('refuses autofight outside command mode', () => {
    const h = setup()
    h.ctx.mode = 'targeting'
    h.runner.fight()
    expect(h.send).not.toHaveBeenCalled()
  })

  it('items on stairs require a choice, with no game key sent while choosing', () => {
    const h = setup()
    h.ctx.under = { kind: 'feature', feature: { type: 'stairs', dir: 'down' }, label: 'stairs', items: 'a potion' }
    h.runner.contextual()
    expect(h.ui).toHaveBeenCalledExactlyOnceWith('interact')
    expect(h.send).not.toHaveBeenCalled()
    h.runner.contextual(true)
    expect(h.send).toHaveBeenLastCalledWith({ msg: 'input', text: ',' })
    h.runner.contextual(false)
    expect(h.send).toHaveBeenLastCalledWith({ msg: 'input', text: '>' })
  })

  it('bare stairs still work with one press, without a hold', () => {
    const h = setup()
    h.ctx.under = { kind: 'feature', feature: { type: 'stairs', dir: 'up' }, label: 'stairs' }
    h.runner.contextual()
    expect(h.send).toHaveBeenCalledExactlyOnceWith({ msg: 'input', text: '<' })
    expect(h.ui).not.toHaveBeenCalled()
  })
})
