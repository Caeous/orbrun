# Contributing

Bug reports and questions go to [GitHub
issues](https://github.com/Caeous/orbrun/issues). Pull requests are welcome;
the contract every change is held to is: match WebTiles, work with a
controller, and never break the keyboard.

## Layout

npm workspaces. `apps/orbrun` is the Vite app; `packages/*` are the
libraries, each with a README (see "DCSS as a library" in the
[README](README.md)); `tools/record` captures fixtures from a live server;
`tools/build` packs the front room's tiles and renders its poster and the
brand artwork. All of those outputs are committed, so an ordinary build never
runs the tools.

## Commands

```
npm test            # vitest run
npm run typecheck   # tsc -b
npm run build       # build apps/orbrun
npm run dev         # dev server (Vite, with the gamedata proxy)
```

Run `npm test` and `npm run typecheck` before calling a change done.

## Fixtures

Prefer a recorded fixture over a hand-written one.

- `npm run record -- wss://crawl.dcss.io/socket 60 out.ndjson` spectates the
  least idle player for 60 seconds and writes every server message to NDJSON.
  Spectating needs no login. The reducer tests replay such files.
- `node tools/record/menus.mjs wss://crawl.dcss.io/socket 30 outdir` collects
  every menu the spectated players open, each from its `menu` message to its
  `close_menu`, as one JSON fixture per menu type.

crawl.dcss.io is the recording target: it is the public server whose
WebSocket accepts the `no-compression` subprotocol from Node, which both
recorders need.

## Live testing

Anything that logs in to a real server reads its credentials from `.env`,
which is gitignored. Copy `.env.example` to `.env`, fill it in, and run such
scripts with `node --env-file=.env ...`. Vite only exposes `VITE_`-prefixed
variables to the browser bundle, so keep these unprefixed. Never commit `.env`
and never paste a password into a fixture.

## The front room and the brand

The Antechamber (`apps/orbrun/src/room/antechamber.des`) is drawn from a
small atlas of DCSS's own tiles, packed from one pinned gamedata version;
`apps/orbrun/public/room/README.md` says how to regenerate it. The poster
the menus stand on before WebGL is up comes from `npm run room:poster`. The
favicon, wordmark and Steam artwork come from `node tools/build/brand.mjs`,
which needs `rsvg-convert` and `magick` on the PATH. Tune the room at
`/testbed/room.html` on the dev server; `/testbed/walls.html` and
`/testbed/grid.html` exercise the wall geometry and the console grid.

## Changelog

`CHANGELOG.md` is public facing. Keep entries short: one line per change,
what changed and why it matters to a player, no implementation detail.
