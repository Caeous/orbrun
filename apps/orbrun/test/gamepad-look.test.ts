import { afterEach, describe, expect, it, vi } from 'vitest'
import { GamepadInput, isPadActivity, type PadEvent } from '../src/gamepad'

/** A standard-mapping pad with nothing pressed and the sticks at the given axes. */
function fakePad(axes: number[]): Gamepad {
  return {
    id: 'Xbox Wireless Controller (045e)',
    index: 0,
    connected: true,
    mapping: 'standard',
    timestamp: 0,
    axes,
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    hapticActuators: [],
    vibrationActuator: null,
  } as unknown as Gamepad
}

function withPad(axes: number[]) {
  vi.stubGlobal('navigator', { getGamepads: () => [fakePad(axes)] })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('right stick look has hysteresis', () => {
  it('a stick resting off centre inside the enter threshold emits no look, so it never counts as the pad speaking', () => {
    const gp = new GamepadInput()
    const looks: PadEvent[] = []
    gp.on((e) => { if (e.type === 'look') looks.push(e) })
    // drift of 0.2 is past the 0.15 deadzone but short of the 0.3 entry
    withPad([0, 0, 0.2, 0.05])
    for (let t = 0; t < 10; t++) gp.poll(t * 16)
    expect(looks).toEqual([])
    expect(gp.isLooking).toBe(false)
  })

  it('a deliberate deflection starts a look, keeps it down to the deadzone, and settles once', () => {
    const gp = new GamepadInput()
    const looks: { dx: number; dy: number }[] = []
    gp.on((e) => { if (e.type === 'look') looks.push({ dx: e.dx, dy: e.dy }) })
    withPad([0, 0, 0.6, 0])
    gp.poll(0)
    expect(gp.isLooking).toBe(true)
    expect(looks.length).toBe(1)
    expect(looks[0].dx).toBeGreaterThan(0)
    // easing back to 0.2 is still inside the look once it has started
    withPad([0, 0, 0.2, 0])
    gp.poll(16)
    expect(gp.isLooking).toBe(true)
    expect(looks.length).toBe(2)
    expect(looks[1].dx).toBeGreaterThan(0)
    // under the deadzone: one settling event with zero delta, then silence
    withPad([0, 0, 0.1, 0])
    gp.poll(32)
    gp.poll(48)
    expect(gp.isLooking).toBe(false)
    expect(looks.length).toBe(3)
    expect(looks[2]).toEqual({ dx: 0, dy: 0 })
  })
  it('only the first frame of a look is the pad speaking: a stick held past the threshold, or resting there, does not keep saying so', () => {
    const gp = new GamepadInput()
    const events: PadEvent[] = []
    gp.on((e) => events.push(e))
    withPad([0, 0, 0.6, 0])
    gp.poll(0)
    gp.poll(16)
    gp.poll(32)
    withPad([0, 0, 0.1, 0])
    gp.poll(48)
    expect(events.map((e) => isPadActivity(e))).toEqual([true, false, false, false])
    expect(events.map((e) => e.type === 'look' && e.start === true)).toEqual([true, false, false, false])
  })
})
