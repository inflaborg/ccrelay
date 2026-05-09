/**
 * Same-origin proxy for wizard upstream model list + endpoint tests (avoids browser CORS).
 */

/* eslint-disable @typescript-eslint/naming-convention -- upstream JSON bodies and HTTP header names */

import * as http from "http";
import { parseJsonBody, sendJson } from "./httpJson";

const REQUEST_TIMEOUT_MS = 5000;

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
  apiKey: string;
  providerType: WizardProviderType;
}

export type WizardProbeModelsResponse =
  | { ok: true; modelIds: string[] }
  | { ok: false; errorCode: "auth" | "network" | "format" };

export async function executeWizardProbeModels(
  body: WizardProbeModelsBody
): Promise<WizardProbeModelsResponse> {
  const { baseUrl, apiKey, providerType } = body;
  if (!baseUrl?.trim() || !apiKey?.trim()) {
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
    headers["x-api-key"] = apiKey.trim();
    headers["anthropic-version"] = "2023-06-01";
  } else {
    headers.authorization = `Bearer ${apiKey.trim()}`;
  }

  let res: Response;
  try {
    res = await fetch(url, { method: "GET", headers });
  } catch {
    return { ok: false, errorCode: "network" };
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, errorCode: "auth" };
  }

  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    return { ok: false, errorCode: "format" };
  }

  const ids = parseModelsResponseBody(json);
  if (ids === null) {
    return { ok: false, errorCode: "format" };
  }

  return { ok: true, modelIds: ids };
}

export async function handleWizardProbeModels(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await parseJsonBody<WizardProbeModelsBody>(req);
    if (
      !body.baseUrl ||
      !body.apiKey ||
      (body.providerType !== "anthropic" &&
        body.providerType !== "openai" &&
        body.providerType !== "openai_chat")
    ) {
      sendJson(res, 400, { error: "Missing or invalid baseUrl, apiKey, or providerType" });
      return;
    }
    const result = await executeWizardProbeModels(body);
    sendJson(res, 200, result);
  } catch (err) {
    sendJson(res, 500, {
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
}

export function inferenceTestUrl(baseUrl: string, providerType: WizardProviderType): string {
  const b = trimTrailingSlash(baseUrl.trim());
  if (providerType === "anthropic") {
    return `${b}/v1/messages`;
  }
  return `${b}/chat/completions`;
}

export function buildAuthHeaders(
  providerType: WizardProviderType,
  apiKey: string,
  authHeader?: string
): Record<string, string> {
  const mode = (authHeader ?? "authorization").toLowerCase();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    accept: "application/json",
  };
  if (mode === "authorization") {
    headers.authorization = `Bearer ${apiKey.trim()}`;
  } else if (mode === "x-api-key") {
    headers["x-api-key"] = apiKey.trim();
    if (providerType === "anthropic") {
      headers["anthropic-version"] = "2023-06-01";
    }
  } else if (authHeader) {
    headers[authHeader] = apiKey.trim();
  }
  return headers;
}

export function usesMaxCompletionTokensForOpenAiChatModel(modelId: string): boolean {
  const m = modelId.trim().toLowerCase();
  if (m.startsWith("gpt-5")) {
    return true;
  }
  if (/^o\d/.test(m)) {
    return true;
  }
  return false;
}

function openAiStyleBody(modelId: string): string {
  const base = {
    model: modelId,
    messages: [{ role: "user", content: "hi" }],
    stream: false,
  };
  if (usesMaxCompletionTokensForOpenAiChatModel(modelId)) {
    return JSON.stringify({
      ...base,
      max_completion_tokens: 1,
    });
  }
  return JSON.stringify({
    ...base,
    max_tokens: 1,
  });
}

function anthropicStyleBody(modelId: string): string {
  return JSON.stringify({
    model: modelId,
    messages: [{ role: "user", content: "hi" }],
    max_tokens: 1,
    stream: false,
  });
}

function isJsonContentType(ct: string | null): boolean {
  return Boolean(ct && ct.toLowerCase().includes("application/json"));
}

export interface WizardEndpointVariantInput {
  id: string;
  name: string;
  baseUrl: string;
  providerType: WizardProviderType;
  authHeader?: string;
}

export interface WizardEndpointTestBody {
  apiKey: string;
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

async function runSingleVariantTest(
  v: WizardEndpointVariantInput,
  apiKey: string,
  modelId: string,
  signal: AbortSignal
): Promise<{ pass: boolean; httpStatus?: number; detail?: string }> {
  if (!validateHttpsUrl(v.baseUrl)) {
    return { pass: false, detail: "format" };
  }

  const url = inferenceTestUrl(v.baseUrl, v.providerType);
  const headers = buildAuthHeaders(v.providerType, apiKey, v.authHeader);
  const body =
    v.providerType === "anthropic" ? anthropicStyleBody(modelId) : openAiStyleBody(modelId);

  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers, body, signal });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { pass: false, detail: "timeout" };
    }
    return { pass: false, detail: "network" };
  }

  const ct = res.headers.get("content-type");
  const status = res.status;

  if (status === 401 || status === 403) {
    return { pass: false, httpStatus: status, detail: "auth" };
  }

  if (status >= 500) {
    return { pass: false, httpStatus: status, detail: "server" };
  }

  if (status >= 400 && status < 500) {
    return { pass: false, httpStatus: status, detail: "client" };
  }

  if (status >= 200 && status < 300) {
    if (isJsonContentType(ct)) {
      return { pass: true, httpStatus: status };
    }
    if (ct?.toLowerCase().includes("text/html")) {
      return { pass: false, httpStatus: status, detail: "html" };
    }
    return { pass: false, httpStatus: status, detail: "format" };
  }

  return { pass: false, httpStatus: status, detail: "format" };
}

export async function executeWizardEndpointTest(
  body: WizardEndpointTestBody
): Promise<WizardEndpointTestResponse> {
  const { apiKey, modelId, variants } = body;
  const trimmedModel = modelId.trim();
  if (!trimmedModel || !apiKey?.trim() || !Array.isArray(variants) || variants.length === 0) {
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

  return { ok: true, results: lines };
}

export async function handleWizardEndpointTest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await parseJsonBody<WizardEndpointTestBody>(req);
    if (
      !body.apiKey ||
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
    const result = await executeWizardEndpointTest(body);
    sendJson(res, 200, result);
  } catch (err) {
    sendJson(res, 500, {
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
}
