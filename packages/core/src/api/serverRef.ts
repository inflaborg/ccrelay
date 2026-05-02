/**
 * Shared ProxyServer reference for API handlers that must only run on the leader.
 */

import type * as http from "http";
import type { ProxyServer } from "../server/handler";

let proxyServer: ProxyServer | null = null;

export function setProxyServerForApi(server: ProxyServer): void {
  proxyServer = server;
}

/** Clears the API guard reference (for tests). */
export function resetProxyServerForApi(): void {
  proxyServer = null;
}

/**
 * Reject with 503 when the storage API is hit on a non-leader (defense in depth).
 * @returns true if the response was sent and the handler should return.
 */
export function rejectLogStorageApiIfNotLeader(res: http.ServerResponse): boolean {
  if (!proxyServer || proxyServer.getRole() !== "leader") {
    // eslint-disable-next-line @typescript-eslint/naming-convention -- HTTP header uses hyphenated keys
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error:
          "Log storage API is only available on the leader; point your client at the leader HTTP URL.",
      })
    );
    return true;
  }
  return false;
}
