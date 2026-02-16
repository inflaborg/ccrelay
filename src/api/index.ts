/**
 * API router for management endpoints
 * Routes: /ccrelay/api/*
 */

/* eslint-disable @typescript-eslint/naming-convention */
// API route paths use slashes and Content-Type header uses hyphen

import * as http from "http";
import type { ProxyServer } from "../server/handler";
import { handleStatus, setServer as setStatusServer } from "./status";
import {
  handleListProviders,
  handleAddProvider,
  handleDeleteProvider,
  handleReloadConfig,
  setServer as setProvidersServer,
} from "./providers";
import { handleSwitchProvider, setServer as setSwitchServer } from "./switch";
import { handleLogs, handleLogDetail, handleDeleteLogs, handleClearLogs } from "./logs";
import { handleStats } from "./stats";
import { handleVersion } from "./version";
import { handleQueueStats, handleClearQueue, setServer as setQueueServer } from "./queue";
import { ScopedLogger } from "../utils/logger";

const log = new ScopedLogger("API");

/**
 * Set the server instance for all API handlers
 */
export function setServer(server: ProxyServer): void {
  setStatusServer(server);
  setProvidersServer(server);
  setSwitchServer(server);
  setQueueServer(server);
}

// API routes mapping
type ApiHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  params: Record<string, string>
) => void | Promise<void>;

const API_ROUTES: Record<string, ApiHandler> = {
  "/ccrelay/api/status": handleStatus,
  "/ccrelay/api/providers": handleListProviders,
  "/ccrelay/api/switch": handleSwitchProvider,
  "/ccrelay/api/logs": handleLogs,
  "/ccrelay/api/stats": handleStats,
  "/ccrelay/api/version": handleVersion,
  "/ccrelay/api/queue": handleQueueStats,
};

/**
 * Check if a path is an API request
 */
export function isApiRequest(reqPath: string): boolean {
  return reqPath.startsWith("/ccrelay/api/");
}

/**
 * Handle API request
 * @returns true if the request was handled, false otherwise
 */
export function handleApiRequest(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  // Parse URL to get pathname without query string
  const fullUrl = req.url || "";
  const reqPath = fullUrl.split("?")[0]; // Remove query string for route matching
  const method = req.method || "GET";
  // Ensure path is an API request
  if (!isApiRequest(reqPath)) {
    return false;
  }

  // Handle OPTIONS preflight
  // Handle OPTIONS preflight
  if (method === "OPTIONS") {
    setCorsHeaders(res);
    res.writeHead(200);
    res.end();
    return true;
  }

  // Set CORS headers for all responses
  setCorsHeaders(res);

  // Check for /ccrelay/api/logs/:id pattern
  const logsIdMatch = reqPath.match(/^\/ccrelay\/api\/logs\/(\d+)$/);
  if (logsIdMatch && method === "GET") {
    handleLogDetail(req, res, { id: logsIdMatch[1] }).catch(err => {
      log.error("Error handling GET /logs/:id", err);
      if (!res.headersSent) {
        sendJson(res, 500, { error: "Internal server error" });
      }
    });
    return true;
  }

  // Check for DELETE /ccrelay/api/logs
  if (reqPath === "/ccrelay/api/logs" && method === "DELETE") {
    handleDeleteLogs(req, res).catch(err => {
      log.error("Error handling DELETE /logs", err);
      sendJson(res, 500, { error: "Internal server error" });
    });
    return true;
  }

  // Check for DELETE /ccrelay/api/queue
  if (reqPath === "/ccrelay/api/queue" && method === "DELETE") {
    try {
      handleClearQueue(req, res);
    } catch (err) {
      log.error("Error handling DELETE /queue", err);
      sendJson(res, 500, { error: "Internal server error" });
    }
    return true;
  }

  // Check for POST /ccrelay/api/providers (add provider)
  if (reqPath === "/ccrelay/api/providers" && method === "POST") {
    handleAddProvider(req, res, {}).catch(err => {
      log.error("Error handling POST /providers", err);
      sendJson(res, 500, { error: "Internal server error" });
    });
    return true;
  }

  // Check for DELETE /ccrelay/api/providers/:id
  const providersIdMatch = reqPath.match(/^\/ccrelay\/api\/providers\/([a-zA-Z0-9_-]+)$/);
  if (providersIdMatch && method === "DELETE") {
    handleDeleteProvider(req, res, { id: providersIdMatch[1] });
    return true;
  }

  // Check for POST /ccrelay/api/reload
  if (reqPath === "/ccrelay/api/reload" && method === "POST") {
    handleReloadConfig(req, res, {});
    return true;
  }

  // Check for exact route matches
  if (API_ROUTES[reqPath]) {
    const handler = API_ROUTES[reqPath];
    const result = handler(req, res, {});
    // Handle async handlers
    if (result instanceof Promise) {
      result.catch(err => {
        log.error(`Error handling ${method} ${reqPath}`, err);
        if (!res.headersSent) {
          sendJson(res, 500, { error: "Internal server error" });
        }
      });
    }
    return true;
  }

  // Route not found
  sendJson(res, 404, { error: "API endpoint not found" });
  return true;
}

/**
 * Set CORS headers for response
 */
export function setCorsHeaders(res: http.ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key");
}

/**
 * Send JSON response
 */
export function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

/**
 * Parse JSON body from request
 */
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

// Export handlers for direct use
export {
  handleStatus,
  handleListProviders,
  handleAddProvider,
  handleDeleteProvider,
  handleReloadConfig,
  handleSwitchProvider,
  handleLogs,
  handleLogDetail,
  handleDeleteLogs,
  handleClearLogs,
  handleStats,
  handleVersion,
};

// Re-export setServer functions from individual modules
export { setServer as setStatusServer } from "./status";
export { setServer as setProvidersServer } from "./providers";
export { setServer as setSwitchServer } from "./switch";
