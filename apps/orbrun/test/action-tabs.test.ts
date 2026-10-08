// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initialState, type GameState, type MenuState } from '@orbrun/webtiles'
import { emptyScene } from '@orbrun/scene'
import { ACTION_TABS, actionNeighbour, actionTabOf } from '../src/action-tabs'
import { barLabels, bindingTable, promptLabels } from '../src/bindings'
import { deriveContext } from '../src/context'
import { Overlays } from '../src/overlays'

// the titles as crawl 0.34 sends them, read off the offline engine (spl-cast.cc, ability.cc, evoke, quiver.cc)
const menu = (tag: string, title: string): MenuState => ({ tag, flags: 0, title: { text: title }, items: [], last_hovered: -1, more: '', alt_more: '' }) as unknown as MenuState
const CAST = menu('spell', ' <lightgrey>Your spells (cast)                  Type                      Failure  Level')
const ABILITIES = menu('ability', '  Ability - do what?                  Cost                            Failure')
const EVOKE = menu('use_item', 'Evoke which item?')
const QUIVER = menu('actions', 'Quiver which action? ([-] to clear)')

/** a game with crawl's menu `m` up */
function up(m: MenuState) {
  const st = initialState()
  st.phase = 'playing' as GameState['phase']
  st.menus.push(m)
  return deriveContext(st, emptyScene(), { facing: 0 } as never, 'micro')
}

afterEach(() => { document.body.replaceChildren() })

describe("X's actions as tabs", () => {
  it("are crawl's cast list, abilities, evoke and quiver menus, and no other", () => {
    expect([CAST, ABILITIES, EVOKE, QUIVER].map(actionTabOf)).toEqual(['spells', 'abilities', 'evocables', 'quiver'])
    // `I` lists the same spells to describe them, quaff is another use-item menu, the pack another menu altogether
    expect(actionTabOf(menu('spell', 'Your spells (describe)'))).toBeNull()
    expect(actionTabOf(menu('use_item', 'Drink which item?'))).toBeNull()
    expect(actionTabOf(menu('inventory', 'Gear: 3/52 gear slots'))).toBeNull()
  })

  it('turn round both ways and pass none by: an empty tab says so when it is up', () => {
    expect(ACTION_TABS.map((t) => t.label)).toEqual(['Spells', 'Abilities', 'Evocables', 'Quiver'])
    expect(actionNeighbour('spells', 1)).toBe('abilities')
    expect(actionNeighbour('quiver', 1)).toBe('spells')
    expect(actionNeighbour('spells', -1)).toBe('quiver')
  })

  it('put the tabs on the bumpers, named for where they turn; swapping weapons is the pack\'s and shouting the character\'s', () => {
    for (const m of [CAST, ABILITIES, EVOKE, QUIVER]) {
      const t = bindingTable(up(m))
      expect(t.LB).toEqual({ kind: 'ui', op: 'actionTab', arg: -1 })
      expect(t.RB).toEqual({ kind: 'ui', op: 'actionTab', arg: 1 })
      expect(t.LT).toBeUndefined()
    }
    const bar = Object.fromEntries(barLabels(up(CAST)).map((l) => [l.button, l.label]))
    expect(bar).toMatchObject({ LB: 'Quiver', RB: 'Abilities', X: 'Examine' })
    expect(Object.values(bar)).not.toContain('Swap weapons')
    expect(promptLabels(up(CAST)).map((l) => l.label)).not.toContain('Shout')
  })

  it("an empty tab is a frame of Orbrun's with crawl's line in it, its tabs turning as the bumpers and arrows do", () => {
    const host = document.createElement('div')
    document.body.append(host)
    const actionTab = vi.fn()
    const ov = new Overlays(host, {
      send: () => {}, gamedata: () => null, watching: () => false, onClientOverlayChange: () => {}, onSystemAction: () => {},
      settingsPanel: () => ({ el: document.createElement('div'), rows: [] }), actionTab,
    })
    ov.showActionTabs('abilities', null)
    const frame = host.querySelector('.action-tabs')!
    expect(ov.openMenu).toBe('battle')
    expect(frame.querySelector('.pack-tabs .current')?.textContent).toBe('Abilities')
    // the line comes into the same frame: a turn never closes it or opens it again
    ov.showActionTabs('abilities', "Sorry, you're not good enough to have a special ability.")
    expect(host.querySelector('.action-tabs')).toBe(frame)
    expect(frame.querySelector('.action-empty')?.textContent).toBe("Sorry, you're not good enough to have a special ability.")
    // the pad's buttons stand under the frame as under crawl's menus, not in it; the frame's own line is the keyboard's
    expect(ov.padPrompts).toEqual([])
    expect(frame.querySelector('.more')?.classList.contains('kbd-only')).toBe(true)
    expect(frame.querySelector('svg')).toBeNull()
    ov.clientOverlayInput('bumperNext')
    ov.clientOverlayInput('left')
    ov.clientOverlayInput('select')
    expect(actionTab.mock.calls).toEqual([['evocables'], ['spells']])
    host.querySelectorAll<HTMLButtonElement>('.pack-tabs button')[3].click()
    expect(actionTab).toHaveBeenLastCalledWith('quiver')
    ov.clientOverlayInput('cancel')
    expect(ov.hasClientOverlay).toBe(false)
  })
})
