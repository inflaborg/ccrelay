/**
 * Claude Desktop bundle and Claude Code CLI version detection for Client Config.
 */

import { execFile } from "node:child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { promisify } from "node:util";

type CliVersionExecFn = (
  file: string,
  args: readonly string[],
  options: Record<string, unknown>
) => Promise<{ stdout: string; stderr: string }>;

const execFileAsync = promisify(execFile) as CliVersionExecFn;

let execFileAsyncOverride: CliVersionExecFn | null = null;

/** @internal Test hook */
export function setExecFileAsyncForTests(fn: CliVersionExecFn | null): void {
  execFileAsyncOverride = fn;
}

function getExecFileAsync(): CliVersionExecFn {
  return execFileAsyncOverride ?? execFileAsync;
}

const VERSION_DIR_RE = /^\d+\.\d+\.\d+(-[\w.]+)?$/;
const MAX_CLI_VERSION_LENGTH = 200;

export interface ClaudeDesktopBundleVersions {
  native: string[];
  vm: string[];
}

export type ClaudeCliVersionStatus =
  | "ok"
  | "not_found"
  | "timeout"
  | "blocked"
  | "disabled"
  | "error";

export interface ClaudeCliVersionInfo {
  status: ClaudeCliVersionStatus;
  version?: string;
  errorCode?: string;
  message?: string;
}

export function claudeDesktopDir(): string | null {
  const p = os.platform();
  if (p === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Claude-3p");
  }
  if (p === "win32") {
    return path.join(os.homedir(), "AppData", "Local", "Claude-3p");
  }
  return null;
}

function parseVersionParts(version: string): (number | string)[] {
  const dash = version.indexOf("-");
  const core = dash === -1 ? version : version.slice(0, dash);
  const suffix = dash === -1 ? undefined : version.slice(dash + 1);
  const parts: (number | string)[] = core.split(".").map(part => parseInt(part, 10));
  if (suffix) {
    parts.push(suffix);
  }
  return parts;
}

function compareVersionDesc(a: string, b: string): number {
  const pa = parseVersionParts(a);
  const pb = parseVersionParts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va === vb) {
      continue;
    }
    if (typeof va === "number" && typeof vb === "number") {
      return vb - va;
    }
    return String(vb).localeCompare(String(va));
  }
  return 0;
}

function scanBundleChannel(baseDir: string, channelDir: string): string[] {
  const channelPath = path.join(baseDir, channelDir);
  if (!fs.existsSync(channelPath)) {
    return [];
  }
  try {
    const entries = fs.readdirSync(channelPath, { withFileTypes: true });
    const versions: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (!VERSION_DIR_RE.test(entry.name)) {
        continue;
      }
      versions.push(entry.name);
    }
    return versions.sort(compareVersionDesc);
  } catch {
    return [];
  }
}

export function scanClaudeDesktopBundles(dir: string | null): ClaudeDesktopBundleVersions {
  if (!dir || !fs.existsSync(dir)) {
    return { native: [], vm: [] };
  }
  return {
    native: scanBundleChannel(dir, "claude-code"),
    vm: scanBundleChannel(dir, "claude-code-vm"),
  };
}

function trimCliVersionOutput(stdout: string): string {
  const trimmed = stdout.trim();
  if (trimmed.length <= MAX_CLI_VERSION_LENGTH) {
    return trimmed;
  }
  return trimmed.slice(0, MAX_CLI_VERSION_LENGTH);
}

function mapExecError(err: unknown): ClaudeCliVersionInfo {
  const code =
    err && typeof err === "object" && "code" in err && typeof err.code === "string"
      ? err.code
      : undefined;
  const message = err instanceof Error ? err.message : String(err);

  if (code === "ENOENT") {
    return { status: "not_found", errorCode: code, message };
  }
  if (code === "ETIMEDOUT") {
    return { status: "timeout", errorCode: code, message };
  }
  if (code === "EPERM" || code === "EACCES") {
    return { status: "blocked", errorCode: code, message };
  }
  return { status: "error", errorCode: code, message };
}

export async function detectClaudeCliVersion(opts?: {
  enabled?: boolean;
}): Promise<ClaudeCliVersionInfo> {
  if (opts?.enabled === false) {
    return { status: "disabled" };
  }

  try {
    const { stdout } = await getExecFileAsync()("claude", ["--version"], {
      env: process.env,
      timeout: 3000,
      maxBuffer: 4096,
      windowsHide: true,
    });
    const version = trimCliVersionOutput(String(stdout));
    if (!version) {
      return { status: "error", message: "Empty version output" };
    }
    return { status: "ok", version };
  } catch (err) {
    return mapExecError(err);
  }
}
