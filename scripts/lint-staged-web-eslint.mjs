#!/usr/bin/env node
/**
 * lint-staged helper: run eslint inside the web/ directory so its
 * eslint.config.js is picked up automatically.
 *
 * Receives repo-root-relative paths (e.g. web/src/foo.tsx) via argv,
 * converts them to web-relative paths, and runs eslint from web/.
 */
import { execFileSync } from "child_process";
import { relative, resolve } from "path";

const root = resolve(import.meta.dirname, "..");
const webDir = resolve(root, "web");

const files = process.argv.slice(2).map(f => relative(webDir, resolve(root, f)));
if (files.length === 0) process.exit(0);

execFileSync("eslint", ["--max-warnings=0", ...files], {
  cwd: webDir,
  stdio: "inherit",
});
