#!/usr/bin/env node
/**
 * Unified version bump for the ccrelay monorepo.
 * Modeled after Electron's script/bump-version.js.
 *
 * Usage:
 *   node scripts/bump-version.mjs <major|minor|patch|premajor|preminor|prepatch|prerelease> [--preid <id>] [--allow-dirty]
 *
 * Updates all workspace package.json files and package-lock.json atomically.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import semver from "semver";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");

// ---------- helpers ----------

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
}

// ---------- config ----------

const BUMP_TYPES = ["major", "minor", "patch", "premajor", "preminor", "prepatch", "prerelease"];

const PACKAGE_PATHS = [
  "package.json",
  "packages/core/package.json",
  "packages/vscode/package.json",
  "packages/desktop/package.json",
  "packages/desktop-tauri/package.json",
];

// ---------- parse args ----------

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith("--")));
const positional = args.filter(a => !a.startsWith("--"));

const bumpType = positional[0];
if (!bumpType || !BUMP_TYPES.includes(bumpType)) {
  console.error(`Usage: bump-version.mjs <${BUMP_TYPES.join("|")}> [--preid <id>] [--allow-dirty]`);
  process.exit(1);
}

const allowDirty = flags.has("--allow-dirty");

let preid;
const preidIdx = args.indexOf("--preid");
if (preidIdx !== -1 && args[preidIdx + 1]) {
  preid = args[preidIdx + 1];
}

if (bumpType.startsWith("pre") && !preid) {
  preid = "beta";
}

// ---------- read current version ----------

const rootPkgPath = path.join(ROOT, "package.json");
const rootPkg = readJson(rootPkgPath);
const currentVersion = rootPkg.version;

if (!currentVersion) {
  console.error("No version found in root package.json");
  process.exit(1);
}

// ---------- compute new version ----------

const newVersion = semver.inc(currentVersion, bumpType, preid);
if (!newVersion) {
  console.error(
    `Cannot bump "${currentVersion}" with type "${bumpType}"${preid ? ` (preid: ${preid})` : ""}`
  );
  process.exit(1);
}

// ---------- git dirty check ----------

if (!allowDirty) {
  try {
    const status = execSync("git status --porcelain", {
      cwd: ROOT,
      encoding: "utf-8",
    });
    if (status.trim()) {
      console.error(
        "Git working tree is dirty. Commit or stash changes first, or use --allow-dirty."
      );
      process.exit(1);
    }
  } catch {
    // git not available — skip check
  }
}

// ---------- update package.json files ----------

for (const relPath of PACKAGE_PATHS) {
  const absPath = path.join(ROOT, relPath);
  const pkg = readJson(absPath);
  pkg.version = newVersion;
  writeJson(absPath, pkg);
}

// ---------- update package-lock.json ----------

const lockPath = path.join(ROOT, "package-lock.json");
if (fs.existsSync(lockPath)) {
  const lock = readJson(lockPath);

  // npm lockfile v3: versions live under "packages"
  if (lock.packages) {
    for (const [pkgPath, entry] of Object.entries(lock.packages)) {
      // root: "" or "."
      if (pkgPath === "" || pkgPath === ".") {
        entry.version = newVersion;
        continue;
      }
      // workspace packages: "packages/<name>"
      const match = pkgPath.match(/^packages\/([^/]+)$/);
      if (match) {
        entry.version = newVersion;
      }
    }
  }

  // also update top-level "version" if present
  if (lock.version) {
    lock.version = newVersion;
  }

  writeJson(lockPath, lock);
}

// ---------- update Tauri config ----------

const TAURI_CONF_PATH = "packages/desktop-tauri/src-tauri/tauri.conf.json";
const tauriConfAbs = path.join(ROOT, TAURI_CONF_PATH);
if (fs.existsSync(tauriConfAbs)) {
  const conf = readJson(tauriConfAbs);
  conf.version = newVersion;
  writeJson(tauriConfAbs, conf);
}

// ---------- update Cargo.toml ----------

const CARGO_TOML_PATH = "packages/desktop-tauri/src-tauri/Cargo.toml";
const cargoAbs = path.join(ROOT, CARGO_TOML_PATH);
if (fs.existsSync(cargoAbs)) {
  let cargo = fs.readFileSync(cargoAbs, "utf-8");
  cargo = cargo.replace(/^(version\s*=\s*)"[^"]*"/m, `$1"${newVersion}"`);
  fs.writeFileSync(cargoAbs, cargo);
}

// ---------- done ----------

console.log(`Version bumped: ${currentVersion} → ${newVersion}`);
console.log("Updated files:");
for (const relPath of [...PACKAGE_PATHS, "package-lock.json", TAURI_CONF_PATH, CARGO_TOML_PATH]) {
  console.log(`  ${relPath}`);
}
