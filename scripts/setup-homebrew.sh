#!/bin/bash
# Setup Homebrew tap for kai-ai
# Run after publishing to npm: ./scripts/setup-homebrew.sh

set -e

VERSION=$(node -p "require('./package.json').version")
PACKAGE_NAME="kai-ai"
TAP_NAME="homebrew-kai"
GITHUB_USER="tmoreton"

# Download the npm package to calculate SHA256
echo "📦 Downloading npm package v${VERSION}..."
curl -sL "https://registry.npmjs.org/${PACKAGE_NAME}/-/${PACKAGE_NAME}-${VERSION}.tgz" -o "/tmp/${PACKAGE_NAME}-${VERSION}.tgz"
SHA256=$(shasum -a 256 "/tmp/${PACKAGE_NAME}-${VERSION}.tgz" | cut -d' ' -f1)
echo "🔐 SHA256: ${SHA256}"

# Update the formula
FORMULA_PATH="homebrew/Formula/${PACKAGE_NAME}.rb"
sed -i '' "s|sha256 \"PLACEHOLDER_SHA256\"|sha256 \"${SHA256}\"|" "${FORMULA_PATH}"
sed -i '' "s|url \"https://registry.npmjs.org/kai-ai/-/kai-ai-.*\.tgz\"|url \"https://registry.npmjs.org/kai-ai/-/kai-ai-${VERSION}.tgz\"|" "${FORMULA_PATH}"

echo "✅ Formula updated at ${FORMULA_PATH}"

# Create or update the tap repo
TAP_DIR="/tmp/${TAP_NAME}"
if [ ! -d "${TAP_DIR}" ]; then
  echo "📁 Creating tap directory..."
  mkdir -p "${TAP_DIR}"
  cd "${TAP_DIR}"
  git init
  git remote add origin "git@github.com:${GITHUB_USER}/${TAP_NAME}.git"
else
  cd "${TAP_DIR}"
fi

# Copy formula
cp "/Users/tmoreton/Code/kai/${FORMULA_PATH}" "${TAP_DIR}/Formula/"

# Commit and push
git add .
git commit -m "Update ${PACKAGE_NAME} to v${VERSION}"

# Only push if remote exists
if git ls-remote origin &>/dev/null; then
  git push origin main || git push origin master
  echo "🚀 Published to homebrew tap!"
  echo ""
  echo "Users can now install with:"
  echo "  brew tap ${GITHUB_USER}/${TAP_NAME}"
  echo "  brew install ${PACKAGE_NAME}"
else
  echo ""
  echo "⚠️  Remote repository not found. Create it on GitHub:"
  echo "  https://github.com/new"
  echo ""
  echo "Repository name: ${TAP_NAME}"
  echo "Then run:"
  echo "  cd ${TAP_DIR}"
  echo "  git push -u origin main"
fi

echo ""
echo "🎉 Setup complete!"
