import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    vi.restoreAllMocks();
  });

  it("returns disabled when detection is turned off", async () => {
    await expect(detectClaudeCliVersion({ enabled: false })).resolves.toEqual({
      status: "disabled",
    });
  });

  it("returns ok with trimmed version output after which resolves claude on unix", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    setExecFileAsyncForTests((file, args) => {
      if (file.endsWith("/which") && args[0] === "claude") {
        return Promise.resolve({ stdout: "/usr/local/bin/claude\n", stderr: "" });
      }
      if (args[0] === "--version") {
        return Promise.resolve({ stdout: "  2.1.153 (Claude Code)\n", stderr: "" });
      }
      return Promise.reject(
        Object.assign(new Error(`unexpected exec ${file} ${args.join(" ")}`), { code: "ENOENT" })
      );
    });

    await expect(detectClaudeCliVersion()).resolves.toEqual({
      status: "ok",
      version: "2.1.153 (Claude Code)",
    });
  });

  it("invokes claude directly on windows without which", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const calls: string[] = [];
    setExecFileAsyncForTests((file, args) => {
      calls.push(`${file} ${args.join(" ")}`);
      if (file === "claude" && args[0] === "--version") {
        return Promise.resolve({ stdout: "2.1.0\n", stderr: "" });
      }
      return Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" }));
    });

    await expect(detectClaudeCliVersion()).resolves.toEqual({
      status: "ok",
      version: "2.1.0",
    });
    expect(calls).toEqual(["claude --version"]);
  });

  it("accepts version output on stderr", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    setExecFileAsyncForTests((file, args) => {
      if (file.endsWith("/which") && args[0] === "claude") {
        return Promise.resolve({ stdout: "/usr/local/bin/claude\n", stderr: "" });
      }
      if (args[0] === "--version") {
        return Promise.resolve({ stdout: "", stderr: "2.1.99\n" });
      }
      return Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" }));
    });

    await expect(detectClaudeCliVersion()).resolves.toEqual({
      status: "ok",
      version: "2.1.99",
    });
  });

  it("truncates overly long stdout", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    setExecFileAsyncForTests((file, args) => {
      if (file.endsWith("/which") && args[0] === "claude") {
        return Promise.resolve({ stdout: "/usr/local/bin/claude\n", stderr: "" });
      }
      if (args[0] === "--version") {
        return Promise.resolve({ stdout: "x".repeat(250), stderr: "" });
      }
      return Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" }));
    });
    const result = await detectClaudeCliVersion();
    expect(result.status).toBe("ok");
    expect(result.version).toHaveLength(200);
  });

  it("returns not_found when claude cannot be resolved on unix", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    setExecFileAsyncForTests(() =>
      Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" }))
    );
    await expect(detectClaudeCliVersion()).resolves.toMatchObject({
      status: "not_found",
    });
  });

  it("maps exec errors to status codes", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    setExecFileAsyncForTests((file, args) => {
      if (file.endsWith("/which") && args[0] === "claude") {
        return Promise.resolve({ stdout: "/usr/local/bin/claude\n", stderr: "" });
      }
      if (args[0] === "--version") {
        return Promise.reject(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }));
      }
      return Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" }));
    });
    await expect(detectClaudeCliVersion()).resolves.toMatchObject({
      status: "timeout",
      errorCode: "ETIMEDOUT",
    });

    setExecFileAsyncForTests((file, args) => {
      if (file.endsWith("/which") && args[0] === "claude") {
        return Promise.resolve({ stdout: "/usr/local/bin/claude\n", stderr: "" });
      }
      if (args[0] === "--version") {
        return Promise.reject(Object.assign(new Error("denied"), { code: "EPERM" }));
      }
      return Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" }));
    });
    await expect(detectClaudeCliVersion()).resolves.toMatchObject({
      status: "blocked",
      errorCode: "EPERM",
    });

    setExecFileAsyncForTests((file, args) => {
      if (file.endsWith("/which") && args[0] === "claude") {
        return Promise.resolve({ stdout: "/usr/local/bin/claude\n", stderr: "" });
      }
      if (args[0] === "--version") {
        return Promise.reject(Object.assign(new Error("boom"), { code: "ERR_FAILED" }));
      }
      return Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" }));
    });
    await expect(detectClaudeCliVersion()).resolves.toMatchObject({
      status: "error",
      errorCode: "ERR_FAILED",
    });
  });
});
