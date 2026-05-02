#!/usr/bin/env node
/**
 * Copy hoisted native/runtime deps into packages/vscode/out/node_modules so
 * `vsce package` includes them (out/ is whitelisted in .vscodeignore).
 *
 * Node.js module resolution from out/dist/extension.cjs walks up to
 * out/node_modules/, so require('pg') resolves correctly at runtime.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const srcRoot = path.join(rootDir, "node_modules");
const destRoot = path.join(rootDir, "packages/vscode/out/node_modules");

/** Keep in sync with scripts/esbuild.config.mjs `external` (minus `vscode`). */
const PACKAGES = [
  "pg",
  "pg-cloudflare",
  "pg-connection-string",
  "pg-int8",
  "pg-pool",
  "pg-protocol",
  "pg-types",
  "pgpass",
  "postgres-array",
  "postgres-bytea",
  "postgres-date",
  "postgres-interval",
  "split2",
  "xtend",
];

fs.mkdirSync(destRoot, { recursive: true });

for (const name of PACKAGES) {
  const src = path.join(srcRoot, name);
  const dest = path.join(destRoot, name);
  if (!fs.existsSync(src)) {
    console.warn(`[sync-vscode-pack-deps] Missing ${name} in root node_modules`);
    continue;
  }
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
}

console.log("[sync-vscode-pack-deps] Copied pg runtime tree → packages/vscode/out/node_modules");
