/**
 * Fetch page content for Agent web_fetch tool.
 * Prefers Tavily Extract when a Tavily API key is configured; otherwise direct HTTP fetch
 * with SSRF guards and HTML→text stripping.
 */

/* eslint-disable @typescript-eslint/naming-convention -- External API / HTTP header wire fields */

import { lookup } from "dns/promises";
import { isIP } from "net";
import { Logger } from "../../utils/logger";
import type { WebSearchGlobalConfig } from "../../types";

const log = Logger.getInstance();

const TAVILY_EXTRACT_URL = "https://api.tavily.com/extract";
const TAVILY_TIMEOUT_MS = 20_000;
const DIRECT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 1_500_000;
const MAX_CONTENT_CHARS = 24_000;
const MAX_REDIRECTS = 3;

export type WebFetchBackend = "tavily" | "direct";

export interface WebFetchResult {
  url: string;
  finalUrl: string;
  title?: string;
  content: string;
  backend: WebFetchBackend;
  truncated: boolean;
  contentType?: string;
}

export interface WebFetchOptions {
  /** Optional relevance hint for Tavily Extract chunk ranking. */
  query?: string;
}

function hasTavilyKey(config: WebSearchGlobalConfig | undefined): boolean {
  return Boolean(config?.tavily?.apiKey?.trim());
}

/** Prefer Tavily Extract when key present; otherwise direct fetch. */
export function resolveWebFetchBackend(config: WebSearchGlobalConfig | undefined): WebFetchBackend {
  return hasTavilyKey(config) ? "tavily" : "direct";
}

function truncateContent(
  text: string,
  max = MAX_CONTENT_CHARS
): { text: string; truncated: boolean } {
  if (text.length <= max) {
    return { text, truncated: false };
  }
  return {
    text: `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`,
    truncated: true,
  };
}

function isPrivateOrLocalIp(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === "::1" || v === "0:0:0:0:0:0:0:1") {
    return true;
  }
  // IPv4-mapped IPv6
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(v);
  if (mapped?.[1]) {
    return isPrivateOrLocalIp(mapped[1]);
  }
  if (v.includes(":")) {
    // Unique local fc00::/7, link-local fe80::/10
    if (v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9")) {
      return true;
    }
    return false;
  }
  const parts = v.split(".").map(p => parseInt(p, 10));
  if (parts.length !== 4 || parts.some(n => !Number.isFinite(n))) {
    return true;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 10 || a === 127 || a === 0) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 100 && b >= 64 && b <= 127) {
    // CGNAT
    return true;
  }
  return false;
}

async function assertUrlAllowed(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http(s) URLs are allowed");
  }
  if (parsed.username || parsed.password) {
    throw new Error("URLs with credentials are not allowed");
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname === "metadata.google.internal"
  ) {
    throw new Error("Local/metadata hosts are not allowed");
  }

  if (isIP(hostname)) {
    if (isPrivateOrLocalIp(hostname)) {
      throw new Error("Private or loopback IP addresses are not allowed");
    }
    return parsed;
  }

  let addresses: string[];
  try {
    const records = await lookup(hostname, { all: true, verbatim: true });
    addresses = records.map(r => r.address);
  } catch {
    throw new Error(`Failed to resolve host: ${hostname}`);
  }
  if (addresses.length === 0) {
    throw new Error(`Failed to resolve host: ${hostname}`);
  }
  for (const addr of addresses) {
    if (isPrivateOrLocalIp(addr)) {
      throw new Error("URL resolves to a private or loopback address");
    }
  }
  return parsed;
}

function extractTitle(html: string): string | undefined {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const raw = m?.[1];
  if (!raw) {
    return undefined;
  }
  return decodeBasicEntities(raw.replace(/\s+/g, " ").trim()).slice(0, 300) || undefined;
}

function decodeBasicEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n: string) => {
      const code = parseInt(n, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    });
}

/** Strip scripts/styles and tags; keep rough readable text. */
export function htmlToText(html: string): string {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<\/(p|div|h[1-6]|li|tr|br|section|article|header|footer)>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeBasicEntities(s);
  s = s
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return s;
}

interface TavilyExtractResponse {
  results?: Array<{ url?: string; raw_content?: string; title?: string }>;
  failed_results?: Array<{ url?: string; error?: string }>;
}

async function fetchViaTavily(
  url: string,
  apiKey: string,
  options?: WebFetchOptions
): Promise<WebFetchResult> {
  const body: Record<string, unknown> = {
    urls: [url],
    extract_depth: "basic",
    format: "markdown",
  };
  if (options?.query?.trim()) {
    body.query = options.query.trim();
    body.chunks_per_source = 3;
  }

  const res = await fetch(TAVILY_EXTRACT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TAVILY_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Tavily Extract HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as TavilyExtractResponse;
  const first = json.results?.[0];
  if (!first?.raw_content) {
    const fail = json.failed_results?.[0];
    throw new Error(fail?.error || "Tavily Extract returned no content");
  }

  const { text, truncated } = truncateContent(first.raw_content);
  return {
    url,
    finalUrl: first.url || url,
    title: first.title,
    content: text,
    backend: "tavily",
    truncated,
  };
}

async function readLimitedBody(res: Response): Promise<Buffer> {
  const declared = res.headers.get("content-length");
  if (declared) {
    const n = parseInt(declared, 10);
    if (Number.isFinite(n) && n > MAX_RESPONSE_BYTES) {
      throw new Error(`Response exceeds ${MAX_RESPONSE_BYTES} bytes`);
    }
  }
  const ab = await res.arrayBuffer();
  if (ab.byteLength > MAX_RESPONSE_BYTES) {
    throw new Error(`Response exceeds ${MAX_RESPONSE_BYTES} bytes`);
  }
  return Buffer.from(ab);
}

async function fetchDirect(url: string): Promise<WebFetchResult> {
  let current = await assertUrlAllowed(url);
  let res: Response | null = null;

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    res = await fetch(current.toString(), {
      method: "GET",
      redirect: "manual",
      headers: {
        "User-Agent": "CCRelay-Agent/1.0 (+web_fetch)",
        Accept: "text/html,application/xhtml+xml,text/plain,text/markdown;q=0.9,*/*;q=0.1",
      },
      signal: AbortSignal.timeout(DIRECT_TIMEOUT_MS),
    });

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) {
        throw new Error(`Redirect without Location (HTTP ${res.status})`);
      }
      const next = new URL(loc, current);
      current = await assertUrlAllowed(next.toString());
      continue;
    }
    break;
  }

  if (!res) {
    throw new Error("Fetch failed");
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  const buf = await readLimitedBody(res);
  const raw = buf.toString("utf8");

  if (
    contentType.includes("text/html") ||
    contentType.includes("application/xhtml") ||
    (!contentType && /<html[\s>]/i.test(raw))
  ) {
    const title = extractTitle(raw);
    const text = htmlToText(raw);
    if (!text.trim()) {
      throw new Error("No readable text extracted from HTML");
    }
    const { text: content, truncated } = truncateContent(text);
    return {
      url,
      finalUrl: current.toString(),
      title,
      content,
      backend: "direct",
      truncated,
      contentType,
    };
  }

  if (
    contentType.includes("text/plain") ||
    contentType.includes("text/markdown") ||
    contentType.includes("application/json") ||
    contentType.startsWith("text/")
  ) {
    const { text: content, truncated } = truncateContent(raw);
    return {
      url,
      finalUrl: current.toString(),
      content,
      backend: "direct",
      truncated,
      contentType,
    };
  }

  throw new Error(`Unsupported content type: ${contentType || "unknown"}`);
}

/**
 * Fetch URL content. Uses Tavily Extract when configured; otherwise direct fetch.
 */
export async function runWebFetch(
  url: string,
  config: WebSearchGlobalConfig | undefined,
  options?: WebFetchOptions
): Promise<WebFetchResult> {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error("url is required");
  }
  if (trimmed.length > 2000) {
    throw new Error("url is too long (max 2000 characters)");
  }

  // Always validate URL shape / SSRF before any outbound call (including Tavily).
  await assertUrlAllowed(trimmed);

  const backend = resolveWebFetchBackend(config);
  if (backend === "tavily") {
    const apiKey = config?.tavily?.apiKey?.trim();
    if (!apiKey) {
      throw new Error("Tavily API key missing");
    }
    try {
      log.info(`[web-fetch] tavily extract url=${trimmed.slice(0, 120)}`);
      return await fetchViaTavily(trimmed, apiKey, options);
    } catch (err) {
      log.warn(
        `[web-fetch] tavily failed, falling back to direct: ${err instanceof Error ? err.message : String(err)}`
      );
      return fetchDirect(trimmed);
    }
  }

  log.info(`[web-fetch] direct fetch url=${trimmed.slice(0, 120)}`);
  return fetchDirect(trimmed);
}
