#!/usr/bin/env bash
# Regenerate packaging/background.tiff (Retina multi-page) from
# resources/dmg-background.svg for the macOS DMG installer window.
#
# Requires: rsvg-convert (brew install librsvg), tiffutil (macOS).
#
# Usage: scripts/generate-dmg-background.sh
set -euo pipefail

cd "$(dirname "$0")/.."

SVG="resources/dmg-background.svg"
OUT="packaging"
# Keep height a bit taller than the visual chrome so Finder's status bar
# (often forced on despite ShowStatusBar=false) does not introduce a scrollbar.
W1=550
H1=360
W2=1100
H2=720

command -v rsvg-convert >/dev/null || {
  echo "rsvg-convert not found. Install with: brew install librsvg" >&2
  exit 1
}
command -v tiffutil >/dev/null || {
  echo "tiffutil not found (macOS only)." >&2
  exit 1
}
[ -f "$SVG" ] || { echo "Missing $SVG" >&2; exit 1; }

mkdir -p "$OUT"

PNG1="$OUT/background.png"
PNG2="$OUT/background@2x.png"
TIFF="$OUT/background.tiff"

rsvg-convert -w "$W1" -h "$H1" "$SVG" -o "$PNG1"
rsvg-convert -w "$W2" -h "$H2" "$SVG" -o "$PNG2"

# Retina DMG background: 1x page plus a 2x page in one TIFF.
tiffutil -cathidpicheck "$PNG1" "$PNG2" -out "$TIFF"

echo "Wrote $PNG1, $PNG2, $TIFF"
