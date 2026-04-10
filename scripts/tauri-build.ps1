#!/usr/bin/env powershell
# Tauri build script for Windows

$ErrorActionPreference = "Stop"

$ROOT = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$RESOURCES = Join-Path $ROOT "src-tauri\resources"
$NODE_VERSION = "v22.16.0"
$NODE_DIST = "node-$NODE_VERSION-win-x64"
$NODE_ZIP = "$NODE_DIST.zip"
$NODE_URL = "https://nodejs.org/dist/$NODE_VERSION/$NODE_ZIP"
$NODE_CACHE = Join-Path $ROOT "src-tauri\.node-cache"

Write-Host "==> Platform: Windows, Arch: x64"
Write-Host "==> Building TypeScript..."
Set-Location $ROOT
npm run build

# Clean and create resources directory
Write-Host "==> Staging resources for Tauri bundle..."
if (Test-Path $RESOURCES) {
    Remove-Item -Recurse -Force $RESOURCES
}
New-Item -ItemType Directory -Path $RESOURCES | Out-Null
New-Item -ItemType Directory -Path "$RESOURCES\node" | Out-Null

# Download and cache Node.js
New-Item -ItemType Directory -Path $NODE_CACHE -Force | Out-Null

$NODE_ZIP_PATH = Join-Path $NODE_CACHE $NODE_ZIP
if (-not (Test-Path $NODE_ZIP_PATH)) {
    Write-Host "==> Downloading Node.js ${NODE_VERSION}..."
    Invoke-WebRequest -Uri $NODE_URL -OutFile $NODE_ZIP_PATH
} else {
    Write-Host "==> Using cached Node.js ${NODE_VERSION}"
}

# Extract Node.js
Write-Host "==> Extracting Node.js binary..."
Expand-Archive -Path $NODE_ZIP_PATH -DestinationPath $NODE_CACHE -Force
Copy-Item -Path "$NODE_CACHE\$NODE_DIST\node.exe" -Destination "$RESOURCES\node\node.exe"
$BUNDLED_NODE = "$RESOURCES\node\node.exe"
$NODE_VERSION_OUTPUT = & $BUNDLED_NODE --version
Write-Host "    Node binary: $NODE_VERSION_OUTPUT"

# Copy compiled app
Write-Host "==> Copying compiled app..."
Copy-Item -Recurse -Path "$ROOT\dist" -Destination "$RESOURCES\dist"
Copy-Item -Path "$ROOT\package.json" -Destination "$RESOURCES\package.json"

# Copy web frontend build
if (Test-Path "$ROOT\packages\web\dist") {
    Write-Host "==> Bundling web frontend..."
    New-Item -ItemType Directory -Path "$RESOURCES\packages\web" -Force | Out-Null
    Copy-Item -Recurse -Path "$ROOT\packages\web\dist" -Destination "$RESOURCES\packages\web\dist"
}

# Bundle .env
if (Test-Path "$ROOT\.env") {
    Write-Host "==> Bundling .env file..."
    Copy-Item -Path "$ROOT\.env" -Destination "$RESOURCES\.env"
} else {
    New-Item -ItemType File -Path "$RESOURCES\.env" | Out-Null
}

# Install production dependencies
Write-Host "==> Installing production dependencies..."
Set-Location $RESOURCES
npm install --omit=dev --ignore-scripts

# For better-sqlite3 on Windows, use prebuilds (skip rebuild)
Write-Host "==> Skipping native addon rebuild (using prebuilds for Windows)"

Write-Host "==> Build script complete!"
