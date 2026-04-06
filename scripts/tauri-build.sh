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
  msys*|mingw*|cygwin*) 
    PLATFORM="win"
    # Windows architecture detection
    case "$ARCH" in
      x86_64|amd64) NODE_ARCH="x64" ;;
      aarch64|arm64) NODE_ARCH="arm64" ;;
      *) echo "Unsupported Windows arch: $ARCH"; exit 1 ;;
    esac
    ;;
  *)      echo "Unsupported OS: $OS"; exit 1 ;;
esac

case "$PLATFORM" in
  darwin|linux)
    case "$ARCH" in
      arm64|aarch64) NODE_ARCH="arm64" ;;
      x86_64)        NODE_ARCH="x64" ;;
      *)             echo "Unsupported arch: $ARCH"; exit 1 ;;
    esac
    ;;
esac

NODE_DIST="node-${NODE_VERSION}-${PLATFORM}-${NODE_ARCH}"
NODE_TARBALL="${NODE_DIST}.tar.gz"
NODE_URL="https://nodejs.org/dist/${NODE_VERSION}/${NODE_TARBALL}"
NODE_HEADERS_URL="https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-headers.tar.gz"
NODE_CACHE="$ROOT/src-tauri/.node-cache"
BUNDLED_NODE="$RESOURCES/node/node"

echo "==> Platform: $PLATFORM, Arch: $NODE_ARCH"
echo "==> Building TypeScript..."
cd "$ROOT"
npm run build

echo "==> Staging resources for Tauri bundle..."
# Cross-platform cleanup
if [ "$PLATFORM" = "win" ]; then
  # Windows: use rimraf equivalent or just try
  rm -rf "$RESOURCES" 2>/dev/null || true
else
  rm -rf "$RESOURCES"
fi
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

# --- Extract Node.js based on platform ---
echo "==> Extracting Node.js binary..."
mkdir -p "$RESOURCES/node"

if [ "$PLATFORM" = "win" ]; then
  # Windows: download zip instead of tar.gz
  NODE_ZIP="${NODE_DIST}.zip"
  NODE_URL_WIN="https://nodejs.org/dist/${NODE_VERSION}/${NODE_ZIP}"
  
  if [ ! -f "$NODE_CACHE/$NODE_ZIP" ]; then
    echo "==> Downloading Node.js Windows binary..."
    curl -fSL "$NODE_URL_WIN" -o "$NODE_CACHE/$NODE_ZIP"
  fi
  
  # Extract using PowerShell
  powershell -Command "Expand-Archive -Path '$NODE_CACHE/$NODE_ZIP' -DestinationPath '$NODE_CACHE' -Force"
  cp "$NODE_CACHE/$NODE_DIST/node.exe" "$RESOURCES/node/node.exe"
  BUNDLED_NODE="$RESOURCES/node/node.exe"
  echo "    Node binary: $($BUNDLED_NODE --version)"
else
  # macOS/Linux: use tar.gz
  tar -xzf "$NODE_CACHE/$NODE_TARBALL" -C "$NODE_CACHE" --strip-components=1 "${NODE_DIST}/bin/node" 2>/dev/null || true
  if [ -f "$NODE_CACHE/bin/node" ]; then
    cp "$NODE_CACHE/bin/node" "$BUNDLED_NODE"
    chmod +x "$BUNDLED_NODE"
    echo "    Node binary: $("$BUNDLED_NODE" --version)"
  else
    echo "ERROR: Failed to extract Node binary"
    exit 1
  fi
fi

# Extract headers for native addon compilation
echo "==> Extracting Node.js headers..."
rm -rf "$NODE_CACHE/node-headers"
mkdir -p "$NODE_CACHE/node-headers"
tar -xzf "$NODE_CACHE/$HEADERS_TARBALL" -C "$NODE_CACHE/node-headers" --strip-components=1

# --- Copy compiled app ---
if [ "$PLATFORM" = "win" ]; then
  # Windows: use xcopy or cp
  cp -R "$ROOT/dist" "$RESOURCES/dist"
  cp "$ROOT/package.json" "$RESOURCES/package.json"
else
  cp -R "$ROOT/dist" "$RESOURCES/dist"
  cp "$ROOT/package.json" "$RESOURCES/package.json"
fi

# --- Copy web frontend build ---
if [ -d "$ROOT/packages/web/dist" ]; then
  echo "==> Bundling web frontend..."
  mkdir -p "$RESOURCES/packages/web"
  cp -R "$ROOT/packages/web/dist" "$RESOURCES/packages/web/dist"
fi

# --- Bundle .env (use project .env if present, else create empty) ---
if [ -f "$ROOT/.env" ]; then
  echo "==> Bundling .env file..."
  cp "$ROOT/.env" "$RESOURCES/.env"
else
  touch "$RESOURCES/.env"
fi

# --- Install production-only dependencies ---
echo "==> Installing production dependencies..."
cd "$RESOURCES"
npm install --omit=dev --ignore-scripts 2>/dev/null || npm install --omit=dev --ignore-scripts

# Rebuild native addons (skip on Windows for now - better-sqlite3 has prebuilds)
if [ "$PLATFORM" != "win" ]; then
  cd "$RESOURCES/node_modules/better-sqlite3"
  if [ -f "binding.gyp" ]; then
    echo "==> Rebuilding better-sqlite3 for Node ${NODE_VERSION}..."
    npx --yes node-gyp rebuild \
      --target="${NODE_VERSION#v}" \
      --nodedir="$NODE_CACHE/node-headers" \
      2>&1 | tail -5 || { echo "ERROR: node-gyp rebuild failed"; exit 1; }
  fi

  # Verify the native addon loads with the bundled Node
  echo "==> Verifying native addon..."
  "$BUNDLED_NODE" -e "require('$RESOURCES/node_modules/better-sqlite3')" && echo "    better-sqlite3: OK" || { echo "ERROR: better-sqlite3 failed to load"; exit 1; }
else
  echo "==> Skipping native addon rebuild on Windows (using prebuilds)"
fi

echo "==> Staging complete. Resource size:"
if [ "$PLATFORM" = "win" ]; then
  du -sh "$RESOURCES" 2>/dev/null || powershell -Command "(Get-ChildItem '$RESOURCES' -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB"
  du -sh "$BUNDLED_NODE" 2>/dev/null || powershell -Command "(Get-Item '$BUNDLED_NODE').Length / 1MB"
else
  du -sh "$RESOURCES"
  du -sh "$BUNDLED_NODE"
fi
