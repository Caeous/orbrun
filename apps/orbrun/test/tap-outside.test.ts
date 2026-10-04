// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { initialState } from '@orbrun/webtiles'
import { GameScreen } from '../src/game'

/**
 * ui.js popup_clickoutside_handler: a press outside a popup is Escape. A
 * crawl menu is a popup too, and Orbrun's own panels step back the same way;
 * the touch bar is never outside: its Back is the pad's B.
 */
function harness(over: { mode: string; ours?: boolean }) {
  const chat = document.createElement('div')
  const sent: unknown[] = []
  const overlayInput = vi.fn()
  const screen = Object.assign(Object.create(GameScreen.prototype), {
    ctx: { mode: over.mode },
    session: { state: initialState(), watching: false },
    chat: { root: chat },
    hud: { hideTooltip: vi.fn() },
    overlays: { hasClientOverlay: !!over.ours, clientOverlayInput: overlayInput },
    runner: { send: (m: unknown) => sent.push(m) },
    tooltipTimer: 0,
    wake: vi.fn(), inputFrom: vi.fn(),
  }) as { onDocPointer(ev: PointerEvent): void }
  const press = (el: Element, pointerType = 'touch', button = 0) => {
    if (!el.isConnected) document.body.append(el)
    const ev = Object.assign(new Event('pointerdown', { cancelable: true }), { pointerType, button })
    Object.defineProperty(ev, 'target', { value: el })
    screen.onDocPointer(ev as unknown as PointerEvent)
  }
  const el = (cls: string) => Object.assign(document.createElement('div'), { className: cls })
  return { press, el, sent, overlayInput }
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
  it('inside the panel, or on the touch bar, the press is theirs', () => {
    for (const ours of [true, false]) {
      const h = harness({ mode: ours ? 'command' : 'popup', ours })
      h.press(h.el('popup'))
      h.press(h.el('touchbar'))
      const bar = h.el('touchbar')
      const tb = h.el('tb')
      bar.append(tb)
      document.body.append(bar)
      h.press(tb)
      expect(h.sent).toEqual([])
      expect(h.overlayInput).not.toHaveBeenCalled()
    }
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
