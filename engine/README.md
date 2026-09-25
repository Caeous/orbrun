# Offline engine

DCSS's webtiles binary, built for WebAssembly, so Orbrun can play with no
server. It runs in a Web Worker and speaks the same WebTiles JSON a server
relays; the page hands it control messages in place of a socket.

Nothing here is a copy of crawl, and no crawl version is pinned. There are two
channels, both resolved on upstream at build time: **trunk** is `master`, and
**stable** is the newest `stone_soup-*` release branch, as servers run it.
`build.sh` fetches the commit, applies `patches/`, adds `wasm/`, and builds;
each channel's `engine.json` records the commit it built. One patch series
serves both.

```sh
engine/build.sh              # stable and trunk
engine/build.sh stable       # one channel
engine/build.sh 0.34.1       # or any crawl tag, branch or commit
node engine/smoke.mjs        # play every built channel under node
```

Needs emsdk active (`em++` on PATH), node 25+ (JSPI), python3 with PyYAML,
and what a native `make WEBTILES=y` needs. Each channel builds in its own
worktree of one clone under `engine/.work/`, and lands in
`engine/dist/builds/<commit>/`, its gamedata in `engine/dist/gamedata/<commit>/`,
with `engine/dist/<channel>/engine.json` pointing at them (all gitignored).
Builds live under their commit so a device can download the next one beside
the one it plays (`@orbrun/offline` `EngineStore`):

| File | What |
|---|---|
| `crawl.js`, `crawl.wasm` | The engine: an ES module factory and its wasm |
| `crawl.data` | `dat/` and `docs/`, preloaded read-only |
| `prewarm/` | The first-boot caches, baked at build time (`wasm/bake-caches.mjs`) |
| `../gamedata/<commit>/` | The atlas sheets and tile info a server serves as `/gamedata/<version>/`, beside the builds so one base URL serves every channel |
| `../<channel>/engine.json` | The channel, the crawl commit built, its version string, the cache stamp, its gamedata version, the recipe (`recipe.mjs`: a hash of `patches/`, `wasm/` and `build.sh`), and every file of the build and its gamedata with its size (`pointer.mjs`) |

A host gives each release, and trunk, its own save dir (`Module.saveDir`, e.g.
`/crawl-0.34`, `/crawl-trunk`): IDBFS names its IndexedDB database after the
mount point, and a save carried into a newer crawl never loads in an older one.

## How it differs from the server build

The binary normally sends JSON over a Unix datagram socket and takes keys from
a pty. Here it runs headless, and `wasm/bridge.h` + `wasm/pre.js` put a JS
queue where the socket was:

| | Server build | This build |
|---|---|---|
| Output | `sendto()` in `finish_message` | `Module.onBridgeOutput(lines)` |
| Control in | `recvfrom()` | `Module.bridge.pushControl(json)` |
| Typed keys | pty | `Module.bridge.pushKeys(text)`, sent as `text_input` |
| Waiting for input | `pselect()` | JSPI suspension: no CPU while the player thinks |
| Terminal | ncurses | `wasm/fake-curses.h`, inert |
| Saves | files | IDBFS at the save dir, flushed at each save commit |

A host must send `{"msg":"attach","primary":true}` after boot, as the server
does, or the engine never sends the map.

Beyond upstream's messages, it sends two: `checkpoint`, once a save commit has
reached IndexedDB, and `ending`, once a game's end has; and it takes one,
`checkpoint`, which saves at the next moment the player has control (for a
tab going to the background).

## Publishing

The builds are served by their own Worker, `orbrun-engine` (`wrangler.jsonc`,
`worker/`), which orbrun.app forwards `/engine/*` to. A new build never
redeploys the app.

```sh
engine/build.sh stable && node engine/publish.mjs
```

A deploy replaces every file, so `publish.mjs` stages what was built here
and copies any channel that was not from the live Worker, into
`engine/.publish`, which is what Wrangler uploads. Only files whose content
Cloudflare does not have go up. Never run a bare `wrangler deploy` here.

Nightly, the same Worker's crons call a Workers Builds deploy hook (the
`DEPLOY_HOOK` secret), which runs `ci.sh` on a fresh machine: `plan.mjs`
picks the one channel whose live build is behind upstream or was made with
another recipe (stable first), then `build.sh`, `smoke.mjs`, `publish.mjs`.
A run has 20 minutes, so one channel a run, and two runs a night. A failed
build or smoke publishes nothing, so players keep the build they have.
`ci.sh` installs what the machine lacks under `.work/ci`: emsdk at
`emsdk-version`, node at `.node-version`, PyYAML.

Workers Builds, set up once in the dashboard for `orbrun-engine`: this
repo, root directory `engine`, production branch `main`, build command
empty, deploy command `sh ci.sh`, build watch paths `engine/*`, builds for
other branches off; then a deploy hook, stored with
`npx wrangler secret put DEPLOY_HOOK -c engine/wrangler.jsonc`.

## Patches

One per crawl file, each saying what it does at the top, every change behind
`#ifdef __EMSCRIPTEN__` so the native build compiles upstream's code.
`tileweb.cc` carries the socket swap; the rest fix headless play for a
watching client (popups painted, pre-game messages sent), keep the caches
valid across boots, and make saves land in IndexedDB whole.

When upstream moves, `build.sh` names the patch that no longer applies.
Fix it against the new source, regenerate it with `git diff` from the
channel's worktree in `.work/<channel>`, and keep the header.

## License

The patches and `wasm/` are derived from DCSS and stay under its license,
GPLv2 or (at your option) any later version. They were first adapted from an
existing WebAssembly port of DCSS; `ATTRIBUTION.md` credits it.
