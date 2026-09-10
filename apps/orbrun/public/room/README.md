# The front room's tiles

`atlas.png` and `atlas.json` are the tiles the front end's room
(`src/room/antechamber.des`) is drawn from: a handful of DCSS's own tiles,
packed from one pinned gamedata version so the menu never waits on a server.
They are committed; an ordinary build ships them as they are.

Regenerate them only when the room or the pinned version changes:

```
V=acd3d60e20f899c1c8a546953d6ffa0f6c7fe0c8   # ROOM_GAMEDATA_VERSION in tools/build/pack-room.mjs
mkdir -p /tmp/gamedata-$V && cd /tmp/gamedata-$V
for f in floor wall feat main player; do curl -fsSO https://crawl.dcss.io/gamedata/$V/$f.png; done
cd - && node tools/build/pack-room.mjs /tmp/gamedata-$V
```

The tileinfo modules of that version are the checked-in fixture under
`packages/scene-webtiles/test/fixtures/gamedata/`. `atlas.json` records the
version, the atlases and the source rect and offsets of every tile; the
vault tests check that the room asks for nothing the atlas lacks.

DCSS's tile art (rltiles) is CC0; see ATTRIBUTION.md.
