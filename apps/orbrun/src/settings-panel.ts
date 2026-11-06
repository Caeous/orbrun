import { h } from './dom'
import { gamepadHints } from './gamepad-hints'
import { touchHints } from './touch-hints'
import { defaultSettings, getSettings, saveSettings, type Settings } from '@orbrun/client/servers'
import { rowHint, rowOff, settingGroups, settingValue, SETTING_ROWS, type SettingGroup, type SettingRow } from '@orbrun/client/settings-rows'

/**
 * Orbrun's settings, one panel for the front end and the game: drawn as
 * the game draws a menu (a title line, a letter per item, the value on the
 * right between the arrows that turn it, the hovered line lit). Left and
 * right, A, Enter or the letter change a value.
 *
 * One group to a panel (settings-rows.ts `SETTING_GROUPS`): the settings
 * screen lists the groups as rows, each opening its own page under a Back,
 * so every page of the settings is reached and left the same way. The
 * Controls page also carries the Gamepad controls sheet, a page to read
 * rather than a group of settings, which is why it is not a group itself. The pause menu opens the same
 * pages over the game (overlays.ts), the front end on its settings screen
 * (menu.ts), and both read `settings-rows.ts`, so the two never disagree.
 *
 * Every row is drawn again after any change: one setting can move another
 * (the camera decides what the height row sets and whether the distance
 * row does anything), and a row that is off is dark grey, as the game's
 * menus draw an item that cannot be taken, and left and right leave it.
 */
export function settingsPanel(group: SettingGroup, opts: { onchange?: () => void; back?: () => void; controls?: () => void } = {}): { el: HTMLElement; rows: HTMLElement[] } {
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
  // the tips are the pad's and the finger's, so they are a row of the page the Hints setting is on
  if (group === 'Controls') {
    const k = hotkey()
    const replay = h('li', { class: 'row level2 selectable fg7 action', dataset: { hotkey: k, focus: 'replay-gamepad-tips', hint: 'Forget which gamepad and touch controls you have used and teach them again: switches Hints to Adaptive.' } },
      h('span', { class: 'hotkey' }, k), h('span', { class: 'dash' }, '-'), h('span', { class: 'label' }, 'Replay tips'))
    replay.addEventListener('click', () => {
      gamepadHints().reset()
      touchHints().reset()
      saveSettings({ ...getSettings(), hints: 'adaptive' })
      opts.onchange?.()
      redraw()
      replay.querySelector('.label')!.textContent = 'Tips reset'
    })
    rows.push(replay)
    ol.append(replay)
    if (opts.controls) {
      const k = hotkey()
      const sheet = h('li', { class: 'row level2 selectable fg7 action', dataset: { hotkey: k, focus: 'gamepad-controls', hint: 'What every button on the pad does, on each layer.' } },
        h('span', { class: 'hotkey' }, k), h('span', { class: 'dash' }, '-'), h('span', { class: 'label' }, 'Gamepad controls'))
      sheet.addEventListener('click', () => opts.controls!())
      rows.push(sheet)
      ol.append(sheet)
    }
  }
  // the page's own settings back as they came; dark while there is nothing to put back
  {
    const k = hotkey()
    const reset = h('li', { class: 'row level2 selectable fg7 action', dataset: { hotkey: k, focus: 'settings-reset', hint: `Put every ${group.toLowerCase()} setting back to its default.` } },
      h('span', { class: 'hotkey' }, k), h('span', { class: 'dash' }, '-'), h('span', { class: 'label' }, 'Reset to defaults'))
    draw.push(() => reset.classList.toggle('off', groupAtDefaults(group)))
    reset.addEventListener('click', () => {
      if (groupAtDefaults(group)) return
      resetGroup(group, opts.onchange)
      redraw()
    })
    rows.push(reset)
    ol.append(reset)
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
  panel.append(h('div', { class: 'more' }, '[<] [>] change a setting  [Esc] back'))
  return { el: panel, rows }
}

// ------------------------------------------------- changing a setting

/**
 * Move `r` on by `d` steps (right is next, left is previous, wrapping),
 * save, and apply what applies at once (the UI scale). Returns how the new
 * value reads; a running game applies the rest through `onchange`. A row
 * that is off under the current settings (`rowOff`) is left as it is. A
 * value that is not one of the stops (a default between two, an old saved
 * value) steps to the next stop in that direction (`offStop`).
 */
export function adjustSetting(r: SettingRow, d: number, onchange?: () => void): string {
  const s = getSettings()
  if (rowOff(r, s)) return settingValue(r, s)
  const key = r.key
  const values = r.values as readonly unknown[]
  const cur = s[key]
  const i = values.indexOf(cur)
  const n = i >= 0 || typeof cur !== 'number' ? values[((((i < 0 ? 0 : i) + d) % values.length) + values.length) % values.length] : offStop(values as readonly number[], cur, d)
  ;(s as unknown as Record<string, unknown>)[key] = n
  saveSettings(s)
  document.documentElement.style.setProperty('--ui-scale', String(s.uiScale))
  onchange?.()
  return settingValue(r, s)
}

/** Whether every row `group` offers is at its default. */
export function groupAtDefaults(group: SettingGroup, s: Settings = getSettings()): boolean {
  return SETTING_ROWS.every((r) => r.group !== group || s[r.key] === defaultSettings[r.key])
}

/**
 * Put every row `group` offers back to its default, save, and apply what
 * applies at once (the UI scale), as `adjustSetting` does. A row the build
 * does not offer (`VIEW_OPTIONS`) keeps what it was.
 */
export function resetGroup(group: SettingGroup, onchange?: () => void) {
  const s = getSettings()
  for (const r of SETTING_ROWS) if (r.group === group) (s as unknown as Record<string, unknown>)[r.key] = defaultSettings[r.key]
  saveSettings(s)
  document.documentElement.style.setProperty('--ui-scale', String(s.uiScale))
  onchange?.()
}

/**
 * The stop `d` steps from `cur`, which is not itself a stop. On an ascending
 * scale (the camera heights) one step right is the first stop above and one
 * step left the first stop below, so 0.62 goes to 0.65 or 0.6 and no stop is
 * skipped; on any other scale it is the nearest stop, then the step.
 */
function offStop(values: readonly number[], cur: number, d: number): number {
  const ascending = values.every((v, k) => k === 0 || v > values[k - 1])
  if (ascending) {
    const above = values.findIndex((v) => v > cur)
    const i = d > 0 ? (above < 0 ? values.length : above) + d - 1 : (above < 0 ? values.length : above) + d
    return values[Math.max(0, Math.min(values.length - 1, i))]
  }
  let i = 0
  for (let k = 1; k < values.length; k++) if (Math.abs(values[k] - cur) < Math.abs(values[i] - cur)) i = k
  return values[((((i + d) % values.length) + values.length) % values.length)]
}
