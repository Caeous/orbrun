# Orbrun in a terminal

The whole game in a terminal, here or over SSH, with no browser: the app's
own `Session` and `GameScreen` run in node on the offline engine, and the
screen is laid out as the browser lays the game out.

```
npm run term                  # play here; -- --name Ada to play as Ada, -- --trunk for trunk
npm run term:ssh              # serve it, then: ssh -p 2222 localhost (or ada@localhost to play as Ada)
npm run term:walk [place]     # just the renderer: walk a frozen level of the front room's
npm run term:compare -- <render-3d frames> <out.png>   # the renderer beside render-3d, pose by pose
```

Ctrl-\ saves and quits. Crawl's engine needs Node 24 or later (WebAssembly
JSPI); `npm run term` finds one (Homebrew's, the system's, or `ORBRUN_NODE`)
when the node on the path is older. A truecolor terminal is needed.

- **The view** is `@orbrun/render-term`: render-3d's own geometry and
  sprites, rasterized on the CPU at 4x8 samples a cell over the whole
  terminal, on several threads (raster.ts, a band of rows each;
  `ORBRUN_TERM_THREADS`, 0 for none). Each cell is then drawn as chafa draws
  a picture: of the glyphs the terminal draws a picture in, the one and the
  two colours that leave least wrong, sample by sample and seen from a step
  back (frame.mjs `mosaicEncoder`), a sprite's samples that stand out from
  those round them (a goblin's eyes, a quokka's) counting more, so a cell
  keeps them.
  Ghostty, Rex and kitty draw octants,
  sextants, eighths and the slanted wedges; iTerm2 all but the octants;
  Terminal.app draws blocks from its font, short of the top of the line, and
  that is reckoned with (`ORBRUN_TERM_BOX`); anything else, the blocks and
  quadrants. `ORBRUN_TERM_BLOCKS` (octant, sextant, block, quadrant) to
  choose, for `term:walk` too. Terminal.app spends its time on each change
  of colour, not on bytes, so there a cell keeps the colours the one before
  it set wherever the difference hardly shows (`ORBRUN_TERM_RATE`, 0 for
  every colour as it is; a little of it in iTerm2 and terminals not known,
  none in the GPU ones). Frames are drawn only while something
  changes, up to 120 a second (`FPS` to change it). Cells are taken to be
  twice as tall as wide (`ORBRUN_TERM_CELL_ASPECT` to say otherwise).
  A monster or an item too small to make out is named by crawl's own glyph,
  in its colour, over the middle of its sprite (`GLYPH_CELLS`).
- **The HUD** lies over the view as the browser's does, each pane the view
  darkened under its text: the stats pane at the top-left (grid/stats.ts),
  a dimmed window of the view with a cell's padding round its rows,
  the minimap at the top-right with the monster list under it (each row
  with the glyph the view names that monster by), the messages
  (grid/messages.ts) along the bottom; the level map (X) as crawl's glyphs.
- **Menus, popups and prompts** are laid out from the overlay DOM (game/text.ts):
  happy-dom does no layout, so block elements start lines, crawl's grids
  become columns, `fgN` classes are its colours, and the focused item is lit.
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
- `game/view.ts`: the MapRenderer GameScreen draws through.
- `game/text.ts`, `game/input.ts`: overlays as text, keys as events.
- `raster.ts`, `raster-worker.ts`: the view on threads, as cells.
- `frame.mjs`: pictures as glyph cells, and the screen diff; `keys.mjs`:
  terminal input sequences.
- `walk.ts`: the renderer alone.
