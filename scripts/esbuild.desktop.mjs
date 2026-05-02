import * as esbuild from "esbuild";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const coreDir = path.join(rootDir, "packages/core");
const desktopDir = path.join(rootDir, "packages/desktop");
const outDir = path.join(desktopDir, "out");

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const commonOptions = {
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  external: [
    "electron",
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

await esbuild.build({
  ...commonOptions,
  entryPoints: [path.join(desktopDir, "src/main.ts")],
  outfile: path.join(outDir, "main.js"),
});

await esbuild.build({
  ...commonOptions,
  entryPoints: [path.join(coreDir, "src/database/database-worker.ts")],
  outfile: path.join(outDir, "database-worker.cjs"),
});

console.log("Desktop main + database worker bundles created successfully");
