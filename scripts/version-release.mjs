#!/usr/bin/env node
/**
 * Strip prerelease suffix from all workspace packages for a stable release.
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

// Strip prerelease suffix for stable release
const releaseVersion = rootPkg.version.replace(/-.*$/, "");

// Update all package.json files
for (const relPath of PACKAGE_PATHS) {
  const absPath = path.join(ROOT, relPath);
  const pkg = JSON.parse(fs.readFileSync(absPath, "utf-8"));
  pkg.version = releaseVersion;
  fs.writeFileSync(absPath, JSON.stringify(pkg, null, 2) + "\n");
}

// Update package-lock.json
const lockPath = path.join(ROOT, "package-lock.json");
if (fs.existsSync(lockPath)) {
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf-8"));

  if (lock.packages) {
    for (const [pkgPath, entry] of Object.entries(lock.packages)) {
      if (pkgPath === "" || pkgPath === "." || /^packages\/[^/]+$/.test(pkgPath)) {
        entry.version = releaseVersion;
      }
    }
  }
  if (lock.version) {
    lock.version = releaseVersion;
  }
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
}

// Update Tauri config
const tauriConfPath = path.join(ROOT, "packages/desktop-tauri/src-tauri/tauri.conf.json");
if (fs.existsSync(tauriConfPath)) {
  const conf = JSON.parse(fs.readFileSync(tauriConfPath, "utf-8"));
  conf.version = releaseVersion;
  fs.writeFileSync(tauriConfPath, JSON.stringify(conf, null, 2) + "\n");
}

// Update Cargo.toml
const cargoPath = path.join(ROOT, "packages/desktop-tauri/src-tauri/Cargo.toml");
if (fs.existsSync(cargoPath)) {
  let cargo = fs.readFileSync(cargoPath, "utf-8");
  cargo = cargo.replace(/^(version\s*=\s*)"[^"]*"/m, `$1"${releaseVersion}"`);
  fs.writeFileSync(cargoPath, cargo);
}

console.log(`Release version: ${releaseVersion}`);
