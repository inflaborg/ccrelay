import * as esbuild from "esbuild";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const outDir = path.join(rootDir, "out/dist");
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// Common build options
const commonOptions = {
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  external: [
    "vscode",
    "pg",
    "pg-*",
    "pgpass",
    "postgres-array",
    "postgres-bytea",
    "postgres-date",
    "postgres-interval",
  ],
  sourcemap: false,
  minify: false,
};

// Build main extension
await esbuild.build({
  ...commonOptions,
  entryPoints: [path.join(rootDir, "src/extension.ts")],
  outfile: path.join(outDir, "extension.cjs"),
});

// Build database worker as separate bundle
await esbuild.build({
  ...commonOptions,
  entryPoints: [path.join(rootDir, "src/database/database-worker.ts")],
  outfile: path.join(outDir, "database-worker.cjs"),
});

console.log("Bundle created successfully");
