import type { Dir8 } from '@orbrun/scene'

/**
 * A pad's buttons and what it says, by the W3C standard mapping: the app's
 * gamepad.ts polls a pad into these, and the bindings answer them.
 */
export type Button = 'A' | 'B' | 'X' | 'Y' | 'LB' | 'RB' | 'LT' | 'RT' | 'SELECT' | 'START' | 'L3' | 'R3' | 'DU' | 'DD' | 'DL' | 'DR' | 'HOME'

/** Where a direction came from. */
export type DirSource = 'dpad' | 'lstick'

export type PadEvent =
  /** `touch`: an on-screen button stood in for the pad's (hud.ts touch bar); the pad itself did not speak */
  | { type: 'press'; button: Button; t: number; touch?: boolean }
  | { type: 'release'; button: Button; t: number; held: number; touch?: boolean }
  | { type: 'repeat'; button: Button; n: number }
  /** `touch` as on a press: the touch bar's arrows moved the d-pad, the pad's own did not */
  | { type: 'dir'; source: DirSource; dir: Dir8 | null; touch?: boolean }
  | { type: 'dirRepeat'; source: DirSource; dir: Dir8; n: number; touch?: boolean }
  /** `start`: true on the first frame of a deflection; false on the frames that follow and on the settle to 0,0 */
  | { type: 'look'; dx: number; dy: number; start?: boolean }

/**
 * Whether an event is the player choosing the controller: a button going
 * down, or a stick or the d-pad being pushed. A connection, a release or a
 * centred stick is not, and neither is the continuation of something already
 * counted (a held button's repeats, a held direction's repeats, the frames of
 * a look after its first): a stick that rests off centre, or a key typed
 * while the stick is still pushed, must not keep the prompts in pad glyphs
 * against a keyboard that spoke since (game.ts `inputFrom`).
 */
export function isPadActivity(ev: PadEvent): boolean {
  return (ev.type === 'press' && !ev.touch) || (ev.type === 'dir' && ev.dir !== null && !ev.touch) || (ev.type === 'look' && ev.start === true)
}
