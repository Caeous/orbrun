/** A frame for a terminal, written whole or not at all (`synced`). */

/**
 * A frame's escapes as one synchronized update (mode 2026): the terminal
 * holds what it shows until the whole frame is in, so it never paints one
 * half drawn. Terminals that do not know the mode ignore it.
 */
export function synced(out) {
  return out && `\x1b[?2026h${out}\x1b[?2026l`
}
