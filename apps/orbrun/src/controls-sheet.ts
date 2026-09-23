import { controlSheet, type SheetCell } from './bindings'
import { getSettings, leftRightTurns } from './servers'
import { h } from './dom'
import type { PadKind } from './gamepad'
import { glyph, glyphName, type GlyphName } from './glyphs'

/**
 * The gamepad reference: what every button does, in the front end and the
 * in-game menu, as two tables side by side, one per half of the pad, each
 * read from the top of the controller down (they stack on a narrow screen).
 */
export function controlsSheet(padKind: PadKind = 'generic'): HTMLElement {
  // what left and right do is the player's, one answer for the whole pad (settings-rows.ts)
  const lr = leftRightTurns('dpad', getSettings()) ? 'Move one step; left / right turn' : 'Move one step; left / right strafe'
  const sticks: Partial<Record<GlyphName, [string, string]>> = { LSTICK: ['Left stick', lr], DPAD: ['D-pad', lr], RSTICK: ['Right stick', 'Turn and glance'] }
  const buttons = new Map<GlyphName, SheetCell>(controlSheet().map((r) => [r.button, r.action]))
  const side = (order: readonly GlyphName[]) => {
    const table = h('table')
    for (const g of order) {
      const stick = sticks[g]
      const action = buttons.get(g)
      if (stick) table.append(h('tr', null, h('td', { class: 'key', title: stick[0] }, glyph(g, padKind)), h('td', null, stick[1])))
      else if (action)
        table.append(h('tr', null,
          h('td', { class: 'key', title: glyphName(g, padKind) }, glyph(g, padKind)),
          h('td', null, h('span', { class: 'tap' }, action.tap), action.hold ? h('span', { class: 'hold' }, glyph('HOLD', padKind), action.hold) : null)))
    }
    return table
  }
  const sides = h('div', { class: 'sides' },
    side(['LT', 'LB', 'LSTICK', 'L3', 'DPAD', 'SELECT']),
    side(['RT', 'RB', 'RSTICK', 'R3', 'A', 'B', 'X', 'Y', 'START']))
  return h('div', { class: 'body' }, sides,
    h('p', { class: 'hint' }, 'LB opens actions (potions, scrolls, spells, abilities); Select opens travel; Y opens the gear, the pack first. Start opens the Orbrun menu, with your character on one tab and the game options on the other; LB / RB or left / right switches its tabs. Commands already on gamepad buttons are omitted. Up / down chooses a command; Page Up / Down pages. A / Start selects, B backs out, Select closes the menu outright. Browsing sends no game commands.'))
}
