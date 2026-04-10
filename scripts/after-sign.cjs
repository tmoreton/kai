#!/usr/bin/env node
/**
 * Sign all nested binaries inside the .app bundle after Tauri codesigns the main app.
 * Apple requires ALL Mach-O binaries in the bundle to be signed for notarization.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const appPath = process.argv[2];
if (!appPath) {
  console.error('Usage: node after-sign.js <path-to-.app>');
  process.exit(1);
}

const IDENTITY = process.env.APPLE_SIGNING_IDENTITY || 'Developer ID Application: Tim Moreton (GVXC5FQ2RP)';

function findBinaries(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findBinaries(fullPath));
    } else {
      // Check if it's a Mach-O binary or .node file
      if (entry.name.endsWith('.node') || entry.name.endsWith('.dylib')) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

function signFile(filePath) {
  const relativePath = path.relative(appPath, filePath);
  console.log(`  Signing: ${relativePath}`);
  try {
    // Use --deep and --strict for proper signing
    const cmd = `codesign --deep --force --strict --options runtime --sign "${IDENTITY}" --timestamp "${filePath}"`;
    execSync(cmd, { stdio: 'pipe' });
    return true;
  } catch (e) {
    console.error(`    ❌ Failed: ${e.message}`);
    return false;
  }
}

console.log('='.repeat(60));
console.log('Signing nested binaries in app bundle...');
console.log(`App: ${appPath}`);
console.log(`Identity: ${IDENTITY}`);
console.log('='.repeat(60));

const nodeModulesPath = path.join(appPath, 'Contents', 'Resources', 'node_modules');
if (!fs.existsSync(nodeModulesPath)) {
  console.log('No node_modules in bundle, nothing to sign.');
  process.exit(0);
}

const binaries = findBinaries(nodeModulesPath);
console.log(`\nFound ${binaries.length} binaries to sign\n`);

let success = 0;
let failed = 0;

for (const file of binaries) {
  if (signFile(file)) {
    success++;
  } else {
    failed++;
  }
}

console.log('\n' + '='.repeat(60));
console.log(`Results: ${success} signed, ${failed} failed`);
console.log('='.repeat(60));

if (failed > 0) {
  process.exit(1);
}
