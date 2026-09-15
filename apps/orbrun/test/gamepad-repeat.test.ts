import { afterEach, describe, expect, it, vi } from 'vitest'
import { GamepadInput, type PadEvent } from '../src/gamepad'

/** A standard-mapping pad with `down` held (RT is button 7) and the sticks centred. */
function fakePad(down: number | null): Gamepad {
  return {
    id: 'Xbox Wireless Controller (045e)',
    index: 0,
    connected: true,
    mapping: 'standard',
    timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: i === down, touched: false, value: i === down ? 1 : 0 })),
    hapticActuators: [],
    vibrationActuator: null,
  } as unknown as Gamepad
}

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * A held button beats like a held key, because what it repeats is autofight,
 * which the keyboard plays by leaning on Tab: the OS's own key repeat is the
 * cadence to copy, not the faster one a held direction steps at.
 */
describe('a held button repeats at the keyboard’s cadence', () => {
  it('waits out the delay, then beats once an interval, for as long as it is down', () => {
    let down: number | null = null
    vi.stubGlobal('navigator', { getGamepads: () => [fakePad(down)] })
    const gp = new GamepadInput()
    const events: PadEvent[] = []
    gp.on((e) => events.push(e))

    down = 7
    gp.poll(0)
    expect(events).toEqual([{ type: 'press', button: 'RT', t: 0 }])

    // polled a good deal finer than the cadence, so each tick is dated to the ms
    const at: number[] = []
    gp.on((e) => { if (e.type === 'repeat') at.push(now) })
    let now = 0
    for (now = 1; now <= 1000; now++) gp.poll(now)
    // nothing until the delay is out, then one every interval
    expect(at[0]).toBe(420)
    expect(at).toEqual([420, 520, 620, 720, 820, 920])

    down = null
    gp.poll(1036)
    expect(events.at(-1)).toMatchObject({ type: 'release', button: 'RT' })
    gp.poll(1136)
    expect(at).toHaveLength(6)
  })
})
