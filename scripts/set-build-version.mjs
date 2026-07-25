#!/usr/bin/env node
/**
 * Rewrite package version for channel-specific Electron builds.
 * Updates the monorepo root and packages/desktop so both
 * generate-version.mjs (PACKAGE_VERSION) and app.getVersion() agree.
 *
 * Usage:
 *   node scripts/set-build-version.mjs --version 0.2.9-dev.42
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import semver from "semver";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--version") {
      out.version = argv[++i];
    } else if (a === "--help" || a === "-h") {
      out.help = true;
    }
  }
  return out;
}

function usage() {
  console.error(`Usage: set-build-version.mjs --version <semver>`);
  process.exit(1);
}

function writePackageVersion(filePath, version) {
  const raw = fs.readFileSync(filePath, "utf8");
  const pkg = JSON.parse(raw);
  pkg.version = version;
  fs.writeFileSync(filePath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.version) {
    usage();
  }

  const version = String(args.version).trim();
  if (!semver.valid(version)) {
    console.error(`Invalid semver version: ${version}`);
    process.exit(1);
  }

  const targets = [
    path.join(rootDir, "package.json"),
    path.join(rootDir, "packages/desktop/package.json"),
  ];

  for (const filePath of targets) {
    writePackageVersion(filePath, version);
    console.log(`Updated ${path.relative(rootDir, filePath)} → ${version}`);
  }
}

main();
