/**
 * What is on the screen, in the terms the rules speak: which of crawl's
 * surfaces is up, what the cursor lights, and what the bar says each button
 * does. Read off the client exactly as the player sees it.
 */
import { formattedStringToText } from '@orbrun/webtiles'
import { barLabels } from '../../src/bindings'
import type { E2e } from './client'

export interface Screen {
  mode: string
  /** the surface: `menu:inventory`, `popup:describe-item`, `prompt`, `text:travel_depth`, `crt`, `more`, `command`, ... */
  surface: string
  title: string
  /** the lit thing's label, as the bar names it; null when nothing is lit */
  lit: string | null
  /** what the bar says each button does */
  bar: Record<string, string>
  /** the last lines of the message log, plain text */
  log: string[]
  /** a server menu where rows are marked, not taken (drop, pickup, the shop) */
  multiselect: boolean
}

export function screen(g: E2e): Screen {
  const st = g.state()
  const ctx = g.ctx()
  const menu = st.menus.at(-1)
  const popup = st.ui.at(-1)
  let surface: string = ctx.mode
  let title = ''
  if (ctx.mode === 'menu' && menu) {
    surface = `menu:${menu.tag || '(untagged)'}`
    title = formattedStringToText(menu.title?.text ?? '')
  } else if ((ctx.mode === 'popup' || ctx.mode === 'newgame') && popup) {
    surface = `popup:${popup.type}`
    const d = popup.data as Record<string, unknown>
    title = formattedStringToText(String(d.title ?? d.prompt ?? d.name ?? ''))
  } else if (ctx.mode === 'text') {
    surface = `text:${st.textInput?.tag ?? ''}`
    title = formattedStringToText(st.textInput?.prompt ?? '')
  } else if (ctx.mode === 'yesno' || ctx.mode === 'prompt') title = ctx.prompt?.text ?? ''
  const menuLit = ctx.mode === 'menu' && menu && menu.last_hovered >= 0 ? formattedStringToText(menu.items[menu.last_hovered]?.text ?? '').trim() : null
  const bar: Record<string, string> = {}
  // an overlay of Orbrun's own (an empty tab of X's actions) puts the bar away: its footer says what the buttons do
  const ours = !!g.root.querySelector('.overlay-stack > [data-client]')
  if (!ours) for (const l of barLabels(ctx)) bar[l.button] = formattedStringToText(l.label)
  return {
    mode: ctx.mode,
    surface,
    title: title.trim(),
    lit: ctx.focus?.label ?? menuLit,
    bar,
    log: st.messages.lines.slice(-4).map((l) => formattedStringToText(l.text).trim()),
    multiselect: ctx.mode === 'menu' && !!ctx.menu?.multiselect,
  }
}
