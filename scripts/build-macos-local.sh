#!/bin/bash
# Build, sign, and notarize Kai for macOS locally
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

# Check notarization credentials
NOTARY_PASSWORD="${APPLE_PASSWORD:-${APPLE_APP_SPECIFIC_PASSWORD:-}}"
if [ -n "$APPLE_ID" ] && [ -n "$NOTARY_PASSWORD" ] && [ -n "$APPLE_TEAM_ID" ]; then
    echo "✅ Notarization credentials found"
    export APPLE_PASSWORD="$NOTARY_PASSWORD"
else
    echo "⚠️  Notarization credentials missing"
    echo "   Set APPLE_ID, APPLE_PASSWORD (or APPLE_APP_SPECIFIC_PASSWORD), and APPLE_TEAM_ID"
    echo "   DMGs will require right-click → Open on first launch"
fi

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

# Build ARM64 — unset APPLE_ID so Tauri doesn't auto-notarize (we do it manually after signing)
echo ""
echo "🔨 Building for Apple Silicon (ARM64)..."
env -u APPLE_ID -u APPLE_TEAM_ID cargo tauri build --target aarch64-apple-darwin

# Sign nested binaries in ARM64 build
echo ""
echo "🔏 Signing nested binaries in ARM64 build..."
ARM64_APP="$PWD/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Kai.app"
node scripts/after-sign.cjs "$ARM64_APP"

# Re-sign the entire ARM64 app (deep sign with entitlements)
echo ""
echo "🔏 Re-signing ARM64 app bundle..."
codesign --deep --force --options runtime --entitlements "$PWD/src-tauri/Entitlements.plist" --sign "$IDENTITY" --timestamp "$ARM64_APP"

# NOTARIZE the ARM64 app
if [ -n "$APPLE_ID" ] && [ -n "$NOTARY_PASSWORD" ] && [ -n "$APPLE_TEAM_ID" ]; then
    echo ""
    echo "🔐 Notarizing ARM64 app..."
    
    # Zip the app for notarization
    ARM64_ZIP="$PWD/src-tauri/target/Kai_${VERSION}_aarch64.zip"
    cd "$(dirname "$ARM64_APP")"
    zip -r "$ARM64_ZIP" Kai.app
    cd -
    
    # Submit for notarization
    echo "  Submitting to Apple..."
    xcrun notarytool submit "$ARM64_ZIP" \
        --apple-id "$APPLE_ID" \
        --password "$NOTARY_PASSWORD" \
        --team-id "$APPLE_TEAM_ID" \
        --wait
    
    # Staple ticket to the .app
    echo ""
    echo "📎 Stapling notarization ticket to app..."
    xcrun stapler staple "$ARM64_APP"
    
    # Re-sign after stapling (with entitlements)
    codesign --deep --force --options runtime --entitlements "$PWD/src-tauri/Entitlements.plist" --sign "$IDENTITY" --timestamp "$ARM64_APP"

    rm "$ARM64_ZIP"
else
    echo "⚠️  Skipping ARM64 app notarization (credentials not set)"
fi

# Build Intel (optional - requires Rosetta on Apple Silicon)
echo ""
if rustup target list --installed | grep -q "x86_64-apple-darwin"; then
    echo "🔨 Building for Intel (x86_64)..."
    env -u APPLE_ID -u APPLE_TEAM_ID cargo tauri build --target x86_64-apple-darwin || echo "⚠️ Intel build failed (may need Rosetta)"
    
    INTEL_APP="$PWD/src-tauri/target/x86_64-apple-darwin/release/bundle/macos/Kai.app"
    if [ -d "$INTEL_APP" ]; then
        # Sign nested binaries in Intel build
        echo ""
        echo "🔏 Signing nested binaries in Intel build..."
        node scripts/after-sign.cjs "$INTEL_APP"
        
        # Re-sign the entire Intel app (deep sign with entitlements)
        echo ""
        echo "🔏 Re-signing Intel app bundle..."
        codesign --deep --force --options runtime --entitlements "$PWD/src-tauri/Entitlements.plist" --sign "$IDENTITY" --timestamp "$INTEL_APP"
        
        # NOTARIZE the Intel app
        if [ -n "$APPLE_ID" ] && [ -n "$NOTARY_PASSWORD" ] && [ -n "$APPLE_TEAM_ID" ]; then
            echo ""
            echo "🔐 Notarizing Intel app..."
            
            # Zip the app for notarization
            INTEL_ZIP="$PWD/src-tauri/target/Kai_${VERSION}_x86_64.zip"
            cd "$(dirname "$INTEL_APP")"
            zip -r "$INTEL_ZIP" Kai.app
            cd -
            
            # Submit for notarization
            echo "  Submitting to Apple..."
            xcrun notarytool submit "$INTEL_ZIP" \
                --apple-id "$APPLE_ID" \
                --password "$NOTARY_PASSWORD" \
                --team-id "$APPLE_TEAM_ID" \
                --wait
            
            # Staple ticket to the .app
            echo ""
            echo "📎 Stapling notarization ticket to app..."
            xcrun stapler staple "$INTEL_APP"
            
            # Re-sign after stapling (with entitlements)
            codesign --deep --force --options runtime --entitlements "$PWD/src-tauri/Entitlements.plist" --sign "$IDENTITY" --timestamp "$INTEL_APP"
            
            rm "$INTEL_ZIP"
        fi
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
    # Rename with underscores (no spaces) for easier CLI usage
    if [ -f "src-tauri/target/Kai ${VERSION}.dmg" ]; then
        mv "src-tauri/target/Kai ${VERSION}.dmg" "src-tauri/target/Kai_${VERSION}_aarch64.dmg"
    fi
fi

if [ -d "$INTEL_APP" ]; then
    echo "  Creating Intel DMG..."
    npx create-dmg "$INTEL_APP" src-tauri/target/ --overwrite 2>&1 || true
    # Rename with underscores (no spaces) for easier CLI usage
    if [ -f "src-tauri/target/Kai ${VERSION}.dmg" ]; then
        mv "src-tauri/target/Kai ${VERSION}.dmg" "src-tauri/target/Kai_${VERSION}_x86_64.dmg"
    fi
fi

echo ""
echo "========================================"
echo "✅ Build & Notarize Complete!"
echo "========================================"
echo ""
echo "Artifacts:"
ls -lh src-tauri/target/*.dmg 2>/dev/null || echo "  (No DMG files found)"
echo ""
echo "Next steps:"
echo "1. Test the builds locally (double-click should open without warning)"
echo "2. Upload to GitHub release:"
echo "   gh release upload ${VERSION} src-tauri/target/*.dmg"
echo ""
