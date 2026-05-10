#!/usr/bin/env node
/**
 * Set a beta prerelease version across all workspace packages.
 * Format: X.Y.Z-beta.<unix_timestamp>
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");

const PACKAGE_PATHS = [
  "package.json",
  "packages/core/package.json",
  "packages/vscode/package.json",
  "packages/desktop/package.json",
  "packages/desktop-tauri/package.json",
];

// Read current version from root (source of truth)
const rootPkgPath = path.join(ROOT, "package.json");
const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf-8"));

// Remove existing prerelease suffix and add new beta tag
const baseVersion = rootPkg.version.replace(/-.*$/, "");
const betaVersion = `${baseVersion}-beta.${Math.floor(Date.now() / 1000)}`;

// Update all package.json files
for (const relPath of PACKAGE_PATHS) {
  const absPath = path.join(ROOT, relPath);
  const pkg = JSON.parse(fs.readFileSync(absPath, "utf-8"));
  pkg.version = betaVersion;
  fs.writeFileSync(absPath, JSON.stringify(pkg, null, 2) + "\n");
}

// Update package-lock.json
const lockPath = path.join(ROOT, "package-lock.json");
if (fs.existsSync(lockPath)) {
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf-8"));

  if (lock.packages) {
    for (const [pkgPath, entry] of Object.entries(lock.packages)) {
      if (pkgPath === "" || pkgPath === "." || /^packages\/[^/]+$/.test(pkgPath)) {
        entry.version = betaVersion;
      }
    }
  }
  if (lock.version) {
    lock.version = betaVersion;
  }
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
}

console.log(`Beta version: ${betaVersion}`);
