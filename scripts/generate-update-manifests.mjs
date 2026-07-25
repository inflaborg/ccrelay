#!/usr/bin/env node
/**
 * Build electron-updater manifests (latest.yml, latest-mac.yml) plus latest.json
 * from a flat directory of installers (CI matrix merge).
 *
 * Only Electron desktop artifacts are included:
 *   CCRelay-<version>-darwin-{arch}.{dmg|zip}
 *   CCRelay-<version>-win32-{arch}.exe
 * Tauri artifacts (filename contains "-tauri-") are excluded.
 *
 * Manifest `files[].url` / `path` use absolute GitHub Release download URLs so
 * the rolling channel tags (channel-prod / channel-dev) can host only the
 * small YAML/JSON files while binaries stay on the versioned release.
 *
 * Usage:
 *   node scripts/generate-update-manifests.mjs \
 *     --assets-dir ./release-assets \
 *     --output-dir ./release-metadata \
 *     --version 0.2.9 \
 *     --base-url https://github.com/inflaborg/ccrelay/releases/download/v0.2.9
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ELECTRON_ASSET_RE = /^CCRelay-.+-(darwin|win32)-(x64|arm64)\.(zip|exe|dmg)$/i;

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--assets-dir") out.assetsDir = argv[++i];
    else if (a === "--output-dir") out.outputDir = argv[++i];
    else if (a === "--version") out.version = argv[++i];
    else if (a === "--base-url") out.baseUrl = argv[++i];
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function usage() {
  console.error(`Usage: generate-update-manifests.mjs \\
  --assets-dir <dir> \\
  --output-dir <dir> \\
  --version <semver> \\
  --base-url <release-download-base>`);
  process.exit(1);
}

function sha512Base64(filePath) {
  const hash = crypto.createHash("sha512");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("base64");
}

function yamlEscapeSingleQuoted(s) {
  return String(s).replace(/'/g, "''");
}

/**
 * @param {{ url: string; sha512: string; size: number }[]} files
 * @param {{ version: string; url: string; sha512: string; releaseDate: string }} primary
 */
function buildUpdaterDoc(files, primary) {
  const lines = [`version: '${yamlEscapeSingleQuoted(primary.version)}'`, "files:"];
  for (const f of files) {
    lines.push(`  - url: ${f.url}`);
    lines.push(`    sha512: ${f.sha512}`);
    lines.push(`    size: ${f.size}`);
  }
  lines.push(`path: ${primary.url}`);
  lines.push(`sha512: ${primary.sha512}`);
  lines.push(`releaseDate: '${yamlEscapeSingleQuoted(primary.releaseDate)}'`);
  return `${lines.join("\n")}\n`;
}

/**
 * @param {string} name
 * @returns {{ platform: 'mac'|'win'; arch: 'x64'|'arm64'; kind: 'zip'|'exe'|'dmg' } | null}
 */
export function parseElectronAssetName(name) {
  if (name.includes("-tauri-")) {
    return null;
  }
  const match = ELECTRON_ASSET_RE.exec(name);
  if (!match) {
    return null;
  }
  const platform = match[1].toLowerCase() === "darwin" ? "mac" : "win";
  /** @type {'x64'|'arm64'} */
  const arch = match[2].toLowerCase() === "arm64" ? "arm64" : "x64";
  /** @type {'zip'|'exe'|'dmg'} */
  const kind = /** @type {'zip'|'exe'|'dmg'} */ (match[3].toLowerCase());
  return { platform, arch, kind };
}

/**
 * Prefer preferredArch first; keep stable relative order otherwise.
 * @param {'x64'|'arm64'} preferredArch
 * @returns {(a: { arch: string }, b: { arch: string }) => number}
 */
function archPrefer(preferredArch) {
  return (a, b) => {
    if (a.arch === preferredArch && b.arch !== preferredArch) {
      return -1;
    }
    if (b.arch === preferredArch && a.arch !== preferredArch) {
      return 1;
    }
    return 0;
  };
}

/**
 * @param {{
 *   assetsDir: string;
 *   outputDir: string;
 *   version: string;
 *   baseUrl: string;
 * }} opts
 * @returns {string[]} written filenames
 */
export function generateUpdateManifests(opts) {
  const baseUrl = opts.baseUrl.replace(/\/$/, "");
  const assetsDir = path.resolve(opts.assetsDir);
  const outputDir = path.resolve(opts.outputDir);
  const version = opts.version;

  if (!fs.existsSync(assetsDir)) {
    throw new Error(`assets-dir not found: ${assetsDir}`);
  }

  const names = fs.readdirSync(assetsDir);
  const releaseDate = new Date().toISOString();

  /** @type {{ name: string; platform: 'mac'|'win'; arch: 'x64'|'arm64'; kind: 'zip'|'exe'|'dmg'; size: number; sha512: string; url: string }[]} */
  const installers = [];

  for (const name of names) {
    const parsed = parseElectronAssetName(name);
    if (!parsed) {
      continue;
    }
    const full = path.join(assetsDir, name);
    if (!fs.statSync(full).isFile()) {
      continue;
    }
    const stat = fs.statSync(full);
    const sha512 = sha512Base64(full);
    const url = `${baseUrl}/${encodeURIComponent(name)}`;
    installers.push({
      name,
      platform: parsed.platform,
      arch: parsed.arch,
      kind: parsed.kind,
      size: stat.size,
      sha512,
      url,
    });
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const written = [];

  const winFiles = installers.filter(i => i.kind === "exe").sort(archPrefer("x64"));
  const macZips = installers.filter(i => i.kind === "zip").sort(archPrefer("arm64"));

  // latest.json: human downloadables only (dmg / exe), not updater zip.
  /** @type {Record<string, { url: string; size: number; sha512: string }>} */
  const assets = {};
  for (const ins of installers) {
    if (ins.kind === "zip") {
      continue;
    }
    const key = `${ins.platform}-${ins.arch}`;
    assets[key] = {
      url: ins.url,
      size: ins.size,
      sha512: ins.sha512,
    };
  }

  if (Object.keys(assets).length > 0 || winFiles.length > 0 || macZips.length > 0) {
    const doc = {
      version,
      date: releaseDate,
      assets,
    };
    fs.writeFileSync(
      path.join(outputDir, "latest.json"),
      `${JSON.stringify(doc, null, 2)}\n`,
      "utf8"
    );
    written.push("latest.json");
  }

  if (winFiles.length > 0) {
    const winPrimary = winFiles[0];
    fs.writeFileSync(
      path.join(outputDir, "latest.yml"),
      buildUpdaterDoc(
        winFiles.map(x => ({ url: x.url, sha512: x.sha512, size: x.size })),
        {
          version,
          url: winPrimary.url,
          sha512: winPrimary.sha512,
          releaseDate,
        }
      ),
      "utf8"
    );
    written.push("latest.yml");
  }

  if (macZips.length > 0) {
    const macPrimary = macZips[0];
    fs.writeFileSync(
      path.join(outputDir, "latest-mac.yml"),
      buildUpdaterDoc(
        macZips.map(x => ({ url: x.url, sha512: x.sha512, size: x.size })),
        {
          version,
          url: macPrimary.url,
          sha512: macPrimary.sha512,
          releaseDate,
        }
      ),
      "utf8"
    );
    written.push("latest-mac.yml");
  }

  return written;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.assetsDir || !args.outputDir || !args.version || !args.baseUrl) {
    usage();
  }

  const written = generateUpdateManifests({
    assetsDir: args.assetsDir,
    outputDir: args.outputDir,
    version: args.version,
    baseUrl: args.baseUrl,
  });

  if (written.length === 0) {
    console.log("No Electron desktop installers found — skipped manifest generation");
    return;
  }

  console.log(`Wrote ${written.join(", ")} -> ${path.resolve(args.outputDir)}`);
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) {
  main();
}
