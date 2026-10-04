/**
 * The input rules, checked on every surface from the same starting screen:
 * a replay of the scenario's recording per input (client.ts `startReplay`),
 * so each input is tried on a fresh client that stands exactly where the
 * live one did.
 *
 *  1. A and Enter send the same thing: one confirm, whatever the device.
 *  2. B and Escape send the same thing: one way back.
 *  3. Each d-pad direction does what its arrow key does.
 *  4. What is lit is live: a click on the lit thing sends what A sends.
 *  5. The bar tells the truth: a button it labels does something.
 *  6. The touch bar keeps its anchors: one button a cell (TOUCH_CELLS), Esc
 *     and the arrows in theirs on every screen, and every one it shows but
 *     the arrows does something and has a picture over its word, Esc by
 *     that name.
 *
 * What a press "did" is what it sent crawl plus what changed on the client's
 * own screen (the cursor moved, an overlay of Orbrun's opened), since a
 * cursor step sends nothing on a popup and is still an answer to the key.
 */
import type { ClientMessage } from '@orbrun/webtiles'
import { startReplay, type E2e, type Input, type Recording } from './client'
import { screen, type Screen } from './screen'
import { isTouchCell } from '../../src/bindings'

type Probe = { id: string; inputs: Input[] }

const pad = (button: string): Probe => ({ id: button, inputs: [{ kind: 'padDown', button: button as never }, { kind: 'padUp', button: button as never, heldMs: 50 }] })
const dpad = (dir: 0 | 2 | 4 | 6, id: string): Probe => ({ id, inputs: [{ kind: 'dir', dir }, { kind: 'dir', dir: null }] })
const key = (k: string): Probe => ({ id: k === ' ' ? 'Space' : k, inputs: [{ kind: 'key', key: k }] })

/** the buttons whose touch cell is the same on every screen (bindings.ts TOUCH_ANCHORS) */
const TOUCH_ANCHOR_OF: Record<string, string> = { B: 'esc', DU: 'up', DL: 'left', DD: 'down', DR: 'right' }

const PAD_BUTTONS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'L3', 'R3', 'SELECT', 'START']
const PROBES: Probe[] = [
  ...PAD_BUTTONS.map(pad),
  dpad(0, 'DU'),
  dpad(2, 'DR'),
  dpad(4, 'DD'),
  dpad(6, 'DL'),
  ...['Enter', 'Escape', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', 'Tab'].map(key),
]

/** What the client looks like, for "did the press change anything": the screen, the cursor, Orbrun's own overlays. */
function appearance(g: E2e): string {
  const s = screen(g)
  const st = g.state()
  return JSON.stringify({
    surface: s.surface,
    lit: s.lit,
    focus: g.ctx().focus?.index,
    hover: st.menus.at(-1)?.last_hovered,
    clientOverlays: g.root.querySelectorAll('.overlay-stack > [data-client]').length,
    osk: !!g.root.querySelector('.osk:not(.hidden)'),
  })
}

/** The element the top overlay lights: the focus layer's `.focused`, a menu's hovered row or more-line switch. */
function litElement(g: E2e): HTMLElement | null {
  const stack = g.root.querySelector('.overlay-stack')
  if (!stack) return null
  // the prompt card is over everything else while it is up: only what it lights counts
  const card = stack.querySelector('.prompt-card')
  if (card) return card.querySelector('.focused') as HTMLElement | null
  const tops = Array.from(stack.children).filter((c) => !c.classList.contains('hidden')) as HTMLElement[]
  for (let i = tops.length - 1; i >= 0; i--) {
    const lit = tops[i].querySelector('.focused, li.hovered, .more-hot.hovered') as HTMLElement | null
    if (lit) return lit
  }
  return null
}

export interface Outcome {
  probe: string
  sent: ClientMessage[]
  /** the client's screen changed (cursor, overlay), whether or not anything was sent */
  changed: boolean
  after: string
}

export interface Violation {
  scenario: string
  rule: string
  detail: string
}

/** Try every probe on the recorded screen: one fresh replay each. */
export async function tryAll(rec: Recording): Promise<{ before: ReturnType<typeof screen>; outcomes: Map<string, Outcome>; click: Outcome | null }> {
  const outcomes = new Map<string, Outcome>()
  let before: ReturnType<typeof screen> | null = null
  for (const p of PROBES) {
    const g = await startReplay(rec)
    try {
      before ??= screen(g)
      const a0 = appearance(g)
      for (const i of p.inputs) await g.apply(i)
      const a1 = appearance(g)
      outcomes.set(p.id, { probe: p.id, sent: g.sent.slice(), changed: a0 !== a1, after: a1 })
    } finally {
      g.close()
    }
  }
  // rule 4: a click on the lit thing, on a replay of its own
  let click: Outcome | null = null
  const g = await startReplay(rec)
  try {
    const lit = litElement(g)
    if (lit) {
      const a0 = appearance(g)
      await g.click(lit)
      click = { probe: 'click', sent: g.sent.slice(), changed: a0 !== appearance(g), after: appearance(g) }
    }
  } finally {
    g.close()
  }
  return { before: before!, outcomes, click }
}

/**
 * What crawl receives, as keys: `key 13` and `input "\r"` are one keypress
 * to it (tileweb.cc turns both into the same getch), so they compare equal.
 * Anything that is not a key (a menu hover, a scroll) stays itself.
 */
export function keysOf(sent: ClientMessage[]): string {
  const out: (number | string)[] = []
  for (const m of sent) {
    const r = m as Record<string, unknown>
    if (m.msg === 'key' && typeof r.keycode === 'number') out.push(r.keycode)
    else if (m.msg === 'input' && (typeof r.text === 'string' || Array.isArray(r.data))) {
      if (Array.isArray(r.data)) out.push(...(r.data as number[]))
      if (typeof r.text === 'string') for (const ch of r.text) out.push(ch.charCodeAt(0))
    } else out.push(JSON.stringify(m))
  }
  return JSON.stringify(out)
}

/** What a sequence of messages does on crawl, from the scenario's screen: read off a live run (matrix.test.ts). */
export type Judge = (sent: ClientMessage[]) => Promise<string>

const show = (o: Outcome | undefined) => (o ? `${keysOf(o.sent)}${o.changed && !o.sent.length ? ' (screen only)' : ''}` : 'nothing')

/**
 * Two presses are the same answer when they send crawl the same keys and
 * leave the client's screen the same; when the keys differ, crawl decides:
 * each is sent on a live run from the same screen, and what the screen
 * became is compared.
 */
async function equivalent(a: Outcome | undefined, b: Outcome | undefined, judge: Judge): Promise<boolean> {
  if (!a || !b) return a === b
  if (keysOf(a.sent) === keysOf(b.sent)) return a.after === b.after || !!a.sent.length
  // one moved Orbrun's own cursor and the other did not: no key sent to crawl can make up for that
  if ((!a.sent.length && a.changed) || (!b.sent.length && b.changed)) return false
  // otherwise crawl says: a key it ignores does what sending nothing does
  return (await judge(a.sent)) === (await judge(b.sent))
}

/**
 * Which key each button is, screen by screen (bindings.ts `screenKey`, and
 * the decisions behind it): by default Enter is A, Escape B, the arrows the
 * d-pad. A menu where rows are marked takes what is marked on Enter, as
 * crawl's does, so there Enter is Start and Space is A. A yes/no's Enter is
 * crawl's default answer, so only Escape pairs (with B, No). A line of text
 * types: Enter submits as Start does.
 */
function pairsFor(s: Screen): [string, string][] {
  const dirs: [string, string][] = [['DU', 'ArrowUp'], ['DD', 'ArrowDown'], ['DL', 'ArrowLeft'], ['DR', 'ArrowRight']]
  if (s.mode === 'text') return [['START', 'Enter'], ['B', 'Escape']]
  if (s.mode === 'yesno') return [['B', 'Escape'], ...dirs]
  if (s.multiselect) return [['A', ' '], ['START', 'Enter'], ['B', 'Escape'], ...dirs]
  return [['A', 'Enter'], ['B', 'Escape'], ...dirs]
}

export async function check(scenario: string, r: Awaited<ReturnType<typeof tryAll>>, judge: Judge, idle: Record<string, string> = {}): Promise<Violation[]> {
  const v: Violation[] = []
  const o = r.outcomes
  const add = (rule: string, detail: string) => v.push({ scenario, rule, detail })
  for (const [pad, key] of pairsFor(r.before)) {
    const kid = key === ' ' ? 'Space' : key
    if (!(await equivalent(o.get(pad), o.get(kid), judge))) add(`${pad} = ${kid}`, `${pad} sends ${show(o.get(pad))}, ${kid} sends ${show(o.get(kid))}`)
  }
  // a yes/no answers Yes on A, whatever crawl's default, with the key crawl takes whatever the rc says (Y)
  if (r.before.mode === 'yesno' && !/^\[89\]$|^\[121\]$/.test(keysOf(o.get('A')?.sent ?? []))) add('A = Yes', `A sends ${show(o.get('A'))}`)
  if (r.click && !(await equivalent(r.click, o.get('A'), judge))) add('lit is live', `the lit ${JSON.stringify(r.before.lit)} clicked sends ${show(r.click)}, A sends ${show(o.get('A'))}`)
  if (!r.click && r.before.lit) add('lit is live', `the bar names ${JSON.stringify(r.before.lit)} as lit but nothing on screen is lit`)
  // a button the bar labels does something: moves Orbrun's cursor, or sends crawl something it acts on.
  // The bumpers go as a pair: at the top of a list its page up has nowhere to go, and that is fine
  // while its page down does
  const nothing = await judge([])
  const does = async (b: string) => {
    const out = o.get(b)
    return !out || out.changed || (!!out.sent.length && (await judge(out.sent)) !== nothing)
  }
  const pair: Record<string, string> = { LB: 'RB', RB: 'LB' }
  for (const [button, label] of Object.entries(r.before.bar)) {
    if (idle[button] || (await does(button))) continue
    if (pair[button] && r.before.bar[pair[button]] && (await does(pair[button]))) continue
    add('bar tells the truth', `${button} is labelled ${JSON.stringify(label)} and does nothing`)
  }
  // rule 6: one button a cell, and Esc and the arrows where the finger knows them, on every screen. The arrows are
  // the d-pad wherever it is live, as the pad's is, whether or not this list has anywhere to go (a one-row menu, a
  // describe with nothing to walk): only their cells count
  const cells = new Set<string>()
  const shown = new Set(r.before.touch.map((t) => t.button))
  for (const t of r.before.touch) {
    const anchor = TOUCH_ANCHOR_OF[t.button]
    if (!isTouchCell(t.cell) || (anchor && t.cell !== anchor)) add('touch keeps its anchors', `${t.button} (${JSON.stringify(t.label)}) stands in ${t.cell}`)
    if (cells.has(t.cell)) add('touch keeps its anchors', `two buttons in ${t.cell}`)
    cells.add(t.cell)
    if (!t.button.startsWith('D') && !t.picture) add('touch has pictures', `${t.button} (${JSON.stringify(t.label)}) has none`)
    if (t.button === 'B' && t.label !== 'Esc') add('touch has pictures', `B is ${JSON.stringify(t.label)}, not Esc`)
    if (t.button.startsWith('D') || idle[t.button] || (await does(t.button))) continue
    if (pair[t.button] && shown.has(pair[t.button]) && (await does(pair[t.button]))) continue
    add('touch tells the truth', `${t.button} (${JSON.stringify(t.label)}) does nothing`)
  }
  return v
}
