/**
 * Version API endpoint
 * GET /ccrelay/api/version - Returns build version info
 */

import * as http from "http";
import { sendJson } from "./index";

/**
 * Type definition for auto-generated version info
 */
type GeneratedVersion = {
  // eslint-disable-next-line @typescript-eslint/naming-convention -- Build constants use UPPER_CASE
  BUILD_VERSION: string;
  // eslint-disable-next-line @typescript-eslint/naming-convention -- Build constants use UPPER_CASE
  BUILD_DATE: string;
};

// Import auto-generated version info (fallback if not generated yet)
let BUILD_VERSION = "dev";
let BUILD_DATE = "";
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const gen = require("./version.generated") as GeneratedVersion;
  BUILD_VERSION = gen.BUILD_VERSION;
  BUILD_DATE = gen.BUILD_DATE;
} catch {
  // Use defaults during development
  BUILD_VERSION = "dev-" + Date.now().toString(36);
  BUILD_DATE = new Date().toISOString().split("T")[0];
}

export function handleVersion(_req: http.IncomingMessage, res: http.ServerResponse): void {
  sendJson(res, 200, {
    version: BUILD_VERSION,
    date: BUILD_DATE,
    features: {
      modelExtraction: true,
      logListWithoutBody: true,
    },
  });
}
