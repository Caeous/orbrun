# Orbrun in a terminal

The whole game in a terminal, here or over SSH, with no browser and no page:
the app's own `Session` and its rules for the eye and the keys (pilot.ts,
runner.ts, keys.ts) run in node on the offline engine, the screen is laid
out as the browser lays the game out, and crawl's menus are drawn as console
crawl draws them.

```
npm run term                  # play here (or `orbrun`); -- --help for the options (--name Ada, --dcss trunk, --set fov=90…)
npm run term:ssh              # serve it, then: ssh -p 2222 localhost (or ada@localhost to play as Ada)
npm run term:walk [place]     # just the renderer: walk a frozen level of the front room's
npm run term:snap -- [place] [out.png]                 # a frame of the renderer as a PNG
npm run term:bench -- [place…]                         # how fast the view is drawn, without a terminal
npm run term:compare -- <render-3d frames> <out.png>   # the renderer beside render-3d, pose by pose
npm run term:glyph [place]    # the glyph view (glyph/): the view as cells, in sextants or octants
npm run term:glyph -- [place] --bench [cols rows frames]   # how fast it draws, without a terminal
npm run term:gym -- [--monsters goblin,ogre] [--term 160x48] [--motion]   # the glyph view's monsters as the game sees them, beside the truth
```

The game starts at the front screen, as the browser's (game/home.ts): a
place of the front room's standing still behind it in the view's glyphs,
the next of the browser's cycle each start, under its tinted veil; the
logo as the browser's, laid out in the mosaic's dots as the page lays it
out (game/home.ts `lockup`): the Orb of Zot's tile a texel to a dot (or
two to one, 16 dots a side; 32 on a very wide screen), the name in the
wordmark's face in the page's proportion and place beside it, cut sharp
on the dots (a dot inked where its ink covers most of it), and the page's shadows under them, the orb's
gold and purple glow and the name's dark cloud, as Chrome draws them; a
cell of either is the two colours and the glyph nearest its dots, and the shadows past them shade
the room's own cells (or, where a cell is one colour, are drawn by the
dot); and the rows: each version built
(`engine/build.sh`), its game to continue or a new one; the account;
Settings; and Quit. Arrows (or j and k) move, Enter takes a row, q leaves,
and the screen comes back when a game ends. `--dcss trunk` (or `dcss` in
the config) skips it and plays in that version straight away.

As in the browser, an account is its character: crawl plays it by the
account's name (`--name`, or the SSH user), one character to a version, so
a second character is a second account. Over SSH, each user has their
own.

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
name = "Ada"            # the player (default: Player, as in the browser)
dcss = "trunk"          # play it straight away, with no menu: stable, trunk, or a release built (0.34)
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

The game's settings (the browser's Settings menu's) are set on the front
screen's Settings, those the terminal draws by, and kept; any the file names
are written over them when it starts, so the file has the last word.

Accounts, from the player at the foot of the front screen, are the players
with saves here: play as another, add one by its name, or delete one and
every game saved as it (not the one in use). Without `--name` (or `name` in
the config), the game starts as the account last picked there, kept in
`~/.cache/orbrun/account`; over SSH it starts as the SSH user.

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
  up, crawl's letter for it where it would stand a cell tall or less; a cloud, or what is
  submerged or seen invisible, shows what is behind it. What stands is
  steady (glyph/render.ts `steady`): its picture is drawn once at a size
  and kept, its size whole cells and its foot and middle on the cells'
  edges (half cells, or dots, for what is too small for a cell to be little
  of it), so wherever it stands, glides, or is seen from, turning or
  stepping, it is the same picture on the same glyphs, moved, and changes
  only when its size does; near enough that its texels fill a dot, it is
  read a dot at a time, crisp; farther, its texels are averaged as the
  truth averages them, each pixel then the art's own colour nearest it
  (`farSampling`, `farSnap`), so its colours are its own far off as near,
  and each cell it is in is drawn in two of its own pixels' colours, the
  glyph chosen as seen from a step back. The hands are a whole number of dots a texel, on the
  dots. Over all, in a lens of
  their own, the hands, posed and sized as render-3d poses them (world hands.ts),
  the weapon lifting for a swing, and the net or the web round a trapped
  player (hud.ts `renderTrapped`). The view is drawn on threads in bands of
  rows (glyph/threads.ts; `ORBRUN_TERM_THREADS`, 0 for none), and again only
  when what it is drawn from changes. A turn's easing, once within 6° of its
  heading, lands on it (game/view.ts `shownCamera`): its long tail, drawn a
  few dots at a time, was seen as the whole view crawling and what stands
  hopping up and down as it slowed. `--reduced-motion` prefers reduced
  motion, as a player may ask a browser to: turns and steps land at once
  and nothing glides or swings. Frames are drawn only
  while something changes or moves, up to 60 a second (`FPS` to change it),
  each written as the cells that changed since the last (glyph/render.ts
  `ansiInto`).
- **The HUD** lies over the view as the browser's does, its text on the
  view darkened under it, a cell's padding either side: the stats pane at
  the top-left (grid/stats.ts) (no portrait or action panel: their tiles
  are too small to read in cells); the status badges left of the minimap; the minimap at
  the top-right, the level in crawl's own glyphs and colours as the level
  map draws it, what isn't known the view darkened, the player always in
  the middle as the browser's minimap has it, an arrow where crawl has its
  @, pointing the way the view faces, and the server's cursor on gold; the
  monster list under it (its bearing, crawl's letter where the browser shows
  the sprite, and its name; the `nearby` setting's edge pips are not drawn);
  the messages
  (grid/messages.ts) along the bottom, with what a prompt has typed. The
  level map (X) is crawl's glyphs in the clear part of the view (left of
  the right column, above the messages, the stats pane over its corner, as
  the browser's `levelMapSplit` has it; the minimap and the monster list
  stand down while it is open, as the browser's do), its cursor lit gold, the map still
  as the cursor moves and moved only near its edges.
- **Menus, popups and prompts** are crawl's, drawn as console crawl draws
  them, from the game's state (game/screens.ts): a menu its title, its rows
  (`a - a +0 dagger`) and its more line; a description its title, its text
  and its keys; the new-game choices crawl's columns under their headings;
  a CRT screen (the skills) crawl's own lines; a line typed at a prompt
  after its question. The one on top is a box over the view, eighty columns
  at most as crawl's console is: hung from near the top, or in the middle
  where crawl centres it; its title and keys stand while what is between
  them scrolls, the row under the cursor lit gold and kept in view. A yes/no
  or a --more-- is in the messages, as in console crawl.
- **Keys** go to crawl as console crawl takes them, as the official client
  sends them (keys.ts `keydownMessage`), but for a direction in the dungeon
  or while aiming, which is the app's: a step, a run, an attack or a turn,
  taken as the way the view faces (runner.ts). What the official client keeps
  for itself is kept here: a menu's cursor and its pages (menu-nav.ts), a
  popup's scroll, the new-game cursor, and a line being typed (text-entry.ts).

Saves, settings and the SSH host key live in `~/.cache/orbrun` (saves by
player and game; it was `~/.cache/orbrun-term`, and is moved on the first run). The SSH server lets anyone who reaches it play without a
password, so it listens on 127.0.0.1 only unless `HOST` says otherwise
(`PORT` for the port); each connection is a game process of its own.
`ORBRUN_TERM_TRACE=1` writes startup steps, messages and frame rates to
`~/.cache/orbrun/trace.log`.

- `game/main.ts`, `game/run.mjs`: play here (the `orbrun` command); `ssh.mjs`: the SSH server;
  `state.mjs`: where both keep their state.
- `game/client.ts`: the game (the session, the eye, the keys) and the
  screen: layout, panes, the box on top, the frame loop.
- `game/env.ts`: what the app asks of a browser in node (localStorage in a
  file, gamedata from disk).
- `game/engine.ts`, `game/engine-worker.mjs`: crawl in a worker, saves on disk,
  and what the menu says of them (`savedCharacters`).
- `game/view.ts`: the view as the glyph view's cells, with what stands and
  the hands; badges and items in the view's glyphs.
- `game/screens.ts`, `game/text.ts`: crawl's menus, popups and prompts as
  console crawl draws them, and its formatted text as coloured lines.
- `game/input.ts`: terminal keys as a browser's keydowns say them.
- `raster.ts`, `raster-worker.ts`: render-term on threads, for `walk.ts`.
- `frame.mjs`: a frame written whole (`synced`), and the kitty images
  `walk.ts` shows its picture in; `keys.mjs`: terminal input sequences.
- `glyph/`, `glyph-walk.ts`: the view as terminal cells, a ray a column
  through crawl's grid, for the game and alone (`glyph-walk.ts`,
  GLYPH_OPTS='{"wallInset":0.375}' for the game's walls); `glyph-gym.ts`:
  its gym, the view as the game sets it (game/view.ts `gameLens`,
  `GAME_GLYPH`: its field of view the height's, 85° as the terminal's Auto,
  across as wide as the terminal makes it; its eye, its pitch) at each
  terminal size asked for (`--term 120x36,160x48`), in an open room. At
  rest, the eye on a cell's middle facing north or north-east and a monster
  on each cell in view out to five cells (`--reach`), at each height asked
  for (`--heights 0.4,0.55,0.85`, as crawl's hit points stand them), each
  variant of the glyph view (`VARIANTS`) against what the same view shows in
  true pixels (8x16 a cell): how far apart, both blurred; how like, within
  the cell the cells may move it, from a step back and close up; how much
  more or less colourful; and how many dots its height, foot and middle are
  off; with a sheet of the poses ahead. `--sample 40 --items 8` stands
  monsters and items evenly through the game's tiles rather than a few
  named, for what holds for almost everything (the median, the worst tenth,
  and the subjects each does worst on); `--shard i/n` runs a share of them
  on each of n processes and `--merge` reports them as one; `--hands`
  draws the hands as the game holds them. `--motion`: a monster
  gliding across, toward and on the diagonal, the eye stepping toward it
  and aside and turning a heading, a frame at a time (`--steps`, `--at`
  for how far), each variant scored by how much the monster changes from
  frame to frame besides moving, and how often its height changes and
  changes back.
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
