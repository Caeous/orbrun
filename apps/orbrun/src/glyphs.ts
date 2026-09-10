import type { Button, PadKind } from './gamepad'

/**
 * Controller button glyphs as inline SVG, in the style each platform's own
 * games use: Xbox letters in coloured discs, PlayStation shapes, Nintendo's
 * swapped letters, bumpers as wide pills and triggers as tall ones, stick
 * clicks as a stick seen from above. Everything draws in `currentColor` on top
 * of a dark disc so the CSS can dim or highlight a whole prompt at once.
 */

export type GlyphName = Button | 'DPAD' | 'LSTICK' | 'LSTICK_UP' | 'RSTICK' | 'HOLD'

const NS = 'http://www.w3.org/2000/svg'

function svg(w: number, h: number, ...children: (SVGElement | null)[]): SVGSVGElement {
  const el = document.createElementNS(NS, 'svg')
  el.setAttribute('viewBox', `0 0 ${w} ${h}`)
  el.setAttribute('width', String(w))
  el.setAttribute('height', String(h))
  el.setAttribute('aria-hidden', 'true')
  el.style.width = w / 24 + 'em'
  el.style.height = h / 24 + 'em'
  for (const c of children) if (c) el.appendChild(c)
  return el
}

function n(tag: string, attrs: Record<string, string | number>): SVGElement {
  const el = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v))
  return el
}

function text(x: number, y: number, s: string, size = 12, weight = 700): SVGElement {
  // no font of its own: the letter is set in whatever the prompt around it uses (the HUD's mono, a sheet's sans)
  const t = n('text', { x, y, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': size, 'font-weight': weight, fill: 'currentColor' })
  t.textContent = s
  return t
}

/** A face button: dark disc, coloured ring, letter or shape inside. */
function disc(fill: string, inner: SVGElement): SVGSVGElement {
  return svg(24, 24, n('circle', { cx: 12, cy: 12, r: 11, fill: '#15171c' }), n('circle', { cx: 12, cy: 12, r: 10, fill: 'none', stroke: fill, 'stroke-width': 1.8 }), inner)
}

function letter(fill: string, s: string): SVGSVGElement {
  const t = text(12, 12.5, s, 12.5)
  t.setAttribute('fill', fill)
  return disc(fill, t)
}

const PS = {
  cross: '#7b9dff',
  circle: '#ff6b6b',
  square: '#ff8ad8',
  triangle: '#4fe08f',
}

function psShape(kind: keyof typeof PS): SVGSVGElement {
  const c = PS[kind]
  let inner: SVGElement
  switch (kind) {
    case 'cross':
      inner = n('path', { d: 'M8 8 L16 16 M16 8 L8 16', stroke: c, 'stroke-width': 2, 'stroke-linecap': 'round', fill: 'none' })
      break
    case 'circle':
      inner = n('circle', { cx: 12, cy: 12, r: 4.6, stroke: c, 'stroke-width': 2, fill: 'none' })
      break
    case 'square':
      inner = n('rect', { x: 7.6, y: 7.6, width: 8.8, height: 8.8, rx: 1, stroke: c, 'stroke-width': 2, fill: 'none' })
      break
    case 'triangle':
      inner = n('path', { d: 'M12 6.8 L17.2 16 L6.8 16 Z', stroke: c, 'stroke-width': 2, 'stroke-linejoin': 'round', fill: 'none' })
      break
  }
  return disc(c, inner)
}

/** Bumper: a wide pill, its top edge curved like the shoulder it sits on. */
function bumper(label: string): SVGSVGElement {
  return svg(34, 24, n('path', { d: 'M4 19 L4 11 Q4 5 12 5 L30 5 Q32 5 32 7 L32 19 Q32 21 30 21 L6 21 Q4 21 4 19 Z', fill: '#15171c', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-opacity': 0.75 }), text(18, 13.5, label, 10.5))
}

/** Trigger: taller than a bumper, rounded on the far corner, with a second line for the pull. */
function trigger(label: string): SVGSVGElement {
  return svg(30, 24, n('path', { d: 'M5 22 L5 8 Q5 2 11 2 L23 2 Q25 2 25 4 L25 22 Q25 23 24 23 L6 23 Q5 23 5 22 Z', fill: '#15171c', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-opacity': 0.75 }), n('path', { d: 'M9 19 L21 19', stroke: 'currentColor', 'stroke-width': 1.2, 'stroke-opacity': 0.4 }), text(15, 11, label, 10))
}

/** Stick click: the stick head seen from above with a press mark, L or R beside the centre. */
function stickClick(label: string): SVGSVGElement {
  return svg(24, 24, n('circle', { cx: 12, cy: 12, r: 11, fill: '#15171c' }), n('circle', { cx: 12, cy: 12, r: 9.5, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-opacity': 0.75 }), n('circle', { cx: 12, cy: 12, r: 6, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.2, 'stroke-opacity': 0.45 }), n('path', { d: 'M7 3 L9 1 M17 3 L15 1', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linecap': 'round', 'stroke-opacity': 0.75 }), text(12, 12.5, label, 9.5))
}

/** A stick without the press mark, with an arrow ring to say it moves. */
function stick(label: string): SVGSVGElement {
  return svg(24, 24, n('circle', { cx: 12, cy: 12, r: 11, fill: '#15171c' }), n('circle', { cx: 12, cy: 12, r: 6.5, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-opacity': 0.8 }), n('path', { d: 'M12 1.5 L10 3.5 M12 1.5 L14 3.5 M12 22.5 L10 20.5 M12 22.5 L14 20.5 M1.5 12 L3.5 10 M1.5 12 L3.5 14 M22.5 12 L20.5 10 M22.5 12 L20.5 14', stroke: 'currentColor', 'stroke-width': 1.3, 'stroke-linecap': 'round', 'stroke-opacity': 0.55, fill: 'none' }), text(12, 12.5, label, 8.5))
}

/** Left stick pushed forward: one upward arrow, never the stick-click press mark. */
function stickForward(): SVGSVGElement {
  return svg(24, 24,
    n('circle', { cx: 12, cy: 12, r: 11, fill: '#15171c' }),
    n('circle', { cx: 12, cy: 16, r: 6, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-opacity': 0.8 }),
    n('path', { d: 'M12 9 V2 M8.5 5.5 L12 2 L15.5 5.5', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
    text(12, 16.5, 'L', 8.5))
}

/** The d-pad cross; `arm` fills the one that is down (DU, DR, DD, DL) so a chord reads at a glance. */
function dpad(arm?: 'up' | 'right' | 'down' | 'left'): SVGSVGElement {
  const arms = { up: 'M9.5 3.5 h5 v6 h-5 z', right: 'M14.5 9.5 h6 v5 h-6 z', down: 'M9.5 14.5 h5 v6 h-5 z', left: 'M3.5 9.5 h6 v5 h-6 z' }
  return svg(
    24,
    24,
    n('circle', { cx: 12, cy: 12, r: 11, fill: '#15171c' }),
    n('path', { d: 'M9.5 3.5 h5 v6 h6 v5 h-6 v6 h-5 v-6 h-6 v-5 h6 z', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linejoin': 'round', 'stroke-opacity': 0.85 }),
    arm ? n('path', { d: arms[arm], fill: 'currentColor', 'fill-opacity': 0.9 }) : n('circle', { cx: 12, cy: 12, r: 1.3, fill: 'currentColor', 'fill-opacity': 0.6 }),
  )
}

/** Xbox View: two overlapping windows. */
function view(): SVGSVGElement {
  return svg(24, 24, n('circle', { cx: 12, cy: 12, r: 11, fill: '#15171c' }), n('circle', { cx: 12, cy: 12, r: 10, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-opacity': 0.6 }), n('rect', { x: 6.5, y: 8.5, width: 8, height: 7, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4 }), n('path', { d: 'M10 8.5 V6.5 H17.5 V13.5 H14.5', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4 }))
}

/** Menu / Options: three lines. */
function menu(): SVGSVGElement {
  return svg(24, 24, n('circle', { cx: 12, cy: 12, r: 11, fill: '#15171c' }), n('circle', { cx: 12, cy: 12, r: 10, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-opacity': 0.6 }), n('path', { d: 'M7.5 8.5 H16.5 M7.5 12 H16.5 M7.5 15.5 H16.5', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round' }))
}

/** PlayStation Share / Create: an upward arrow out of a tray. */
function share(): SVGSVGElement {
  return svg(24, 24, n('circle', { cx: 12, cy: 12, r: 11, fill: '#15171c' }), n('circle', { cx: 12, cy: 12, r: 10, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-opacity': 0.6 }), n('path', { d: 'M12 15 V6.5 M9 9.5 L12 6.5 L15 9.5 M7.5 13 V17 H16.5 V13', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }))
}

function sign(s: '+' | '−'): SVGSVGElement {
  return svg(24, 24, n('circle', { cx: 12, cy: 12, r: 11, fill: '#15171c' }), n('circle', { cx: 12, cy: 12, r: 10, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-opacity': 0.6 }), n('path', { d: s === '+' ? 'M12 7 V17 M7 12 H17' : 'M7 12 H17', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round' }))
}

/** The hold marker: a ring three quarters full, the way hold prompts read on consoles. */
/** The three-quarter arc has a path length of 1, so a hold in progress can draw part of it by dash offset (styles.css .chip.holding). */
function holdRing(): SVGSVGElement {
  return svg(24, 24, n('circle', { cx: 12, cy: 12, r: 7.5, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-opacity': 0.25 }), n('path', { d: 'M12 4.5 A7.5 7.5 0 1 1 4.5 12', pathLength: 1, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round' }))
}

const XBOX = { A: '#6fcf6f', B: '#ff6e6e', X: '#6d9cff', Y: '#ffd35c' }
const NINTENDO = '#e8e8ec'

/** A fresh SVG node for the glyph; callers own it. */
export function glyph(name: GlyphName, kind: PadKind): SVGSVGElement {
  switch (name) {
    case 'A':
      return kind === 'playstation' ? psShape('cross') : kind === 'nintendo' ? letter(NINTENDO, 'B') : letter(XBOX.A, 'A')
    case 'B':
      return kind === 'playstation' ? psShape('circle') : kind === 'nintendo' ? letter(NINTENDO, 'A') : letter(XBOX.B, 'B')
    case 'X':
      return kind === 'playstation' ? psShape('square') : kind === 'nintendo' ? letter(NINTENDO, 'Y') : letter(XBOX.X, 'X')
    case 'Y':
      return kind === 'playstation' ? psShape('triangle') : kind === 'nintendo' ? letter(NINTENDO, 'X') : letter(XBOX.Y, 'Y')
    case 'LB':
      return bumper(kind === 'playstation' || kind === 'steamdeck' ? 'L1' : kind === 'nintendo' ? 'L' : 'LB')
    case 'RB':
      return bumper(kind === 'playstation' || kind === 'steamdeck' ? 'R1' : kind === 'nintendo' ? 'R' : 'RB')
    case 'LT':
      return trigger(kind === 'playstation' || kind === 'steamdeck' ? 'L2' : kind === 'nintendo' ? 'ZL' : 'LT')
    case 'RT':
      return trigger(kind === 'playstation' || kind === 'steamdeck' ? 'R2' : kind === 'nintendo' ? 'ZR' : 'RT')
    case 'L3':
      return stickClick('L')
    case 'R3':
      return stickClick('R')
    case 'LSTICK':
      return stick('L')
    case 'LSTICK_UP':
      return stickForward()
    case 'RSTICK':
      return stick('R')
    case 'DPAD':
      return dpad()
    case 'DU':
      return dpad('up')
    case 'DR':
      return dpad('right')
    case 'DD':
      return dpad('down')
    case 'DL':
      return dpad('left')
    case 'SELECT':
      return kind === 'playstation' ? share() : kind === 'nintendo' ? sign('−') : view()
    case 'START':
      return kind === 'nintendo' ? sign('+') : menu()
    case 'HOLD':
      return holdRing()
    case 'HOME':
      return menu()
  }
}

/** The spoken name of a button on this controller, for tooltips and screen readers. */
export function glyphName(name: GlyphName, kind: PadKind): string {
  const ps = kind === 'playstation'
  const sw = kind === 'nintendo'
  const sd = kind === 'steamdeck'
  switch (name) {
    case 'A':
      return ps ? 'Cross' : sw ? 'B' : 'A'
    case 'B':
      return ps ? 'Circle' : sw ? 'A' : 'B'
    case 'X':
      return ps ? 'Square' : sw ? 'Y' : 'X'
    case 'Y':
      return ps ? 'Triangle' : sw ? 'X' : 'Y'
    case 'LB':
      return ps || sd ? 'L1' : sw ? 'L' : 'LB'
    case 'RB':
      return ps || sd ? 'R1' : sw ? 'R' : 'RB'
    case 'LT':
      return ps || sd ? 'L2' : sw ? 'ZL' : 'LT'
    case 'RT':
      return ps || sd ? 'R2' : sw ? 'ZR' : 'RT'
    case 'L3':
      return 'Left stick click'
    case 'R3':
      return 'Right stick click'
    case 'LSTICK':
      return 'Left stick'
    case 'LSTICK_UP':
      return 'Left stick forward'
    case 'RSTICK':
      return 'Right stick'
    case 'SELECT':
      return ps ? 'Share' : sw ? 'Minus' : 'View'
    case 'START':
      return ps ? 'Options' : sw ? 'Plus' : 'Menu'
    case 'HOLD':
      return 'Hold'
    case 'DU':
      return 'D-pad up'
    case 'DR':
      return 'D-pad right'
    case 'DD':
      return 'D-pad down'
    case 'DL':
      return 'D-pad left'
    default:
      return 'D-pad'
  }
}
