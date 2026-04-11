#!/usr/bin/env node
/**
 * Cross-platform Tauri build script
 * Works on macOS, Linux, and Windows
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { pipeline } = require('stream/promises');

const ROOT = path.resolve(__dirname, '..');
const RESOURCES = path.join(ROOT, 'src-tauri', 'resources');
const NODE_CACHE = path.join(ROOT, 'src-tauri', '.node-cache');
const NODE_VERSION = 'v24.5.0';  // Match system Node.js version

const PLATFORM = process.platform === 'win32' ? 'win' : 
                 process.platform === 'darwin' ? 'darwin' : 'linux';
const ARCH = process.arch === 'arm64' ? 'arm64' : 'x64';

const NODE_ARCH = ARCH === 'arm64' && PLATFORM === 'win' ? 'arm64' : 
                  ARCH === 'arm64' ? 'arm64' : 'x64';

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        https.get(response.headers.location, (res) => {
          pipeline(res, file).then(resolve).catch(reject);
        }).on('error', reject);
      } else {
        pipeline(response, file).then(resolve).catch(reject);
      }
    }).on('error', reject);
  });
}

async function main() {
  console.log(`==> Platform: ${PLATFORM}, Arch: ${NODE_ARCH}`);
  
  // Build TypeScript
  console.log('==> Building TypeScript...');
  execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
  
  // Clean and create resources directory
  console.log('==> Staging resources for Tauri bundle...');
  if (fs.existsSync(RESOURCES)) {
    fs.rmSync(RESOURCES, { recursive: true, force: true });
  }
  fs.mkdirSync(RESOURCES, { recursive: true });
  fs.mkdirSync(path.join(RESOURCES, 'node'), { recursive: true });
  
  // Download and cache Node.js
  fs.mkdirSync(NODE_CACHE, { recursive: true });
  
  const NODE_DIST = `node-${NODE_VERSION}-${PLATFORM}-${NODE_ARCH}`;
  const isWindows = PLATFORM === 'win';
  const NODE_ARCHIVE = isWindows ? `${NODE_DIST}.zip` : `${NODE_DIST}.tar.gz`;
  const NODE_URL = `https://nodejs.org/dist/${NODE_VERSION}/${NODE_ARCHIVE}`;
  const NODE_ARCHIVE_PATH = path.join(NODE_CACHE, NODE_ARCHIVE);
  
  if (!fs.existsSync(NODE_ARCHIVE_PATH)) {
    console.log(`==> Downloading Node.js ${NODE_VERSION}...`);
    await downloadFile(NODE_URL, NODE_ARCHIVE_PATH);
  } else {
    console.log(`==> Using cached Node.js ${NODE_VERSION}`);
  }
  
  // Extract Node.js
  console.log('==> Extracting Node.js binary...');
  if (isWindows) {
    // Use PowerShell to extract on Windows
    execSync(`powershell -Command "Expand-Archive -Path '${NODE_ARCHIVE_PATH}' -DestinationPath '${NODE_CACHE}' -Force"`);
    const nodeExe = path.join(NODE_CACHE, NODE_DIST, 'node.exe');
    fs.copyFileSync(nodeExe, path.join(RESOURCES, 'node', 'node.exe'));
    const BUNDLED_NODE = path.join(RESOURCES, 'node', 'node.exe');
    const version = execSync(`"${BUNDLED_NODE}" --version`).toString().trim();
    console.log(`    Node binary: ${version}`);
  } else {
    // Use tar on Unix
    execSync(`tar -xzf "${NODE_ARCHIVE_PATH}" -C "${NODE_CACHE}" --strip-components=1 "${NODE_DIST}/bin/node"`, { stdio: 'ignore' });
    const nodeBin = path.join(NODE_CACHE, 'bin', 'node');
    if (fs.existsSync(nodeBin)) {
      fs.copyFileSync(nodeBin, path.join(RESOURCES, 'node', 'node'));
      fs.chmodSync(path.join(RESOURCES, 'node', 'node'), 0o755);
      const BUNDLED_NODE = path.join(RESOURCES, 'node', 'node');
      const version = execSync(`"${BUNDLED_NODE}" --version`).toString().trim();
      console.log(`    Node binary: ${version}`);
    } else {
      console.error('ERROR: Failed to extract Node binary');
      process.exit(1);
    }
  }
  
  // Copy compiled app
  console.log('==> Copying compiled app...');
  fs.cpSync(path.join(ROOT, 'dist'), path.join(RESOURCES, 'dist'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(RESOURCES, 'package.json'));
  
  // Copy web frontend build
  const webDist = path.join(ROOT, 'packages', 'web', 'dist');
  if (fs.existsSync(webDist)) {
    console.log('==> Bundling web frontend...');
    fs.mkdirSync(path.join(RESOURCES, 'packages', 'web'), { recursive: true });
    fs.cpSync(webDist, path.join(RESOURCES, 'packages', 'web', 'dist'), { recursive: true });
  }
  
  // NOTE: Not bundling .env file - credentials should be in ~/.kai/.env only
  
  // Install production dependencies
  console.log('==> Installing production dependencies...');
  execSync('npm install --omit=dev --ignore-scripts', { cwd: RESOURCES, stdio: 'inherit' });
  
  // Copy pre-compiled better-sqlite3 native binary (can't compile without headers)
  console.log('==> Copying better-sqlite3 native binary...');
  const systemSqlite = path.join(ROOT, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
  const bundledSqliteDir = path.join(RESOURCES, 'node_modules', 'better-sqlite3', 'build', 'Release');
  const bundledSqlite = path.join(bundledSqliteDir, 'better_sqlite3.node');
  if (fs.existsSync(systemSqlite)) {
    fs.mkdirSync(bundledSqliteDir, { recursive: true });
    fs.copyFileSync(systemSqlite, bundledSqlite);
    console.log('    Copied better_sqlite3.node');
  } else {
    console.error('    ERROR: System better_sqlite3.node not found. Run `npm install` in project root first.');
    process.exit(1);
  }
  
  // Remove problematic packages that cause signing issues
  console.log('==> Removing dev-only packages...');
  const packagesToRemove = [
    'node-notifier',
    '@types/node-notifier'
  ];
  for (const pkg of packagesToRemove) {
    const pkgPath = path.join(RESOURCES, 'node_modules', pkg);
    if (fs.existsSync(pkgPath)) {
      console.log(`    Removing ${pkg}...`);
      fs.rmSync(pkgPath, { recursive: true, force: true });
    }
  }
  
  // Sign the Node.js binary with Developer ID + JIT entitlements before bundling
  const identity = 'Developer ID Application: Tim Moreton (GVXC5FQ2RP)';
  const nodeEntitlements = path.join(ROOT, 'src-tauri', 'NodeEntitlements.plist');
  
  if (PLATFORM === 'darwin') {
    const bundledNode = path.join(RESOURCES, 'node', 'node');
    console.log('==> Signing Node.js binary with Developer ID + JIT entitlements...');
    try {
      try {
        execSync(`codesign --remove-signature "${bundledNode}"`, { stdio: 'ignore' });
      } catch (e) {}
      execSync(`codesign --force --options runtime --entitlements "${nodeEntitlements}" --sign "${identity}" --timestamp "${bundledNode}"`, { stdio: 'inherit' });
      console.log('    ✓ Node.js binary signed with JIT entitlements');
    } catch (e) {
      console.error('    ✗ Failed to sign Node.js binary:', e.message);
      process.exit(1);
    }
    
    // Sign native .node binaries in node_modules (better-sqlite3, etc.)
    console.log('==> Signing native .node binaries in node_modules...');
    const nativeBinaries = [
      path.join(RESOURCES, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'),
    ];
    for (const binary of nativeBinaries) {
      if (fs.existsSync(binary)) {
        try {
          execSync(`codesign --force --options runtime --sign "${identity}" --timestamp "${binary}"`, { stdio: 'ignore' });
          console.log(`    ✓ Signed ${path.basename(binary)}`);
        } catch (e) {
          console.log(`    ⚠ Could not sign ${path.basename(binary)}`);
        }
      }
    }
  }
  
  console.log('==> Build script complete!');
}

main().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
