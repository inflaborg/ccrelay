/**
 * Client tool configuration (Claude Code ~/.claude/settings.json, Codex ~/.codex/config.toml)
 * GET/POST /ccrelay/api/client-config
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import type { ProxyServer } from "../server/handler";
import { CCRELAY_MODEL_ALIAS_HEADER } from "../converter/models-fallback";
import { redactHomeInPath } from "../utils/path-display";
import {
  claudeDesktopDir,
  detectClaudeCliVersion,
  scanClaudeDesktopBundles,
  type ClaudeCliVersionInfo,
  type ClaudeDesktopBundleVersions,
} from "./clientVersion";

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  // eslint-disable-next-line @typescript-eslint/naming-convention -- HTTP response header
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function parseJsonBody<T>(req: http.IncomingMessage): Promise<T> {
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

let serverInstance: ProxyServer | null = null;

export function setServer(server: ProxyServer | null): void {
  serverInstance = server;
}

const CLAUDE_SETTINGS = () => path.join(os.homedir(), ".claude", "settings.json");
const CODEX_CONFIG = () => path.join(os.homedir(), ".codex", "config.toml");

// Re-export for tests and callers that imported from clientConfig historically.
export { claudeDesktopDir } from "./clientVersion";
export type { ClaudeCliVersionInfo, ClaudeDesktopBundleVersions } from "./clientVersion";

export type ClientConfigItemStatus = "ok" | "missing" | "wrong_target" | "invalid";

export interface ClientConfigField {
  key: string;
  expected: string;
  current?: string;
  ok: boolean;
}

export interface ClientConfigItem {
  status: ClientConfigItemStatus;
  filePath: string;
  fields: ClientConfigField[];
  /** e.g. ANTHROPIC_BASE_URL or Codex base_url */
  currentValue?: string;
  /** Claude Desktop inferenceCustomHeaders when readable */
  customHeaders?: Record<string, string>;
  /** Expected Claude Desktop inferenceCustomHeaders for Cowork alias mode */
  expectedCustomHeaders?: Record<string, string>;
  /** For Codex, which model_provider is selected */
  modelProvider?: string;
  /** For Codex, the current model value from config.toml */
  model?: string;
  message?: string;
}

function formatScalarFieldValue(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return undefined;
}

function resolveStatusFromFields(
  fields: ClientConfigField[],
  options: { baseUrlKey?: string; hasInvalidBaseType?: boolean }
): ClientConfigItemStatus {
  if (options.hasInvalidBaseType) {
    return "wrong_target";
  }
  const baseKey = options.baseUrlKey;
  if (baseKey) {
    const baseField = fields.find(f => f.key === baseKey);
    if (baseField && !baseField.ok && baseField.current !== undefined && baseField.current !== "") {
      return "wrong_target";
    }
  }
  if (fields.every(f => f.ok)) {
    return "ok";
  }
  return "missing";
}

function itemFromFields(
  filePath: string,
  fields: ClientConfigField[],
  options?: {
    baseUrlKey?: string;
    hasInvalidBaseType?: boolean;
    message?: string;
    currentValue?: string;
    customHeaders?: Record<string, string>;
    expectedCustomHeaders?: Record<string, string>;
    modelProvider?: string;
    model?: string;
  }
): ClientConfigItem {
  const status = resolveStatusFromFields(fields, {
    baseUrlKey: options?.baseUrlKey,
    hasInvalidBaseType: options?.hasInvalidBaseType,
  });
  return {
    status,
    filePath: redactHomeInPath(filePath),
    fields,
    ...(options?.currentValue !== undefined ? { currentValue: options.currentValue } : {}),
    ...(options?.customHeaders !== undefined ? { customHeaders: options.customHeaders } : {}),
    ...(options?.expectedCustomHeaders !== undefined
      ? { expectedCustomHeaders: options.expectedCustomHeaders }
      : {}),
    ...(options?.modelProvider !== undefined ? { modelProvider: options.modelProvider } : {}),
    ...(options?.model !== undefined ? { model: options.model } : {}),
    ...(options?.message !== undefined ? { message: options.message } : {}),
  };
}

/** Optional Claude Code env overrides (CCRelay modelMap usually enough). */
export interface ClaudeDefaultModels {
  opus?: string;
  sonnet?: string;
  haiku?: string;
}

export interface ClientConfigGetResponse {
  expectedAnthropicBase: string;
  expectedCodexBaseUrl: string;
  port: number;
  claudeDesktop: ClientConfigItem | null;
  claudeCode: ClientConfigItem;
  codex: ClientConfigItem;
  /** Parsed from settings.json env when file is readable */
  claudeDefaultModels: ClaudeDefaultModels;
  claudeDesktopBundles: ClaudeDesktopBundleVersions;
  claudeCli: ClaudeCliVersionInfo;
}

/** localhost / 127.0.0.1 / ::1, matching port, and `/anthropic` prefix (Anthropic Messages API base_url) */
export function isLocalProxyAnthropicBase(urlStr: string, port: number): boolean {
  const t = urlStr.trim();
  if (!t) {
    return false;
  }
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return false;
  }
  const h = u.hostname;
  if (h !== "localhost" && h !== "127.0.0.1" && h !== "[::1]" && h !== "::1") {
    return false;
  }
  const p = u.port ? parseInt(u.port, 10) : u.protocol === "https:" ? 443 : 80;
  if (p !== port) {
    return false;
  }
  return u.pathname === "/anthropic" || u.pathname === "/anthropic/";
}

/** localhost / 127.0.0.1 / ::1, matching port, and `/openai` prefix (Codex/OpenAI-compatible base_url) */
export function isLocalProxyCodexBase(urlStr: string, port: number): boolean {
  const t = urlStr.trim();
  if (!t) {
    return false;
  }
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return false;
  }
  const h = u.hostname;
  if (h !== "localhost" && h !== "127.0.0.1" && h !== "[::1]" && h !== "::1") {
    return false;
  }
  const p = u.port ? parseInt(u.port, 10) : u.protocol === "https:" ? 443 : 80;
  if (p !== port) {
    return false;
  }
  return u.pathname === "/openai" || u.pathname === "/openai/";
}

/* eslint-disable @typescript-eslint/naming-convention -- Claude Code settings.json env object keys */
function buildClaudeDefaultEnv(port: number): Record<string, string | number> {
  return {
    ANTHROPIC_AUTH_TOKEN: "ccrelay_apikey_placehold_do_not_need_to_setup_here",
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}/anthropic`,
    API_TIMEOUT_MS: "3000000",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 1,
  };
}

function isNonEmptyScalar(v: unknown): boolean {
  if (v === undefined || v === null) {
    return false;
  }
  if (typeof v === "string") {
    return v.trim() !== "";
  }
  if (typeof v === "number" || typeof v === "boolean") {
    return true;
  }
  return false;
}

function isTruthyEnvFlag(v: unknown): boolean {
  if (v === true || v === 1) {
    return true;
  }
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    return t === "1" || t === "true";
  }
  return false;
}

function isPositiveNumericString(v: unknown): boolean {
  if (v === undefined || v === null) {
    return false;
  }
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim()) : NaN;
  return Number.isFinite(n) && n > 0;
}

function findHeaderValueCaseInsensitive(
  headers: Record<string, string>,
  canonicalKey: string
): string | undefined {
  const target = canonicalKey.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === target) {
      return String(v);
    }
  }
  return undefined;
}

export function buildClaudeCodeFields(
  env: Record<string, unknown> | undefined,
  port: number
): ClientConfigField[] {
  const baseUrlRaw = env?.ANTHROPIC_BASE_URL;
  const baseUrlStr = formatScalarFieldValue(baseUrlRaw)?.trim();
  const baseOk = baseUrlStr ? isLocalProxyAnthropicBase(baseUrlStr, port) : false;
  const authToken = env?.ANTHROPIC_AUTH_TOKEN;
  const timeout = env?.API_TIMEOUT_MS;
  const disableTraffic = env?.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;

  return [
    {
      key: "ANTHROPIC_BASE_URL",
      expected: `http://127.0.0.1:${port}/anthropic`,
      current: baseUrlStr,
      ok: baseOk,
    },
    {
      key: "ANTHROPIC_AUTH_TOKEN",
      expected: "(non-empty)",
      current: formatScalarFieldValue(authToken),
      ok: isNonEmptyScalar(authToken),
    },
    {
      key: "API_TIMEOUT_MS",
      expected: "(positive number)",
      current: formatScalarFieldValue(timeout),
      ok: isPositiveNumericString(timeout),
    },
    {
      key: "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
      expected: "(truthy)",
      current: formatScalarFieldValue(disableTraffic),
      ok: isTruthyEnvFlag(disableTraffic),
    },
  ];
}

export function getClaudeCodeEnvGaps(
  env: Record<string, unknown> | undefined,
  port: number
): string[] {
  return buildClaudeCodeFields(env, port)
    .filter(f => !f.ok)
    .map(f => f.key);
}
/* eslint-enable @typescript-eslint/naming-convention */

function readClaudeDefaultModelsFromFile(claudePath: string): ClaudeDefaultModels {
  if (!fs.existsSync(claudePath)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(claudePath, "utf-8");
    const parsed = JSON.parse(raw) as { env?: Record<string, unknown> };
    const env = parsed.env || {};
    const s = (key: string): string | undefined => {
      const v = env[key];
      if (v === undefined || v === null) {
        return undefined;
      }
      if (typeof v === "string" || typeof v === "number") {
        return String(v);
      }
      return undefined;
    };
    return {
      opus: s("ANTHROPIC_DEFAULT_OPUS_MODEL"),
      sonnet: s("ANTHROPIC_DEFAULT_SONNET_MODEL"),
      haiku: s("ANTHROPIC_DEFAULT_HAIKU_MODEL"),
    };
  } catch {
    return {};
  }
}

export const CODEX_DEFAULT_MODEL = "gpt-5.4-mini";

function buildCodexTemplate(port: number, model: string): string {
  return `# Generated by CCRelay dashboard — Codex -> local proxy
model = "${model}"
model_provider = "ccrelay"

[model_providers.ccrelay]
name = "CCRelay"
base_url = "http://127.0.0.1:${port}/openai"
`;
}

type ParsedTomlLite = {
  top: Record<string, string>;
  sections: Record<string, Record<string, string>>;
};

/** Minimal TOML parse for key = value and [table] (Codex config shape). */
export function parseTomlLite(content: string): ParsedTomlLite {
  const top: Record<string, string> = {};
  const sections: Record<string, Record<string, string>> = {};
  let current = "";
  for (const line of content.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) {
      continue;
    }
    const section = t.match(/^\[([^\]]+)\]$/);
    if (section) {
      current = section[1];
      continue;
    }
    const eq = t.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (current) {
      if (!sections[current]) {
        sections[current] = {};
      }
      sections[current][key] = val;
    } else {
      top[key] = val;
    }
  }
  return { top, sections };
}

function detectClaude(claudePath: string, port: number): ClientConfigItem {
  const filePath = claudePath;
  if (!fs.existsSync(claudePath)) {
    return itemFromFields(filePath, buildClaudeCodeFields(undefined, port), {
      baseUrlKey: "ANTHROPIC_BASE_URL",
    });
  }
  const raw = fs.readFileSync(claudePath, "utf-8");
  let parsed: { env?: Record<string, unknown> };
  try {
    parsed = JSON.parse(raw) as { env?: Record<string, unknown> };
  } catch {
    return {
      status: "invalid",
      filePath: redactHomeInPath(filePath),
      fields: [],
      message: "Invalid JSON",
    };
  }

  const env = parsed.env;
  const base = env?.ANTHROPIC_BASE_URL;
  const baseStr =
    base === undefined || base === null
      ? undefined
      : typeof base === "string" || typeof base === "number"
        ? String(base).trim()
        : undefined;

  const fields = buildClaudeCodeFields(env, port);

  if (baseStr === undefined) {
    if (base !== undefined && base !== null) {
      return itemFromFields(filePath, fields, {
        baseUrlKey: "ANTHROPIC_BASE_URL",
        hasInvalidBaseType: true,
        currentValue: JSON.stringify(base),
        message: "ANTHROPIC_BASE_URL must be a string",
      });
    }
    return itemFromFields(filePath, fields, {
      baseUrlKey: "ANTHROPIC_BASE_URL",
      message: "ANTHROPIC_BASE_URL not set in env",
    });
  }

  if (baseStr === "") {
    return itemFromFields(filePath, fields, {
      baseUrlKey: "ANTHROPIC_BASE_URL",
      message: "ANTHROPIC_BASE_URL not set in env",
    });
  }

  return itemFromFields(filePath, fields, {
    baseUrlKey: "ANTHROPIC_BASE_URL",
    currentValue: baseStr,
  });
}

export function buildCodexFields(toml: ParsedTomlLite, port: number): ClientConfigField[] {
  const expectedBase = `http://127.0.0.1:${port}/openai`;
  const modelProvider = toml.top.model_provider;
  const model = toml.top.model;
  const baseUrl = modelProvider
    ? toml.sections[`model_providers.${modelProvider}`]?.base_url
    : undefined;

  return [
    {
      key: "model_provider",
      expected: "ccrelay",
      current: modelProvider,
      ok: modelProvider === "ccrelay",
    },
    {
      key: "model_providers.ccrelay.base_url",
      expected: expectedBase,
      current: baseUrl,
      ok: baseUrl ? isLocalProxyCodexBase(baseUrl, port) : false,
    },
    {
      key: "model",
      expected: "(any non-empty)",
      current: model?.trim() || undefined,
      ok: Boolean(model?.trim()),
    },
  ];
}

function detectCodex(codexPath: string, port: number): ClientConfigItem {
  const filePath = codexPath;
  if (!fs.existsSync(codexPath)) {
    return itemFromFields(filePath, buildCodexFields({ top: {}, sections: {} }, port), {
      baseUrlKey: "model_providers.ccrelay.base_url",
    });
  }
  const raw = fs.readFileSync(codexPath, "utf-8");
  const toml = parseTomlLite(raw);
  const modelProvider = toml.top.model_provider;
  const model = toml.top.model;
  const fields = buildCodexFields(toml, port);
  const baseUrl = modelProvider
    ? toml.sections[`model_providers.${modelProvider}`]?.base_url
    : undefined;

  return itemFromFields(filePath, fields, {
    baseUrlKey: "model_providers.ccrelay.base_url",
    currentValue: baseUrl,
    modelProvider,
    model,
  });
}

interface ClaudeDesktopMeta {
  appliedId: string;
  entries: Array<{ id: string; name: string }>;
}

function readClaudeDesktopMeta(dir: string): ClaudeDesktopMeta | null {
  const metaPath = path.join(dir, "configLibrary", "_meta.json");
  if (!fs.existsSync(metaPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(metaPath, "utf-8");
    const parsed = JSON.parse(raw) as ClaudeDesktopMeta;
    if (typeof parsed.appliedId === "string" && parsed.appliedId.trim()) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function readClaudeDesktopCustomHeaders(
  parsed: Record<string, unknown>
): Record<string, string> | undefined {
  const custom = parsed.inferenceCustomHeaders;
  if (!custom || typeof custom !== "object" || Array.isArray(custom)) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(custom as Record<string, unknown>)) {
    if (typeof value === "string" || typeof value === "number") {
      out[key] = String(value);
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function expectedClaudeDesktopCustomHeaders(): Record<string, string> {
  return { [CCRELAY_MODEL_ALIAS_HEADER]: "1" };
}

export function hasExpectedClaudeDesktopCustomHeaders(
  headers: Record<string, string> | undefined
): boolean {
  if (!headers) {
    return false;
  }
  const alias = findHeaderValueCaseInsensitive(headers, CCRELAY_MODEL_ALIAS_HEADER);
  return alias !== undefined && alias.trim() !== "";
}

export function isCoworkEgressAllowed(hosts: unknown): boolean {
  return Array.isArray(hosts) && hosts.length > 0 && hosts.some(entry => String(entry) === "*");
}

export function buildClaudeDesktopFields(
  parsed: Record<string, unknown>,
  port: number,
  deploymentMode?: string
): ClientConfigField[] {
  const customHeaders = readClaudeDesktopCustomHeaders(parsed);

  const baseUrl = parsed.inferenceGatewayBaseUrl;
  let trimmedBase: string | undefined;
  let baseOk = false;
  if (typeof baseUrl === "string" && baseUrl.trim()) {
    trimmedBase = baseUrl.trim();
    baseOk = isLocalProxyAnthropicBase(trimmedBase, port);
  }

  const fields: ClientConfigField[] = [
    {
      key: "inferenceGatewayBaseUrl",
      expected: `http://127.0.0.1:${port}/anthropic`,
      current: trimmedBase,
      ok: baseOk,
    },
    {
      key: "inferenceProvider",
      expected: "gateway",
      current: formatScalarFieldValue(parsed.inferenceProvider),
      ok: parsed.inferenceProvider === "gateway",
    },
    {
      key: "inferenceGatewayApiKey",
      expected: "(non-empty)",
      current: formatScalarFieldValue(parsed.inferenceGatewayApiKey),
      ok:
        typeof parsed.inferenceGatewayApiKey === "string" &&
        String(parsed.inferenceGatewayApiKey).trim() !== "",
    },
    {
      key: "coworkEgressAllowedHosts",
      expected: '(non-empty array including "*")',
      current: formatScalarFieldValue(parsed.coworkEgressAllowedHosts),
      ok: isCoworkEgressAllowed(parsed.coworkEgressAllowedHosts),
    },
    {
      key: "inferenceCustomHeaders",
      expected: "x-ccrelay-model-alias: (non-empty, key case-insensitive)",
      current: customHeaders ? JSON.stringify(customHeaders) : undefined,
      ok: hasExpectedClaudeDesktopCustomHeaders(customHeaders),
    },
    {
      key: "inferenceGatewayHeaders",
      expected: "(absent)",
      current:
        parsed.inferenceGatewayHeaders === undefined
          ? undefined
          : formatScalarFieldValue(parsed.inferenceGatewayHeaders),
      ok: parsed.inferenceGatewayHeaders === undefined,
    },
    {
      key: "disableEssentialTelemetry",
      expected: "true",
      current: formatScalarFieldValue(parsed.disableEssentialTelemetry),
      ok: parsed.disableEssentialTelemetry === true,
    },
    {
      key: "disableNonessentialTelemetry",
      expected: "true",
      current: formatScalarFieldValue(parsed.disableNonessentialTelemetry),
      ok: parsed.disableNonessentialTelemetry === true,
    },
    {
      key: "deploymentMode",
      expected: "3p",
      current: deploymentMode,
      ok: deploymentMode === "3p",
    },
  ];

  return fields;
}

export function getClaudeDesktopConfigGaps(
  parsed: Record<string, unknown>,
  port: number,
  deploymentMode?: string
): { baseOk: boolean; trimmedBase?: string; gaps: string[] } {
  const fields = buildClaudeDesktopFields(parsed, port, deploymentMode);
  const baseField = fields.find(f => f.key === "inferenceGatewayBaseUrl");
  return {
    baseOk: baseField?.ok ?? false,
    trimmedBase: baseField?.current,
    gaps: fields.filter(f => !f.ok).map(f => f.key),
  };
}

function readClaudeDesktopDeploymentMode(dir: string): string | undefined {
  const desktopConfigPath = path.join(dir, "claude_desktop_config.json");
  if (!fs.existsSync(desktopConfigPath)) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(desktopConfigPath, "utf-8")) as Record<
      string,
      unknown
    >;
    return typeof parsed.deploymentMode === "string" ? parsed.deploymentMode : undefined;
  } catch {
    return undefined;
  }
}

function evaluateClaudeDesktopConfig(
  configPath: string,
  parsed: Record<string, unknown>,
  port: number,
  deploymentMode?: string
): ClientConfigItem {
  const expectedCustomHeaders = expectedClaudeDesktopCustomHeaders();
  const customHeaders = readClaudeDesktopCustomHeaders(parsed);
  const fields = buildClaudeDesktopFields(parsed, port, deploymentMode);
  const baseField = fields.find(f => f.key === "inferenceGatewayBaseUrl");

  return itemFromFields(configPath, fields, {
    baseUrlKey: "inferenceGatewayBaseUrl",
    currentValue: baseField?.current,
    customHeaders,
    expectedCustomHeaders,
  });
}

function detectClaudeDesktop(dir: string | null, port: number): ClientConfigItem | null {
  if (!dir) {
    return null;
  }
  const filePath = path.join(dir, "configLibrary");
  if (!fs.existsSync(dir)) {
    return itemFromFields(filePath, buildClaudeDesktopFields({}, port), {
      baseUrlKey: "inferenceGatewayBaseUrl",
    });
  }
  const meta = readClaudeDesktopMeta(dir);
  if (!meta) {
    return itemFromFields(path.join(filePath, "_meta.json"), buildClaudeDesktopFields({}, port), {
      baseUrlKey: "inferenceGatewayBaseUrl",
    });
  }
  const configPath = path.join(filePath, `${meta.appliedId}.json`);
  if (!fs.existsSync(configPath)) {
    return itemFromFields(configPath, buildClaudeDesktopFields({}, port), {
      baseUrlKey: "inferenceGatewayBaseUrl",
    });
  }
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const deploymentMode = readClaudeDesktopDeploymentMode(dir);
    return evaluateClaudeDesktopConfig(configPath, parsed, port, deploymentMode);
  } catch {
    return {
      status: "invalid",
      filePath: redactHomeInPath(configPath),
      fields: [],
      message: "Invalid JSON",
    };
  }
}

/**
 * GET /ccrelay/api/client-config
 */
export async function handleGetClientConfig(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  if (!serverInstance) {
    sendJson(res, 503, { error: "Server not initialized" });
    return;
  }
  const routerConfig = serverInstance.getConfig().configValue;
  const port = routerConfig.port;
  const expectedAnthropicBase = `http://127.0.0.1:${port}/anthropic`;
  const expectedCodexBaseUrl = `http://127.0.0.1:${port}/openai`;
  const claudePath = CLAUDE_SETTINGS();
  const detectionEnabled = routerConfig.clientVersionDetection?.enabled !== false;
  const claudeCli = await detectClaudeCliVersion({ enabled: detectionEnabled });
  const body: ClientConfigGetResponse = {
    expectedAnthropicBase,
    expectedCodexBaseUrl,
    port,
    claudeCode: detectClaude(claudePath, port),
    codex: detectCodex(CODEX_CONFIG(), port),
    claudeDesktop: detectClaudeDesktop(claudeDesktopDir(), port),
    claudeDefaultModels: readClaudeDefaultModelsFromFile(claudePath),
    claudeDesktopBundles: scanClaudeDesktopBundles(claudeDesktopDir()),
    claudeCli,
  };
  sendJson(res, 200, body);
}

type ApplyTarget = "claudeCode" | "codex" | "claudeDesktop";

/**
 * POST /ccrelay/api/client-config/apply
 * Body: { target, overwrite?, patchClaudeModelsOnly?, claudeDefaultModels? }
 */
export async function handleApplyClientConfig(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  if (!serverInstance) {
    sendJson(res, 503, { error: "Server not initialized" });
    return;
  }
  const port = serverInstance.getConfig().port;
  const claudePath = CLAUDE_SETTINGS();
  const codexPath = CODEX_CONFIG();
  const existingClaude = detectClaude(claudePath, port);
  const existingCodex = detectCodex(codexPath, port);

  try {
    const body = await parseJsonBody<{
      target?: ApplyTarget;
      overwrite?: boolean;
      model?: string;
      restore?: boolean;
      patchClaudeModelsOnly?: boolean;
      patchCodexModelOnly?: boolean;
      claudeDefaultModels?: { opus?: string; sonnet?: string; haiku?: string };
    }>(req);
    const target = body.target;
    const overwrite = Boolean(body.overwrite);
    if (target !== "claudeCode" && target !== "codex" && target !== "claudeDesktop") {
      sendJson(res, 400, {
        status: "error",
        message: "target must be claudeCode, codex, or claudeDesktop",
      });
      return;
    }

    // ── Restore mode: remove CCRelay-injected settings ──
    if (body.restore) {
      if (target === "claudeCode") {
        if (!fs.existsSync(claudePath)) {
          sendJson(res, 200, { status: "ok", message: "No settings.json to clean up" });
          return;
        }
        let root: Record<string, unknown>;
        try {
          root = JSON.parse(fs.readFileSync(claudePath, "utf-8")) as Record<string, unknown>;
        } catch {
          sendJson(res, 200, { status: "ok", message: "File is not valid JSON, nothing to clean" });
          return;
        }
        const env = (root.env as Record<string, unknown>) || {};
        const keysToRemove = [
          "ANTHROPIC_BASE_URL",
          "ANTHROPIC_AUTH_TOKEN",
          "API_TIMEOUT_MS",
          "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
          "ANTHROPIC_DEFAULT_OPUS_MODEL",
          "ANTHROPIC_DEFAULT_SONNET_MODEL",
          "ANTHROPIC_DEFAULT_HAIKU_MODEL",
        ];
        let removed = 0;
        for (const key of keysToRemove) {
          if (key in env) {
            delete env[key];
            removed++;
          }
        }
        root.env = env;
        fs.writeFileSync(claudePath, `${JSON.stringify(root, null, 2)}\n`, "utf-8");
        sendJson(res, 200, {
          status: "ok",
          message: `Removed ${removed} CCRelay key(s) from ${claudePath}`,
        });
        return;
      }

      if (target === "codex") {
        if (!fs.existsSync(codexPath)) {
          sendJson(res, 200, { status: "ok", message: "No config.toml to clean up" });
          return;
        }
        const raw = fs.readFileSync(codexPath, "utf-8");
        const toml = parseTomlLite(raw);
        const provider = toml.top.model_provider;
        let lines = raw.split(/\r?\n/);
        // Remove model_provider line if it references ccrelay
        if (provider === "ccrelay") {
          lines = lines.filter(l => !/^\s*model_provider\s*=\s*"ccrelay"\s*$/.test(l));
        }
        // Remove [model_providers.ccrelay] section
        let inSection = false;
        lines = lines.filter(l => {
          if (/^\s*\[model_providers\.ccrelay\]\s*$/.test(l)) {
            inSection = true;
            return false;
          }
          if (inSection) {
            if (/^\s*\[/.test(l)) {
              inSection = false;
              return true;
            }
            return false;
          }
          return true;
        });
        // Reset model to default
        lines = lines.map(l =>
          l.replace(/^(\s*model\s*=\s*)".*"(\s*)$/m, `$1"${CODEX_DEFAULT_MODEL}"$2`)
        );
        fs.writeFileSync(codexPath, lines.join("\n"), "utf-8");
        sendJson(res, 200, {
          status: "ok",
          message: `Removed CCRelay provider from ${codexPath}`,
        });
        return;
      }

      if (target === "claudeDesktop") {
        const dir = claudeDesktopDir();
        if (!dir || !fs.existsSync(dir)) {
          sendJson(res, 200, { status: "ok", message: "No Claude-3p directory to clean up" });
          return;
        }
        const meta = readClaudeDesktopMeta(dir);
        if (meta) {
          const configPath = path.join(dir, "configLibrary", `${meta.appliedId}.json`);
          if (fs.existsSync(configPath)) {
            fs.unlinkSync(configPath);
          }
          const metaPath = path.join(dir, "configLibrary", "_meta.json");
          if (fs.existsSync(metaPath)) {
            fs.unlinkSync(metaPath);
          }
        }
        // Change deploymentMode from "3p" back to "1p"
        const desktopConfigPath = path.join(dir, "claude_desktop_config.json");
        if (fs.existsSync(desktopConfigPath)) {
          try {
            const cfg = JSON.parse(fs.readFileSync(desktopConfigPath, "utf-8")) as Record<
              string,
              unknown
            >;
            cfg.deploymentMode = "1p";
            fs.writeFileSync(desktopConfigPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf-8");
          } catch {
            // ignore invalid JSON
          }
        }
        // Remove developer_settings.json
        const devSettingsPath = path.join(dir, "developer_settings.json");
        if (fs.existsSync(devSettingsPath)) {
          fs.unlinkSync(devSettingsPath);
        }
        sendJson(res, 200, {
          status: "ok",
          message: `Removed CCRelay config from ${dir}`,
        });
        return;
      }
    }

    if (target === "claudeCode" && body.patchClaudeModelsOnly) {
      const m = body.claudeDefaultModels;
      if (!m || typeof m !== "object") {
        sendJson(res, 400, { status: "error", message: "claudeDefaultModels is required" });
        return;
      }
      const dir = path.dirname(claudePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      let root: Record<string, unknown> = {};
      if (fs.existsSync(claudePath)) {
        try {
          root = JSON.parse(fs.readFileSync(claudePath, "utf-8")) as Record<string, unknown>;
        } catch {
          root = {};
        }
      }
      const env = { ...((root.env as Record<string, unknown>) || {}) };
      const setOrDelete = (envKey: string, value: string | undefined) => {
        if (value === undefined) {
          return;
        }
        const t = String(value).trim();
        if (t === "") {
          delete env[envKey];
        } else {
          env[envKey] = t;
        }
      };
      if (m.opus !== undefined) {
        setOrDelete("ANTHROPIC_DEFAULT_OPUS_MODEL", m.opus);
      }
      if (m.sonnet !== undefined) {
        setOrDelete("ANTHROPIC_DEFAULT_SONNET_MODEL", m.sonnet);
      }
      if (m.haiku !== undefined) {
        setOrDelete("ANTHROPIC_DEFAULT_HAIKU_MODEL", m.haiku);
      }
      root.env = env;
      fs.writeFileSync(claudePath, `${JSON.stringify(root, null, 2)}\n`, "utf-8");
      sendJson(res, 200, {
        status: "ok",
        message: `Updated Claude default model env in ${claudePath}`,
      });
      return;
    }

    if (target === "codex" && body.patchCodexModelOnly) {
      const m = typeof body.model === "string" ? body.model.trim() : "";
      if (!fs.existsSync(codexPath)) {
        sendJson(res, 400, {
          status: "error",
          message: "Codex config file does not exist yet. Apply the template first.",
        });
        return;
      }
      const raw = fs.readFileSync(codexPath, "utf-8");
      const updated = raw.replace(/^model\s*=\s*".*"$/m, `model = "${m || CODEX_DEFAULT_MODEL}"`);
      fs.writeFileSync(codexPath, updated, "utf-8");
      sendJson(res, 200, { status: "ok", message: `Updated model in ${codexPath}` });
      return;
    }

    if (target === "claudeCode") {
      if (existingClaude.status === "wrong_target" && !overwrite) {
        sendJson(res, 409, {
          status: "error",
          code: "NEEDS_OVERWRITE",
          message:
            "Claude Code settings point to a different base URL. Confirm overwrite to apply CCRelay defaults.",
        });
        return;
      }
      if (existingClaude.status === "invalid" && !overwrite) {
        sendJson(res, 409, {
          status: "error",
          code: "NEEDS_OVERWRITE",
          message: "settings.json is not valid JSON. Overwrite to replace with a fresh template.",
        });
        return;
      }

      const dir = path.dirname(claudePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      let root: Record<string, unknown> = {};
      if (fs.existsSync(claudePath)) {
        try {
          root = JSON.parse(fs.readFileSync(claudePath, "utf-8")) as Record<string, unknown>;
        } catch {
          root = {};
        }
      }
      const oldEnv = (root.env as Record<string, unknown>) || {};
      const merged = { ...oldEnv, ...buildClaudeDefaultEnv(port) };
      root.env = merged;
      fs.writeFileSync(claudePath, `${JSON.stringify(root, null, 2)}\n`, "utf-8");
      sendJson(res, 200, { status: "ok", message: `Updated ${claudePath}` });
      return;
    }

    if (target === "codex") {
      if (existingCodex.status === "wrong_target" && !overwrite) {
        sendJson(res, 409, {
          status: "error",
          code: "NEEDS_OVERWRITE",
          message:
            "Codex config points elsewhere. Confirm overwrite to replace with the CCRelay template.",
        });
        return;
      }
      const dir = path.dirname(codexPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const codexModel =
        typeof body.model === "string" && body.model.trim()
          ? body.model.trim()
          : CODEX_DEFAULT_MODEL;
      fs.writeFileSync(codexPath, buildCodexTemplate(port, codexModel), "utf-8");
      sendJson(res, 200, { status: "ok", message: `Updated ${codexPath}` });
      return;
    }

    if (target === "claudeDesktop") {
      const dir = claudeDesktopDir();
      if (!dir) {
        sendJson(res, 400, {
          status: "error",
          message: "Claude Desktop configuration is not supported on this platform.",
        });
        return;
      }
      const existing = detectClaudeDesktop(dir, port);
      if (
        existing &&
        (existing.status === "wrong_target" || existing.status === "invalid") &&
        !overwrite
      ) {
        sendJson(res, 409, {
          status: "error",
          code: "NEEDS_OVERWRITE",
          message:
            existing.status === "invalid"
              ? "Claude Desktop config file is not valid JSON. Confirm overwrite."
              : "Claude Desktop config points to a different base URL. Confirm overwrite.",
        });
        return;
      }

      const configLibDir = path.join(dir, "configLibrary");
      if (!fs.existsSync(configLibDir)) {
        fs.mkdirSync(configLibDir, { recursive: true });
      }

      // 1. developer_settings.json — merge
      const devSettingsPath = path.join(dir, "developer_settings.json");
      let devSettings: Record<string, unknown> = {};
      if (fs.existsSync(devSettingsPath)) {
        try {
          devSettings = JSON.parse(fs.readFileSync(devSettingsPath, "utf-8")) as Record<
            string,
            unknown
          >;
        } catch {
          devSettings = {};
        }
      }
      devSettings.allowDevTools = true;
      fs.writeFileSync(devSettingsPath, `${JSON.stringify(devSettings, null, 2)}\n`, "utf-8");

      // 2. claude_desktop_config.json — merge
      const desktopConfigPath = path.join(dir, "claude_desktop_config.json");
      let desktopConfig: Record<string, unknown> = {};
      if (fs.existsSync(desktopConfigPath)) {
        try {
          desktopConfig = JSON.parse(fs.readFileSync(desktopConfigPath, "utf-8")) as Record<
            string,
            unknown
          >;
        } catch {
          desktopConfig = {};
        }
      }
      desktopConfig.deploymentMode = "3p";
      fs.writeFileSync(desktopConfigPath, `${JSON.stringify(desktopConfig, null, 2)}\n`, "utf-8");

      // 3. configLibrary/_meta.json — reuse existing appliedId or generate new one
      const metaPath = path.join(configLibDir, "_meta.json");
      const existingMeta = readClaudeDesktopMeta(dir);
      const appliedId = existingMeta?.appliedId ?? crypto.randomUUID();
      const meta = {
        appliedId,
        entries: [
          {
            id: appliedId,
            name: "CCRelay",
          },
        ],
      };
      fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf-8");

      // 4. configLibrary/{appliedId}.json — merge
      const configPath = path.join(configLibDir, `${appliedId}.json`);
      let ccConfig: Record<string, unknown> = {};
      if (fs.existsSync(configPath)) {
        try {
          ccConfig = JSON.parse(fs.readFileSync(configPath, "utf-8")) as Record<string, unknown>;
        } catch {
          ccConfig = {};
        }
      }
      ccConfig.coworkEgressAllowedHosts = ["*"];
      ccConfig.disableDeploymentModeChooser = true;
      ccConfig.inferenceProvider = "gateway";
      ccConfig.inferenceGatewayBaseUrl = `http://127.0.0.1:${port}/anthropic`;
      ccConfig.inferenceGatewayApiKey = "1";
      const existingHeaders = readClaudeDesktopCustomHeaders(ccConfig) ?? {};
      ccConfig.inferenceCustomHeaders = {
        ...existingHeaders,
        ...expectedClaudeDesktopCustomHeaders(),
      };
      delete ccConfig.inferenceGatewayHeaders;
      ccConfig.disableEssentialTelemetry = true;
      ccConfig.disableNonessentialTelemetry = true;
      fs.writeFileSync(configPath, `${JSON.stringify(ccConfig, null, 2)}\n`, "utf-8");

      sendJson(res, 200, { status: "ok", message: `Updated Claude Desktop config in ${dir}` });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    sendJson(res, 500, { status: "error", message });
  }
}
