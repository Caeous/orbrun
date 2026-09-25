#!/bin/sh
# Builds crawl's webtiles binary for WebAssembly into engine/dist.
#
#   engine/build.sh                  # both channels
#   engine/build.sh trunk|stable     # one channel
#   engine/build.sh <crawl ref>      # any commit, tag or branch
#
# No crawl version is pinned here. trunk is upstream's master; stable is the
# newest stone_soup-* release branch, looked up on upstream at build time.
# Each build lands in dist/builds/<commit>/, its gamedata in
# dist/gamedata/<commit>/, and dist/<channel>/engine.json (a ref's in
# dist/<ref>/) points at them (pointer.mjs).
#
# Needs emsdk active (em++ on PATH), node with JSPI (25+), python3 with
# PyYAML, and what a native `make WEBTILES=y` needs. ENGINE_WORK moves the
# clone and build trees (default engine/.work).
set -eu

ENGINE=$(cd "$(dirname "$0")" && pwd)
WORK=${ENGINE_WORK:-$ENGINE/.work}
REPO=$WORK/repo
JOBS=${JOBS:-$(getconf _NPROCESSORS_ONLN)}

command -v em++ >/dev/null || { echo "em++ not found: activate emsdk (source <emsdk>/emsdk_env.sh)" >&2; exit 1; }
python3 -c 'import yaml' 2>/dev/null || { echo "python3 needs PyYAML (pip install pyyaml)" >&2; exit 1; }

# One blobless clone for every channel. It keeps the history and tags, so
# crawl's own version string (git describe) comes out as upstream's.
mkdir -p "$WORK"
if [ ! -d "$REPO/.git" ]; then
    git clone --filter=blob:none --no-checkout https://github.com/crawl/crawl.git "$REPO"
fi
git -C "$REPO" fetch --quiet --filter=blob:none --tags --prune origin \
    '+refs/heads/*:refs/remotes/origin/*'

# The commit a channel or ref means today. A branch resolves on the remote:
# the clone's own branches stop at the day it was made.
resolve() {
    case $1 in
        trunk) ref=origin/master ;;
        stable) ref=origin/$(git -C "$REPO" for-each-ref --format='%(refname:lstrip=3)' \
                    'refs/remotes/origin/stone_soup-*' | sort -V | tail -1) ;;
        *) if git -C "$REPO" rev-parse --verify --quiet "origin/$1^{commit}" >/dev/null; then
               ref=origin/$1
           else
               ref=$1
           fi ;;
    esac
    git -C "$REPO" rev-parse "$ref^{commit}"
}

# Builds one channel (or ref) in its own worktree, so switching between them
# never throws the other's build tree away.
build() {
    name=$1
    commit=$(resolve "$name")
    slug=$(printf '%s' "$name" | tr -c 'A-Za-z0-9._-' '-')
    src=$WORK/$slug
    out=$ENGINE/dist/builds/$commit

    # A different commit starts from a clean tree; the same one keeps its
    # build outputs and only resets the patched sources.
    if [ ! -e "$src/.git" ]; then
        git -C "$REPO" worktree add --quiet --detach "$src" "$commit"
    fi
    if [ "$(cat "$WORK/$slug.commit" 2>/dev/null)" != "$commit" ]; then
        git -C "$src" checkout --quiet --force --detach "$commit"
        git -C "$src" clean -fdxq
        git -C "$src" submodule update --quiet --init --recursive --depth 1
        echo "$commit" > "$WORK/$slug.commit"
    else
        git -C "$src" checkout --quiet --force --detach "$commit"
    fi

    for p in "$ENGINE"/patches/*.patch; do
        git -C "$src" apply --whitespace=nowarn "$p" || {
            echo "$(basename "$p") no longer applies to crawl $name ($commit)" >&2
            exit 1
        }
    done
    rm -rf "$src/crawl-ref/source/wasm"
    cp -R "$ENGINE/wasm" "$src/crawl-ref/source/wasm"

    (
        cd "$src/crawl-ref/source"
        # The native build generates the sources the wasm build compiles
        # (art-data.h, mon-data.h, levcomp, rltiles, tags.lua) and the
        # client's atlas sheets; wasm/generated.mk asks for only those, not
        # the native game. status-icon-sizes is generated first, by
        # hand: upstream's rule for it names `$(RLTILES)status-icon-sizes.h`
        # (no slash), so under -j the copy into webserver/game_data/static can
        # look for rltiles/status-icon-sizes.js before anything wrote it, and
        # make stops with "No rule to make target".
        python3 util/status-icon-sizes-gen.py rltiles/icon-sizes.txt
        make -f wasm/generated.mk -j"$JOBS" WEBTILES=y
        sh wasm/gen-objects.sh
        make -f wasm/Makefile.emscripten -j"$JOBS" DAT_STAMP="$(git log -1 --format=%ct)"
        node wasm/bake-caches.mjs

        # The build sits under its commit, and the channel's engine.json
        # points at it: a device keeps the build it has while it downloads
        # the next one beside it, never a mix of the two. Gamedata sits
        # beside the builds, under the commit, as a server serves it under
        # /gamedata/<version>/: one base URL for every channel, and a hex
        # version, as the client expects.
        rm -rf "$out"
        mkdir -p "$out"
        cp wasm/dist/crawl.js wasm/dist/crawl.wasm wasm/dist/crawl.data "$out/"
        cp -R wasm/dist/prewarm "$out/prewarm"
        rm -rf "$ENGINE/dist/gamedata/$commit"
        mkdir -p "$ENGINE/dist/gamedata"
        cp -R webserver/game_data/static "$ENGINE/dist/gamedata/$commit"
        version=$(git describe --tags --long "$commit" 2>/dev/null || echo "$commit")
        old=$(sed -n 's/.*"commit":"\([0-9a-f]*\)".*/\1/p' "$ENGINE/dist/$slug/engine.json" 2>/dev/null || true)
        node "$ENGINE/pointer.mjs" "$ENGINE/dist" "$slug" "$commit" "$version" "$(cat wasm/build/dat-stamp)"
        # the build this channel pointed at before, unless another channel still does
        if [ -n "$old" ] && [ "$old" != "$commit" ] && ! grep -qs "\"commit\":\"$old\"" "$ENGINE"/dist/*/engine.json; then
            rm -rf "$ENGINE/dist/builds/$old" "$ENGINE/dist/gamedata/$old"
        fi
        echo "engine $name $version -> $out"
    )
}

if [ $# -eq 0 ]; then
    set -- stable trunk
fi
for name in "$@"; do
    build "$name"
done
