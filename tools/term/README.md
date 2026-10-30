# Orbrun in a terminal

The whole game in a terminal, here or over SSH, with no browser: the app's
own `Session` and `GameScreen` run in node on the offline engine, and the
screen is laid out as the browser lays the game out.

```
npm run term                  # play here; -- --help for the options (--name Ada, --dcss trunk, --set fov=90…)
npm run term:ssh              # serve it, then: ssh -p 2222 localhost (or ada@localhost to play as Ada)
npm run term:walk [place]     # just the renderer: walk a frozen level of the front room's
npm run term:snap -- [place] [out.png]                 # a frame of the renderer as a PNG
npm run term:bench -- [place…]                         # how fast the view is drawn, without a terminal
npm run term:compare -- <render-3d frames> <out.png>   # the renderer beside render-3d, pose by pose
npm run term:glyph [place]    # the glyph view (glyph/): the view as cells, in sextants or octants
npm run term:glyph -- [place] --bench [cols rows frames]   # how fast it draws, without a terminal
npm run term:gym -- [--monsters goblin,ogre] [--variants best,base]   # the glyph view's monsters near to far, beside the truth
```

Ctrl-\ saves and quits. Crawl's engine needs Node 24 or later (WebAssembly
JSPI); `npm run term` finds one (Homebrew's, the system's, or `ORBRUN_NODE`)
when the node on the path is older. Everything on the screen is the
terminal's own cells, so any terminal with truecolour plays it. The view is
drawn in octants (Unicode 16's 2x4 block mosaics), which Ghostty, kitty,
WezTerm and Rex draw themselves; in a terminal whose font has none, play
with `--mosaic sextant` (2x3, Unicode 13), which more fonts have.

What to play and how comes from, least to most weight, the defaults,
`~/.config/orbrun/config.toml` (or `$XDG_CONFIG_HOME/orbrun/config.toml`,
or `--config <file>`), the environment (`ORBRUN_TERM_*`, `FPS`), and the
command line (game/config.ts):

```toml
name = "Ada"            # the player (default: your login name)
dcss = "stable"         # stable, trunk, or a release built (0.34)
fps = 60
reduced_motion = false

[view]
mosaic = "octant"       # the view's glyphs: octant, or sextant for a font without octants
letters = false         # monsters as crawl's letters rather than their sprites
threads = 5             # that draw it (0 for none)

[settings]              # the game's own (`--settings` lists them)
fov = 90
eye_height = 0.6
```

The game's settings are written over what it saved when it starts, so the
file says how a game begins and the Settings menu still changes it.

- **The view** is the glyph view's cells (glyph/, below), drawn as the
  prototype draws them, with what the browser's view has besides: a ray a
  column through crawl's grid meets each wall's body as render-3d stands it,
  both by `@orbrun/world`'s rules (footprint.ts `bodyRect`: back from the
  floor round it by its inset, a corner cut where a diagonal is open), so a
  corner can be seen round and a ray past a cut corner goes on; what a
  wall's body leaves of its cell is floored and roofed with the open cell's
  beside it, its floor tile alone, and crawl's wall shadows are left off the
  floor (cells.ts `stripAt`, `floorLayers`). A door in its doorway
  (doors.ts `framedDoors`, `doorBoard`) stands in its wall run, the walls
  either side standing back from it as from any opening and its art
  stretched to reach them, its ends as they are: closed, a block the run's
  thickness, wider than its cell; open, a board in the run's face on the
  eye's side that the view shows through where its art is clear.
  The walls, floors and lid are
  crawl's own tiles, a texel a dot near and their averages (mips) as they
  recede, lit by the eye's torch, what is remembered dimmer, and a cell's
  flash washed over all of it; what lies (a corpse) is laid on its floor,
  with a cell's marks (travel arrows, exclusion, badges) over it, and the
  blood and the rest crawl paints on a wall on its faces; the cursor is
  WebTiles' icon for it on its floor, or render-3d's ring in its mode's
  colour. What stands (the monsters, the items, the missiles, the features,
  the plants) is each its own sprite, as `@orbrun/world` lists it
  (things.ts `crowd`, `fixtures`): its layers and badges as render-3d
  stacks them, a missile lifted off the floor, a feature render-3d's
  height, the damage bar over its head, washed with
  its flash, gliding as world's movers glide it, its name under it close
  up, crawl's letter for it when too far to make out; a cloud, or what is
  submerged or seen invisible, shows what is behind it. A monster near
  enough that its texels fill a dot stands on the dots and is read on the
  coarsest of a cell's grids its texels fill (glyph/sampling.ts `gridFor`),
  so its texels' edges fall where a glyph draws them. Over all, in a lens of
  their own, the hands, posed and sized as render-3d poses them (world hands.ts),
  the weapon lifting for a swing, and the net or the web round a trapped
  player (hud.ts `renderTrapped`). The view is drawn on threads in bands of
  rows (glyph/threads.ts; `ORBRUN_TERM_THREADS`, 0 for none), and again only
  when what it is drawn from changes. `--reduced-motion` has the page prefer
  reduced motion, as a player may ask a browser to (game/env.ts): turns and
  steps land at once and nothing glides or swings. Frames are drawn only
  while something changes or moves, up to 60 a second (`FPS` to change it),
  each written as the cells that changed since the last (glyph/render.ts
  `ansiInto`).
- **The HUD** lies over the view as the browser's does, its text on the
  view darkened under it, a cell's padding either side: the stats pane at
  the top-left (grid/stats.ts) with the portrait (the player's cell) in the
  view's glyphs; the action panel's consumables beside it, each its tile
  with its count; the status badges left of the minimap; the minimap at
  the top-right, a level cell to a column and half a row (half blocks), in
  the level's own colours, the cone the view faces lit over it; the monster
  list under it, always (its bearing, crawl's letter where the browser shows
  the sprite, and its name; the `nearby` setting's edge pips are not drawn);
  the messages
  (grid/messages.ts) along the bottom, with what a prompt has typed. The
  level map (X) is crawl's glyphs in the clear part of the view (left of
  the monster list, above the messages, the stats pane over its corner, as
  the browser's `levelMapSplit` has it), its cursor lit gold, the map still
  as the cursor moves and moved only near its edges.
- **Menus, popups and prompts** are boxes over the view as the browser's
  popups are (styles.css `.popup`): hung from near the top, each one a
  stack deep a row lower, as wide as their widest line; in the middle where
  crawl centres them (before a game) and for a yes/no or a choice prompt,
  its keys named `[Y]`. The row under the cursor is lit gold across the box
  and kept in view as the box scrolls, and a pack's current tab is lit.
  They are laid out from the overlay DOM (game/text.ts): happy-dom does no
  layout, so block elements start lines, crawl's grids become columns, a
  console table (the `%` overview, a monster's stats) keeps crawl's column
  widths, a hanging line wraps under its words, and `fgN` classes are its
  colours. The browser's item tiles in a menu's rows are left out.
- **Keys** go to the page as the keydown events a browser fires (game/input.ts),
  so every binding is the app's.

Saves, settings and the SSH host key live in `~/.cache/orbrun-term` (saves by
player and game). The SSH server lets anyone who reaches it play without a
password, so it listens on 127.0.0.1 only unless `HOST` says otherwise
(`PORT` for the port); each connection is a game process of its own.
`ORBRUN_TERM_TRACE=1` writes startup steps, messages and frame rates to
`~/.cache/orbrun-term/trace.log`.

- `game/main.ts`, `game/run.mjs`: play here; `ssh.mjs`: the SSH server.
- `game/client.ts`: the screen: layout, panes, overlays, the frame loop.
- `game/env.ts`: the page the app runs in (happy-dom, gamedata from disk).
- `game/engine.ts`, `game/engine-worker.mjs`: crawl in a worker, saves on disk.
- `game/view.ts`: the MapRenderer GameScreen draws through, and the view
  as the glyph view's cells, with what stands and the hands; the portrait,
  badges and items in the view's glyphs.
- `game/text.ts`, `game/input.ts`: overlays as text, keys as events.
- `raster.ts`, `raster-worker.ts`: render-term on threads, for `walk.ts`.
- `frame.mjs`: a frame written whole (`synced`), and the kitty images
  `walk.ts` shows its picture in; `keys.mjs`: terminal input sequences.
- `glyph/`, `glyph-walk.ts`: the view as terminal cells, a ray a column
  through crawl's grid, for the game and alone (`glyph-walk.ts`,
  GLYPH_OPTS='{"wallInset":0.375}' for the game's walls); `glyph-gym.ts`:
  its gym. A monster is stood in an open room at a
  ladder of distances, from filling the view to a speck, and drawn by each
  variant of the glyph view (`VARIANTS`) beside what the same view shows in
  true pixels (8x16 a cell), each panel cropped to it, a sheet a monster
  (`--zoom 3`, `--across` for a column a variant); with how far each is
  from the truth, both blurred (which favours a blur: look at the sheets),
  `--motion lateral|depth|turn` how much more each shimmers than the truth
  as the monster glides or the view turns, `--sizes` how much of the view
  each covers, `--time [--at 8]` how long a frame takes.
  The glyph view draws on threads (glyph/threads.ts, glyph/worker.ts;
  `ORBRUN_TERM_THREADS`, 0 for none): what a frame is drawn from (each
  column's wall, what stands where) is found once a thread, then bands of
  the cell rows are taken as each thread comes free, this one too, the
  slowest of late first; each band packs its cells (three numbers a cell,
  encode.ts `pack`) and writes its own terminal output against the frame
  before, into memory they share, so a frame is the bands' bytes joined.
  `--bench` spins and walks a place (200x55 cells, 120 frames) and prints
  how long a frame takes and a checksum of its cells, the same on threads
  or not (GLYPH_OPTS='{"mosaic":"sextant"}' for other options than the
  gym's best, GLYPH_LOCAL=1 for `render` and `toAnsi` on this thread,
  GLYPH_ANSI_CHECK=1 to play the output on a screen and match it to the
  cells, BENCH_GAP=<ms> for a pause between frames, BENCH_MOVE=1 to move
  the monsters halfway).
- `walk.ts`: render-term alone, as a kitty image; `snap.ts`: a frame of it as a PNG;
  `bench.ts`: how long a frame takes to draw and ready, a place spun and
  walked (BENCH_HASH=1 and BENCH_DUMP=<file> to tell a change draws the same).
