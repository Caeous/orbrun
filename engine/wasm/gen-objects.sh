#!/bin/sh
# Derives the wasm object list from the upstream Makefile's own WEBTILES link
# command (ground truth, survives upstream object-list changes), as a dry
# run: nothing is compiled. Run from crawl-ref/source after
# `make -f wasm/generated.mk WEBTILES=y`.
set -e
cd "$(dirname "$0")/.."
# Only the game's own link line: in a tree where nothing is compiled yet, the
# dry run also prints the rltiles tool's build, whose objects are not ours.
make WEBTILES=y -n -W main.o crawl 2>/dev/null \
  | grep -- ' LINK crawl;' \
  | tr ' ' '\n' \
  | grep '\.o$' \
  | grep -v '^-' \
  | awk '!seen[$0]++' \
  > wasm/objects.txt
count=$(wc -l < wasm/objects.txt | tr -d ' ')
echo "wasm/objects.txt: $count objects"
