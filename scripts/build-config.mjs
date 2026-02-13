#!/usr/bin/env node
/**
 * Generate build configuration
 * Creates build config with environment type, log level
 * Outputs the build version for vsce packaging
 *
 * Usage:
 *   node scripts/build-config.mjs dev   # Dev build: DEBUG log level
 *   node scripts/build-config.mjs prod  # Prod build: INFO log level
 *
 * Outputs:
 *   - src/config/build-config.generated.ts
 *   - stdout: package version (e.g., 0.1.1-f551421)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

// Parse environment argument
const env = process.argv[2] || "dev";
if (!["dev", "prod"].includes(env)) {
  console.error(`Invalid environment: ${env}. Use 'dev' or 'prod'.`);
  process.exit(1);
}

const packageJson = require("../package.json");
const configDir = path.join(__dirname, "../src/config");
const outFile = path.join(configDir, "build-config.generated.ts");

// Determine log level based on environment
const LOG_LEVELS = {
  dev: "DEBUG",
  prod: "INFO",
};

// Get current timestamp
const now = new Date();
const dateStr = now.toISOString().split("T")[0]; // YYYY-MM-DD
const timeStr = now.toISOString().replace(/[:.]/g, "-").slice(0, -1);

// Get git short hash if available
let gitHash = "unknown";
try {
  gitHash = execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
} catch {
  gitHash = Math.random().toString(36).substring(2, 8);
}

// Get base version (remove any existing hash suffix)
const baseVersion = packageJson.version.replace(/-\w+$/, "");

// Build version string: version-githash (same code = same filename)
const buildVersion = `${baseVersion}-${gitHash}`;

const content = `/**
 * Auto-generated build configuration
 * Generated: ${now.toISOString()}
 * Environment: ${env}
 */
export const BUILD_ENV = "${env}";
export const BUILD_VERSION = "${buildVersion}";
export const BUILD_DATE = "${dateStr}";
export const BUILD_TIME = "${timeStr}";
export const BUILD_HASH = "${gitHash}";
export const PACKAGE_VERSION = "${baseVersion}";
export const DEFAULT_LOG_LEVEL = "${LOG_LEVELS[env]}";
`;

try {
  // Ensure directory exists
  fs.mkdirSync(configDir, { recursive: true });

  // Write config file
  fs.writeFileSync(outFile, content, "utf-8");

  console.log(`✓ Build config generated for ${env.toUpperCase()} environment`);
  console.log(`  Version: ${buildVersion}`);
  console.log(`  Log Level: ${LOG_LEVELS[env]}`);
  console.log(`  → ${outFile}`);

  // Output the package version for vsce (last line, machine-readable)
  console.log(`PACKAGE_VERSION:${buildVersion}`);
} catch (err) {
  console.error(`! Failed to write build config: ${err.message}`);
  process.exit(1);
}
