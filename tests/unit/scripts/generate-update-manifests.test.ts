import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCRIPT = path.join(ROOT, "scripts/generate-update-manifests.mjs");

describe("generate-update-manifests", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    dirs.push(dir);
    return dir;
  }

  function writeAsset(dir: string, name: string, content: string): void {
    fs.writeFileSync(path.join(dir, name), content, "utf8");
  }

  function runGenerate(opts: {
    assetsDir: string;
    outputDir: string;
    version: string;
    baseUrl: string;
  }): string {
    return execFileSync(
      process.execPath,
      [
        SCRIPT,
        "--assets-dir",
        opts.assetsDir,
        "--output-dir",
        opts.outputDir,
        "--version",
        opts.version,
        "--base-url",
        opts.baseUrl,
      ],
      { encoding: "utf8" }
    );
  }

  it("writes mac + win manifests with absolute URLs, preferred arch, and sha512", () => {
    const assetsDir = tempDir("ccrelay-manif-assets-");
    const outputDir = tempDir("ccrelay-manif-out-");

    const macArmZip = "CCRelay-0.2.9-darwin-arm64.zip";
    const macX64Zip = "CCRelay-0.2.9-darwin-x64.zip";
    const macArmDmg = "CCRelay-0.2.9-darwin-arm64.dmg";
    const winX64 = "CCRelay-0.2.9-win32-x64.exe";
    const winArm = "CCRelay-0.2.9-win32-arm64.exe";
    const tauriDmg = "CCRelay-0.2.9-tauri-darwin-arm64.dmg";

    writeAsset(assetsDir, macArmZip, "mac-arm-zip");
    writeAsset(assetsDir, macX64Zip, "mac-x64-zip");
    writeAsset(assetsDir, macArmDmg, "mac-arm-dmg");
    writeAsset(assetsDir, winX64, "win-x64-exe");
    writeAsset(assetsDir, winArm, "win-arm-exe");
    writeAsset(assetsDir, tauriDmg, "tauri-should-be-ignored");

    const baseUrl = "https://github.com/inflaborg/ccrelay/releases/download/v0.2.9";
    const stdout = runGenerate({
      assetsDir,
      outputDir,
      version: "0.2.9",
      baseUrl,
    });

    expect(stdout).toContain("latest-mac.yml");
    expect(stdout).toContain("latest.yml");
    expect(stdout).toContain("latest.json");

    const written = fs.readdirSync(outputDir).sort();
    expect(written).toEqual(["latest-mac.yml", "latest.json", "latest.yml"].sort());

    const macYml = fs.readFileSync(path.join(outputDir, "latest-mac.yml"), "utf8");
    expect(macYml).toContain("version: '0.2.9'");
    expect(macYml.indexOf(macArmZip)).toBeLessThan(macYml.indexOf(macX64Zip));
    expect(macYml).toContain(`${baseUrl}/${encodeURIComponent(macArmZip)}`);
    expect(macYml).not.toContain("tauri");
    expect(macYml).toContain(sha512Base64(fs.readFileSync(path.join(assetsDir, macArmZip))));

    const winYml = fs.readFileSync(path.join(outputDir, "latest.yml"), "utf8");
    expect(winYml.indexOf(winX64)).toBeLessThan(winYml.indexOf(winArm));
    expect(winYml).toContain(`${baseUrl}/${encodeURIComponent(winX64)}`);

    const latestJson = JSON.parse(fs.readFileSync(path.join(outputDir, "latest.json"), "utf8")) as {
      version: string;
      assets: Record<string, { url: string; size: number; sha512: string }>;
    };
    expect(latestJson.version).toBe("0.2.9");
    expect(latestJson.assets["mac-arm64"].url).toContain(macArmDmg);
    expect(latestJson.assets["win-x64"].size).toBe(Buffer.byteLength("win-x64-exe"));
    expect(latestJson.assets["mac-arm64"].sha512).toBe(
      sha512Base64(fs.readFileSync(path.join(assetsDir, macArmDmg)))
    );
    expect(latestJson.assets["mac-arm64"].url).not.toContain(".zip");
  });

  it("generates only the platforms that are present", () => {
    const assetsDir = tempDir("ccrelay-manif-maconly-");
    const outputDir = tempDir("ccrelay-manif-maconly-out-");
    writeAsset(assetsDir, "CCRelay-0.2.9-darwin-arm64.zip", "zip");
    writeAsset(assetsDir, "CCRelay-0.2.9-darwin-arm64.dmg", "dmg");

    runGenerate({
      assetsDir,
      outputDir,
      version: "0.2.9",
      baseUrl: "https://example.com/v0.2.9",
    });

    expect(fs.readdirSync(outputDir).sort()).toEqual(["latest-mac.yml", "latest.json"].sort());
    expect(fs.existsSync(path.join(outputDir, "latest.yml"))).toBe(false);
  });

  it("skips when no electron installers exist", () => {
    const assetsDir = tempDir("ccrelay-manif-empty-");
    const outputDir = tempDir("ccrelay-manif-empty-out-");
    writeAsset(assetsDir, "CCRelay-0.2.9-tauri-win32-x64.exe", "tauri");
    writeAsset(assetsDir, "readme.txt", "hi");

    const stdout = runGenerate({
      assetsDir,
      outputDir,
      version: "0.2.9",
      baseUrl: "https://example.com/v0.2.9",
    });

    expect(stdout).toContain("skipped");
    expect(fs.readdirSync(outputDir)).toEqual([]);
  });
});

function sha512Base64(buf: Buffer): string {
  return crypto.createHash("sha512").update(buf).digest("base64");
}
