/**
 * Version API endpoint
 * GET /ccrelay/api/version - Returns build version info
 */

import * as http from "http";
import { sendJson } from "./httpJson";

/**
 * Type definition for auto-generated version info
 */
type GeneratedVersion = {
  // eslint-disable-next-line @typescript-eslint/naming-convention -- Build constants use UPPER_CASE
  BUILD_VERSION: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention -- Build constants use UPPER_CASE
  BUILD_DATE: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention -- Build constants use UPPER_CASE
  BUILD_HASH: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention -- Build constants use UPPER_CASE
  GIT_HASH?: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention -- Build constants use UPPER_CASE
  PACKAGE_VERSION?: string;
};

export type BuildVersionInfo = {
  version: string;
  packageVersion: string;
  date: string;
  hash: string;
  gitHash: string;
};

// Import auto-generated version info (fallback if not generated yet)
let BUILD_VERSION = "dev";
let PACKAGE_VERSION = "dev";
let BUILD_DATE = "";
let BUILD_HASH = "dev";
let GIT_HASH = "unknown";
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const gen = require("./version.generated") as GeneratedVersion;
  BUILD_VERSION = gen.BUILD_VERSION;
  PACKAGE_VERSION = gen.PACKAGE_VERSION ?? gen.BUILD_VERSION;
  BUILD_DATE = gen.BUILD_DATE;
  BUILD_HASH = gen.BUILD_HASH;
  GIT_HASH = gen.GIT_HASH ?? "unknown";
} catch {
  // Use defaults during development
  BUILD_HASH = Date.now().toString(36);
  BUILD_VERSION = "dev-" + BUILD_HASH;
  PACKAGE_VERSION = BUILD_VERSION;
  BUILD_DATE = new Date().toISOString().split("T")[0];
}

export function getBuildVersionInfo(): BuildVersionInfo {
  return {
    version: BUILD_VERSION,
    packageVersion: PACKAGE_VERSION,
    date: BUILD_DATE,
    hash: BUILD_HASH,
    gitHash: GIT_HASH,
  };
}

export function handleVersion(_req: http.IncomingMessage, res: http.ServerResponse): void {
  const info = getBuildVersionInfo();
  sendJson(res, 200, {
    version: info.version,
    date: info.date,
    hash: info.hash,
    gitHash: info.gitHash,
    features: {
      modelExtraction: true,
      logListWithoutBody: true,
    },
  });
}
