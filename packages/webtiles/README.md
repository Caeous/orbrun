# @orbrun/webtiles

The DCSS [WebTiles](https://crawl.develz.org/wordpress/howto) protocol as a
library: what the server sends, what a client sends back, and a reducer that
turns the stream of server messages into one plain `GameState`. No DOM, no
renderer, no opinion about how anything looks. Orbrun's game is built on it;
so could a bot, a recorder, a stats scraper, or another client.

- `protocol.ts`: `Keys` (the special keycodes the server expects for arrows,
  function keys and the keypad), `ctrl()`, the client message builders in
  `cm` (`login`, `register`, `play`, `watch`, `key`, `input`, `chat`,
  `clickCell`, `menuScroll`, `setRc`, and the rest), `keyMessage()`, and the
  `MouseMode`, `MenuFlag`, `UiState` and `MapFeature` constant tables.
- `connection.ts`: `RemoteConnection`, a small wrapper over any
  `WebSocket`-like constructor that unpacks the WebTiles `{msgs: [...]}`
  batches in order, with `send`, `onOpen`, `onMessage` and `onClose`. It
  asks for the `no-compression` subprotocol; compressed frames are not
  decoded. Works in the browser and in Node.
- `state.ts`: `initialState()` and `reduce(state, message)`: a tolerant,
  immutable reducer over every message type the official client handles:
  the map, the player, items, menus and popups, the UI-state stack, prompts,
  text input, `--more--`, the lobby roster and game links, chat, and the
  message log. Plus helpers over the state: `topMenu`, `topPopup`,
  `hasStatus`, `itemsUnderfoot`, `floorItemsLabel`, `latestGameLinks`,
  `gameLinkRows`, `actionPanelItems`.
- `format.ts`: DCSS formatted strings (`<red>`, `<lightblue>` and friends)
  to HTML, plain text, or a span list, with the 16-colour terminal palette.

```ts
import { RemoteConnection, cm, initialState, reduce } from '@orbrun/webtiles'

let state = initialState()
const conn = new RemoteConnection({ url: 'wss://crawl.dcss.io/socket', gamedataBase: 'https://crawl.dcss.io', WebSocket })
conn.onMessage((m) => { state = reduce(state, m) })
conn.send(cm.watch('somebody'))
```

Tested by replaying recorded sessions from a public server
(`test/fixtures/*.ndjson`, captured with `tools/record/record.mjs` at the
repository root).

Part of [Orbrun](https://github.com/Caeous/orbrun). AGPL-3.0-or-later; see
the repository's ATTRIBUTION.md for what is reproduced from the official
client for interoperability.
