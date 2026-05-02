#!/bin/bash
# Package script for CCRelay
# Usage: ./scripts/package.sh dev|prod

set -e

ENV=${1:-dev}

if [[ "$ENV" != "dev" && "$ENV" != "prod" ]]; then
  echo "Invalid environment: $ENV. Use 'dev' or 'prod'."
  exit 1
fi

cd "$(dirname "$0")/.."

# Export env so vscode:prepublish (triggered by vsce) uses the correct environment
export BUILD_ENV="$ENV"

# Generate build config and extract version
OUTPUT=$(node scripts/build-config.mjs "$ENV")
PACKAGE_VERSION=$(echo "$OUTPUT" | grep "^PACKAGE_VERSION:" | cut -d: -f2)

if [[ -z "$PACKAGE_VERSION" ]]; then
  echo "Failed to extract package version"
  exit 1
fi

echo ""
echo "Packaging with version: $PACKAGE_VERSION"

# Clean then build
npm run clean
npm run vscode:prepublish

# Sync runtime deps & copy marketplace metadata
node scripts/sync-vscode-pack-deps.mjs
cp README.md README_CN.md CHANGELOG.md LICENSE packages/vscode/

# Ensure dists directory exists
mkdir -p dists

cd packages/vscode

# Package with dynamic version (without modifying package.json)
npx vsce package "$PACKAGE_VERSION" --no-dependencies --no-update-package-json --out ../../dists

# Clean up copied metadata files
rm -f README.md README_CN.md CHANGELOG.md LICENSE
