/**
 * Base Writer - common functionality for all response writers
 */

import type * as http from "http";
import { ScopedLogger } from "../../utils/logger";

const log = new ScopedLogger("BaseWriter");

/**
 * Cleanup function for disconnect handlers
 */
export type DisconnectCleanup = () => void;

/**
 * Base writer with common HTTP response functionality
 */
export class BaseWriter {
  constructor(protected res: http.ServerResponse) {}

  /**
   * Check if response is still writable
   */
  isWritable(): boolean {
    return !this.res.writableEnded;
  }

  /**
   * Check if headers have been sent
   */
  headersSent(): boolean {
    return this.res.headersSent;
  }

  /**
   * Register callback for client disconnect
   */
  onDisconnect(clientId: string, onDisconnect: () => void): DisconnectCleanup {
    const handler = () => {
      log.info(`[${clientId}] Client disconnected`);
      onDisconnect();
    };

    this.res.on("close", handler);

    // Return cleanup function
    return () => {
      this.res.off("close", handler);
    };
  }

  /**
   * Get the underlying response object
   */
  getResponse(): http.ServerResponse {
    return this.res;
  }
}
