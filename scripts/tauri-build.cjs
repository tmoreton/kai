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
  
  // Sign the Node.js binary with Developer ID before bundling
  // This is required for notarization - embedded binaries must be signed
  if (PLATFORM === 'darwin') {
    const bundledNode = path.join(RESOURCES, 'node', 'node');
    const identity = 'Developer ID Application: Tim Moreton (GVXC5FQ2RP)';
    console.log('==> Signing Node.js binary with Developer ID...');
    try {
      // Strip any existing signature first
      try {
        execSync(`codesign --remove-signature "${bundledNode}"`, { stdio: 'ignore' });
      } catch (e) {
        // May not be signed yet, that's ok
      }
      // Sign with hardened runtime and secure timestamp (required for notarization)
      execSync(`codesign --force --options runtime --sign "${identity}" --timestamp "${bundledNode}"`, { stdio: 'inherit' });
      console.log('    ✓ Node.js binary signed successfully');
    } catch (e) {
      console.error('    ✗ Failed to sign Node.js binary:', e.message);
      process.exit(1);
    }
  }
  
  console.log('==> Build script complete!');
}

main().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
