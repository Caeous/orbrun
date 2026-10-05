/**
 * The columns of a menu that crawl lays out as a console table: the spells
 * (spl-cast.cc `list_spells`: "Your spells (cast)  Type  Failure  Level") and
 * the abilities (ability.cc: "Ability - do what?  Cost  Failure"). Crawl pads
 * each row with spaces to the title's column heads, which reads as a table at
 * eighty columns and as a jumble wrapped on a phone held upright. Knowing
 * where the columns start lets styles.css lay a row out afresh there (the
 * name on a line, the rest under it) while everywhere else it stays the
 * padded line crawl sent.
 */

export interface MenuColumns {
  /** where each column after the first starts, in characters of the plain text */
  starts: number[]
  /** each column after the first: the most characters any of its cells (head included) holds, trimmed */
  widths: number[]
}

/** a head starts after a run of two spaces or more; one space is a word gap within a head ("Your spells") */
const HEAD = /\s{2,}(?=\S)/g

/**
 * The columns `title` heads, where `rows` keep to them: each row a cell's
 * edge at every head (a space just before it). Null when the title heads no
 * columns or no row keeps to them; a row that does not (a section header,
 * "Invocations -") is the caller's to leave whole (`fits`).
 */
export function menuColumns(title: string, rows: string[]): MenuColumns | null {
  const starts = [...title.trimEnd().matchAll(HEAD)].map((m) => m.index! + m[0].length)
  if (!starts.length) return null
  const kept = rows.filter((r) => fits(r, starts))
  if (!kept.length) return null
  const widths = starts.map((s, i) => Math.max(...[title, ...kept].map((t) => t.slice(s, starts[i + 1]).trim().length)))
  return { starts, widths }
}

/** whether `row` keeps to the columns starting at `starts` */
export function fits(row: string, starts: number[]): boolean {
  return row.length > starts[0] && starts.every((s) => s >= row.length || row[s - 1] === ' ')
}
