// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { Osk, type OskTarget } from '../src/osk'

const EXTRAS = [
  { ch: '<', label: 'up' },
  { ch: '>', label: 'down' },
  { ch: '$', label: 'last' },
  { ch: '^', label: 'here' },
]

function target(extras?: OskTarget['extras']): OskTarget {
  const input = document.createElement('input')
  document.body.append(input)
  return { input, extras, submit: () => {}, cancel: () => {} }
}

/**
 * The cursor is a row and a column into the target's rows, and a target
 * with extras has one row more than one without: a cursor carried from one
 * to the other must still stand on a key.
 */
describe('on-screen keyboard cursor', () => {
  it('starts on the first key each time it is shown', () => {
    const osk = new Osk()
    const plain = target()
    osk.attach(plain, document.body)
    for (let i = 0; i < 5; i++) osk.op('move', 2)
    osk.detach()
    const depth = target(EXTRAS)
    osk.attach(depth, document.body)
    osk.op('type')
    expect(depth.input.value).toBe('<')
  })

  it('stays on a key when a rebuild swaps in a target with fewer rows', () => {
    const osk = new Osk()
    osk.attach(target(EXTRAS), document.body)
    // up from the extras row wraps to the last of seven rows
    osk.op('move', 0)
    const plain = target()
    osk.attach(plain, document.body)
    expect(() => osk.op('type')).not.toThrow()
    expect(plain.input.value).not.toBe('')
  })

  it('stays on a key when a rebuild swaps in a target whose first row is shorter', () => {
    const osk = new Osk()
    osk.attach(target(), document.body)
    for (let i = 0; i < 6; i++) osk.op('move', 2)
    const depth = target(EXTRAS)
    osk.attach(depth, document.body)
    osk.op('type')
    expect(depth.input.value).toBe('^')
  })
})
