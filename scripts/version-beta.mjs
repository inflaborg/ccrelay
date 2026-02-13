#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pkgPath = path.join(__dirname, "../package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));

// Remove existing beta suffix and add new one
const baseVersion = pkg.version.replace(/-beta.\d+$/, "");
const betaVersion = `${baseVersion}-beta.${Math.floor(Date.now() / 1000)}`;

pkg.version = betaVersion;

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
console.log(`Version: ${betaVersion}`);
