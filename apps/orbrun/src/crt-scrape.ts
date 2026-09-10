/**
 * CRT screens (`txt` messages: the skills screen and its kin) arrive as lines
 * of server-rendered HTML with no structure a cursor could use. This module
 * scrapes the hotkeys each known screen prints so the focus layer can put a
 * cursor over its rows. One scraper per screen, keyed by the crt menu's tag,
 * each pinned by a fixture recorded from a real server: a DCSS update that
 * changes the layout breaks a test here, not play. A screen with no scraper
 * of its own still yields the switches it prints in brackets (`scrapeSwitches`),
 * so no CRT screen is left with nothing the cursor can reach; its rows stay
 * raw keys until someone records it.
 *
 * Activation always sends exactly the key the screen printed for the row.
 */

export interface CrtHotkey {
  /** the character the screen printed; activation sends it as typed input */
  key: string
  label: string
  /** 0-based line of the screen */
  line: number
  /** 0-based column of the hotkey in the plain text of that line */
  col: number
  /** width of the region the row covers, for the cursor */
  len: number
  /** column group for left / right: skills print two columns of rows */
  group: string
  kind: 'row' | 'footer'
}

/** The plain text of one CRT line: tags dropped, the entities the server escapes restored. */
export function crtPlainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

/**
 * A selectable skill row: hotkey, training sign (`+` training, `-` not,
 * `*` focused), then the name, which always starts with a capital. Anchoring
 * on `<sign> <Capital>` keeps the digits of the level and aptitude columns
 * from matching (PocketZot's skill-hotkeys.ts uses the same anchor).
 */
const SKILL_HOTKEY_RE = /([a-z0-9]) [+\-*] [A-Z]/g

/** A footer switch: `[!] training`, `[?] help`, `[=] set target`. */
const CRT_BRACKET_RE = /\[(\S)\]/g

/**
 * The switches one line prints (`[!] training  [?] help`), as a menu's more
 * line prints its own: the label is what follows the brackets up to the next
 * switch or a wide gap. Every CRT screen gets these, known or not.
 */
function bracketSwitches(text: string, line: number): CrtHotkey[] {
  const out: CrtHotkey[] = []
  const foots: { key: string; col: number; end: number }[] = []
  for (const m of text.matchAll(CRT_BRACKET_RE)) foots.push({ key: m[1], col: m.index ?? 0, end: (m.index ?? 0) + m[0].length })
  foots.forEach((f, i) => {
    const limit = i + 1 < foots.length ? foots[i + 1].col : text.length
    const rest = text.slice(f.end, limit)
    const stop = rest.search(/ {2,}/)
    const label = (stop < 0 ? rest : rest.slice(0, stop)).trim()
    const len = f.end - f.col + (stop < 0 ? rest.trimEnd().length : stop)
    out.push({ key: f.key, label: label || f.key, line, col: f.col, len, group: 'foot' + i, kind: 'footer' })
  })
  return out
}

/**
 * Any CRT screen, known or not: the switches it prints. The rows of a screen
 * need a scraper of its own (they have no shape in common), but a switch is a
 * switch everywhere, so no screen is left with nothing the cursor can reach.
 */
function scrapeSwitches(plain: string[]): CrtHotkey[] {
  const out: CrtHotkey[] = []
  for (let line = 0; line < plain.length; line++) out.push(...bracketSwitches(plain[line], line))
  return out
}

/** Scrape the skills screen (menu tag `skills`). */
export function scrapeSkills(plain: string[]): CrtHotkey[] {
  const out: CrtHotkey[] = []
  for (let line = 0; line < plain.length; line++) {
    const text = plain[line]
    const rows: { key: string; col: number }[] = []
    for (const m of text.matchAll(SKILL_HOTKEY_RE)) rows.push({ key: m[1], col: m.index ?? 0 })
    rows.forEach((r, i) => {
      const end = i + 1 < rows.length ? rows[i + 1].col : text.length
      // the name runs from after "x + " to the first double space (the level column)
      const rest = text.slice(r.col + 4, end)
      const stop = rest.search(/ {2,}/)
      const label = (stop < 0 ? rest : rest.slice(0, stop)).trim()
      out.push({ key: r.key, label: label || r.key, line, col: r.col, len: Math.max(1, end - r.col), group: '', kind: 'row' })
    })
    if (rows.length) continue
    out.push(...bracketSwitches(text, line))
  }
  // the column a row belongs to is where its hotkey sits on the screen, so a
  // line with only a right-hand entry still lands the cursor in the right column
  const cols = Array.from(new Set(out.filter((h) => h.kind === 'row').map((h) => h.col))).sort((a, b) => a - b)
  for (const h of out) if (h.kind === 'row') h.group = 'col' + cols.indexOf(h.col)
  return out
}

const SCRAPERS: Record<string, (plain: string[]) => CrtHotkey[]> = {
  skills: scrapeSkills,
}

/** Screens the scraper knows. */
export function knownCrtScreen(tag: string): boolean {
  return tag in SCRAPERS
}

/**
 * Hotkeys of the CRT screen `tag`, from its HTML lines in order. A tag with
 * no scraper falls back to the switches the screen prints in brackets.
 */
export function scrapeCrt(tag: string, htmlLines: string[]): CrtHotkey[] {
  const scraper = SCRAPERS[tag] ?? scrapeSwitches
  return scraper(htmlLines.map(crtPlainText))
}
