#!/usr/bin/env node
/**
 * Pre-build script: Sign all native binaries in node_modules BEFORE Tauri packages them
 * This way they're already signed when copied into the app bundle
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const NODE_MODULES = path.join(__dirname, '..', 'node_modules');
const IDENTITY = process.env.APPLE_SIGNING_IDENTITY || 'Developer ID Application: Tim Moreton (Q82WC4546X)';

function findBinaries(dir, patterns) {
  const results = [];

  function walk(currentDir) {
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (e) {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        // Skip certain directories
        if (entry.name === '.bin' || entry.name === 'node_modules') continue;
        walk(fullPath);
      } else {
        for (const pattern of patterns) {
          if (pattern.test(entry.name)) {
            results.push(fullPath);
            break;
          }
        }
      }
    }
  }

  walk(dir);
  return results;
}

function signFile(filePath) {
  console.log(`  Signing: ${path.relative(NODE_MODULES, filePath)}`);
  try {
    // Deep sign (for .app bundles) or regular sign
    const isApp = filePath.endsWith('.app');
    const cmd = isApp
      ? `codesign --deep --force --options runtime --sign "${IDENTITY}" --timestamp "${filePath}"`
      : `codesign --force --options runtime --sign "${IDENTITY}" --timestamp "${filePath}"`;

    execSync(cmd, { stdio: 'inherit' });
    return true;
  } catch (e) {
    console.error(`  FAILED: ${e.message}`);
    return false;
  }
}

function verifySigned(filePath) {
  try {
    execSync(`codesign -v "${filePath}"`, { stdio: 'pipe' });
    return true;
  } catch (e) {
    return false;
  }
}

console.log('='.repeat(60));
console.log('Pre-signing node_modules binaries...');
console.log(`Identity: ${IDENTITY}`);
console.log('='.repeat(60));

// Find all binaries to sign
const patterns = [
  /\.node$/,           // Node native addons
  /\.dylib$/,          // Dynamic libraries
  /\.framework\/.*$/,  // Frameworks
  /\.app$/             // Embedded apps
];

const files = findBinaries(NODE_MODULES, patterns);
console.log(`\nFound ${files.length} binaries to sign\n`);

let success = 0;
let failed = 0;
let alreadySigned = 0;

for (const file of files) {
  if (verifySigned(file)) {
    alreadySigned++;
    console.log(`  ✓ Already signed: ${path.relative(NODE_MODULES, file)}`);
    continue;
  }

  if (signFile(file)) {
    success++;
  } else {
    failed++;
  }
}

console.log('\n' + '='.repeat(60));
console.log('Pre-sign complete:');
console.log(`  Already signed: ${alreadySigned}`);
console.log(`  Newly signed: ${success}`);
console.log(`  Failed: ${failed}`);
console.log('='.repeat(60));

if (failed > 0) {
  process.exit(1);
}
