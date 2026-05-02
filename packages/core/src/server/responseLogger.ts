/**
 * Response logger for database logging
 */

import * as zlib from "zlib";
import { ScopedLogger } from "../utils/logger";
import type { LogDatabase } from "../database";

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
    originalResponseBody?: string
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

    this.database.updateLogCompleted(
      clientId,
      statusCode,
      responseBodyLog,
      duration,
      success,
      errorMessage,
      originalResponseBody
    );
  }
}
