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

# Generate build config and extract version
OUTPUT=$(node scripts/build-config.mjs "$ENV")
PACKAGE_VERSION=$(echo "$OUTPUT" | grep "^PACKAGE_VERSION:" | cut -d: -f2)

if [[ -z "$PACKAGE_VERSION" ]]; then
  echo "Failed to extract package version"
  exit 1
fi

echo ""
echo "Packaging with version: $PACKAGE_VERSION"

# Build
npm run build

# Ensure dists directory exists
mkdir -p dists

# Package with dynamic version (without modifying package.json)
npx vsce package "$PACKAGE_VERSION" --no-update-package-json --out dists
