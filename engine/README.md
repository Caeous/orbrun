# Offline engine

DCSS's webtiles binary, built for WebAssembly so Orbrun can play with no
server. `build.sh` fetches upstream crawl, applies `patches/`, adds `wasm/`,
and builds it; [DEPLOYMENT.md](DEPLOYMENT.md) has the rest.

## License

Each patch modifies one DCSS source file and says at its top what it
changes; `wasm/` holds the files built in beside them. Both are derived from
DCSS and stay under its license, GPLv2 or (at your option) any later
version. They were first adapted from an existing WebAssembly port of DCSS;
`ATTRIBUTION.md` credits it.
