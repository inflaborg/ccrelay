/**
 * Success Writer - handles successful proxy response writing
 */

import type { ProxyResult } from "../../types";
import { BaseWriter } from "./baseWriter";
import { ScopedLogger } from "../../utils/logger";

const log = new ScopedLogger("SuccessWriter");

/**
 * SuccessWriter handles writing successful proxy responses
 */
export class SuccessWriter extends BaseWriter {
  /**
   * Write success response from proxy result
   */
  write(result: ProxyResult, clientId?: string): void {
    // Check if client already disconnected
    if (this.isWritable() === false) {
      log.info(`[${clientId}] Client disconnected, skipping response`);
      return;
    }

    // Handle streaming case - already handled by executor
    if (result.streamed) {
      log.info(`[${clientId}] Streaming done`);
      return;
    }

    // Write success response headers
    const responseHeaders = result.headers as Record<string, string | number | string[]>;
    this.res.writeHead(result.statusCode, responseHeaders);

    // Write body
    if (result.body) {
      this.res.end(result.body);
    } else {
      this.res.end();
    }

    log.info(`[${clientId}] Response sent: ${result.statusCode}`);
  }
}
