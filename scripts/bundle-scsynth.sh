#!/usr/bin/env bash
# Copies scsynth + plugins + libsndfile out of a local SuperCollider.app
# into src-tauri/resources/sc/ in the layout scsynth expects at runtime
# (@loader_path/../Frameworks/libsndfile.1.dylib).
#
# Re-run this whenever you want to refresh the bundled SuperCollider bits.

set -euo pipefail

SC_APP="${SC_APP:-/Applications/SuperCollider.app}"
DEST="$(cd "$(dirname "$0")/.." && pwd)/src-tauri/resources/sc"

if [[ ! -d "$SC_APP" ]]; then
  echo "SuperCollider.app not found at $SC_APP" >&2
  exit 1
fi

rm -rf "$DEST"
mkdir -p "$DEST/Resources/plugins" "$DEST/Frameworks"

cp "$SC_APP/Contents/Resources/scsynth" "$DEST/Resources/scsynth"
cp "$SC_APP/Contents/Resources/plugins/"*.scx "$DEST/Resources/plugins/"
cp "$SC_APP/Contents/Frameworks/"*.dylib "$DEST/Frameworks/"

echo "Bundled scsynth from $SC_APP → $DEST"
du -sh "$DEST"
