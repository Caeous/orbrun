# @orbrun/room

The front room: the places, levels frozen from play, that the front screen
stands in behind the menu, a different one each visit. The browser app and
the terminal both show them.

- `places.ts`: the places (`places.json`), the cycle the front screen walks
  (`nextHomePlace`), and where each one's eye stands (`placeCamera`).
- `place-data.ts`: a place's file, the level as the player knew it then, to
  and from a `Scene`.
- `tiles.ts`: `RoomTiles`, a place's tiles from its atlas, as a
  `TileSource` for the renderers.

The places' files and atlases are the app's (apps/orbrun
`public/room/places`): the browser fetches them, the terminal reads them
from disk.
