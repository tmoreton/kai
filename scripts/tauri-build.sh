#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RESOURCES="$ROOT/src-tauri/resources"
NODE_VERSION="v22.16.0"  # LTS

# Detect platform and arch
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
case "$OS" in
  darwin) PLATFORM="darwin" ;;
  linux)  PLATFORM="linux" ;;
  *)      echo "Unsupported OS: $OS"; exit 1 ;;
esac
case "$ARCH" in
  arm64|aarch64) NODE_ARCH="arm64" ;;
  x86_64)        NODE_ARCH="x64" ;;
  *)             echo "Unsupported arch: $ARCH"; exit 1 ;;
esac

NODE_DIST="node-${NODE_VERSION}-${PLATFORM}-${NODE_ARCH}"
NODE_TARBALL="${NODE_DIST}.tar.gz"
NODE_URL="https://nodejs.org/dist/${NODE_VERSION}/${NODE_TARBALL}"
NODE_HEADERS_URL="https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-headers.tar.gz"
NODE_CACHE="$ROOT/src-tauri/.node-cache"
BUNDLED_NODE="$RESOURCES/node/node"

echo "==> Building TypeScript..."
cd "$ROOT"
npm run build

echo "==> Staging resources for Tauri bundle..."
rm -rf "$RESOURCES"
mkdir -p "$RESOURCES"

# --- Download and cache Node.js binary + headers ---
mkdir -p "$NODE_CACHE"
if [ ! -f "$NODE_CACHE/$NODE_TARBALL" ]; then
  echo "==> Downloading Node.js ${NODE_VERSION} (${PLATFORM}-${NODE_ARCH})..."
  curl -fSL "$NODE_URL" -o "$NODE_CACHE/$NODE_TARBALL"
else
  echo "==> Using cached Node.js ${NODE_VERSION}"
fi

HEADERS_TARBALL="node-${NODE_VERSION}-headers.tar.gz"
if [ ! -f "$NODE_CACHE/$HEADERS_TARBALL" ]; then
  echo "==> Downloading Node.js ${NODE_VERSION} headers..."
  curl -fSL "$NODE_HEADERS_URL" -o "$NODE_CACHE/$HEADERS_TARBALL"
else
  echo "==> Using cached Node.js headers"
fi

echo "==> Extracting Node.js binary..."
mkdir -p "$RESOURCES/node"
tar -xzf "$NODE_CACHE/$NODE_TARBALL" -C "$NODE_CACHE" --strip-components=1 "${NODE_DIST}/bin/node" 2>/dev/null || true
cp "$NODE_CACHE/bin/node" "$BUNDLED_NODE"
chmod +x "$BUNDLED_NODE"
echo "    Node binary: $("$BUNDLED_NODE" --version)"

# Extract headers for native addon compilation
echo "==> Extracting Node.js headers..."
rm -rf "$NODE_CACHE/node-headers"
mkdir -p "$NODE_CACHE/node-headers"
tar -xzf "$NODE_CACHE/$HEADERS_TARBALL" -C "$NODE_CACHE/node-headers" --strip-components=1

# --- Copy compiled app ---
cp -R "$ROOT/dist" "$RESOURCES/dist"
cp "$ROOT/package.json" "$RESOURCES/package.json"

# --- Install production-only dependencies ---
echo "==> Installing production dependencies..."
cd "$RESOURCES"
npm install --omit=dev --ignore-scripts 2>/dev/null

# Rebuild native addons using the BUNDLED Node version's headers
cd "$RESOURCES/node_modules/better-sqlite3"
if [ -f "binding.gyp" ]; then
  echo "==> Rebuilding better-sqlite3 for Node ${NODE_VERSION}..."
  npx --yes node-gyp rebuild \
    --target="${NODE_VERSION#v}" \
    --nodedir="$NODE_CACHE/node-headers" \
    2>&1 | tail -5
fi

# Verify the native addon loads with the bundled Node
echo "==> Verifying native addon..."
"$BUNDLED_NODE" -e "require('$RESOURCES/node_modules/better-sqlite3')" && echo "    better-sqlite3: OK" || echo "    better-sqlite3: FAILED"

echo "==> Staging complete. Resource size:"
du -sh "$RESOURCES"
du -sh "$BUNDLED_NODE"
