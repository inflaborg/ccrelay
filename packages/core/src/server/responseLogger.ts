/* eslint-disable @typescript-eslint/naming-convention */
// API response fields use snake_case (input_tokens, prompt_tokens, etc.)

/**
 * Response logger for database logging
 */

import * as zlib from "zlib";
import { ScopedLogger } from "../utils/logger";
import type { LogDatabase } from "../database";

export interface LogResponseTokenOverrides {
  inputTokens?: number;
  outputTokens?: number;
  cacheTokens?: number;
}

interface UsageFields {
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
  message?: {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      prompt_tokens?: number;
      completion_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
    };
  };
}

/**
 * Extract token usage from a response body (handles both JSON and SSE formats).
 */
function extractTokenUsage(body: string | undefined): LogResponseTokenOverrides {
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
 * Extract usage from a parsed JSON object (Anthropic or OpenAI format).
 */
function extractUsageFromObj(obj: UsageFields): LogResponseTokenOverrides {
  const usage = obj.usage || obj.message?.usage;
  if (!usage) {
    return {};
  }

  // Anthropic format
  if (typeof usage.input_tokens === "number") {
    return {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheTokens: usage.cache_read_input_tokens,
    };
  }

  // OpenAI format
  if (typeof usage.prompt_tokens === "number") {
    return {
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
      cacheTokens: usage.prompt_tokens_details?.cached_tokens,
    };
  }

  return {};
}

/**
 * Response logger handles logging request/response to database
 */
export class ResponseLogger {
  private log = new ScopedLogger("ResponseLogger");

  constructor(private database: LogDatabase) {}

  /**
   * Check if database logging is enabled
   */
  get enabled(): boolean {
    return this.database.enabled;
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
    tokenOverrides?: LogResponseTokenOverrides
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
      ttfb
    );
  }
}
