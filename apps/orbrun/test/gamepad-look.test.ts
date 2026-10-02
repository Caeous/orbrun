import { afterEach, describe, expect, it, vi } from 'vitest'
import { GamepadInput, isPadActivity, standardView, type PadEvent } from '../src/gamepad'

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

describe('which pad is primary on a Steam Deck with an external controller', () => {
  /** The raw device as Chrome sees it without a mapping: triggers rest at -1 on axes 2 and 5. */
  function rawPad(index: number): Gamepad {
    const buttons = Array.from({ length: 11 }, () => ({ pressed: false, touched: false, value: 0 }))
    return { ...fakePad([0, 0, -1, 0, 0, -1, 0, 0]), buttons, id: 'Microsoft X-Box 360 pad (045e-028e)', index, mapping: '' } as unknown as Gamepad
  }

  it('a raw pad resting its triggers at -1 does not take the primary from the pad being pressed', () => {
    const deck = { ...fakePad([0, 0, 0, 0]), id: 'Steam Virtual Gamepad', index: 0 } as unknown as Gamepad
    const raw = rawPad(1)
    vi.stubGlobal('navigator', { getGamepads: () => [deck, raw] })
    const gp = new GamepadInput()
    const events: PadEvent[] = []
    gp.on((e) => events.push(e))
    gp.poll(0)
    // no look from the raw pad's resting -1 on axis 2
    expect(events).toEqual([])
    deck.buttons[0] = { pressed: true, touched: true, value: 1 }
    gp.poll(16)
    expect(gp.isHeld('A')).toBe(true)
  })

  it('the unmapped pad alone is read once it is used', () => {
    const raw = rawPad(0)
    vi.stubGlobal('navigator', { getGamepads: () => [raw] })
    const gp = new GamepadInput()
    gp.poll(0)
    raw.buttons[0] = { pressed: true, touched: true, value: 1 }
    gp.poll(16)
    expect(gp.isHeld('A')).toBe(true)
  })

  it('when a Steam Input pad and its raw twin wake together, the standard one is read', () => {
    const deck = { ...fakePad([0, 0, 0, 0]), index: 0 } as unknown as Gamepad
    const virt = { ...fakePad([0, 0, 0, 0]), index: 1 } as unknown as Gamepad
    const raw = rawPad(2)
    vi.stubGlobal('navigator', { getGamepads: () => [deck, virt, raw] })
    const gp = new GamepadInput()
    gp.poll(0)
    // Back on the external pad: index 8 on the virtual pad, index 6 (LT's slot) on the raw one
    virt.buttons[8] = { pressed: true, touched: true, value: 1 }
    raw.buttons[6] = { pressed: true, touched: true, value: 1 }
    gp.poll(16)
    expect(gp.isHeld('SELECT')).toBe(true)
    expect(gp.isHeld('LT')).toBe(false)
  })
})

describe('an unmapped pad is read in the standard layout', () => {
  function raw(nButtons: number, axes: number[], down: number[]): Gamepad {
    const buttons = Array.from({ length: nButtons }, (_, i) => ({ pressed: down.includes(i), touched: false, value: down.includes(i) ? 1 : 0 }))
    return { id: 'Xbox Wireless Controller (Vendor: 045e Product: 0b13)', index: 0, mapping: '', axes, buttons } as unknown as Gamepad
  }
  const held = (v: { buttons: boolean[] }) => v.buttons.flatMap((d, i) => (d ? [i] : []))

  it('a wired (xpad) pad: Back, Start, Guide and the stick clicks move to their slots, the triggers and d-pad come off axes', () => {
    expect(held(standardView(raw(11, [0, 0, -1, 0, 0, -1, 0, 0], [6, 7, 8, 9, 10])))).toEqual([8, 9, 10, 11, 16])
    expect(held(standardView(raw(11, [0, 0, 1, 0, 0, 1, -1, 1], [])))).toEqual([6, 7, 13, 14])
    expect(standardView(raw(11, [0.1, 0.2, -1, 0.3, 0.4, -1, 0, 0], [])).axes).toEqual([0.1, 0.2, 0.3, 0.4])
  })

  it('a Bluetooth pad: X and Y skip the gaps, the bumpers come off 6 and 7, the triggers off axes 5 and 4', () => {
    expect(held(standardView(raw(15, [0, 0, 0, 0, -1, -1, 0, 0], [0, 1, 3, 4, 6, 7, 10, 11, 12, 13, 14])))).toEqual([0, 1, 2, 3, 4, 5, 8, 9, 10, 11, 16])
    expect(held(standardView(raw(15, [0, 0, 0, 0, 1, 1, 1, -1], [])))).toEqual([6, 7, 12, 15])
    expect(standardView(raw(15, [0.1, 0.2, 0.3, 0.4, -1, -1, 0, 0], [])).axes).toEqual([0.1, 0.2, 0.3, 0.4])
  })

  it('a resting raw pad presses nothing', () => {
    expect(held(standardView(raw(11, [0, 0, -1, 0, 0, -1, 0, 0], [])))).toEqual([])
    expect(held(standardView(raw(15, [0, 0, 0, 0, -1, -1, 0, 0], [])))).toEqual([])
  })
})

describe('a pad that goes away', () => {
  it('lets go of what it held and settles its look', () => {
    const gp = new GamepadInput()
    const events: PadEvent[] = []
    gp.on((e) => events.push(e))
    const pad = fakePad([0, 0, 0.8, 0])
    ;(pad.buttons[0] as { pressed: boolean }).pressed = true
    vi.stubGlobal('navigator', { getGamepads: () => [pad] })
    gp.poll(0)
    expect(gp.isLooking).toBe(true)
    expect(gp.isHeld('A')).toBe(true)
    vi.stubGlobal('navigator', { getGamepads: () => [null] })
    gp.poll(16)
    expect(gp.connected).toBe(false)
    expect(gp.isLooking).toBe(false)
    expect(gp.isHeld('A')).toBe(false)
    expect(events).toContainEqual({ type: 'release', button: 'A', t: 16, held: 16 })
    expect(events.at(-1)).toEqual({ type: 'look', dx: 0, dy: 0 })
    const n = events.length
    gp.poll(32)
    expect(events.length).toBe(n)
  })
})

describe('the left stick on four ways', () => {
  const dirs = (gp: GamepadInput) => {
    const out: (number | null)[] = []
    gp.on((e) => { if (e.type === 'dir') out.push(e.dir) })
    return out
  }

  it('reads a forward push pulled well off true as forward, never a diagonal', () => {
    const gp = new GamepadInput()
    gp.fourWay = true
    const out = dirs(gp)
    // 35° right of up: a diagonal on eight ways
    withPad([Math.sin(0.61), -Math.cos(0.61), 0, 0])
    gp.poll(0)
    withPad([0.9, 0.05, 0, 0])
    gp.poll(16)
    withPad([0, 0, 0, 0])
    gp.poll(32)
    expect(out).toEqual([0, 2, null])
  })

  it('keeps all eight ways otherwise, as on the level map', () => {
    const gp = new GamepadInput()
    const out = dirs(gp)
    withPad([0.7, -0.7, 0, 0])
    gp.poll(0)
    expect(out).toEqual([1])
  })
})

describe('the right stick on Turn', () => {
  function record(gp: GamepadInput) {
    const out: PadEvent[] = []
    gp.on((e) => { if (e.type !== 'look' || e.dx !== 0 || e.dy !== 0) out.push(e) })
    return out
  }

  it('reads left and right as the left stick does: the same reach, four-way sectors and repeat', () => {
    const gp = new GamepadInput()
    gp.rightStickTurns = true
    const out = record(gp)
    // short of the left stick's 0.55: nothing
    withPad([0, 0, 0.5, 0])
    gp.poll(0)
    // 0.6 and 30° above level: a turn right, as on the left stick
    withPad([0, 0, 0.6 * Math.cos(0.52), -0.6 * Math.sin(0.52)])
    gp.poll(16)
    gp.poll(400)
    withPad([0, 0, 0, 0])
    gp.poll(416)
    expect(out).toEqual([
      { type: 'dir', source: 'rstick', dir: 2 },
      { type: 'dirRepeat', source: 'rstick', dir: 2, n: 1 },
      { type: 'dir', source: 'rstick', dir: null },
    ])
  })

  it('a push up or down only tilts, and sends no direction', () => {
    const gp = new GamepadInput()
    gp.rightStickTurns = true
    const out = record(gp)
    withPad([0, 0, 0.2, -0.9])
    gp.poll(0)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ type: 'look', dx: 0, start: true })
    expect((out[0] as { dy: number }).dy).toBeLessThan(0)
  })

  it('sends no directions as free look', () => {
    const gp = new GamepadInput()
    const out = record(gp)
    withPad([0, 0, 0.9, 0])
    gp.poll(0)
    expect(out).toEqual([{ type: 'look', dx: expect.any(Number), dy: 0, start: true }])
  })
})
