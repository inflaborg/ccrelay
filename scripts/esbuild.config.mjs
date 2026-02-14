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

const result = await esbuild.build({
  entryPoints: [path.join(rootDir, "src/extension.ts")],
  bundle: true,
  outfile: path.join(outDir, "extension.cjs"),
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
});

console.log("Bundle created successfully");
