/**
 * Request processing helpers - extracted from proxyRequest for clarity
 */

/* eslint-disable @typescript-eslint/naming-convention */
// HTTP headers use hyphenated names

import type * as http from "http";
import type * as url from "url";
import type { Provider, RouteType } from "../../types";
import type { Router } from "../router";
import type { LogDatabase } from "../../database";
import { applyModelMapping } from "./modelMapping";
import { convertRequestToOpenAI } from "../../converter";
import { ScopedLogger } from "../../utils/logger";

const log = new ScopedLogger("RequestProcessor");

/**
 * Block check result
 */
export interface BlockCheckResult {
  blocked: boolean;
  response?: string;
  statusCode?: number;
}

/**
 * Routing info
 */
export interface RoutingInfo {
  provider: Provider;
  isRouted: boolean;
  routeType: RouteType;
  isOpenAIProvider: boolean;
  headers: Record<string, string>;
  targetUrl: string;
  targetPath: string;
}

/**
 * Body processing result
 */
export interface BodyProcessResult {
  body: Buffer | null;
  originalRequestBody: string | undefined;
  originalModel: string | undefined;
  requestBodyLog: string | undefined;
}

/**
 * Check if request should be blocked
 */
export function checkBlocked(router: Router, path: string): BlockCheckResult {
  const result = router.shouldBlock(path);
  if (!result.blocked) {
    return { blocked: false };
  }
  return {
    blocked: true,
    response: result.response ?? JSON.stringify({ ok: true }),
    statusCode: result.responseCode ?? 200,
  };
}

/**
 * Handle blocked request - log and send response
 */
export function handleBlocked(
  res: http.ServerResponse,
  path: string,
  method: string,
  blockResult: BlockCheckResult,
  database: LogDatabase
): void {
  log.info(`${method} ${path} -> [BLOCKED]`);

  const response = blockResult.response!;
  const statusCode = blockResult.statusCode!;

  // Log blocked request
  if (database.enabled) {
    const routeType: RouteType = "block";
    database.insertLog({
      timestamp: Date.now(),
      providerId: "blocked",
      providerName: "blocked",
      method,
      path,
      targetUrl: undefined,
      responseBody: response,
      statusCode,
      duration: 0,
      success: true,
      status: "completed",
      routeType,
    });
  }

  // Send response
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const jsonResponse = JSON.parse(response);
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(jsonResponse));
  } catch {
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(response);
  }
}

/**
 * Resolve routing info for a request
 */
export function resolveRouting(
  req: http.IncomingMessage,
  path: string,
  parsedUrl: url.UrlWithParsedQuery,
  router: Router
): RoutingInfo {
  const provider = router.getTargetProvider(path);
  const isRouted = router.shouldRoute(path);
  const isOpenAIProvider = provider.providerType === "openai";
  const routeType: RouteType = isRouted ? "router" : "passthrough";

  // Log routing decision
  const routeTypeStr = isRouted ? "ROUTE" : "PASSTHROUGH";
  log.info(
    `${req.method || "GET"} ${path} -> [${routeTypeStr}] ${provider.id} (${provider.name})` +
      (isOpenAIProvider ? " [OpenAI]" : "")
  );

  // Prepare headers
  const originalHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (value) {
      originalHeaders[key] = Array.isArray(value) ? value[0] : value;
    }
  }
  const headers = router.prepareHeaders(originalHeaders, provider);

  // Build target URL
  let targetPath = path;
  let targetUrl = router.getTargetUrl(path, provider);
  if (parsedUrl.search) {
    targetUrl += parsedUrl.search;
  }

  return {
    provider,
    isRouted,
    routeType,
    isOpenAIProvider,
    headers,
    targetUrl,
    targetPath,
  };
}

/**
 * Process request body - apply model mapping and OpenAI conversion
 */
export function processBody(
  body: Buffer,
  routing: RoutingInfo,
  databaseEnabled: boolean
): BodyProcessResult {
  let result: BodyProcessResult = {
    body,
    originalRequestBody: undefined,
    originalModel: undefined,
    requestBodyLog: undefined,
  };

  // Save original body for logging
  if (databaseEnabled) {
    try {
      result.originalRequestBody = body.toString("utf-8");
    } catch {
      result.originalRequestBody = undefined;
    }
  }

  // Apply model mapping
  result.body = applyModelMapping(body, routing.provider);

  // Convert for OpenAI provider
  if (routing.isOpenAIProvider && result.body) {
    const conversion = convertForOpenAI(result.body, routing.targetPath, routing.provider);
    if (conversion) {
      result.body = conversion.body;
      result.originalModel = conversion.originalModel;
      // Update target path and URL
      routing.targetPath = conversion.newPath;
      const baseUrl = routing.provider.baseUrl.replace(/\/$/, "");
      routing.targetUrl = `${baseUrl}${conversion.newPath}`;

      log.info(
        `[OpenAI] URL conversion: ${routing.targetPath} -> ${conversion.newPath}, final="${routing.targetUrl}"`
      );
    }
  }

  // Capture request body for logging
  if (databaseEnabled && result.body) {
    try {
      result.requestBodyLog = result.body.toString("utf-8");
    } catch {
      result.requestBodyLog = undefined;
    }
  }

  return result;
}

/**
 * Convert request for OpenAI provider
 */
function convertForOpenAI(
  body: Buffer,
  path: string,
  _provider: Provider
): { body: Buffer; newPath: string; originalModel: string | undefined } | null {
  try {
    const bodyStr = body.toString("utf-8");
    const anthropicRequest = JSON.parse(bodyStr) as Record<string, unknown>;

    // Check if this looks like an Anthropic Messages API request
    if (!anthropicRequest.messages || !Array.isArray(anthropicRequest.messages)) {
      return null;
    }

    const conversionResult = convertRequestToOpenAI(
      anthropicRequest as unknown as Parameters<typeof convertRequestToOpenAI>[0],
      path
    );

    // Extract original model from the original body
    let originalModel: string | undefined;
    try {
      const originalData = JSON.parse(bodyStr) as Record<string, unknown>;
      originalModel = originalData.model as string | undefined;
    } catch {
      // ignore
    }

    return {
      body: Buffer.from(JSON.stringify(conversionResult.request), "utf-8"),
      newPath: conversionResult.newPath,
      originalModel,
    };
  } catch (err) {
    log.error("[OpenAI Conversion] Failed to convert request", err);
    return null;
  }
}
