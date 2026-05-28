import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  setExecFileAsyncForTests,
  detectClaudeCliVersion,
  scanClaudeDesktopBundles,
} from "@/api/clientVersion";

describe("scanClaudeDesktopBundles", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns semver-like version dirs in descending order and ignores invalid entries", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ccrelay-claude-desktop-"));
    const nativeDir = path.join(tmpDir, "claude-code");
    fs.mkdirSync(path.join(nativeDir, "2.1.149"), { recursive: true });
    fs.mkdirSync(path.join(nativeDir, "2.1.138"), { recursive: true });
    fs.writeFileSync(path.join(nativeDir, ".txt"), "hint");
    fs.mkdirSync(path.join(nativeDir, "notaversion"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "claude-code-vm", "2.1.140"), { recursive: true });

    expect(scanClaudeDesktopBundles(tmpDir)).toEqual({
      native: ["2.1.149", "2.1.138"],
      vm: ["2.1.140"],
    });
  });

  it("returns empty arrays when directory is missing or null", () => {
    expect(scanClaudeDesktopBundles(null)).toEqual({ native: [], vm: [] });
    expect(scanClaudeDesktopBundles(path.join(os.tmpdir(), "missing-claude-3p-dir"))).toEqual({
      native: [],
      vm: [],
    });
  });
});

describe("detectClaudeCliVersion", () => {
  beforeEach(() => {
    setExecFileAsyncForTests(null);
  });

  afterEach(() => {
    setExecFileAsyncForTests(null);
  });

  it("returns disabled when detection is turned off", async () => {
    await expect(detectClaudeCliVersion({ enabled: false })).resolves.toEqual({
      status: "disabled",
    });
  });

  it("returns ok with trimmed version output", async () => {
    setExecFileAsyncForTests(() =>
      Promise.resolve({
        stdout: "  2.1.153 (Claude Code)\n",
        stderr: "",
      })
    );

    await expect(detectClaudeCliVersion()).resolves.toEqual({
      status: "ok",
      version: "2.1.153 (Claude Code)",
    });
  });

  it("truncates overly long stdout", async () => {
    setExecFileAsyncForTests(() =>
      Promise.resolve({
        stdout: "x".repeat(250),
        stderr: "",
      })
    );
    const result = await detectClaudeCliVersion();
    expect(result.status).toBe("ok");
    expect(result.version).toHaveLength(200);
  });

  it("maps exec errors to status codes", async () => {
    setExecFileAsyncForTests(() =>
      Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" }))
    );
    await expect(detectClaudeCliVersion()).resolves.toMatchObject({
      status: "not_found",
      errorCode: "ENOENT",
    });

    setExecFileAsyncForTests(() =>
      Promise.reject(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }))
    );
    await expect(detectClaudeCliVersion()).resolves.toMatchObject({
      status: "timeout",
      errorCode: "ETIMEDOUT",
    });

    setExecFileAsyncForTests(() =>
      Promise.reject(Object.assign(new Error("denied"), { code: "EPERM" }))
    );
    await expect(detectClaudeCliVersion()).resolves.toMatchObject({
      status: "blocked",
      errorCode: "EPERM",
    });

    setExecFileAsyncForTests(() =>
      Promise.reject(Object.assign(new Error("boom"), { code: "ERR_FAILED" }))
    );
    await expect(detectClaudeCliVersion()).resolves.toMatchObject({
      status: "error",
      errorCode: "ERR_FAILED",
    });
  });
});
