/**
 * Bearer + internal UI header checks for local HTTP routes.
 */

import * as crypto from "crypto";
import * as http from "http";
import { CCRELAY_UI_HEADER_NAME, CCRELAY_UI_HEADER_VALUE } from "./internalUiHeaders";
import { WEB_UI_GATE_FALLBACK_HTML } from "./webUiGateFallback";

/** Lower-case header keys as Node provides */
function bearerFromAuthHeader(auth?: string): string | null {
  if (!auth || typeof auth !== "string") {
    return null;
  }
  const m = /^Bearer\s+(\S+)/i.exec(auth.trim());
  return m?.[1] ?? null;
}

export function timingSafeBearerEqual(provided: string | undefined, secret: string): boolean {
  if (!provided || !secret) {
    return false;
  }
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(secret, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

export function hasRequiredUiGateHeader(headers: http.IncomingHttpHeaders): boolean {
  const needle = CCRELAY_UI_HEADER_NAME.toLowerCase();
  const raw = headers[needle];
  const value = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : undefined;
  return value === CCRELAY_UI_HEADER_VALUE;
}

/** True if Bearer matches server.apiBearerToken */
export function isBearerAuthorized(
  headers: http.IncomingHttpHeaders,
  expectedSecret: string
): boolean {
  const auth = typeof headers.authorization === "string" ? headers.authorization : undefined;
  const token = bearerFromAuthHeader(auth);
  return token !== null && timingSafeBearerEqual(token, expectedSecret);
}

export function sendJsonUnauthorized(res: http.ServerResponse): void {
  res.writeHead(401, {
    // eslint-disable-next-line @typescript-eslint/naming-convention -- HTTP response header casing
    "Content-Type": "application/json",
  });
  res.end(
    JSON.stringify({ error: "unauthorized", message: "Valid Authorization Bearer required" })
  );
}

export function sendHtmlUiGateBlocked(res: http.ServerResponse): void {
  res.writeHead(200, {
    // eslint-disable-next-line @typescript-eslint/naming-convention -- HTTP response header casing
    "Content-Type": "text/html; charset=utf-8",
    // eslint-disable-next-line @typescript-eslint/naming-convention -- HTTP response header casing
    "Cache-Control": "no-store",
  });
  res.end(WEB_UI_GATE_FALLBACK_HTML);
}

export function corsExtraAllowedHeadersCsv(): string {
  return `Content-Type, X-API-Key, ${CCRELAY_UI_HEADER_NAME}, Authorization`;
}
