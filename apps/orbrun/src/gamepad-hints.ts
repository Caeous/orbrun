import { barLabels, bindingTable, promptLabels, type Action, type BindingLabel } from './bindings'
import type { Context } from './context'

/**
 * The Hints setting, for the pad: `adaptive` shows contextual prompts and
 * teaches pad controls until each is used, nothing standing. `contextual`
 * skips the teaching; `off` hides gameplay prompts (menu and targeting
 * controls remain). The keyboard gets no prompts.
 */
export type HintMode = 'adaptive' | 'contextual' | 'off'
const STORAGE_KEY = 'orbrun.gamepad-learning.v1'
const LESSONS = ['move', 'look', 'commands', 'inventory', 'explore', 'examine', 'travel', 'wait', 'rest', 'navigate', 'target-cursor', 'map-cursor'] as const
export type PadLesson = (typeof LESSONS)[number]
const STEPS_TO_LEARN = 3
const LOOK_TO_LEARN = 0.3 // radians of actual camera movement, not stick polling ticks
const RESPONSE_WINDOW = 1500
const KEY_LESSONS: Readonly<Record<string, PadLesson>> = { i: 'inventory', o: 'explore', '.': 'wait', '5': 'rest' }

/** Only observable outcomes count; sending a key is not proof that it worked. */
export interface PadHintEvidence {
  mode: Context['mode']
  turn: number
  x: number
  y: number
  cursor: string
  focus: number
  clientOverlay: boolean
}

/** Stable action identities, deliberately independent of button, direction and controller family. */
export function padLesson(a: Action, ctx: Context): PadLesson | null {
  if (ctx.mode === 'command') {
    if (a.kind === 'ui' && (a.op === 'commands' || a.op === 'travel')) return a.op
    if (a.kind === 'examine') return 'examine'
    if (a.kind === 'keys' && a.seq.length === 1 && 'text' in a.seq[0]) {
      return KEY_LESSONS[a.seq[0].text] ?? null
    }
  }
  if ((a.kind === 'menu' || a.kind === 'focus') && ['next', 'prev', 'left', 'right'].includes(a.op)) return 'navigate'
  if (a.kind === 'cursor') return ctx.mode === 'targeting' ? 'target-cursor' : ctx.mode === 'levelmap' ? 'map-cursor' : null
  return null
}

/** Device-wide learning, never attached to a character, server or run. */
export class GamepadHints {
  private learned = new Set<PadLesson>()
  private steps = 0
  private looked = 0
  private pending: { lesson: PadLesson; before: PadHintEvidence; at: number } | null = null

  constructor() {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
      if (Array.isArray(saved)) for (const id of LESSONS) if (saved.includes(id)) this.learned.add(id)
    } catch { /* unavailable or old/corrupt storage: teach normally */ }
  }

  knows(id: PadLesson): boolean { return this.learned.has(id) }

  private learn(id: PadLesson) {
    if (this.learned.has(id)) return
    this.learned.add(id)
    this.save()
  }

  private save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.learned])) } catch { /* session-only learning still works */ }
  }

  reset() {
    this.learned.clear()
    this.steps = this.looked = 0
    this.cancel()
    this.save()
  }

  cancel() { this.pending = null }

  /** Called only for server-confirmed, player-directed pad steps, never bumps or autoexplore. */
  moved(steps = 1) {
    this.steps += steps
    if (this.steps >= STEPS_TO_LEARN) this.learn('move')
  }

  /** Called while the right stick actually steers the game camera. */
  lookedBy(radians: number) {
    this.looked += Math.abs(radians)
    if (this.looked >= LOOK_TO_LEARN) this.learn('look')
  }

  attempt(a: Action, ctx: Context, before: PadHintEvidence, now: number) {
    const lesson = padLesson(a, ctx)
    if (!lesson || this.knows(lesson)) { this.cancel(); return }
    // A held navigation direction must not replace its baseline before the reply arrives.
    if (this.pending?.lesson === lesson && now - this.pending.at < RESPONSE_WINDOW) return
    this.pending = { lesson, before, at: now }
  }

  observe(after: PadHintEvidence, now: number) {
    const p = this.pending
    if (!p) return
    if (now - p.at > RESPONSE_WINDOW) { this.cancel(); return }
    const b = p.before
    let worked = false
    switch (p.lesson) {
      case 'commands': case 'travel': worked = !b.clientOverlay && after.clientOverlay; break
      case 'inventory': worked = after.mode === 'menu' && b.mode !== 'menu'; break
      case 'examine': worked = after.mode === 'targeting' && b.mode !== 'targeting'; break
      case 'explore': worked = after.x !== b.x || after.y !== b.y; break
      case 'wait': case 'rest': worked = after.turn > b.turn; break
      case 'navigate': worked = after.mode === b.mode && after.focus !== b.focus; break
      case 'target-cursor': case 'map-cursor': worked = after.mode === b.mode && after.cursor !== b.cursor; break
    }
    if (worked) { this.learn(p.lesson); this.cancel() }
  }

  /** Context first, then the lessons: at most two basic ones, then one discovery. Nothing stands once learned. */
  prompts(ctx: Context, mode: HintMode): BindingLabel[] {
    if (['spectating', 'lobby', 'ended', 'macro', 'text'].includes(ctx.mode)) return []
    const all = barLabels(ctx)
    // Confirm/back are navigation, not tutorial reminders. Keep them even with gameplay hints off.
    const navigation = ['menu', 'targeting', 'levelmap', 'popup', 'newgame', 'crt', 'dialog'].includes(ctx.mode)
      ? all.filter((l) => l.button === 'A' || l.button === 'B' || (ctx.mode === 'menu' && l.button === 'START')) : []
    const decision = ['more', 'prompt', 'yesno'].includes(ctx.mode)
    const contextual = mode === 'off' && !decision ? [...navigation] : [...promptLabels(ctx)]
    for (const l of navigation) if (!contextual.some((p) => p.button === l.button)) contextual.push(l)
    if (mode !== 'adaptive') return contextual

    const tip = (button: BindingLabel['button'], label: string, action: Action): BindingLabel => ({ button, label, action, contextual: false, teaching: true })
    let teaching: BindingLabel[] = []
    if (ctx.mode === 'command' && ctx.hostilesInView === 0) {
      if (!this.knows('move')) teaching.push(tip('LSTICK', 'Move', { kind: 'step', dir: 0 }))
      if (!this.knows('look')) teaching.push(tip('RSTICK', 'Look around', { kind: 'look', dx: 0, dy: 0 }))
      if (!teaching.length) {
        const table = bindingTable(ctx)
        for (const button of ['LB', 'SELECT', 'B'] as const) {
          const a = table[button]
          if (!a) continue
          if (a.kind === 'hold') {
            if (this.knows('wait') && (this.knows('rest') || !ctx.injured)) continue
          } else {
            const id = padLesson(a, ctx)
            if (!id || this.knows(id)) continue
          }
          const l = all.find((l) => l.button === button)
          if (l) teaching.push({ ...l, teaching: true })
          break
        }
      }
    } else if ((ctx.mode === 'menu' || ctx.focus?.count) && !this.knows('navigate')) {
      teaching.push(tip('DPAD', 'Navigate', { kind: 'focus', op: 'next' }))
    } else if (ctx.mode === 'targeting' && !this.knows('target-cursor')) {
      teaching.push(tip('LSTICK', 'Move cursor', { kind: 'cursor', dir: 0 }))
    } else if (ctx.mode === 'levelmap' && !this.knows('map-cursor')) {
      teaching.push(tip('LSTICK', 'Move cursor', { kind: 'cursor', dir: 0 }))
    }
    teaching = teaching.filter((l) => !contextual.some((p) => p.button === l.button))
    // Contextual interactions keep the anchor at the corner's foot; lessons stack above them.
    return [...contextual, ...teaching]
  }
}

let shared: GamepadHints | undefined
export function gamepadHints(): GamepadHints { return shared ??= new GamepadHints() }
