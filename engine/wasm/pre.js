// The Module side of the webtiles bridge (wasm/bridge.h has the C++ side).
// Loaded via --pre-js, so it runs before the runtime. A host keeps the object
// it passes the factory: Module.bridge appears on it once the factory's first
// await has passed, while the factory's own promise settles only when main()
// returns -- which, for a game, is when the player quits.

// Headless webtiles invocation. -webtiles-socket only needs to be non-empty
// (keeps the m_sock_name.empty() guards live; no socket is created under
// __EMSCRIPTEN__). The save dir (Module.saveDir, default /crawl) is the
// persistent IDBFS mount below. A host passes its own argv (a player name, a
// game mode); wasm/bake-caches.mjs appends -builddb.
// No -dir here: CRAWL_DIR goes in via the environment (preRun below) -- the
// env path (initfile.cc get_system_environment) avoids the flag's
// triplicated "Setting crawl_dir..." boot-log line.
Module['arguments'] = Module['arguments'] || [
    '-headless',
    '-webtiles-socket', 'bridge',
    '-name', 'local',
];

// Writable game dir (saves, morgue, bones, generated description DBs) on
// IDBFS: hydrate from IndexedDB before main() runs. Persistence is batched,
// not autoPersist: the engine calls wasm_bridge_persist() (wasm/bridge.h) at
// consistency points -- package::commit() and process exit -- so IndexedDB
// only ever sees whole save states, never a mid-write torn one, and normal
// play does no IndexedDB traffic. dat/ and docs/ arrive read-only via the
// preload .data bundle.
//
// Module.saveDir picks the directory, default /crawl. IDBFS names its
// IndexedDB database after the mount point, so two engines (a stable and a
// trunk) on one origin keep their saves apart by mounting different dirs.
Module['preRun'] = (Module['preRun'] || []).concat(function () {
    var dir = Module['saveDir'] || '/crawl';
    // Trailing slash: get_system_environment expects crawl_dir to end with
    // the path delimiter (the -dir flag path appends it; getenv does not).
    ENV.CRAWL_DIR = dir + '/';
    try { FS.mkdir(dir); } catch (e) { /* exists */ }
    // No IndexedDB (the node cache-bake run): plain MEMFS, nothing persists.
    if (typeof indexedDB === 'undefined')
        return;
    FS.mount(IDBFS, {}, dir);
    addRunDependency('bridge-idbfs');
    FS.syncfs(true, function () {
        // Host hook, called after hydration and before main(): the host
        // seeds the pre-baked caches (dist/prewarm/) into the dir here, so
        // first boot skips the in-engine cache build. Async (may fetch);
        // boot proceeds on failure -- the engine just rebuilds.
        var seed = Module['seedCaches'];
        if (!seed) { removeRunDependency('bridge-idbfs'); return; }
        Promise.resolve(seed(FS, dir))
            .catch(function (e) { console.warn('wasm bridge: cache seeding failed', e); })
            .then(function () { removeRunDependency('bridge-idbfs'); });
    });
});

Module['bridge'] = {
    queue: [],
    wake: null,
    // One control message (the server->binary datagram equivalent),
    // forwarded verbatim: key, menu_hover, menu_scroll, text_input, ...
    pushControl: function (json) {
        this.queue.push(json);
        if (this.wake) {
            var w = this.wake;
            this.wake = null;
            w();
        }
    },
    // Typed text. The engine's text_input handler buffers the whole string
    // and drains it through getch before reading the next message, so a
    // multi-key sequence stays atomic.
    pushKeys: function (text) {
        this.pushControl(JSON.stringify({ msg: 'text_input', text: text }));
    },
    // Current wasm memory size in bytes. HEAPU8 is re-created on every
    // memory grow, so its length is always current; undefined until the
    // runtime initializes. Memory never shrinks (MAXIMUM_MEMORY caps it).
    heapBytes: function () {
        return typeof HEAPU8 === 'undefined' || !HEAPU8 ? 0 : HEAPU8.length;
    },
};
