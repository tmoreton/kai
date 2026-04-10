#!/usr/bin/env node
/**
 * After Sign Hook for Tauri
 * Signs native binaries in node_modules that aren't covered by Tauri's automatic signing
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const APP_PATH = process.argv[2]; // Path to .app bundle
const IDENTITY = process.env.APPLE_SIGNING_IDENTITY;

console.log('=== After-Sign Hook Starting ===');
console.log(`App path: ${APP_PATH}`);
console.log(`Identity: ${IDENTITY ? 'Set' : 'NOT SET'}`);

if (!APP_PATH) {
  console.error('Error: No app path provided');
  process.exit(1);
}

if (!IDENTITY) {
  console.error('Error: No signing identity found in environment (APPLE_SIGNING_IDENTITY)');
  process.exit(1);
}

// Recursively find files to sign
function findFiles(dir, pattern) {
  const files = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...findFiles(fullPath, pattern));
      } else if (pattern.test(entry.name)) {
        files.push(fullPath);
      }
    }
  } catch (e) {
    // Directory might not exist or be accessible
  }
  return files;
}

// Find all .node files
const resourcesPath = path.join(APP_PATH, 'Contents/Resources');
console.log(`\nScanning ${resourcesPath} for .node files...`);
const nodeFiles = findFiles(resourcesPath, /\.node$/);
console.log(`Found ${nodeFiles.length} .node files`);

// Find terminal-notifier
const notifierPath = path.join(resourcesPath, 'node_modules/node-notifier/vendor/mac.noindex/terminal-notifier.app');
const filesToSign = [...nodeFiles];
if (fs.existsSync(notifierPath)) {
  console.log(`Found terminal-notifier.app`);
  filesToSign.push(notifierPath);
}

console.log(`\nTotal files to sign: ${filesToSign.length}`);

// Sign each file
let successCount = 0;
let failCount = 0;

for (const file of filesToSign) {
  try {
    console.log(`\nSigning: ${path.relative(APP_PATH, file)}`);
    execSync(
      `codesign --force --options runtime --sign "${IDENTITY}" --timestamp "${file}"`,
      { stdio: 'pipe', encoding: 'utf8' }
    );
    console.log(`✅ Signed successfully`);
    successCount++;
  } catch (err) {
    console.error(`❌ Failed: ${err.stderr || err.message}`);
    failCount++;
  }
}

console.log(`\n=== After-Sign Hook Complete ===`);
console.log(`Signed: ${successCount}, Failed: ${failCount}`);

if (failCount > 0) {
  console.error('ERROR: Some files failed to sign');
  process.exit(1);
}
