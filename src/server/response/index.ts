/**
 * Response Writers - unified exports
 */

import type * as http from "http";
import type { ProxyResult } from "../../types";
import type { DisconnectCleanup } from "./baseWriter";
import { SuccessWriter } from "./successWriter";
import { ErrorWriter } from "./errorWriter";
import { BlockedWriter } from "./blockedWriter";

export { BaseWriter, type DisconnectCleanup } from "./baseWriter";
export { SuccessWriter } from "./successWriter";
export { ErrorWriter } from "./errorWriter";
export { BlockedWriter } from "./blockedWriter";

/**
 * Unified ResponseWriter - delegates to specialized writers
 */
export class ResponseWriter {
  private successWriter: SuccessWriter;
  private errorWriter: ErrorWriter;
  private blockedWriter: BlockedWriter;

  constructor(private res: http.ServerResponse) {
    this.successWriter = new SuccessWriter(res);
    this.errorWriter = new ErrorWriter(res);
    this.blockedWriter = new BlockedWriter(res);
  }

  /**
   * Write success response
   */
  write(result: ProxyResult, clientId?: string): void {
    // Check if client already disconnected
    if (this.res.writableEnded) {
      return;
    }

    // Handle error case
    if (result.error) {
      this.errorWriter.write(result.error.message, result.statusCode || 502, clientId);
      return;
    }

    // Delegate to success writer
    this.successWriter.write(result, clientId);
  }

  /**
   * Write error response
   */
  writeError(errorMessage: string, statusCode: number = 502, clientId?: string): void {
    this.errorWriter.write(errorMessage, statusCode, clientId);
  }

  /**
   * Write blocked response
   */
  writeBlocked(response: string, statusCode: number = 200, clientId?: string): void {
    this.blockedWriter.write(response, statusCode, clientId);
  }

  /**
   * Register callback for client disconnect
   */
  onClientDisconnect(clientId: string, onDisconnect: () => void): DisconnectCleanup {
    const handler = () => {
      onDisconnect();
    };

    this.res.on("close", handler);

    return () => {
      this.res.off("close", handler);
    };
  }

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
   * Get the underlying response object
   */
  get response(): http.ServerResponse {
    return this.res;
  }
}
