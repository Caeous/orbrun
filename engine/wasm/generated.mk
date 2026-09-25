# What the wasm build takes from the native one, and nothing else: the
# generated sources and headers, levcomp's parser, the tile definitions, the
# generated docs, and the client's atlas sheets. Run from crawl-ref/source
# (engine/build.sh does):
#
#   make -f wasm/generated.mk WEBTILES=y -j8
#
# upstream's own `make WEBTILES=y` gets all of these too, but only after it
# has compiled and linked the native game, which the wasm build never uses:
# about a quarter of a clean build.
include Makefile

.DEFAULT_GOAL := wasm-generated
.PHONY: wasm-generated
# levcomp.tab.h comes with levcomp.tab.cc: from bison, or with no bison (the
# Workers Builds image) copied from prebuilt/, where it has no rule of its own
wasm-generated: $(GENERATED_FILES) $(TILEDEFSRCS) $(TILEDEFHDRS) \
    $(UTIL)levcomp.tab.cc $(UTIL)levcomp.lex.cc \
    docs webserver
