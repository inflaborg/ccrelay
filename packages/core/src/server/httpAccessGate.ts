/**
 * Bearer + internal UI header checks for local HTTP routes.
 * Dynamic UI access token for WebView-based clients (Tauri).
 */

import * as crypto from "crypto";
import * as http from "http";
import { CCRELAY_UI_HEADER_NAME, CCRELAY_UI_HEADER_VALUE } from "./internalUiHeaders";
import { WEB_UI_GATE_FALLBACK_HTML } from "./webUiGateFallback";

// --- UI Access Token (dynamic, per-server-instance) ---

const UI_TOKEN_BYTES = 32;
let uiAccessToken: string = "";

/** Generate and store a random UI access token (called once at server startup) */
export function initUiAccessToken(): void {
  uiAccessToken = crypto.randomBytes(UI_TOKEN_BYTES).toString("hex");
}

/** Get the current UI access token (for stdout output to Tauri) */
export function getUiAccessToken(): string {
  if (!uiAccessToken) {
    initUiAccessToken();
  }
  return uiAccessToken;
}

/** Validate a provided token against the generated one (constant-time) */
function validateUiAccessToken(token: string): boolean {
  if (!uiAccessToken || !token) {
    return false;
  }
  const a = Buffer.from(token, "utf8");
  const b = Buffer.from(uiAccessToken, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

// --- Session Cookie (HMAC-signed, with expiration) ---

const SESSION_COOKIE = "__ccrelay_session";
const SESSION_SECRET = crypto.randomBytes(32);
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface SessionPayload {
  exp: number;
}

function createSessionCookie(): string {
  const payload: SessionPayload = { exp: Date.now() + SESSION_MAX_AGE_MS };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(data).digest("hex");
  return `${data}.${sig}`;
}

function validateSessionCookie(cookie: string): boolean {
  const sep = cookie.lastIndexOf(".");
  if (sep === -1) {
    return false;
  }
  const data = cookie.substring(0, sep);
  const sig = cookie.substring(sep + 1);
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(data).digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return false;
  }
  try {
    const raw = Buffer.from(data, "base64url").toString("utf8");
    const payload: SessionPayload = JSON.parse(raw) as SessionPayload;
    return payload.exp > Date.now();
  } catch {
    return false;
  }
}

// --- Auth checks ---

/** Check header-based UI gate (for Electron/VS Code) */
export function hasRequiredUiGateHeader(headers: http.IncomingHttpHeaders): boolean {
  const needle = CCRELAY_UI_HEADER_NAME.toLowerCase();
  const raw = headers[needle];
  const value = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : undefined;
  return value === CCRELAY_UI_HEADER_VALUE;
}

/** Check UI gate access: header OR valid session cookie */
export function hasUiGateAccess(headers: http.IncomingHttpHeaders): boolean {
  if (hasRequiredUiGateHeader(headers)) {
    return true;
  }
  const cookieHeader = typeof headers.cookie === "string" ? headers.cookie : "";
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${SESSION_COOKIE}=`)) {
      const cookieValue = trimmed.substring(SESSION_COOKIE.length + 1);
      if (validateSessionCookie(cookieValue)) {
        return true;
      }
    }
  }
  return false;
}

// --- Auth endpoint handlers ---

/** Handle /ccrelay/ui-auth?token=xxx — validate token, set session cookie, redirect */
export function handleUiAuthRedirect(res: http.ServerResponse, url: string): void {
  const parsed = new URL(url, "http://localhost");
  const token = parsed.searchParams.get("token");

  if (!token || !validateUiAccessToken(token)) {
    sendHtmlUiGateBlocked(res);
    return;
  }

  const session = createSessionCookie();
  res.writeHead(302, {
    // eslint-disable-next-line @typescript-eslint/naming-convention -- HTTP response header casing
    "Set-Cookie": `${SESSION_COOKIE}=${session}; Path=/ccrelay; SameSite=Lax; HttpOnly`,
    // eslint-disable-next-line @typescript-eslint/naming-convention -- HTTP response header casing
    Location: "/ccrelay/",
  });
  res.end();
}

// --- Bearer auth (for API endpoints) ---

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
