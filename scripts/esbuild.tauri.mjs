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
  target: "node20",
  format: "cjs",
  external: [
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

// Bundle the sidecar entry point
await esbuild.build({
  ...commonOptions,
  entryPoints: [path.join(tauriDir, "src/main.ts")],
  outfile: path.join(outDir, "ccrelay-server.js"),
});

// Bundle the database worker (must be a separate file for worker_threads)
await esbuild.build({
  ...commonOptions,
  entryPoints: [path.join(coreDir, "src/database/database-worker.ts")],
  outfile: path.join(outDir, "database-worker.cjs"),
});

// Create sidecar binary in src-tauri/binaries/ with target triple suffix
const targetTriple = execSync("rustc --print host-tuple").toString().trim();
const ext = process.platform === "win32" ? ".exe" : "";
const sidecarBinaryName = `ccrelay-server-${targetTriple}${ext}`;
const sidecarBinaryPath = path.join(binariesDir, sidecarBinaryName);

const isSea = process.env.CCRELAY_SEA === "1";

if (isSea) {
  // Node.js SEA (Single Executable Application) for production
  const seaConfigPath = path.join(outDir, "sea-config.json");
  const seaBlobPath = path.join(outDir, "sea-prep.blob");

  fs.writeFileSync(
    seaConfigPath,
    JSON.stringify(
      {
        main: "ccrelay-server.js",
        output: "sea-prep.blob",
        disableExperimentalSEAWarning: true,
        useCodeCache: true,
      },
      null,
      2
    )
  );

  execSync(`node --experimental-sea-config ${seaConfigPath}`, {
    cwd: outDir,
    stdio: "inherit",
  });

  // Copy node binary and inject SEA blob
  const nodePath = execSync("which node").toString().trim();
  fs.copyFileSync(nodePath, sidecarBinaryPath);
  fs.chmodSync(sidecarBinaryPath, 0o755);

  if (process.platform === "darwin") {
    execSync(`codesign --remove-signature "${sidecarBinaryPath}"`, {
      stdio: "inherit",
    });
  }

  execSync(
    `npx postject "${sidecarBinaryPath}" NODE_SEA_BLOB "${seaBlobPath}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`,
    { stdio: "inherit" }
  );

  if (process.platform === "darwin") {
    execSync(`codesign --sign - "${sidecarBinaryPath}"`, {
      stdio: "inherit",
    });
  }

  console.log(`SEA binary created: ${sidecarBinaryPath}`);
} else {
  // Development: create a wrapper script that runs node with the bundle
  const nodePath = execSync("which node").toString().trim();
  const wrapperScript = `#!/bin/sh
exec "${nodePath}" "${outDir}/ccrelay-server.js" "$@"
`;
  fs.writeFileSync(sidecarBinaryPath, wrapperScript);
  fs.chmodSync(sidecarBinaryPath, 0o755);
  console.log(`Dev sidecar wrapper created: ${sidecarBinaryPath}`);
}

console.log("Tauri sidecar + database worker bundles created successfully");
