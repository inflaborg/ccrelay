/**
 * Same-origin proxy for wizard upstream model list + endpoint tests (avoids browser CORS).
 */

/* eslint-disable @typescript-eslint/naming-convention -- upstream JSON bodies and HTTP header names */

import * as http from "http";
import type { ModelMapEntry, OpenAICompat, Provider } from "../types";
import { parseProvider } from "../config/provider-utils";
import { isOpenAIType } from "../converter";
import type { ProxyServer } from "../server/handler";
import type { RoutingContext } from "../server/request/context";
import { BodyProcessor } from "../server/request/bodyProcessor";
import { resolveInboundClientSurface } from "../server/request/apiSurfaceDetector";
import { resolveUpstreamPath } from "../server/request/routerStage";
import { buildProviderTargetUrl, prepareProviderHeaders } from "../server/router";
import { Logger } from "../utils/logger";
import { parseJsonBody, sendJson } from "./httpJson";

const log = Logger.getInstance();

const REQUEST_TIMEOUT_MS = 30_000;

/** Claude Code-shaped inbound path so conversion, mapping, and headers match a real request. */
const WIZARD_TEST_CLIENT_PATH = "/anthropic/v1/messages";

const FETCH_SKIP_HEADERS = new Set([
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "te",
]);

const bodyProcessor = new BodyProcessor();

let serverInstance: ProxyServer | null = null;

/** Wire ProxyServer so endpoint tests can resolve stored provider API keys. */
export function setServer(server: ProxyServer | null): void {
  serverInstance = server;
}

/** True when the value looks like a UI-masked key (`****…****`), not a real secret. */
export function looksLikeMaskedApiKey(apiKey: string | undefined): boolean {
  return typeof apiKey === "string" && apiKey.includes("************");
}

/**
 * Prefer a non-masked `apiKey`; otherwise look up the stored key for `providerId`.
 */
export function resolveWizardApiKey(
  apiKey: string | undefined,
  providerId: string | undefined
): string | undefined {
  const trimmed = typeof apiKey === "string" ? apiKey.trim() : "";
  if (trimmed && !looksLikeMaskedApiKey(trimmed)) {
    return trimmed;
  }
  const id = typeof providerId === "string" ? providerId.trim() : "";
  if (id && serverInstance) {
    const stored = serverInstance.getConfig().providers[id]?.apiKey?.trim();
    if (stored) {
      return stored;
    }
  }
  return undefined;
}

export type WizardProviderType = "anthropic" | "openai" | "openai_chat";

function trimTrailingSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

function validateHttpsUrl(baseUrl: string): boolean {
  try {
    const u = new URL(baseUrl.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function upstreamModelsRequestUrl(
  baseUrl: string,
  providerType: WizardProviderType
): string {
  const b = trimTrailingSlash(baseUrl.trim());
  if (providerType === "anthropic") {
    return `${b}/v1/models`;
  }
  return `${b}/models`;
}

export function parseModelsResponseBody(data: unknown): string[] | null {
  if (!data || typeof data !== "object") {
    return null;
  }
  const root = data as { data?: unknown };
  // Some providers (e.g. MiniMax) return {data: null} when no models are available
  // rather than {data: []}. Treat null/undefined data as empty list, not an error.
  if (root.data === null || root.data === undefined) {
    return [];
  }
  if (!Array.isArray(root.data)) {
    return null;
  }
  const ids: string[] = [];
  for (const item of root.data) {
    if (
      item &&
      typeof item === "object" &&
      "id" in item &&
      typeof (item as { id: unknown }).id === "string"
    ) {
      ids.push((item as { id: string }).id);
    }
  }
  return ids;
}

export interface WizardProbeModelsBody {
  baseUrl: string;
  apiKey?: string;
  providerType: WizardProviderType;
  /** When set (and apiKey is missing/masked), use the stored provider secret. */
  providerId?: string;
}

export type WizardProbeModelsResponse =
  | { ok: true; modelIds: string[] }
  | { ok: false; errorCode: "auth" | "network" | "format" };

export async function executeWizardProbeModels(
  body: WizardProbeModelsBody
): Promise<WizardProbeModelsResponse> {
  const { baseUrl, providerType } = body;
  const apiKey = resolveWizardApiKey(body.apiKey, body.providerId);
  if (!baseUrl?.trim() || !apiKey) {
    return { ok: false, errorCode: "format" };
  }
  if (!validateHttpsUrl(baseUrl)) {
    return { ok: false, errorCode: "format" };
  }

  const url = upstreamModelsRequestUrl(baseUrl, providerType);
  const headers: Record<string, string> = {
    accept: "application/json",
  };
  if (providerType === "anthropic") {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    headers.authorization = `Bearer ${apiKey}`;
  }

  log.info(`[wizard/models] Probing ${providerType} GET ${url}`);

  let res: Response;
  try {
    res = await fetch(url, { method: "GET", headers });
  } catch (err) {
    log.warn(`[wizard/models] Network error: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, errorCode: "network" };
  }

  if (res.status === 401 || res.status === 403) {
    log.warn(`[wizard/models] Auth error: HTTP ${res.status}`);
    return { ok: false, errorCode: "auth" };
  }

  if (res.status < 200 || res.status >= 300) {
    log.warn(`[wizard/models] Non-2xx status: HTTP ${res.status}`);
    return { ok: false, errorCode: "format" };
  }

  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    log.warn(`[wizard/models] Response is not valid JSON: ${text.slice(0, 200)}`);
    return { ok: false, errorCode: "format" };
  }

  const ids = parseModelsResponseBody(json);
  if (ids === null) {
    log.warn(
      `[wizard/models] Response JSON missing {data:[{id}]} structure: ${text.slice(0, 300)}`
    );
    return { ok: false, errorCode: "format" };
  }

  log.info(`[wizard/models] OK: ${ids.length} models from ${providerType}`);
  return { ok: true, modelIds: ids };
}

export async function handleWizardProbeModels(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await parseJsonBody<WizardProbeModelsBody>(req);
    const resolvedKey = resolveWizardApiKey(body.apiKey, body.providerId);
    if (
      !body.baseUrl ||
      !resolvedKey ||
      (body.providerType !== "anthropic" &&
        body.providerType !== "openai" &&
        body.providerType !== "openai_chat")
    ) {
      sendJson(res, 400, { error: "Missing or invalid baseUrl, apiKey, or providerType" });
      return;
    }
    const result = await executeWizardProbeModels({
      ...body,
      apiKey: resolvedKey,
    });
    sendJson(res, 200, result);
  } catch (err) {
    sendJson(res, 500, {
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
}

function isJsonContentType(ct: string | null): boolean {
  return Boolean(ct && ct.toLowerCase().includes("application/json"));
}

export interface WizardEndpointVariantInput {
  id: string;
  name: string;
  baseUrl: string;
  providerType: WizardProviderType;
  mode?: "passthrough" | "inject";
  authHeader?: string;
  headers?: Record<string, string>;
  modelMap?: ModelMapEntry[];
  vlModelMap?: ModelMapEntry[];
  modelMappingEnabled?: boolean;
  openaiCompat?: OpenAICompat;
  useCustomModelsList?: boolean;
  customModelsList?: string[];
}

export interface WizardEndpointTestBody {
  apiKey?: string;
  /** When set (and apiKey is missing/masked), use the stored provider secret. */
  providerId?: string;
  modelId: string;
  variants: WizardEndpointVariantInput[];
}

export interface WizardEndpointTestResultLine {
  id: string;
  pass: boolean;
  httpStatus?: number;
  detail?: string;
}

export interface WizardEndpointTestResponse {
  ok: true;
  results: WizardEndpointTestResultLine[];
}

function snapshotToTempProvider(v: WizardEndpointVariantInput, apiKey: string): Provider {
  const id = v.id.trim() || "wizard-test";
  return parseProvider(id, {
    name: (v.name || id).trim() || id,
    baseUrl: v.baseUrl.trim(),
    mode: v.mode ?? "inject",
    providerType: v.providerType,
    apiKey,
    authHeader: v.authHeader,
    modelMap: v.modelMap,
    vlModelMap: v.vlModelMap,
    ...(v.modelMappingEnabled !== undefined ? { modelMappingEnabled: v.modelMappingEnabled } : {}),
    headers: v.headers,
    useCustomModelsList: v.useCustomModelsList === true,
    ...(v.useCustomModelsList === true ? { customModelsList: v.customModelsList ?? [] } : {}),
    ...(v.openaiCompat !== undefined ? { openaiCompat: v.openaiCompat } : {}),
    enabled: true,
  });
}

function wizardProbeBody(modelId: string): Buffer {
  return Buffer.from(
    JSON.stringify({
      model: modelId,
      messages: [{ role: "user", content: "hi" }],
      stream: false,
    }),
    "utf-8"
  );
}

function clientHeadersForTempProvider(provider: Provider, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
    "anthropic-version": "2023-06-01",
  };
  if (provider.mode === "passthrough") {
    const authHeader = (provider.authHeader || "authorization").toLowerCase();
    if (authHeader === "authorization") {
      headers.authorization = `Bearer ${apiKey}`;
    } else if (authHeader === "x-api-key") {
      headers["x-api-key"] = apiKey;
    } else if (provider.authHeader) {
      headers[provider.authHeader] = apiKey;
    }
  } else {
    headers["x-api-key"] = "ccrelay-wizard-test";
    headers.authorization = "Bearer ccrelay-wizard-test";
  }
  return headers;
}

function buildTempRouting(provider: Provider, apiKey: string): RoutingContext {
  const method = "POST";
  const path = WIZARD_TEST_CLIENT_PATH;
  const clientHeaders = clientHeadersForTempProvider(provider, apiKey);
  const headers = prepareProviderHeaders(clientHeaders, provider);
  const targetPath = resolveUpstreamPath(method, path);
  const targetUrl = buildProviderTargetUrl(targetPath, provider);
  return {
    blocked: false,
    method,
    path,
    provider,
    clientHeaders,
    headers,
    targetUrl,
    targetPath,
    targetQuery: "",
    isRouted: false,
    isOpenAIProvider: isOpenAIType(provider.providerType),
    clientSurface: resolveInboundClientSurface(method, path, provider),
  };
}

/** Anthropic Messages requires max_tokens; omit it on OpenAI-compat outbound. */
function ensureAnthropicOutboundMaxTokens(body: Buffer, targetPath: string): Buffer {
  if (targetPath !== "/v1/messages" || !body.length) {
    return body;
  }
  try {
    const data = JSON.parse(body.toString("utf-8")) as Record<string, unknown>;
    if (typeof data.max_tokens === "number" && data.max_tokens > 0) {
      return body;
    }
    data.max_tokens = 4096;
    return Buffer.from(JSON.stringify(data), "utf-8");
  } catch {
    return body;
  }
}

function headersForFetch(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (FETCH_SKIP_HEADERS.has(key.toLowerCase())) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

async function runSingleVariantTest(
  v: WizardEndpointVariantInput,
  apiKey: string,
  modelId: string,
  signal: AbortSignal
): Promise<{ pass: boolean; httpStatus?: number; detail?: string }> {
  if (!validateHttpsUrl(v.baseUrl)) {
    log.warn(`[wizard/test] ${v.id}: invalid baseUrl "${v.baseUrl}"`);
    return { pass: false, detail: "format" };
  }

  const provider = snapshotToTempProvider(v, apiKey);
  const routing = buildTempRouting(provider, apiKey);
  const processed = bodyProcessor.process(wizardProbeBody(modelId), routing, false);
  const outboundBody = ensureAnthropicOutboundMaxTokens(processed.body, routing.targetPath);
  const url = routing.targetUrl;
  const headers = headersForFetch(routing.headers);
  const start = Date.now();

  log.info(`[wizard/test] ${v.id}: POST ${url} (timeout=${REQUEST_TIMEOUT_MS}ms)`);

  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers, body: outboundBody, signal });
  } catch (e) {
    const elapsed = Date.now() - start;
    if (e instanceof Error && e.name === "AbortError") {
      log.warn(`[wizard/test] ${v.id}: timeout after ${elapsed}ms`);
      return { pass: false, detail: "timeout" };
    }
    log.warn(
      `[wizard/test] ${v.id}: network error after ${elapsed}ms: ${e instanceof Error ? e.message : String(e)}`
    );
    return { pass: false, detail: "network" };
  }

  const elapsed = Date.now() - start;
  const ct = res.headers.get("content-type");
  const status = res.status;

  if (status === 401 || status === 403) {
    const text = await res.text();
    log.warn(
      `[wizard/test] ${v.id}: auth error HTTP ${status} (${elapsed}ms): ${text.slice(0, 200)}`
    );
    return { pass: false, httpStatus: status, detail: "auth" };
  }

  if (status >= 500) {
    const text = await res.text();
    log.warn(
      `[wizard/test] ${v.id}: server error HTTP ${status} (${elapsed}ms): ${text.slice(0, 200)}`
    );
    return { pass: false, httpStatus: status, detail: "server" };
  }

  if (status >= 400 && status < 500) {
    const text = await res.text();
    log.warn(
      `[wizard/test] ${v.id}: client error HTTP ${status} (${elapsed}ms): ${text.slice(0, 200)}`
    );
    return { pass: false, httpStatus: status, detail: "client" };
  }

  if (status >= 200 && status < 300) {
    if (isJsonContentType(ct)) {
      log.info(`[wizard/test] ${v.id}: pass HTTP ${status} (${elapsed}ms)`);
      return { pass: true, httpStatus: status };
    }
    const text = await res.text();
    if (ct?.toLowerCase().includes("text/html")) {
      log.warn(
        `[wizard/test] ${v.id}: got HTML response (${elapsed}ms), ct=${ct}: ${text.slice(0, 200)}`
      );
      return { pass: false, httpStatus: status, detail: "html" };
    }
    log.warn(
      `[wizard/test] ${v.id}: unexpected content-type (${elapsed}ms), ct=${ct}: ${text.slice(0, 200)}`
    );
    return { pass: false, httpStatus: status, detail: "format" };
  }

  log.warn(`[wizard/test] ${v.id}: unexpected HTTP ${status} (${elapsed}ms), ct=${ct}`);
  return { pass: false, httpStatus: status, detail: "format" };
}

export async function executeWizardEndpointTest(
  body: WizardEndpointTestBody
): Promise<WizardEndpointTestResponse> {
  const { modelId, variants } = body;
  const apiKey = resolveWizardApiKey(body.apiKey, body.providerId);
  const trimmedModel = modelId.trim();
  if (!trimmedModel || !apiKey || !Array.isArray(variants) || variants.length === 0) {
    return { ok: true, results: [] };
  }

  const results = await Promise.all(
    variants.map(v => {
      const ac = new AbortController();
      const tid = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
      return runSingleVariantTest(v, apiKey, trimmedModel, ac.signal).finally(() =>
        clearTimeout(tid)
      );
    })
  );

  const lines: WizardEndpointTestResultLine[] = variants.map((v, i) => {
    const r = results[i];
    return {
      id: v.id,
      pass: r.pass,
      httpStatus: r.httpStatus,
      detail: r.detail,
    };
  });

  const summary = lines.map(l => `${l.id}:${l.pass ? "pass" : (l.detail ?? "fail")}`).join(", ");
  log.info(`[wizard/test] results: ${summary}`);

  return { ok: true, results: lines };
}

export async function handleWizardEndpointTest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await parseJsonBody<WizardEndpointTestBody>(req);
    const resolvedKey = resolveWizardApiKey(body.apiKey, body.providerId);
    if (
      !resolvedKey ||
      !body.modelId ||
      !Array.isArray(body.variants) ||
      body.variants.length === 0
    ) {
      sendJson(res, 400, { error: "Missing apiKey, modelId, or variants" });
      return;
    }
    for (const v of body.variants) {
      if (
        !v.id ||
        !v.baseUrl ||
        (v.providerType !== "anthropic" &&
          v.providerType !== "openai" &&
          v.providerType !== "openai_chat")
      ) {
        sendJson(res, 400, { error: "Invalid variant entry" });
        return;
      }
    }
    const result = await executeWizardEndpointTest({
      ...body,
      apiKey: resolvedKey,
    });
    sendJson(res, 200, result);
  } catch (err) {
    sendJson(res, 500, {
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
}
