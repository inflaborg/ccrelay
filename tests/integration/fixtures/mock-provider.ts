/**
 * Mock provider server for integration tests
 * Simulates upstream API responses
 */

/* eslint-disable @typescript-eslint/naming-convention */
// HTTP headers use Content-Type format

import * as http from "http";
import type { AddressInfo } from "net";

export interface MockProviderOptions {
  port?: number;
  host?: string;
}

export interface MockResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
  delay?: number;
}

export interface SSEMockResponse {
  status: number;
  chunks: string[];
  chunkDelay?: number;
  headers?: Record<string, string>;
}

export class MockProvider {
  private server: http.Server | null = null;
  private port: number;
  private host: string;
  private responseQueue: Array<{
    path: string;
    method: string;
    response: MockResponse | SSEMockResponse | ((req: http.IncomingMessage) => MockResponse);
    isSSE?: boolean;
  }> = [];
  private requestLog: Array<{
    method: string;
    path: string;
    headers: Record<string, string>;
    body?: string;
    timestamp: number;
  }> = [];

  constructor(options: MockProviderOptions = {}) {
    this.port = options.port ?? 0; // 0 means random port
    this.host = options.host ?? "127.0.0.1";
  }

  /**
   * Start the mock provider server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        let body = "";
        req.on("data", chunk => {
          body += chunk;
        });
        req.on("end", () => {
          // Log the request
          this.requestLog.push({
            method: req.method ?? "GET",
            path: req.url ?? "/",
            headers: req.headers as Record<string, string>,
            body: body || undefined,
            timestamp: Date.now(),
          });

          // Find matching response
          const matched = this.responseQueue.find(
            r => r.path === req.url && r.method === req.method
          );

          if (matched) {
            const responseData =
              typeof matched.response === "function"
                ? matched.response(req)
                : matched.response;

            if (matched.isSSE) {
              this.handleSSEResponse(res, responseData as SSEMockResponse);
            } else {
              this.handleNormalResponse(res, responseData as MockResponse);
            }
          } else {
            // Default 404
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Not found" }));
          }
        });
      });

      this.server.listen(this.port, this.host, () => {
        const addr = this.server!.address() as AddressInfo;
        this.port = addr.port;
        resolve();
      });

      this.server.on("error", reject);
    });
  }

  private handleNormalResponse(res: http.ServerResponse, data: MockResponse): void {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...data.headers,
    };

    const sendResponse = () => {
      res.writeHead(data.status, headers);
      res.end(JSON.stringify(data.body));
    };

    if (data.delay && data.delay > 0) {
      setTimeout(sendResponse, data.delay);
    } else {
      sendResponse();
    }
  }

  private handleSSEResponse(res: http.ServerResponse, data: SSEMockResponse): void {
    const headers: Record<string, string> = {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      ...data.headers,
    };

    res.writeHead(data.status, headers);

    const chunkDelay = data.chunkDelay ?? 50;
    let index = 0;

    const sendChunk = () => {
      if (index < data.chunks.length) {
        res.write(data.chunks[index]);
        index++;
        setTimeout(sendChunk, chunkDelay);
      } else {
        res.end();
      }
    };

    if (data.chunks.length > 0) {
      setTimeout(sendChunk, chunkDelay);
    }
  }

  /**
   * Stop the mock provider server
   */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(err => {
        if (err) {
          reject(err);
        } else {
          this.server = null;
          resolve();
        }
      });
    });
  }

  /**
   * Get the base URL of the mock provider
   */
  get baseUrl(): string {
    return `http://${this.host}:${this.port}`;
  }

  /**
   * Queue a response for a specific path and method
   */
  on(path: string, method: string, response: MockResponse): this {
    this.responseQueue.push({ path, method, response });
    return this;
  }

  /**
   * Queue a GET response
   */
  onGet(path: string, response: MockResponse): this {
    return this.on(path, "GET", response);
  }

  /**
   * Queue a POST response
   */
  onPost(path: string, response: MockResponse): this {
    return this.on(path, "POST", response);
  }

  /**
   * Queue a delayed response
   */
  onDelayed(
    path: string,
    method: string,
    response: MockResponse,
    delay: number
  ): this {
    this.responseQueue.push({
      path,
      method,
      response: { ...response, delay },
    });
    return this;
  }

  /**
   * Queue a SSE streaming response
   */
  onSSE(path: string, method: string, response: SSEMockResponse): this {
    this.responseQueue.push({ path, method, response, isSSE: true });
    return this;
  }

  /**
   * Queue a response that never completes (for timeout testing)
   */
  onHanging(path: string, method: string): this {
    this.responseQueue.push({
      path,
      method,
      response: {
        status: 200,
        body: {},
        delay: 999999, // Essentially hanging
      },
    });
    return this;
  }

  /**
   * Queue a dynamic response handler
   */
  onDynamic(
    path: string,
    method: string,
    handler: (req: http.IncomingMessage) => MockResponse
  ): this {
    this.responseQueue.push({ path, method, response: handler });
    return this;
  }

  /**
   * Clear all queued responses
   */
  reset(): this {
    this.responseQueue = [];
    this.requestLog = [];
    return this;
  }

  /**
   * Get all received requests
   */
  getRequests(): Array<{
    method: string;
    path: string;
    headers: Record<string, string>;
    body?: string;
    timestamp: number;
  }> {
    return [...this.requestLog];
  }

  /**
   * Get request count
   */
  getRequestCount(): number {
    return this.requestLog.length;
  }

  /**
   * Clear request log
   */
  clearRequestLog(): void {
    this.requestLog = [];
  }
}
