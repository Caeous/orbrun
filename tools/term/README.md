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
  sprites, rasterized on the CPU, one pixel a dot of a block character, over
  the whole terminal: octants (2x4 a cell) in Ghostty, Rex and kitty, whole
  cells as coloured spaces in Terminal.app, whose blocks fall short of the
  line and leave seams, else quadrants (2x2); `ORBRUN_TERM_BLOCKS` (cell,
  half, quadrant, sextant, octant) to choose, for `term:walk` too. Frames are drawn only while something
  changes, up to 120 a second (`FPS` to change it). Cells are taken to be
  twice as tall as wide (`ORBRUN_TERM_CELL_ASPECT` to say otherwise).
- **The HUD** lies over the view as the browser's does, each pane the view
  darkened under its text: the stats pane at the top-left (grid/stats.ts),
  a dimmed window of the view with a cell's padding round its rows,
  the minimap at the top-right with the monster list under it, the messages
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
- `frame.mjs`: pictures as block cells, and the screen diff; `keys.mjs`:
  terminal input sequences.
- `walk.ts`: the renderer alone.
