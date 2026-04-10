#!/bin/bash
# Build and sign Kai for macOS locally
# This must be run on a Mac with Xcode command line tools and a valid Developer ID certificate

set -e

echo "========================================"
echo "Kai macOS Local Build Script"
echo "========================================"
echo ""

# Check prerequisites
if ! command -v cargo &> /dev/null; then
    echo "❌ Rust/Cargo not found. Install from https://rustup.rs"
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Install from https://nodejs.org"
    exit 1
fi

if ! security find-identity -v -p codesigning | grep -q "Developer ID"; then
    echo "❌ No Developer ID certificate found in keychain."
    echo "   You need a 'Developer ID Application' certificate from Apple."
    exit 1
fi

# Get signing identity (use Developer ID, not Apple Development)
IDENTITY=$(security find-identity -v -p codesigning 2>/dev/null | grep "Developer ID Application" | head -1 | sed 's/.*"\([^"]*\)".*/\1/')
echo "✅ Found signing identity: $IDENTITY"
echo ""

# Get version from git tag or use "dev"
VERSION=$(git describe --tags --exact-match 2>/dev/null || echo "dev")
echo "📦 Building version: $VERSION"
echo ""

# Install dependencies
echo "📥 Installing dependencies..."
npm ci

# Install Tauri CLI and required targets
echo "📥 Installing Tauri CLI and targets..."
cargo install tauri-cli --version "^2.0"

# Ensure both ARM64 and Intel targets are installed
echo "📦 Checking Rust targets..."
rustup target add aarch64-apple-darwin 2>/dev/null || true
rustup target add x86_64-apple-darwin 2>/dev/null || true

# Pre-sign node_modules binaries
echo "🔏 Pre-signing node_modules binaries..."
export APPLE_SIGNING_IDENTITY="$IDENTITY"
node scripts/pre-sign-node-modules.cjs

# Build ARM64
echo ""
echo "🔨 Building for Apple Silicon (ARM64)..."
cargo tauri build --target aarch64-apple-darwin

# Sign nested binaries in ARM64 build
echo ""
echo "🔏 Signing nested binaries in ARM64 build..."
ARM64_APP="$PWD/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Kai.app"
node scripts/after-sign.cjs "$ARM64_APP"

# Re-sign the entire ARM64 app (deep sign)
echo ""
echo "🔏 Re-signing ARM64 app bundle..."
codesign --deep --force --options runtime --sign "$IDENTITY" --timestamp "$ARM64_APP"

# Build Intel (optional - requires Rosetta on Apple Silicon)
echo ""
if rustup target list --installed | grep -q "x86_64-apple-darwin"; then
    echo "🔨 Building for Intel (x86_64)..."
    cargo tauri build --target x86_64-apple-darwin || echo "⚠️ Intel build failed (may need Rosetta)"
    
    if [ -d "$PWD/src-tauri/target/x86_64-apple-darwin/release/bundle/macos/Kai.app" ]; then
        # Sign nested binaries in Intel build
        echo ""
        echo "🔏 Signing nested binaries in Intel build..."
        INTEL_APP="$PWD/src-tauri/target/x86_64-apple-darwin/release/bundle/macos/Kai.app"
        node scripts/after-sign.cjs "$INTEL_APP"
        
        # Re-sign the entire Intel app (deep sign)
        echo ""
        echo "🔏 Re-signing Intel app bundle..."
        codesign --deep --force --options runtime --sign "$IDENTITY" --timestamp "$INTEL_APP"
    fi
else
    echo "⚠️ Skipping Intel build (x86_64-apple-darwin target not installed)"
    echo "   To install: rustup target add x86_64-apple-darwin"
fi

# Create DMGs from the signed .app bundles
echo ""
echo "📦 Creating DMGs..."

ARM64_APP="src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Kai.app"
INTEL_APP="src-tauri/target/x86_64-apple-darwin/release/bundle/macos/Kai.app"

if [ -d "$ARM64_APP" ]; then
    echo "  Creating ARM64 DMG..."
    npx create-dmg "$ARM64_APP" src-tauri/target/ --overwrite 2>&1 || true
    # Rename if create-dmg succeeded
    if [ -f "src-tauri/target/Kai ${VERSION}.dmg" ]; then
        mv "src-tauri/target/Kai ${VERSION}.dmg" "src-tauri/target/Kai_${VERSION}_aarch64.dmg"
    fi
fi

if [ -d "$INTEL_APP" ]; then
    echo "  Creating Intel DMG..."
    npx create-dmg "$INTEL_APP" src-tauri/target/ --overwrite 2>&1 || true
    # Rename if create-dmg succeeded
    if [ -f "src-tauri/target/Kai ${VERSION}.dmg" ]; then
        mv "src-tauri/target/Kai ${VERSION}.dmg" "src-tauri/target/Kai_${VERSION}_x86_64.dmg"
    fi
fi

echo ""
echo "========================================"
echo "✅ Build Complete!"
echo "========================================"
echo ""
echo "Artifacts:"
ls -lh src-tauri/target/*.dmg 2>/dev/null || echo "  (No DMG files found)"
echo ""
echo "Next steps:"
echo "1. Test the builds locally"
echo "2. Upload to GitHub release:"
echo "   gh release upload ${VERSION} src-tauri/target/*.dmg"
echo ""
