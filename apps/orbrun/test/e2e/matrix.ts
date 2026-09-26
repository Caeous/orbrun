/**
 * Every surface × every input: each scenario is recorded once on crawl, then
 * every input is tried on a replay of it (rules.ts), and crawl judges where
 * two inputs send different keys. Shared by the shard files, which vitest runs
 * side by side (each has a DOM of its own, and engines in workers of their own).
 */
import { formattedStringToText } from '@orbrun/webtiles'
import { startLive, type E2e } from './client'
import { screen } from './screen'
import { FIGHTER, SCENARIOS, type Scenario } from './scenarios'
import { check, keysOf, tryAll, type Judge, type Violation } from './rules'

const SHARDS = 5

/** The scenario played live to its surface. */
export async function atSurface(sc: Scenario): Promise<E2e> {
  const g = await startLive({ args: sc.args ?? FIGHTER })
  if (!sc.newGame) for (let i = 0; i < 5 && g.ctx().mode !== 'command'; i++) await g.raw('a')
  await sc.setup(g)
  const s = screen(g)
  const ok = typeof sc.surface === 'string' ? s.surface === sc.surface : sc.surface.test(s.surface)
  if (!ok) {
    g.close()
    throw new Error(`${sc.id} landed on ${s.surface} (${s.title}), not ${String(sc.surface)}; log ${JSON.stringify(s.log)}; engine ${g.log().slice(-5).join(' / ')}; last ${JSON.stringify(g.recording().steps.map((x) => [x.input, x.msgs.map((m) => m.msg + (m.msg === "game_ended" ? ":" + JSON.stringify(m) : ""))]))}`)
  }
  return g
}

/**
 * What crawl did, as the player could see it: the surface and its cursor,
 * the top menu's rows, marks and footer, the top popup's contents and pane,
 * the CRT screen, the cursors on the map, the options, what the log gained.
 */
function effect(g: E2e, linesBefore: number): string {
  const st = g.state()
  const s = screen(g)
  const menu = st.menus.at(-1)
  const popup = st.ui.at(-1)
  return JSON.stringify({
    surface: s.surface,
    title: s.title,
    lit: s.lit,
    phase: st.phase,
    mode: st.inputMode,
    menu: menu && { tag: menu.tag, title: menu.title?.text, prompt: menu.titlePrompt, more: menu.more, alt: menu.alt_more, hover: menu.last_hovered, items: menu.items.map((i) => i && [i.text, i.q, i.preselected]) },
    popup: popup && { type: popup.type, data: popup.data, state: popup.state },
    crt: [Array.from(st.crt.lines.entries()), Array.from(st.crt.areas.entries()).map(([k, v]) => [k, Array.from(v.entries())])],
    text: st.textInput && { tag: st.textInput.tag, prompt: st.textInput.prompt },
    cursors: st.cursors,
    options: (st as { options?: unknown }).options,
    player: st.player.pos,
    log: st.messages.lines.slice(linesBefore).map((l) => formattedStringToText(l.text)),
  })
}

/** What crawl makes of `sent` from the scenario's surface, once per distinct sequence of keys. */
function judgeFor(sc: Scenario): Judge {
  const seen = new Map<string, Promise<string>>()
  return (sent) => {
    const k = keysOf(sent)
    let p = seen.get(k)
    if (!p) {
      p = (async () => {
        const g = await atSurface(sc)
        try {
          const lines = g.state().messages.lines.length
          for (const m of sent) await g.rawMessage(m)
          return effect(g, lines)
        } finally {
          g.close()
        }
      })()
      seen.set(k, p)
    }
    return p
  }
}


/** The scenarios of one shard (every SHARDS-th, so the slow ones spread out), or those ONLY names. */
export function shardScenarios(shard: number): Scenario[] {
  const only = process.env.ONLY?.split(',')
  if (only) return shard === 0 ? SCENARIOS.filter((s) => only.includes(s.id)) : []
  return SCENARIOS.filter((_, i) => i % SHARDS === shard)
}

/** How many presses of B may stand between any screen and the map (a describe over a menu over a look is three). */
const WAY_OUT = 6

/**
 * The way out: B, again and again, from the scenario's surface on crawl,
 * gets back to the map (or to the lobby, where a new game's B goes). A pad
 * with nothing else to press is never stuck. Each press is the pad's own,
 * down the same path as in play.
 */
async function wayOut(sc: Scenario): Promise<Violation[]> {
  if (sc.noWayOut) return []
  const g = await atSurface(sc)
  try {
    const path: string[] = []
    for (let i = 0; i < WAY_OUT; i++) {
      const s = screen(g)
      if (s.mode === 'command' || s.mode === 'lobby' || g.state().phase !== 'playing') return []
      path.push(s.surface)
      await g.press('B')
    }
    const s = screen(g)
    if (s.mode === 'command' || s.mode === 'lobby' || g.state().phase !== 'playing') return []
    return [{ scenario: sc.id, rule: 'B finds the way out', detail: `${WAY_OUT} presses of B: ${[...path, s.surface].join(' → ')}` }]
  } finally {
    g.close()
  }
}

/** Every violation on the given scenarios. */
export async function runMatrix(scenarios: Scenario[]): Promise<Violation[]> {
  const all: Violation[] = []
  for (const sc of scenarios) {
    const g = await atSurface(sc)
    const rec = g.recording()
    g.close()
    all.push(...(await check(sc.id, await tryAll(rec), judgeFor(sc), sc.idle)))
    all.push(...(await wayOut(sc)))
  }
  return all
}

export function formatViolations(v: Violation[]): string {
  return v.map((x) => `${x.scenario.padEnd(20)} ${x.rule.padEnd(20)} ${x.detail}`).join('\n')
}
