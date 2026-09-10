import { h } from './dom'
import { gamepadHints } from './gamepad-hints'
import { getSettings, saveSettings } from './servers'
import { adjustSetting, rowHint, rowOff, settingGroups, settingValue } from './settings-rows'

/**
 * Orbrun's settings, one panel for the front end and the game: drawn as
 * the game draws a menu (a title line, a letter per item, the value on the
 * right between the arrows that turn it, the hovered line lit), in groups.
 * Left and right, A, Enter or the letter change a value; the pause menu
 * opens it over the game (overlays.ts), the front end on its settings
 * screen (menu.ts), and both read `settings-rows.ts`, so the two never
 * disagree.
 *
 * Every row is drawn again after any change: one setting can move another
 * (the camera decides what the height row sets and whether the distance
 * row does anything), and a row that is off is dark grey, as the game's
 * menus draw an item that cannot be taken, and left and right leave it.
 */
export function settingsPanel(opts: { onchange?: () => void; close?: boolean } = {}): { el: HTMLElement; rows: HTMLElement[] } {
  const panel = h('div', { class: 'settings menu game' })
  panel.append(h('div', { class: 'title' }, 'Orbrun settings'))
  const ol = h('ol')
  const body = h('div', { class: 'body' }, ol)
  const rows: HTMLElement[] = []
  const hotkey = () => String.fromCharCode(97 + rows.length)
  const draw: (() => void)[] = []
  const redraw = () => draw.forEach((f) => f())
  for (const g of settingGroups()) {
    ol.append(h('li', { class: 'group' }, g.group))
    for (const sr of g.rows) {
      const val = h('span', { class: 'val' }, settingValue(sr))
      const k = hotkey()
      const adjust = (d: number) => {
        adjustSetting(sr, d, opts.onchange)
        redraw()
      }
      // the angle brackets are what left and right do, under the mouse: each turns the value its own way, so a click
      // can walk a long scale back as well as on. Each stops its click before the row takes it as a turn forward
      const arrow = (d: number, ch: string) =>
        h('span', {
          class: 'arrow',
          role: 'button',
          'aria-label': `${sr.label} ${d < 0 ? 'previous' : 'next'}`,
          onclick: (ev: Event) => {
            ev.stopPropagation()
            adjust(d)
          },
        }, ch)
      const r = h(
        'li',
        { class: 'row level2 selectable fg7', dataset: { hotkey: k, focus: 'setting:' + sr.label, hint: rowHint(sr) } },
        h('span', { class: 'hotkey' }, k),
        h('span', { class: 'dash' }, '-'),
        h('span', { class: 'label' }, sr.label),
        h('span', { class: 'value' }, arrow(-1, '<'), val, arrow(1, '>')),
      )
      draw.push(() => {
        val.textContent = settingValue(sr)
        r.dataset.hint = rowHint(sr)
        r.classList.toggle('off', rowOff(sr))
      })
      r.addEventListener('click', () => adjust(1))
      r.addEventListener('adjust', (ev) => adjust((ev as CustomEvent<number>).detail))
      rows.push(r)
      ol.append(r)
    }
    if (g.group === 'Controls') {
      const replay = h('li', { class: 'row level2 selectable fg7 action', dataset: { hotkey: hotkey(), focus: 'replay-gamepad-tips', hint: 'Forget which gamepad controls you have used and teach them again: switches Hints to Adaptive.' } },
        h('span', { class: 'hotkey' }, hotkey()), h('span', { class: 'dash' }, '-'), h('span', { class: 'label' }, 'Replay gamepad tips'))
      replay.addEventListener('click', () => {
        gamepadHints().reset()
        saveSettings({ ...getSettings(), hints: 'adaptive' })
        opts.onchange?.()
        redraw()
        replay.querySelector('.label')!.textContent = 'Gamepad tips reset'
      })
      rows.push(replay)
      ol.append(replay)
    }
  }
  redraw()
  if (opts.close !== false) {
    const k = hotkey()
    const close = h('li', { class: 'row level2 selectable fg7 action', dataset: { hotkey: k } }, h('span', { class: 'hotkey' }, k), h('span', { class: 'dash' }, '-'), h('span', { class: 'label' }, 'Close'))
    rows.push(close)
    ol.append(close)
  }
  panel.append(body)
  panel.append(h('div', { class: 'more' }, '[<] [>] or a letter change a setting  [Esc] close'))
  return { el: panel, rows }
}
