// Cross-platform build script for server
const fs = require('fs');
const path = require('path');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function removeDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function copyDir(src, dest) {
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function copyFiles(srcPattern, destDir) {
  ensureDir(destDir);
  const srcDir = path.dirname(srcPattern);
  const pattern = path.basename(srcPattern);
  if (!fs.existsSync(srcDir)) return;
  
  const entries = fs.readdirSync(srcDir);
  for (const entry of entries) {
    if (entry.match(new RegExp(pattern.replace('*', '.*')))) {
      fs.copyFileSync(path.join(srcDir, entry), path.join(destDir, entry));
    }
  }
}

// Copy workflow files
removeDir('dist/agents-core/builtin-workflows');
ensureDir('dist/agents-core/builtin-workflows');
copyFiles('src/agents-core/builtin-workflows/*.yaml', 'dist/agents-core/builtin-workflows');

// Copy skill builtins
removeDir('dist/skills/builtins');
if (fs.existsSync('src/skills/builtins')) {
  copyDir('src/skills/builtins', 'dist/skills/builtins');
}

// Make index.js executable on Unix
if (process.platform !== 'win32') {
  const indexPath = 'dist/index.js';
  if (fs.existsSync(indexPath)) {
    const stat = fs.statSync(indexPath);
    fs.chmodSync(indexPath, stat.mode | 0o111);
  }
}

console.log('✓ Server post-build complete');
