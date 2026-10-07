// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { initialState } from '@orbrun/webtiles'
import { GameScreen } from '../src/game'

/**
 * ui.js popup_clickoutside_handler: a press outside a popup is Escape. A
 * crawl menu is a popup too, and Orbrun's own panels step back the same way;
 * the touch bar's buttons are never outside: its Back is the pad's B. The
 * bar around them is.
 */
function harness(over: { mode: string; ours?: boolean }) {
  const chat = document.createElement('div')
  const sent: unknown[] = []
  const overlayInput = vi.fn()
  const touchPress = vi.fn()
  const screen = Object.assign(Object.create(GameScreen.prototype), {
    ctx: { mode: over.mode },
    session: { state: initialState(), watching: false },
    chat: { root: chat, owns: (el: Element) => chat.contains(el) },
    hud: { hideTooltip: vi.fn() },
    overlays: { hasClientOverlay: !!over.ours, clientOverlayInput: overlayInput, tabLean: { lean() {}, end() {} } },
    runner: { send: (m: unknown) => sent.push(m) },
    tooltipTimer: 0,
    wake: vi.fn(), inputFrom: vi.fn(), touchPress,
  }) as { onDocPointer(ev: PointerEvent): void; outsideLift(ev: PointerEvent): void }
  const event = (type: string, el: Element, init: object) => {
    const ev = Object.assign(new Event(type, { cancelable: true }), { pointerId: 1, clientX: 100, clientY: 100, ...init })
    Object.defineProperty(ev, 'target', { value: el })
    return ev as unknown as PointerEvent
  }
  /** a press and its lift, `dx` across from where it came down */
  const press = (el: Element, pointerType = 'touch', button = 0, dx = 0, type = 'pointerup') => {
    if (!el.isConnected) document.body.append(el)
    screen.onDocPointer(event('pointerdown', el, { pointerType, button }))
    screen.outsideLift(event(type, el, { pointerType, button, clientX: 100 + dx }))
  }
  const el = (cls: string) => Object.assign(document.createElement('div'), { className: cls })
  return { press, el, sent, overlayInput, touchPress }
}

describe('a tap outside what is up closes it, as Escape does', () => {
  it('a crawl menu: Escape goes to the server', () => {
    const h = harness({ mode: 'menu' })
    h.press(h.el('view'))
    expect(h.sent).toEqual([{ msg: 'key', keycode: 27 }])
  })
  it('a panel of ours: one step back, as B takes it', () => {
    const h = harness({ mode: 'command', ours: true })
    h.press(h.el('view'))
    expect(h.overlayInput).toHaveBeenCalledWith('cancel')
  })
  it('inside the panel, or on a touch bar button, the press is theirs', () => {
    for (const ours of [true, false]) {
      const h = harness({ mode: ours ? 'command' : 'popup', ours })
      h.press(h.el('popup'))
      const bar = h.el('touchbar')
      const tb = Object.assign(document.createElement('button'), { className: 'tb' })
      bar.append(tb)
      document.body.append(bar)
      h.press(tb)
      expect(h.sent).toEqual([])
      expect(h.overlayInput).not.toHaveBeenCalled()
    }
  })
  it('the touch bar where no button stands is outside: between the buttons, or on a dim placeholder', () => {
    const h = harness({ mode: 'menu' })
    const bar = h.el('touchbar')
    const idle = Object.assign(document.createElement('span'), { className: 'tb idle' })
    bar.append(idle)
    document.body.append(bar)
    h.press(bar)
    h.press(idle)
    expect(h.sent).toEqual([{ msg: 'key', keycode: 27 }, { msg: 'key', keycode: 27 }])
    const ours = harness({ mode: 'command', ours: true })
    ours.press(ours.el('touchbar'))
    expect(ours.overlayInput).toHaveBeenCalledWith('cancel')
  })
  it('a swipe outside is no tap: it turns the tabs, as a swipe over the menu does', () => {
    for (const ours of [true, false]) {
      const h = harness({ mode: ours ? 'command' : 'menu', ours })
      h.press(h.el('view'), 'touch', 0, -80)
      h.press(h.el('view'), 'touch', 0, 80)
      expect(h.touchPress.mock.calls).toEqual([['DR'], ['DL']])
      expect(h.sent).toEqual([])
      expect(h.overlayInput).not.toHaveBeenCalled()
    }
  })
  it('a gesture the browser takes for itself neither closes nor turns', () => {
    const h = harness({ mode: 'menu' })
    h.press(h.el('view'), 'touch', 0, 0, 'pointercancel')
    expect(h.sent).toEqual([])
    expect(h.touchPress).not.toHaveBeenCalled()
  })
  it('the map itself has nothing to close', () => {
    const h = harness({ mode: 'command' })
    h.press(h.el('view'))
    expect(h.sent).toEqual([])
  })
})

describe('a mouse keeps what it had: only a popup or dialog closes on a click outside it (ui.js)', () => {
  it('a crawl menu stays up under a click beside it, and a right click inside it is no Escape (menu.js takes it)', () => {
    const h = harness({ mode: 'menu' })
    h.press(h.el('view'), 'mouse')
    h.press(h.el('popup'), 'mouse', 2)
    expect(h.sent).toEqual([])
  })
  it('a panel of ours stays up: the view beside it is the mouse\'s to drag while a setting is tuned', () => {
    const h = harness({ mode: 'command', ours: true })
    h.press(h.el('view'), 'mouse')
    expect(h.overlayInput).not.toHaveBeenCalled()
  })
  it('a server popup closes on a click outside, and on a right click anywhere', () => {
    const h = harness({ mode: 'popup' })
    h.press(h.el('view'), 'mouse')
    h.press(h.el('popup'), 'mouse', 2)
    expect(h.sent).toEqual([{ msg: 'key', keycode: 27 }, { msg: 'key', keycode: 27 }])
  })
})
