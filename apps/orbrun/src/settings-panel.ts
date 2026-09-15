import { h } from './dom'
import { gamepadHints } from './gamepad-hints'
import { getSettings, saveSettings } from './servers'
import { adjustSetting, rowHint, rowOff, settingGroups, settingValue, type SettingGroup } from './settings-rows'

/**
 * Orbrun's settings, one panel for the front end and the game: drawn as
 * the game draws a menu (a title line, a letter per item, the value on the
 * right between the arrows that turn it, the hovered line lit). Left and
 * right, A, Enter or the letter change a value.
 *
 * One group to a panel (settings-rows.ts `SETTING_GROUPS`): the settings
 * screen lists the groups as rows, each opening its own page under a Back,
 * the way the Gamepad sheet has always opened from it, so every page of the
 * settings is reached and left the same way. The pause menu opens the same
 * pages over the game (overlays.ts), the front end on its settings screen
 * (menu.ts), and both read `settings-rows.ts`, so the two never disagree.
 *
 * Every row is drawn again after any change: one setting can move another
 * (the camera decides what the height row sets and whether the distance
 * row does anything), and a row that is off is dark grey, as the game's
 * menus draw an item that cannot be taken, and left and right leave it.
 */
export function settingsPanel(group: SettingGroup, opts: { onchange?: () => void; back?: () => void } = {}): { el: HTMLElement; rows: HTMLElement[] } {
  const panel = h('div', { class: 'settings menu game' })
  panel.append(h('div', { class: 'title' }, group))
  const ol = h('ol')
  const body = h('div', { class: 'body' }, ol)
  const rows: HTMLElement[] = []
  const hotkey = () => String.fromCharCode(97 + rows.length)
  const draw: (() => void)[] = []
  const redraw = () => draw.forEach((f) => f())
  const g = settingGroups().find((x) => x.group === group)
  for (const sr of g?.rows ?? []) {
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
  // the tips are the pad's, so they are a row of the page the pad's settings are on
  if (group === 'Controls') {
    const k = hotkey()
    const replay = h('li', { class: 'row level2 selectable fg7 action', dataset: { hotkey: k, focus: 'replay-gamepad-tips', hint: 'Forget which gamepad controls you have used and teach them again: switches Hints to Adaptive.' } },
      h('span', { class: 'hotkey' }, k), h('span', { class: 'dash' }, '-'), h('span', { class: 'label' }, 'Replay gamepad tips'))
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
  redraw()
  // every page leaves the same way: Back at its foot, where the group's row was taken from
  if (opts.back) {
    const k = hotkey()
    const back = h('li', { class: 'row level2 selectable fg7 action', dataset: { hotkey: k, focus: 'settings-back', hint: 'Back to the settings.' } }, h('span', { class: 'hotkey' }, k), h('span', { class: 'dash' }, '-'), h('span', { class: 'label' }, 'Back'))
    back.addEventListener('click', () => opts.back!())
    rows.push(back)
    ol.append(back)
  }
  panel.append(body)
  panel.append(h('div', { class: 'more' }, '[<] [>] or a letter change a setting  [Esc] back'))
  return { el: panel, rows }
}
