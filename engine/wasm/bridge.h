/*
 * The webtiles socket, as a JS message queue.
 *
 * Under Emscripten the webtiles Unix DGRAM socket is replaced by a queue on
 * the Emscripten Module object (wasm/pre.js):
 *
 *   engine -> JS   wasm_bridge_emit(buf, len)
 *                  calls Module.onBridgeOutput(str): one flush of
 *                  newline-terminated JSON lines (identical bytes to what
 *                  finish_message() would have sent over the socket).
 *
 *   JS -> engine   Module.bridge.pushControl(json) enqueues one control
 *                  message (the server->binary datagram equivalent);
 *                  pushKeys(text) wraps typed text as {"msg":"text_input"}.
 *                  The engine pops via wasm_bridge_pop_message() and
 *                  suspends in wasm_bridge_await_message() (JSPI) until the
 *                  queue is non-empty, so a waiting engine costs no CPU.
 *
 * Included exactly once, by tileweb.cc (EM_JS emits real definitions).
 */

#pragma once

#ifdef __EMSCRIPTEN__

#include <emscripten.h>

EM_JS(void, wasm_bridge_emit, (const char *buf, int len), {
    if (Module['onBridgeOutput'])
        Module['onBridgeOutput'](UTF8ToString(buf, len));
});

// Returns a malloc'd UTF-8 string (caller frees), or 0 if the queue is empty.
EM_JS(char *, wasm_bridge_pop_message, (), {
    var q = Module['bridge']['queue'];
    if (!q.length)
        return 0;
    var s = q.shift();
    var len = lengthBytesUTF8(s) + 1;
    var p = _malloc(len);
    stringToUTF8(s, p, len);
    return p;
});

EM_JS(bool, wasm_bridge_has_message, (), {
    return Module['bridge']['queue'].length > 0;
});

// Suspends the engine until the queue is non-empty.
EM_ASYNC_JS(void, wasm_bridge_await_message, (), {
    var b = Module['bridge'];
    if (b['queue'].length)
        return;
    await new Promise(function(resolve) { b['wake'] = resolve; });
});

// Flushes the IDBFS save dir (wasm/pre.js) to IndexedDB and suspends until it
// lands. The mount is not autoPersist (wasm/pre.js): the engine calls this at
// consistency points only -- package::commit() and end() -- so a tab death
// can never leave a torn half-synced save in IndexedDB. Callers outside
// tileweb.cc declare these extern "C" (EM_JS emits one real definition, via
// this header's single include there).
// Returns whether the flush landed: IndexedDB can refuse a write (quota,
// eviction, a broken store), and package::commit() only announces a
// checkpoint to the host when it did -- see wasm_bridge_checkpoint.
EM_ASYNC_JS(bool, wasm_bridge_persist, (), {
    return await new Promise(function(resolve) {
        FS.syncfs(false, function(err) {
            if (err)
                console.warn('wasm bridge: IDBFS persist failed', err);
            resolve(!err);
        });
    });
});

// Tells the host that the save package committed AND that the commit reached
// IndexedDB, so anything the host shows about a save (a Continue button, a
// slot label) can never promise turns a resume would not produce.
//
// Emitted from package::commit() and nowhere else. end()'s persist is a
// whole-mount flush on the way out -- the unlinked save after a death,
// morgue/scores/bones, the closed sqlite DBs -- and says nothing about the
// save package, which still holds its last commit. Tying it to commit()
// covers every consistency point: level changes, the start-of-game
// checkpoint, the felid-life and Abyss-shift saves, and a host-requested
// checkpoint.
//
// Guarded like wasm_bridge_emit: an embedder need not install a host
// callback (the cache bake, wasm/bake-caches.mjs, only stubs one).
EM_JS(void, wasm_bridge_checkpoint, (), {
    if (Module['onBridgeOutput'])
        Module['onBridgeOutput']('*{"msg":"checkpoint"}\n');
});

#endif // __EMSCRIPTEN__
