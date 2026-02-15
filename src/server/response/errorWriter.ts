/**
 * Error Writer - handles error response writing
 */

/* eslint-disable @typescript-eslint/naming-convention */
// HTTP headers use hyphenated names (Content-Type, etc.)

import { BaseWriter } from "./baseWriter";
import { ScopedLogger } from "../../utils/logger";

const log = new ScopedLogger("ErrorWriter");

/**
 * ErrorWriter handles writing error responses
 */
export class ErrorWriter extends BaseWriter {
  /**
   * Write error response
   */
  write(errorMessage: string, statusCode: number = 502, clientId?: string): void {
    if (this.isWritable() === false || this.headersSent()) {
      return;
    }

    this.res.writeHead(statusCode, { "Content-Type": "application/json" });
    this.res.end(JSON.stringify({ error: errorMessage }));

    log.info(`[${clientId}] Error response: ${statusCode}`);
  }

  /**
   * Write queue full/timeout error
   */
  writeQueueError(errorMessage: string, clientId?: string): void {
    this.write(errorMessage, 503, clientId);
  }
}
