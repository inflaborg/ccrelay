/**
 * Static file serving for Web UI
 * Serves the built frontend from web/dist
 */

/* eslint-disable @typescript-eslint/naming-convention */
// MIME type keys use dots (.html, .js, etc.) and headers use hyphens

import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { ScopedLogger } from "../utils/logger";

// Web UI build directory (relative to compiled output)
const WEB_DIST = path.join(__dirname, "../../web");

// MIME types for static files
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
};

const log = new ScopedLogger("Static");

/**
 * Get MIME type for a file extension
 */
function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

/**
 * Check if a path is a static file request
 */
export function isStaticRequest(reqPath: string): boolean {
  return (
    reqPath === "/ccrelay" ||
    reqPath === "/ccrelay/" ||
    reqPath.startsWith("/ccrelay/assets") ||
    reqPath.startsWith("/ccrelay/index.html")
  );
}

/**
 * Serve static file for Web UI
 * @returns true if the request was handled, false otherwise
 */
export function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const reqPath = req.url || "";

  // Root path - serve index.html
  if (reqPath === "/ccrelay" || reqPath === "/ccrelay/") {
    return serveIndex(res);
  }

  // Assets or other files
  if (reqPath.startsWith("/ccrelay/")) {
    const relativePath = reqPath.replace("/ccrelay/", "");
    const filePath = path.join(WEB_DIST, relativePath);
    return serveFile(filePath, res);
  }

  return false;
}

/**
 * Serve index.html
 */
function serveIndex(res: http.ServerResponse): boolean {
  const indexPath = path.join(WEB_DIST, "index.html");

  if (!fs.existsSync(indexPath)) {
    log.warn("index.html not found - Web UI may not be built");
    sendJson(res, 503, {
      error: "Web UI not available. Please run 'npm run build:web' first.",
    });
    return true;
  }

  try {
    const content = fs.readFileSync(indexPath, "utf-8");
    res.writeHead(200, {
      "Content-Type": "text/html",
      "Cache-Control": "no-cache",
    });
    res.end(content);
    return true;
  } catch (err) {
    log.error("Error serving index.html", err);
    return false;
  }
}

/**
 * Serve a static file
 */
function serveFile(filePath: string, res: http.ServerResponse): boolean {
  try {
    // Security check - prevent directory traversal
    const normalizedPath = path.normalize(filePath);
    if (!normalizedPath.startsWith(WEB_DIST)) {
      log.warn(`Blocked directory traversal attempt: ${filePath}`);
      sendJson(res, 403, { error: "Forbidden" });
      return true;
    }

    if (!fs.existsSync(filePath)) {
      log.warn(`File not found: ${filePath}`);
      sendJson(res, 404, { error: "Not found" });
      return true;
    }

    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
      // For directory requests, try to serve index.html
      const indexPath = path.join(filePath, "index.html");
      if (fs.existsSync(indexPath)) {
        return serveFile(indexPath, res);
      }
      sendJson(res, 404, { error: "Not found" });
      return true;
    }

    const content = fs.readFileSync(filePath);
    const mimeType = getMimeType(filePath);

    res.writeHead(200, {
      "Content-Type": mimeType,
      "Cache-Control": "public, max-age=3600", // Cache for 1 hour
    });
    res.end(content);
    return true;
  } catch (err) {
    log.error(`Error serving file: ${filePath}`, err);
    return false;
  }
}

/**
 * Send JSON response
 */
function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}
