/**
 * Shared JSON request/response helpers for HTTP API handlers.
 */

import * as http from "http";

export function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { ["Content-Type"]: "application/json" });
  res.end(JSON.stringify(data));
}

export async function parseJsonBody<T = unknown>(req: http.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}") as T);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
    req.on("error", reject);
  });
}
