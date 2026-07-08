/* eslint-disable @typescript-eslint/naming-convention */
// API response fields use snake_case (input_tokens, prompt_tokens, etc.)

/**
 * Response logger for database logging
 */

import * as zlib from "zlib";
import { ScopedLogger } from "../utils/logger";
import type { LogDatabase } from "../database";
import type { LogResponseTiming } from "../database/types";
import { isTokenUsageRequestPath } from "../converter/paths";

export interface LogResponseTokenOverrides {
  inputTokens?: number;
  outputTokens?: number;
  cacheTokens?: number;
}

interface UsageRecord {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  effectiveCachedTokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  input_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
}

interface UsageFields {
  usage?: UsageRecord;
  message?: {
    usage?: UsageRecord;
  };
}

function firstNonZero(...values: Array<number | undefined>): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && value > 0) {
      return value;
    }
  }
  return undefined;
}

function firstDefined(...values: Array<number | undefined>): number | undefined {
  for (const value of values) {
    if (typeof value === "number") {
      return value;
    }
  }
  return undefined;
}

/**
 * Extract token usage from a response body (handles both JSON and SSE formats).
 */
export function extractTokenUsage(body: string | undefined): LogResponseTokenOverrides {
  if (!body) {
    return {};
  }

  // Try direct JSON parse first
  try {
    const parsed = JSON.parse(body) as UsageFields;
    return extractUsageFromObj(parsed);
  } catch {
    // Not direct JSON — try SSE format
  }

  // SSE format: scan data lines and accumulate usage
  const result: LogResponseTokenOverrides = {};
  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") {
      continue;
    }
    try {
      const event = JSON.parse(line.slice(6)) as UsageFields;
      const usage = extractUsageFromObj(event);
      if (usage.inputTokens !== undefined) {
        result.inputTokens = usage.inputTokens;
      }
      if (usage.outputTokens !== undefined) {
        result.outputTokens = usage.outputTokens;
      }
      if (usage.cacheTokens !== undefined) {
        result.cacheTokens = usage.cacheTokens;
      }
    } catch {
      // Skip malformed SSE lines
    }
  }

  return result;
}

/**
 * Extract usage from a parsed JSON object (Anthropic, OpenAI Chat, or Responses format).
 * Stored input_tokens always means total prompt tokens; cache_tokens is the cached subset.
 */
function extractUsageFromObj(obj: UsageFields): LogResponseTokenOverrides {
  const usage = obj.usage || obj.message?.usage;
  if (!usage) {
    return {};
  }

  const cacheTokens =
    firstNonZero(
      usage.prompt_tokens_details?.cached_tokens,
      usage.input_tokens_details?.cached_tokens,
      usage.cache_read_input_tokens,
      usage.effectiveCachedTokens
    ) ??
    firstDefined(
      usage.prompt_tokens_details?.cached_tokens,
      usage.input_tokens_details?.cached_tokens,
      usage.cache_read_input_tokens,
      usage.effectiveCachedTokens
    );

  const inputTokens = normalizeTotalInputTokens(usage);
  const outputTokens =
    firstNonZero(usage.completion_tokens, usage.output_tokens) ??
    firstDefined(usage.completion_tokens, usage.output_tokens);

  if (inputTokens === undefined && outputTokens === undefined && cacheTokens === undefined) {
    return {};
  }

  return {
    inputTokens,
    outputTokens,
    cacheTokens,
  };
}

function normalizeTotalInputTokens(usage: UsageRecord): number | undefined {
  const promptTotal = firstNonZero(usage.prompt_tokens) ?? firstDefined(usage.prompt_tokens);
  if (promptTotal !== undefined) {
    return promptTotal;
  }

  const inputRaw = firstNonZero(usage.input_tokens) ?? firstDefined(usage.input_tokens);
  if (inputRaw === undefined) {
    return undefined;
  }

  // Anthropic: input_tokens excludes cache; total prompt = input + cache_read.
  if (typeof usage.cache_read_input_tokens === "number") {
    return inputRaw + usage.cache_read_input_tokens;
  }

  // Responses and others: input_tokens is already total prompt.
  return inputRaw;
}

/**
 * Response logger handles logging request/response to database
 */
export class ResponseLogger {
  private log = new ScopedLogger("ResponseLogger");

  constructor(private database: LogDatabase) {}

  /**
   * Check if the database driver is available (metrics can be persisted).
   */
  get enabled(): boolean {
    return this.database.enabled;
  }

  /**
   * Whether request/response body logging is enabled.
   */
  get logsEnabled(): boolean {
    return this.database.logsEnabled;
  }

  /**
   * Whether to capture response chunks for DB writes (body logs or token metrics).
   */
  shouldCaptureResponse(method: string, path: string): boolean {
    if (!this.database.enabled) {
      return false;
    }
    if (this.database.logsEnabled) {
      return true;
    }
    return isTokenUsageRequestPath(method, path);
  }

  /**
   * Log request/response to database - updates existing pending log by clientId
   */
  logResponse(
    clientId: string,
    duration: number,
    statusCode: number,
    responseChunks: Buffer[],
    errorMessage: string | undefined,
    originalResponseBody?: string,
    ttfb?: number,
    tokenOverrides?: LogResponseTokenOverrides,
    responseHeadersMasked?: string,
    timing?: LogResponseTiming
  ): void {
    if (!this.database.enabled) {
      this.log.info(`logResponse skipped - database not enabled. clientId=${clientId}`);
      return;
    }

    this.log.info(
      `logResponse called - clientId=${clientId}, status=${statusCode}, duration=${duration}ms`
    );

    let responseBodyLog: string | undefined;
    if (responseChunks.length > 0) {
      try {
        const rawBuffer = Buffer.concat(responseChunks);
        // Try to detect and decompress gzip data
        // Gzip magic number: 1f 8b
        const isGzip = rawBuffer.length >= 2 && rawBuffer[0] === 0x1f && rawBuffer[1] === 0x8b;
        if (isGzip) {
          try {
            const decompressed = zlib.gunzipSync(rawBuffer);
            responseBodyLog = decompressed.toString("utf-8");
            this.log.debug(
              `Decompressed gzip response: ${rawBuffer.length} -> ${decompressed.length} bytes`
            );
          } catch (decompressErr: unknown) {
            const errMsg =
              decompressErr instanceof Error ? decompressErr.message : String(decompressErr);
            this.log.warn(`Failed to decompress gzip data: ${errMsg}`);
            responseBodyLog = rawBuffer.toString("utf-8");
          }
        } else {
          responseBodyLog = rawBuffer.toString("utf-8");
        }
      } catch {
        responseBodyLog = undefined;
      }
    }

    const success = statusCode >= 200 && statusCode < 300 && !errorMessage;

    // Extract token usage from response body (try converted first, then original)
    let tokens = extractTokenUsage(responseBodyLog);
    if (tokens.inputTokens === undefined && originalResponseBody) {
      tokens = extractTokenUsage(originalResponseBody);
    }
    if (tokenOverrides?.inputTokens !== undefined) {
      tokens.inputTokens = tokenOverrides.inputTokens;
    }
    if (tokenOverrides?.outputTokens !== undefined) {
      tokens.outputTokens = tokenOverrides.outputTokens;
    }
    if (tokenOverrides?.cacheTokens !== undefined) {
      tokens.cacheTokens = tokenOverrides.cacheTokens;
    }

    this.database.updateLogCompleted(
      clientId,
      statusCode,
      responseBodyLog,
      duration,
      success,
      errorMessage,
      originalResponseBody,
      tokens.inputTokens,
      tokens.outputTokens,
      tokens.cacheTokens,
      ttfb,
      responseHeadersMasked,
      timing
    );
  }
}
