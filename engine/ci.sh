#!/bin/sh
# The engine's CI run, on Workers Builds (orbrun-engine, root directory
# engine/, deploy command `sh ci.sh`), started nightly by the Worker's crons
# and by pushes that touch engine/. Builds the one channel that is behind
# (plan.mjs), plays it (smoke.mjs), and publishes it with the other channel
# kept as it is live (publish.mjs). A run with nothing new ends in seconds;
# a build or smoke failure publishes nothing, so the live build stays.
#
# Runs anywhere with a C++ toolchain, python3, git and curl: what it lacks
# of the build's needs (emsdk, node 25 for JSPI, PyYAML) it installs under
# .work/ci. ENGINE_CHANNEL names a channel instead of asking plan.mjs;
# ENGINE_DRY_RUN=1 checks the deploy without publishing.
set -eu

ENGINE=$(cd "$(dirname "$0")" && pwd)
TOOLS=$ENGINE/.work/ci
EMSDK_VERSION=$(cat "$ENGINE/emsdk-version")
NODE_MAJOR=$(cat "$ENGINE/.node-version")
LIVE=${ENGINE_LIVE:-https://orbrun-engine.angers.workers.dev/engine}
export ENGINE_LIVE=$LIVE
START=$(date +%s)
step() { echo "ci: +$(( $(date +%s) - START ))s $*"; }
mkdir -p "$TOOLS"

# node: the builds image has its own, and reads .node-version; if that was
# not honoured, fetch the pinned major
if [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -lt "$NODE_MAJOR" ]; then
    step "node $NODE_MAJOR"
    arch=$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')
    os=$(uname -s | tr 'A-Z' 'a-z')
    dir=$(curl -fsSL "https://nodejs.org/dist/latest-v$NODE_MAJOR.x/" | grep -o "node-v$NODE_MAJOR\.[0-9.]*-$os-$arch\.tar\.gz" | head -1)
    curl -fsSL "https://nodejs.org/dist/latest-v$NODE_MAJOR.x/$dir" | tar xz -C "$TOOLS"
    PATH=$TOOLS/${dir%.tar.gz}/bin:$PATH
fi
NODE_BIN=$(dirname "$(command -v node)")

step "plan"
channel=$(node "$ENGINE/plan.mjs" "$LIVE")
if [ -z "$channel" ]; then
    step "nothing new"
    exit 0
fi

if [ ! -x "$TOOLS/emsdk/emsdk" ]; then
    step "emsdk $EMSDK_VERSION"
    git clone --quiet --depth 1 https://github.com/emscripten-core/emsdk.git "$TOOLS/emsdk"
    "$TOOLS/emsdk/emsdk" install "$EMSDK_VERSION" >/dev/null
fi
"$TOOLS/emsdk/emsdk" activate "$EMSDK_VERSION" >/dev/null
# from inside its directory: sourced by a shell other than bash (dash is sh
# on the builds image), emsdk_env.sh cannot tell where it is and sets nothing
# emsdk_env also points SSL_CERT_FILE at its own python's bundle (on a Mac),
# which node then trusts instead of the machine's; the build needs neither
ssl=${SSL_CERT_FILE-}
cd "$TOOLS/emsdk"
. ./emsdk_env.sh >/dev/null
cd "$ENGINE"
if [ -n "$ssl" ]; then export SSL_CERT_FILE="$ssl"; else unset SSL_CERT_FILE; fi
command -v em++ >/dev/null || { echo "ci: emsdk $EMSDK_VERSION did not put em++ on PATH" >&2; exit 1; }
# emsdk_env puts its own node first, which is older than JSPI needs
PATH=$NODE_BIN:$PATH

# after emsdk_env, which can put a python of its own first
if ! python3 -c 'import yaml' 2>/dev/null; then
    step "PyYAML"
    python3 -m pip install --quiet --target "$TOOLS/py" pyyaml
    export PYTHONPATH=$TOOLS/py${PYTHONPATH:+:$PYTHONPATH}
fi

step "build $channel"
sh "$ENGINE/build.sh" "$channel"

step "smoke"
node "$ENGINE/smoke.mjs" "$ENGINE/dist/$channel"

step "publish"
node "$ENGINE/publish.mjs" ${ENGINE_DRY_RUN:+--dry-run}
step "done"
