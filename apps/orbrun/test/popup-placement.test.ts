// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { initialState, reduce, MouseMode, type ClientMessage, type GameState } from '@orbrun/webtiles'
import { Overlays } from '../src/overlays'

/**
 * Where a server overlay stands, as WebTiles places it (ui.js show_popup,
 * style.css .ui-popup): at the top, each one pushed over another 20px lower,
 * three deep at most, and in the middle only when crawl sends `ui-centred`.
 */

function setup() {
  const sent: ClientMessage[] = []
  const host = document.createElement('div')
  document.body.append(host)
  const ov = new Overlays(host, {
    send: (m) => sent.push(m),
    gamedata: () => null as never,
    watching: () => false,
    onClientOverlayChange: () => {},
    onSystemAction: () => {},
    settingsPanel: () => ({ el: document.createElement('div'), rows: [] }),
  })
  const st = initialState()
  st.phase = 'playing' as GameState['phase']
  st.inputMode = MouseMode.COMMAND
  return { ov, st, host }
}

const menu = (tag: string, centred: boolean) => ({
  msg: 'menu',
  tag,
  type: 'menu',
  title: { text: tag },
  more: '',
  total_items: 1,
  items: [{ text: 'a - thing', level: 2, hotkeys: [97] }],
  'ui-centred': centred,
})

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('popup placement', () => {
  it('hangs a game menu from the top, and stacks each later one 20px lower, three deep at most', () => {
    const { ov, st, host } = setup()
    reduce(st, menu('inventory', false))
    for (const type of ['describe-item', 'describe-item', 'describe-item', 'describe-item'])
      reduce(st, { msg: 'ui-push', type, title: 'a thing', body: 'text', 'ui-centred': false })
    ov.update(st)
    const els = Array.from(host.querySelectorAll('.popup')) as HTMLElement[]
    expect(els).toHaveLength(5)
    expect(els.some((el) => el.classList.contains('centred'))).toBe(false)
    expect(els.map((el) => el.style.getPropertyValue('--depth'))).toEqual(['0', '1', '2', '3', '3'])
  })

  it('centres what crawl marks ui-centred', () => {
    const { ov, st, host } = setup()
    reduce(st, menu('inventory', true))
    ov.update(st)
    const el = host.querySelector('.popup') as HTMLElement
    expect(el.classList.contains('centred')).toBe(true)
  })
})
