/**
 * Blocked Writer - handles blocked response writing
 */

/* eslint-disable @typescript-eslint/naming-convention */
// HTTP headers use hyphenated names (Content-Type, etc.)

import { BaseWriter } from "./baseWriter";
import { ScopedLogger } from "../../utils/logger";

const log = new ScopedLogger("BlockedWriter");

/**
 * BlockedWriter handles writing responses for blocked requests
 */
export class BlockedWriter extends BaseWriter {
  /**
   * Write blocked response
   */
  write(response: string, statusCode: number = 200, clientId?: string): void {
    if (this.isWritable() === false) {
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const jsonResponse = JSON.parse(response);
      this.res.writeHead(statusCode, { "Content-Type": "application/json" });
      this.res.end(JSON.stringify(jsonResponse));
    } catch {
      this.res.writeHead(statusCode, { "Content-Type": "application/json" });
      this.res.end(response);
    }

    log.info(`[${clientId}] Blocked response: ${statusCode}`);
  }
}
