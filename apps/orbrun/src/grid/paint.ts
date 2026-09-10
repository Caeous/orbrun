import { h } from '../dom'
import type { Row } from './rows'

/**
 * One row of grid text as a line of spans: `fg` and a numeric `bg` are the
 * terminal colour classes (`--color-N`, replaced by the rc's
 * `custom_text_colours`), a css `bg` is painted as given (the noise bar's
 * stylesheet colours), `cls` is a class the official stylesheet names.
 */
export function paintRow(row: Row, cls = 'line'): HTMLElement {
  const line = h('div', { class: cls })
  for (const s of row) {
    const classes = [s.fg !== undefined ? 'fg' + s.fg : '', typeof s.bg === 'number' ? 'bg' + s.bg : '', s.cls || ''].filter(Boolean).join(' ')
    line.append(h('span', { class: classes || undefined, title: s.title, style: typeof s.bg === 'string' ? { background: s.bg } : undefined }, s.text))
  }
  return line
}
