import { describe, it, expect } from 'vitest'
import { FocusNav, focusPage, focusSlots, focusStep, focusWrap, type Focusable } from '../src/focus'

/** A stand-in for an element: the nav only toggles a class and scrolls. */
function fakeEl(): HTMLElement {
  const classes = new Set<string>()
  return {
    classList: {
      toggle: (c: string, on?: boolean) => {
        if (on === undefined) on = !classes.has(c)
        if (on) classes.add(c)
        else classes.delete(c)
        return on
      },
      remove: (c: string) => classes.delete(c),
      contains: (c: string) => classes.has(c),
    },
    scrollIntoView: () => {},
  } as unknown as HTMLElement
}

function item(label: string, extra: Partial<Focusable> = {}): Focusable & { fired: number } {
  const f = { label, el: fakeEl(), fired: 0, activate: () => f.fired++, ...extra } as Focusable & { fired: number }
  return f
}

describe('focus layout', () => {
  it('items without rows are each their own row, in order', () => {
    expect(focusSlots([{}, {}, {}])).toEqual([
      { row: 0, col: 0 },
      { row: 1, col: 0 },
      { row: 2, col: 0 },
    ])
  })
  it('items on one row are columns in registration order', () => {
    expect(focusSlots([{ row: 5 }, { row: 5 }, { row: 7 }])).toEqual([
      { row: 5, col: 0 },
      { row: 5, col: 1 },
      { row: 7, col: 0 },
    ])
  })
  it('up and down go to the nearest row keeping the column; left and right stay on the row', () => {
    // the skills screen shape: two columns, the right one shorter, one line with only a right entry
    const slots = focusSlots([
      { row: 1, col: 0 },
      { row: 1, col: 1 },
      { row: 3, col: 0 },
      { row: 3, col: 1 },
      { row: 4, col: 0 },
      { row: 6, col: 1 },
      { row: 7, col: 0 },
    ])
    expect(focusStep(slots, 0, 'down')).toBe(2)
    expect(focusStep(slots, 1, 'down')).toBe(3)
    expect(focusStep(slots, 3, 'down')).toBe(5) // stays in the right column, skipping the row with only a left entry
    expect(focusStep(slots, 4, 'down')).toBe(6) // and the left column skips the right-only row
    expect(focusStep(slots, 5, 'down')).toBe(6) // nothing below in the column: nearest row
    expect(focusStep(slots, 6, 'down')).toBeNull()
    expect(focusStep(slots, 6, 'up')).toBe(4)
    expect(focusStep(slots, 5, 'up')).toBe(3)
    expect(focusStep(slots, 0, 'up')).toBeNull()
    expect(focusStep(slots, 0, 'right')).toBe(1)
    expect(focusStep(slots, 1, 'right')).toBeNull()
    expect(focusStep(slots, 1, 'left')).toBe(0)
    expect(focusStep(slots, 4, 'right')).toBeNull()
  })
  it('in columns, left and right cross to the nearest row of the next column', () => {
    // a row with only a left entry (Long Blades on the skills screen) must still
    // leave sideways, or the arrow falls through and moves the server's own hover
    const slots = focusSlots([
      { row: 1, col: 0 },
      { row: 1, col: 1 },
      { row: 3, col: 0 },
      { row: 3, col: 1 },
      { row: 4, col: 0 },
      { row: 6, col: 1 },
      { row: 7, col: 0 },
    ])
    const cols = { columns: true }
    expect(focusStep(slots, 4, 'right', cols)).toBe(3) // row 4 has no right entry: the nearest one, row 3
    expect(focusStep(slots, 6, 'right', cols)).toBe(5)
    expect(focusStep(slots, 5, 'left', cols)).toBe(6) // row 6 has no left entry: row 7 is nearer than row 4
    expect(focusStep(slots, 0, 'right', cols)).toBe(1) // its own row when it has one
    expect(focusStep(slots, 1, 'right', cols)).toBeNull() // still nothing past the last column
    expect(focusWrap(slots, 1, 'right', cols)).toBe(0) // wraps back to the left column, nearest row
    expect(focusWrap(slots, 5, 'right', cols)).toBe(6)
    expect(focusWrap(slots, 4, 'left', cols)).toBe(3)
  })
  it('wraps to the far row or the far end of the row', () => {
    const slots = focusSlots([{ row: 0 }, { row: 0 }, { row: 1 }])
    expect(focusWrap(slots, 2, 'down')).toBe(0)
    expect(focusWrap(slots, 0, 'up')).toBe(2)
    expect(focusWrap(slots, 1, 'right')).toBe(0)
    expect(focusWrap(slots, 0, 'left')).toBe(1)
    expect(focusWrap(slots, 2, 'right')).toBeNull()
  })
  it('pages by rows and clamps at the ends', () => {
    const slots = focusSlots([{}, {}, {}, {}, {}])
    expect(focusPage(slots, 0, 3)).toBe(3)
    expect(focusPage(slots, 3, 3)).toBe(4)
    expect(focusPage(slots, 4, 3)).toBeNull()
    expect(focusPage(slots, 4, -10)).toBe(0)
  })
})

describe('FocusNav', () => {
  it('starts on the first item, paints one class and reports the label', () => {
    const nav = new FocusNav()
    const a = item('Yes')
    const b = item('No', { cancel: true })
    nav.set([a, b], 'prompt')
    expect(a.el.classList.contains('focused')).toBe(true)
    expect(b.el.classList.contains('focused')).toBe(false)
    expect(nav.info()).toEqual({ label: 'Yes', cancelLabel: 'No', index: 0, count: 2 })
    expect(nav.move('down')).toBe(true)
    expect(a.el.classList.contains('focused')).toBe(false)
    expect(b.el.classList.contains('focused')).toBe(true)
    expect(nav.activate()).toBe(true)
    expect(b.fired).toBe(1)
    expect(a.fired).toBe(0)
  })
  it('B fires the cancel item when the screen has one, else reports false so Esc goes out', () => {
    const nav = new FocusNav()
    const no = item('No', { cancel: true })
    nav.set([item('Yes'), no], 'p')
    expect(nav.cancel()).toBe(true)
    expect(no.fired).toBe(1)
    nav.set([item('Wield'), item('Drop')], 'popup')
    expect(nav.cancel()).toBe(false)
  })
  it('at an edge without wrap it reports false, so the key can be forwarded (a popup scrolls)', () => {
    const nav = new FocusNav()
    nav.set([item('Wield', { row: 0 }), item('Drop', { row: 0 })], 'popup')
    expect(nav.move('up')).toBe(false)
    expect(nav.move('down')).toBe(false)
    expect(nav.move('right')).toBe(true)
    expect(nav.move('right')).toBe(false)
  })
  it('wraps when asked', () => {
    const nav = new FocusNav()
    nav.set([item('a'), item('b')], 's', { wrap: true })
    expect(nav.move('up')).toBe(true)
    expect(nav.info().label).toBe('b')
  })
  it('keeps the cursor on the same item across a rebuild of the same screen', () => {
    const nav = new FocusNav()
    nav.set([item('Fighting', { id: 'row:a' }), item('Dodging', { id: 'row:g' })], 'crt:skills')
    nav.move('down')
    // the server re-sent the screen with the toggled row first
    const g2 = item('Dodging', { id: 'row:g' })
    nav.set([g2, item('Fighting', { id: 'row:a' })], 'crt:skills')
    expect(nav.current()).toBe(g2)
    // a different screen starts over
    const x = item('Wield')
    nav.set([x, item('Drop')], 'popup:describe-item')
    expect(nav.current()).toBe(x)
  })
  it('follows the server when told to (newgame button_focus)', () => {
    const nav = new FocusNav()
    nav.set([item('Fighter'), item('Wizard')], 'popup:newgame-choice', {}, 0)
    nav.set([item('Fighter'), item('Wizard')], 'popup:newgame-choice', {}, 1, true)
    expect(nav.info().index).toBe(1)
  })
  it('a linear strip walks on up and down as well', () => {
    const nav = new FocusNav()
    nav.set([item('Yes', { row: 0 }), item('No', { row: 0 })], 'p', { wrap: true, linear: true })
    expect(nav.move('down')).toBe(true)
    expect(nav.info().label).toBe('No')
    expect(nav.move('down')).toBe(true)
    expect(nav.info().label).toBe('Yes')
  })
  it('with nothing registered every op reports false', () => {
    const nav = new FocusNav()
    nav.set([], 'empty')
    expect(nav.info()).toEqual({ label: null, cancelLabel: null, index: -1, count: 0 })
    expect(nav.move('down')).toBe(false)
    expect(nav.activate()).toBe(false)
    expect(nav.page(1)).toBe(false)
  })
})
