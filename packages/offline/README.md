# @orbrun/offline

Plays DCSS with no server. The engine is crawl's own webtiles binary built for
WebAssembly (`engine/` at the repo root); this package runs it in a Web Worker
and puts a WebTiles `Connection` in front of it, so the rest of Orbrun talks to
it exactly as it talks to a server.

- `connection.ts`: `LocalWasmConnection`, a `Connection` of kind `local-wasm`.
  It opens on the next tick, never drops, and delivers batches in order,
  synchronously, like `RemoteConnection`. `workerLauncher` runs one module
  worker per game.
- `server.ts`: `OfflineServer`, what a server does around the game
  (ws_handler.py, process_handler.py): login, game links, `play`, the relay of
  crawl's lines and `*` messages, and stopping a game with its save landed.
  The engine is injected, so it is tested with a fake one.
- `engine.ts`: `startEngine`, which boots one engine from any file source and
  seeds its first-boot caches. The worker and the node tests both use it.
- `worker.ts`: the worker, which fetches a channel's files and runs `startEngine`.
- `channels.ts`: `channelOf`, the lobby entry for a build's `engine.json`, played
  as its release (`offline-0.34`) or as trunk; `profileSaveDir`,
  `deleteProfileSaves` and `hasSaves`, the saves.
- `install.ts`: `EngineStore`, the builds kept on the device (Cache Storage)
  and their updates. Play never waits on a download: a build downloads only
  while no game runs, a file at a time, keeping every whole file, and switches
  in at the next game start. A first game played online installs its build as
  it goes (the app's service worker keeps what the engine fetches). Trunk
  updates in place; a new release is offered beside the last one once whole,
  and the older one goes when no profile has a character saved in it. `note`
  is what a game's row says: `updating… 60%`, then `updated` until the next game.

```ts
import { EngineStore, LocalWasmConnection } from '@orbrun/offline'

const engines = new EngineStore({ base: new URL('/engine/', location.href).href, caches })
const conn = new LocalWasmConnection({
  channels: () => engines.channels(),
  engineBase: (c) => engines.engineBase(c),
  gamedataBase: '/engine',
})
engines.onChange(() => conn.channelsChanged())
```

## How it differs from a server

- Every account is a profile on this device: any login succeeds, as the name
  it gives, and its token lasts ten years. Each profile keeps its saves (and
  scores, morgues, bones) in a directory of its own, `profileSaveDir`, which
  is an IndexedDB database of its own; `deleteProfileSaves` drops them. The
  default profile, `Player`, keeps the release's (or trunk's) own directory.
- `game_client` goes out with `game_started`, not on crawl's `client_path`, which
  only an installed build sends; the channel's gamedata is known up front.
- Nobody else is here: no lobby entries, no watching, no chat.
- A game's files never leave the device, so `game_ended` carries no dump URL.
- A stop (`go_lobby`, `close`) asks the engine for a checkpoint save and
  terminates it once the save has reached IndexedDB, where a server sends
  SIGHUP. It ends as `saved`, or as an error if the save never landed.
- crawl starts with the profile's name, as a server starts it with the
  account's, so crawl's main menu never shows: a profile is one character,
  which Play resumes if saved and starts if not.
- Game links carry save info, as a server with `show_save_info` does
  ("[Kai, a level 3 Minotaur Berserker of Trog]"). A server asks crawl's
  `-save-json`; here the words are crawl's last `*milestone` for that save
  directory, kept in localStorage (`SaveBook`, `saves.ts`), and shown only
  while a `.cs` file is in the directory's IndexedDB.

## Tests

`test/server.test.ts` drives the server with a fake engine. `test/engine.test.ts`
plays the real engine through the whole connection, for every channel built in
`engine/dist`, and is skipped where none is. `test/install.test.ts` drives the
`EngineStore` against an in-memory cache and a fake publisher.
