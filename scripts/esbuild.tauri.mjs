import * as esbuild from "esbuild";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const coreDir = path.join(rootDir, "packages/core");
const tauriDir = path.join(rootDir, "packages/desktop-tauri");
const outDir = path.join(tauriDir, "out");
const binariesDir = path.join(tauriDir, "src-tauri/binaries");

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}
if (!fs.existsSync(binariesDir)) {
  fs.mkdirSync(binariesDir, { recursive: true });
}

const commonOptions = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  external: ["better-sqlite3", "bindings", "file-uri-to-path"],
  sourcemap: false,
  minify: false,
};

// Bundle the sidecar entry point
await esbuild.build({
  ...commonOptions,
  entryPoints: [path.join(tauriDir, "src/main.ts")],
  outfile: path.join(outDir, "ccrelay-server.js"),
});

// Bundle the database worker (must be a separate file for worker_threads)
await esbuild.build({
  ...commonOptions,
  entryPoints: [path.join(coreDir, "src/database/worker/worker.ts")],
  outfile: path.join(outDir, "database-worker.cjs"),
});

// Copy better-sqlite3 and runtime deps for sidecar (resolved via NODE_PATH at runtime)
function resolvePackageDir(packageName, anchorDirs) {
  const seen = new Set();
  for (const anchor of anchorDirs) {
    const candidates = [
      path.join(anchor, "node_modules", packageName),
      path.join(path.dirname(anchor), "node_modules", packageName),
      path.join(rootDir, "node_modules", packageName),
    ];
    for (const dir of candidates) {
      if (seen.has(dir)) {
        continue;
      }
      seen.add(dir);
      if (fs.existsSync(path.join(dir, "package.json"))) {
        return dir;
      }
    }
  }
  throw new Error(
    `${packageName} not found. Run npm install from the repo root (desktop-tauri depends on it).`
  );
}

function copyIntoNativeNodeModules(packageName, anchorDirs) {
  const src = resolvePackageDir(packageName, anchorDirs);
  const dest = path.join(outDir, "native/node_modules", packageName);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

const nativeAnchors = [
  path.join(tauriDir, "node_modules/better-sqlite3"),
  path.join(rootDir, "node_modules/better-sqlite3"),
  path.join(coreDir, "node_modules/better-sqlite3"),
];

execSync("npm rebuild better-sqlite3", { cwd: rootDir, stdio: "inherit" });

copyIntoNativeNodeModules("better-sqlite3", nativeAnchors);
copyIntoNativeNodeModules("bindings", nativeAnchors);
copyIntoNativeNodeModules("file-uri-to-path", nativeAnchors);

// Sidecar binary: copy Node executable (Tauri externalBin)
const targetTriple = execSync("rustc --print host-tuple").toString().trim();
const ext = process.platform === "win32" ? ".exe" : "";
const sidecarBinaryName = `ccrelay-server-${targetTriple}${ext}`;
const sidecarBinaryPath = path.join(binariesDir, sidecarBinaryName);

fs.copyFileSync(process.execPath, sidecarBinaryPath);
if (process.platform !== "win32") {
  fs.chmodSync(sidecarBinaryPath, 0o755);
}

console.log(`Sidecar Node binary created: ${sidecarBinaryPath}`);
console.log("Tauri sidecar + database worker bundles created successfully");
