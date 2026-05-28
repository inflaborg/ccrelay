/**
 * Lightweight HTTP probe: is a CCRelay leader serving /ccrelay/api/status?
 */

import * as http from "http";
import { CCRELAY_UI_HEADER_NAME, CCRELAY_UI_HEADER_VALUE } from "./internalUiHeaders";

const DEFAULT_PROBE_TIMEOUT_MS = 500;

let getBearerToken: (() => string) | null = null;

export function setLeaderHttpProbeBearer(getter: () => string): void {
  getBearerToken = getter;
}

export function probeCcrelayHttp(
  host: string,
  port: number,
  timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS
): Promise<boolean> {
  return new Promise(resolve => {
    const bearer = getBearerToken?.() ?? "";
    const req = http.request(
      {
        hostname: host,
        port,
        path: "/ccrelay/api/status",
        method: "GET",
        timeout: timeoutMs,
        headers: {
          // eslint-disable-next-line @typescript-eslint/naming-convention -- HTTP request header casing
          Authorization: `Bearer ${bearer}`,
          [CCRELAY_UI_HEADER_NAME]: CCRELAY_UI_HEADER_VALUE,
        },
      },
      res => {
        resolve(res.statusCode === 200);
        res.resume();
      }
    );

    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}
