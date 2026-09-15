import { controlSheet } from './bindings'
import { getSettings, leftRightTurns } from './servers'
import { h } from './dom'
import type { PadKind } from './gamepad'
import { glyph, glyphName } from './glyphs'

/** The gamepad reference: one table of what every button does, in the front end and the in-game menu. */
export function controlsSheet(padKind: PadKind = 'generic'): HTMLElement {
  const table = h('table', null, h('tr', null, h('th', null, 'Input'), h('th', null, 'Action')))
  // what left and right do is the player's, one answer per stick (settings-rows.ts)
  const s = getSettings()
  const lr = (source: 'dpad' | 'lstick') => (leftRightTurns(source, s) ? 'Move one step; left / right turn' : 'Move one step; left / right strafe')
  for (const [g, name, action] of [
    ['LSTICK', 'Left stick', lr('lstick')],
    ['DPAD', 'D-pad', lr('dpad')],
    ['RSTICK', 'Right stick', 'Turn and glance'],
  ] as const) {
    table.append(h('tr', null, h('td', { class: 'key', title: name }, glyph(g, padKind)), h('td', null, action)))
  }
  for (const { button, action } of controlSheet()) {
    table.append(h('tr', null,
      h('td', { class: 'key', title: glyphName(button, padKind) }, glyph(button, padKind)),
      h('td', null, h('span', { class: 'tap' }, action.tap), action.hold ? h('span', { class: 'hold' }, glyph('HOLD', padKind), action.hold) : null)))
  }
  return h('div', { class: 'body' }, table,
    h('p', { class: 'hint' }, 'RB opens actions (potions, scrolls, spells, abilities); Select opens Travel, Equipment and Character tabs; Start opens the Orbrun menu with the game options. LB / RB or left / right switches Select tabs. Commands already on gamepad buttons are omitted. Up / down chooses a command; Page Up / Down pages. A / Start selects, B backs out, Select closes the menu outright. Browsing sends no game commands.'))
}
