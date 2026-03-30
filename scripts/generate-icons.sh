#!/usr/bin/env bash
set -euo pipefail

# Generate Tauri app icons from the Kai SVG logo
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ICONS="$ROOT/src-tauri/icons"
TMP="$ROOT/src-tauri/.icon-tmp"

mkdir -p "$TMP" "$ICONS"

# The Kai logo SVG — teal gradient with white K mark
cat > "$TMP/icon.svg" << 'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0D9488"/>
      <stop offset="100%" stop-color="#115E59"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="200" fill="url(#g)"/>
  <path d="M320 192v640M320 512l256-256M320 512l256 256"
        stroke="white" stroke-width="72" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>
SVG

echo "==> Generating PNG from SVG..."
rsvg-convert -w 1024 -h 1024 "$TMP/icon.svg" -o "$TMP/icon-1024.png"

echo "==> Generating icon sizes..."
# Tauri required sizes
for SIZE in 32 128 256; do
  sips -z $SIZE $SIZE "$TMP/icon-1024.png" --out "$ICONS/${SIZE}x${SIZE}.png" >/dev/null 2>&1
  echo "    ${SIZE}x${SIZE}.png"
done

# 128x128@2x is actually 256x256
cp "$ICONS/256x256.png" "$ICONS/128x128@2x.png"
echo "    128x128@2x.png"

# Generate .icns for macOS
echo "==> Generating .icns..."
ICONSET="$TMP/icon.iconset"
mkdir -p "$ICONSET"
sips -z 16 16     "$TMP/icon-1024.png" --out "$ICONSET/icon_16x16.png" >/dev/null 2>&1
sips -z 32 32     "$TMP/icon-1024.png" --out "$ICONSET/icon_16x16@2x.png" >/dev/null 2>&1
sips -z 32 32     "$TMP/icon-1024.png" --out "$ICONSET/icon_32x32.png" >/dev/null 2>&1
sips -z 64 64     "$TMP/icon-1024.png" --out "$ICONSET/icon_32x32@2x.png" >/dev/null 2>&1
sips -z 128 128   "$TMP/icon-1024.png" --out "$ICONSET/icon_128x128.png" >/dev/null 2>&1
sips -z 256 256   "$TMP/icon-1024.png" --out "$ICONSET/icon_128x128@2x.png" >/dev/null 2>&1
sips -z 256 256   "$TMP/icon-1024.png" --out "$ICONSET/icon_256x256.png" >/dev/null 2>&1
sips -z 512 512   "$TMP/icon-1024.png" --out "$ICONSET/icon_256x256@2x.png" >/dev/null 2>&1
sips -z 512 512   "$TMP/icon-1024.png" --out "$ICONSET/icon_512x512.png" >/dev/null 2>&1
cp "$TMP/icon-1024.png"                       "$ICONSET/icon_512x512@2x.png"
iconutil -c icns "$ICONSET" -o "$ICONS/icon.icns"
echo "    icon.icns"

# Generate .ico for Windows (using sips for the PNGs, then bundling)
echo "==> Generating .ico..."
sips -z 256 256 "$TMP/icon-1024.png" --out "$ICONS/icon.ico" >/dev/null 2>&1
echo "    icon.ico (256x256 png)"

# Cleanup
rm -rf "$TMP"

echo "==> Icons generated in $ICONS"
ls -la "$ICONS"
