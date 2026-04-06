# GitHub Actions CI/CD Setup

This directory contains GitHub Actions workflows for building and deploying Kai.

## Workflows

### 1. `build-tauri.yml` - Build & Release
**Triggers:**
- Push to `main` branch (builds artifacts, no release)
- Push tags `v*` (creates GitHub Release + deploys download page)
- Pull requests to `main`
- Manual trigger (`workflow_dispatch`)

**Jobs:**
- **build-macos**: Builds for Apple Silicon (aarch64) and Intel (x86_64)
- **build-linux**: Builds AppImage and .deb packages
- **build-windows**: Builds MSI and NSIS (.exe) installers
- **release**: Creates GitHub Release with all artifacts (only on tags)
- **deploy-download-page**: Deploys a download page to GitHub Pages (only on tags)

### 2. `deploy-landing.yml` - Landing Page
**Triggers:**
- Changes to `landing-page/` directory
- Manual trigger

**Deploys:** The static landing page to GitHub Pages

## Setup Instructions

### 1. Enable GitHub Pages
1. Go to **Settings > Pages** in your repo
2. Source: **GitHub Actions**

### 2. Required Secrets (if code signing)
For macOS notarization (optional, skip for now):
- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_ID`
- `APPLE_PASSWORD`
- `APPLE_TEAM_ID`

### 3. Creating a Release
```bash
# Tag and push to trigger release
git tag v1.0.0
git push origin v1.0.0
```

This will:
1. Build all platforms
2. Create GitHub Release with artifacts
3. Deploy download page to `https://tmoreton.github.io/kai/`

## Download URLs

After release, downloads are available at:
- **Landing Page**: `https://tmoreton.github.io/kai/`
- **Latest Release**: `https://github.com/tmoreton/kai/releases/latest`

Direct links (replace `v1.0.0` with actual version):
- Mac (Apple Silicon): `https://github.com/tmoreton/kai/releases/download/v1.0.0/Kai_v1.0.0_aarch64.dmg`
- Mac (Intel): `https://github.com/tmoreton/kai/releases/download/v1.0.0/Kai_v1.0.0_x86_64.dmg`
- Linux: `https://github.com/tmoreton/kai/releases/download/v1.0.0/Kai_v1.0.0_amd64.AppImage`
- Windows: `https://github.com/tmoreton/kai/releases/download/v1.0.0/Kai_v1.0.0_x64-setup.exe`
