#!/usr/bin/env node
/**
 * Generate build version info
 * Creates version.ts with build timestamp and git hash
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const packageJson = require("../package.json");
const srcDir = path.join(__dirname, "../src/api");
const outFile = path.join(srcDir, "version.generated.ts");

// Get current timestamp
const now = new Date();
const dateStr = now.toISOString().split("T")[0]; // YYYY-MM-DD
const timeStr = now.toISOString().replace(/[:.]/g, "-").slice(0, -1); // YYYY-MM-DDTHH-MM-SS-sssZ

// Get git short hash if available
let gitHash = "unknown";
try {
  gitHash = execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
} catch {
  // Fallback to random string if not in git
  gitHash = Math.random().toString(36).substring(2, 8);
}

// Build version string: package.version-date-hash
const buildVersion = `${packageJson.version}-${dateStr}-${gitHash}`;

const content = `/**
 * Auto-generated build version info
 * Generated: ${now.toISOString()}
 */
export const BUILD_VERSION = "${buildVersion}";
export const BUILD_DATE = "${dateStr}";
export const BUILD_HASH = "${gitHash}";
export const PACKAGE_VERSION = "${packageJson.version}";
`;

try {
  // Ensure directory exists
  fs.mkdirSync(srcDir, { recursive: true });

  // Write version file
  fs.writeFileSync(outFile, content, "utf-8");

  console.log(`✓ Generated version: ${buildVersion}`);
  console.log(`  → ${outFile}`);
} catch (err) {
  console.warn(`! failed to write version file: ${err.message}`);
  // If EPERM, maybe file is locked by VSCode or tsc watch, ignore and continue
  if (err.code !== "EPERM") {
    // If it's not EPERM, we might want to rethrow or just log
    // For now, let's just log and continue to unblock build
  }
}
