#!/usr/bin/env node
/**
 * After Sign Hook for Tauri
 * Signs native binaries in node_modules that aren't covered by Tauri's automatic signing
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const glob = require('glob');

const APP_PATH = process.argv[2]; // Path to .app bundle
const IDENTITY = process.env.APPLE_SIGNING_IDENTITY || process.env.TAURI_SIGNING_IDENTITY;

if (!APP_PATH) {
  console.error('Error: No app path provided');
  process.exit(1);
}

if (!IDENTITY) {
  console.error('Error: No signing identity found in environment');
  process.exit(1);
}

console.log(`Signing additional binaries in ${APP_PATH}`);
console.log(`Using identity: ${IDENTITY}`);

// Find all .node files in the app bundle
const nodeFiles = glob.sync(`${APP_PATH}/Contents/Resources/**/node_modules/**/*.node`, {
  absolute: true
});

// Also find terminal-notifier if it exists
const notifierPath = path.join(APP_PATH, 'Contents/Resources/node_modules/node-notifier/vendor/mac.noindex/terminal-notifier.app');

const filesToSign = [...nodeFiles];
if (fs.existsSync(notifierPath)) {
  filesToSign.push(notifierPath);
}

console.log(`Found ${filesToSign.length} files to sign`);

for (const file of filesToSign) {
  try {
    console.log(`Signing: ${file}`);
    execSync(
      `codesign --force --options runtime --sign "${IDENTITY}" --timestamp "${file}"`,
      { stdio: 'inherit' }
    );
    console.log(`✅ Signed: ${path.basename(file)}`);
  } catch (err) {
    console.error(`❌ Failed to sign ${file}:`, err.message);
    // Continue with other files
  }
}

console.log('After-sign hook completed');
