#!/bin/sh
# Compiles Hunspell to WebAssembly. Runs inside emscripten/emsdk — the image is
# the toolchain pin — and is driven either by the Dockerfile's hunspell-wasm
# stage or by npm-scripts/build-hunspell.mjs, which starts the same image.
#
# The checksum is the whole provenance story: the tarball is an upstream release
# asset, so a moved or tampered file fails here rather than becoming an engine
# nobody can account for.
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/pin.env"

VERSION="$HUNSPELL_VERSION"
SHA256="$HUNSPELL_SHA256"
OUT="${OUT_DIR:?OUT_DIR is required}"
GLUE="$HERE/glue.cxx"
WORK="$(mktemp -d)"

cd "$WORK"
curl -fsSL -o hunspell.tar.gz \
	"https://github.com/hunspell/hunspell/releases/download/v${VERSION}/hunspell-${VERSION}.tar.gz"
echo "${SHA256}  hunspell.tar.gz" | sha256sum -c -
tar xzf hunspell.tar.gz
cd "hunspell-${VERSION}"

mkdir -p "$OUT"

# -Oz over -O3: the download is on the composer's critical path and the engine
# is not. FORCE_FILESYSTEM because Hunspell reads its dictionary through a path,
# so the worker writes the two files into MEMFS before opening them.
em++ \
	-std=c++17 -Oz -flto \
	-DHUNSPELL_STATIC -DNDEBUG \
	-I src/hunspell \
	src/hunspell/affentry.cxx \
	src/hunspell/affixmgr.cxx \
	src/hunspell/csutil.cxx \
	src/hunspell/filemgr.cxx \
	src/hunspell/hashmgr.cxx \
	src/hunspell/hunspell.cxx \
	src/hunspell/hunzip.cxx \
	src/hunspell/phonet.cxx \
	src/hunspell/replist.cxx \
	src/hunspell/suggestmgr.cxx \
	"$GLUE" \
	-o "$OUT/hunspell.mjs" \
	-sMODULARIZE=1 \
	-sEXPORT_ES6=1 \
	-sEXPORT_NAME=createHunspell \
	-sENVIRONMENT=worker \
	-sFORCE_FILESYSTEM=1 \
	-sALLOW_MEMORY_GROWTH=1 \
	-sINVOKE_RUN=0 \
	-sEXIT_RUNTIME=0 \
	-sDISABLE_EXCEPTION_CATCHING=1 \
	-sEXPORTED_FUNCTIONS=_malloc,_free,_remit_open,_remit_close,_remit_spell,_remit_add,_remit_suggest \
	-sEXPORTED_RUNTIME_METHODS=FS,UTF8ToString,stringToNewUTF8

cp COPYING.MPL "$OUT/LICENSE"
cp license.hunspell "$OUT/license.hunspell"
cd /
rm -rf "$WORK"
