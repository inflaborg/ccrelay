#!/usr/bin/env bash
# Local signed + notarized macOS build (Electron), matching CI inputs.
# Prerequisites: Developer ID .p12 + Apple notarization credentials in the environment.
set -euo pipefail
cd "$(dirname "$0")/.."

missing=()
[[ -z "${CSC_LINK:-}" ]] && missing+=(CSC_LINK)
[[ -z "${CSC_KEY_PASSWORD:-}" ]] && missing+=(CSC_KEY_PASSWORD)
[[ -z "${APPLE_ID:-}" ]] && missing+=(APPLE_ID)
[[ -z "${APPLE_APP_SPECIFIC_PASSWORD:-}" ]] && missing+=(APPLE_APP_SPECIFIC_PASSWORD)
[[ -z "${APPLE_TEAM_ID:-}" ]] && missing+=(APPLE_TEAM_ID)

if ((${#missing[@]})); then
  echo "pack-mac-signed: missing env: ${missing[*]}" >&2
  echo "Export CSC_LINK (path to .p12 or base64), CSC_KEY_PASSWORD, APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID" >&2
  exit 1
fi

echo "=== Building Electron desktop (signed + notarized) ==="
npm run desktop:build
(
  cd packages/desktop
  export CSC_IDENTITY_AUTO_DISCOVERY=true
  npx electron-builder --mac --publish never
)

echo "Done. For Tauri signed builds, also set APPLE_SIGNING_IDENTITY and run:"
echo "  npm run tauri:build && cd packages/desktop-tauri && npx tauri build"
