/**
 * Mini health and magic bars, as DCSS draws them.
 *
 * The bar a monster carries is the server's own damage-level icon
 * (rltiles/misc/mdam_*.png, listed in dc-icons.txt as MDAM_LIGHTLY_DAMAGED
 * through MDAM_ALMOST_DEAD): a 32x32 tile whose only opaque texels are rows
 * 30 and 31, a two-row bar the full cell wide. The fill shrinks and turns
 * from green through yellow and orange to red with the wound level; the rest
 * of each row is a translucent black track. The upper row of the fill is the
 * bright colour, the lower row a darker one, so the bar reads as a bevel
 * even at two pixels. Along its length the fill is not flat either: the
 * first texels are dimmer (alpha 176 on texels 0-5, 199 on 6-14, 225 from
 * 15 on), and the tip is lit (the upper row's last few texels a lighter
 * shade, its last texel lighter still; the lower row's last texel a touch
 * lighter), so the bar seems to glow toward its end. `fillRun` describes
 * that structure for a fill of any width, in the frame's own texel units.
 *
 * The player's own bars in the local tiles build are the same two-texel rows
 * (tilereg-dgn.cc DungeonRegion::draw_minibars: "Tiles are 32x32 pixels ...
 * The bars are two pixels high each"). WebTiles' cell_renderer.js
 * draw_minibars keeps that height (floor(cell / 16)) but paints them flat
 * green and blue, with a TODO to "use different colors if heavily wounded,
 * like in the tiles version".
 *
 * Orbrun draws the player's bars in the monsters' style: the wound level
 * from crawl's own thresholds (mon-util.cc mons_get_damage_level) and the
 * colours sampled from the damage icons, so a player at half health reads
 * exactly like a heavily damaged monster does. The magic bar has no icon to
 * sample; it takes WebTiles' magic blue (cell_renderer.js determine_colours,
 * `magic = "#5e78ff"`) with its lower row darkened like the icons' rows.
 * Both renderers lay the rects out with `minibarRects`, so they agree to the
 * texel.
 */

/** The wound classes monster_list.js names, from the server's MDAM flags. */
export type WoundLevel = 'uninjured' | 'lightly_damaged' | 'moderately_damaged' | 'heavily_damaged' | 'severely_damaged' | 'almost_dead'

/**
 * mon-util.cc mons_get_damage_level, integer division and all:
 *   hp <= max / 5       almost dead
 *   hp <= max * 2 / 5   severely damaged
 *   hp <= max * 3 / 5   heavily damaged
 *   hp <= max * 4 / 5   moderately damaged
 *   hp <  max           lightly damaged
 */
export function woundLevel(hp: number, hpMax: number): WoundLevel {
  if (hpMax <= 0 || hp >= hpMax) return 'uninjured'
  if (hp <= Math.floor(hpMax / 5)) return 'almost_dead'
  if (hp <= Math.floor((hpMax * 2) / 5)) return 'severely_damaged'
  if (hp <= Math.floor((hpMax * 3) / 5)) return 'heavily_damaged'
  if (hp <= Math.floor((hpMax * 4) / 5)) return 'moderately_damaged'
  return 'lightly_damaged'
}

/**
 * The fill colours of rltiles/misc/mdam_*.png, upper row then lower row,
 * sampled from the icons' opaque run. An uninjured bar (the player at full
 * health with magic spent) takes the lightly-damaged green: the icons have
 * no "okay" bar because a monster at full health carries none.
 */
export const WOUND_COLOURS: Record<WoundLevel, { top: string; bottom: string }> = {
  uninjured: { top: '#0ebd3b', bottom: '#086f42' },
  lightly_damaged: { top: '#0ebd3b', bottom: '#086f42' },
  moderately_damaged: { top: '#8bcd0d', bottom: '#499f10' },
  heavily_damaged: { top: '#dcad08', bottom: '#b1790c' },
  severely_damaged: { top: '#e05001', bottom: '#933d01' },
  almost_dead: { top: '#dd0e00', bottom: '#9f0000' },
}

/** cell_renderer.js determine_colours `magic`; the lower row darkened by the icons' own ratio (0x08/0x0e on the green). */
export const MAGIC_COLOURS = { top: '#5e78ff', bottom: '#3a4a9e' }

/** The icons' track: black at alpha 128/255 on the upper row, 169/255 on the lower. */
export const TRACK_COLOUR = '#000000'
const TRACK_ALPHA = { top: 128 / 255, bottom: 169 / 255 }
/** The icons' fill alpha, 225/255, on the run from texel 15; the dimmer opening steps. */
export const FILL_ALPHA = 225 / 255
/** The icons' alpha steps along the fill: up to (exclusive) this texel of the 32-texel frame, this alpha. */
export const FILL_STEPS: { to: number; alpha: number }[] = [
  { to: 6, alpha: 176 / 255 },
  { to: 15, alpha: 199 / 255 },
  { to: Infinity, alpha: FILL_ALPHA },
]
/**
 * The lit tip, as fractions of the fill's own length: the last fifth lifted
 * toward white by `top` / `bottom` on the two rows, the last twentieth more
 * so (the icons: `#44d458` then `#7ced76` closing the lightly-damaged green
 * `#0ebd3b`; `#0a953e` closing its `#086f42` lower row).
 */
export const FILL_TIP: { from: number; top: number; bottom: number }[] = [
  { from: 0.8, top: 0.3, bottom: 0.1 },
  { from: 0.95, top: 0.55, bottom: 0.25 },
]

/** `#rrggbb` moved toward white by `k` (0 keeps it, 1 is white). */
export function lighten(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16)
  const c = (v: number) =>
    Math.round(v + (255 - v) * k)
      .toString(16)
      .padStart(2, '0')
  return '#' + c((n >> 16) & 255) + c((n >> 8) & 255) + c(n & 255)
}

/** One stretch of a fill along its length, in frame texels: its alpha and how far each row is lifted toward white. */
export interface RunSegment {
  x0: number
  x1: number
  alpha: number
  lift: { top: number; bottom: number }
}

/**
 * The icons' structure along a fill `w` texels long in a `frame` texels
 * wide: the alpha steps at the frame's texels 6 and 15 (they belong to the
 * frame, so a short bar keeps only the dim start, like the almost-dead
 * icon), the lit tip at the fill's own last fifth and twentieth. Segments
 * are contiguous, left to right; none is empty. A bar at its full length
 * is one plain segment: the two tones and nothing else, a calm block, so
 * only a bar that has lost something carries the dim start and the lit tip.
 */
export function fillRun(w: number, frame = MINIBAR_CELL): RunSegment[] {
  if (w <= 0) return []
  if (w >= frame) return [{ x0: 0, x1: w, alpha: FILL_ALPHA, lift: { top: 0, bottom: 0 } }]
  const scale = frame / MINIBAR_CELL
  const cuts = new Set<number>([0, w])
  for (const st of FILL_STEPS) if (st.to * scale < w) cuts.add(st.to * scale)
  for (const t of FILL_TIP) cuts.add(w * t.from)
  const xs = [...cuts].sort((a, b) => a - b)
  const out: RunSegment[] = []
  for (let i = 0; i + 1 < xs.length; i++) {
    const x0 = xs[i]
    const x1 = xs[i + 1]
    if (x1 - x0 <= 1e-9) continue
    const alpha = FILL_STEPS.find((st) => x0 < st.to * scale)!.alpha
    let lift = { top: 0, bottom: 0 }
    for (const t of FILL_TIP) if (x0 >= w * t.from - 1e-9) lift = { top: t.top, bottom: t.bottom }
    out.push({ x0, x1, alpha, lift })
  }
  return out
}

/** Texels of the frame the bars are laid out in, and the rows one bar takes (the icons' rows 30 and 31). */
export const MINIBAR_CELL = 32
export const MINIBAR_ROWS = 2

/** What the `player` message says, with the rc's `tile_show_minihealthbar` / `tile_show_minimagicbar`. */
export interface Minibars {
  hp: number
  hpMax: number
  mp: number
  mpMax: number
  showHp: boolean
  showMp: boolean
}

/** One filled rectangle, in texels of a 32-texel frame from its top-left corner. */
export interface BarRect {
  x: number
  y: number
  w: number
  h: number
  colour: string
  alpha: number
}

/**
 * The player's bars as rectangles on the top edge of the frame, health over
 * magic, each `MINIBAR_ROWS` texels tall and the frame wide. Nothing when
 * both bars are full or hidden (cell_renderer.js draw_minibars: "don't draw
 * if hp and mp is full"); otherwise the health bar is drawn whenever it is
 * shown, full or not, and the magic bar whenever it is shown and the player
 * has any magic, exactly as WebTiles decides it. The fill is the exact
 * fraction, never less than a texel while anything is left, and carries the
 * icons' run: dim start, lit tip, on both rows.
 */
export function minibarRects(m: Minibars | null | undefined): BarRect[] {
  if (!m) return []
  const hpFull = m.hp >= m.hpMax
  const mpFull = m.mp >= m.mpMax
  if ((hpFull || !m.showHp) && (mpFull || !m.showMp)) return []
  const out: BarRect[] = []
  const W = MINIBAR_CELL
  let y = 0
  const bar = (frac: number, fill: { top: string; bottom: string }) => {
    const f = Math.max(0, Math.min(1, frac))
    const w = f > 0 ? Math.max(1, W * f) : 0
    out.push({ x: 0, y, w: W, h: 1, colour: TRACK_COLOUR, alpha: TRACK_ALPHA.top })
    out.push({ x: 0, y: y + 1, w: W, h: 1, colour: TRACK_COLOUR, alpha: TRACK_ALPHA.bottom })
    for (const seg of fillRun(w)) {
      out.push({ x: seg.x0, y, w: seg.x1 - seg.x0, h: 1, colour: lighten(fill.top, seg.lift.top), alpha: seg.alpha })
      out.push({ x: seg.x0, y: y + 1, w: seg.x1 - seg.x0, h: 1, colour: lighten(fill.bottom, seg.lift.bottom), alpha: seg.alpha })
    }
    y += MINIBAR_ROWS
  }
  if (m.showHp) bar(m.hp / Math.max(1, m.hpMax), WOUND_COLOURS[woundLevel(m.hp, m.hpMax)])
  if (m.showMp && m.mpMax > 0) bar(m.mp / m.mpMax, MAGIC_COLOURS)
  return out
}
