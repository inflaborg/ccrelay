/**
 * Test server for integration tests
 * A simplified version of ProxyServer that can be used without VSCode dependencies
 */

/* eslint-disable @typescript-eslint/naming-convention */
// HTTP headers use Content-Type format

import * as http from "http";
import * as https from "https";
import type { AddressInfo } from "net";
import * as url from "url";
import { ConcurrencyManager } from "../../../src/queue";
import type {
  RequestTask,
  ProxyResult,
  ConcurrencyConfig,
} from "../../../src/types";
import { ScopedLogger } from "../../../src/utils/logger";
import type { MockConfig } from "./mock-config";

export interface TestServerOptions {
  config: MockConfig;
}

export class TestServer {
  private server: http.Server | null = null;
  private config: MockConfig;
  private log = new ScopedLogger("TestServer");
  private concurrencyManager: ConcurrencyManager | null = null;
  private routeQueues: Map<string, ConcurrencyManager> = new Map();

  constructor(options: TestServerOptions) {
    this.config = options.config;

    // Initialize concurrency manager if enabled
    const concurrencyConfig = this.config.concurrency;
    if (concurrencyConfig?.enabled) {
      this.concurrencyManager = new ConcurrencyManager(concurrencyConfig, task =>
        this.executeProxyRequest(task)
      );
      this.log.info(
        `ConcurrencyManager initialized: maxConcurrency=${concurrencyConfig.maxConcurrency}`
      );
    }

    // Initialize route-specific queues
    for (const routeConfig of this.config.routeQueues) {
      const queueName = routeConfig.name ?? routeConfig.pathPattern;
      const queueConcurrencyConfig: ConcurrencyConfig = {
        enabled: true,
        maxConcurrency: routeConfig.maxConcurrency,
        maxQueueSize: routeConfig.maxQueueSize,
        timeout: routeConfig.timeout,
      };
      const routeQueue = new ConcurrencyManager(queueConcurrencyConfig, task =>
        this.executeProxyRequest(task)
      );
      this.routeQueues.set(queueName, routeQueue);
      // Store compiled pattern
      (routeQueue as ConcurrencyManager & { pattern?: RegExp }).pattern = new RegExp(
        routeConfig.pathPattern
      );
    }
  }

  /**
   * Start the test server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch(err => {
          this.log.error("Error handling request", err);
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Internal server error" }));
          }
        });
      });

      this.server.listen(0, "127.0.0.1", () => {
        const addr = this.server!.address() as AddressInfo;
        this.log.info(`Test server started on port ${addr.port}`);
        resolve();
      });

      this.server.on("error", reject);
    });
  }

  /**
   * Stop the test server
   */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }

      // Shutdown concurrency manager
      if (this.concurrencyManager) {
        this.concurrencyManager.shutdown();
      }
      for (const queue of this.routeQueues.values()) {
        queue.shutdown();
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
   * Get the server port
   */
  get port(): number {
    if (!this.server) {
      throw new Error("Server not started");
    }
    return (this.server.address() as AddressInfo).port;
  }

  /**
   * Get the server base URL
   */
  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /**
   * Get queue statistics
   */
  getQueueStats(): {
    default?: ReturnType<ConcurrencyManager["getStats"]>;
    routes: Record<string, ReturnType<ConcurrencyManager["getStats"]>>;
  } {
    const routes: Record<string, ReturnType<ConcurrencyManager["getStats"]>> = {};
    for (const [name, queue] of this.routeQueues) {
      routes[name] = queue.getStats();
    }
    return {
      default: this.concurrencyManager?.getStats(),
      routes,
    };
  }

  /**
   * Get the concurrency manager (for testing)
   */
  getConcurrencyManager(): ConcurrencyManager | null {
    return this.concurrencyManager;
  }

  /**
   * Handle incoming HTTP request
   */
  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const clientId = `test-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const path = req.url ?? "/";
    const method = req.method ?? "GET";

    this.log.info(`[${clientId}] ${method} ${path}`);

    // Read request body
    const body = await this.readBody(req);
    const headers = this.extractHeaders(req);

    // Get provider
    const provider = this.config.getCurrentProvider();

    // Check if concurrency is enabled
    if (this.concurrencyManager) {
      // Find matching route queue
      let targetQueue = this.concurrencyManager;
      let queueName = "default";

      for (const [name, queue] of this.routeQueues) {
        const pattern = (queue as ConcurrencyManager & { pattern?: RegExp }).pattern;
        if (pattern && pattern.test(path)) {
          targetQueue = queue;
          queueName = name;
          break;
        }
      }

      this.log.info(`[${clientId}] Submitting to queue "${queueName}"`);

      // Track client disconnect
      let clientDisconnected = false;
      const onClientDisconnect = () => {
        clientDisconnected = true;
      };
      res.on("close", onClientDisconnect);

      // Create task
      const task: RequestTask = {
        id: clientId,
        method,
        targetUrl: `${provider.baseUrl}${path}`,
        headers,
        body,
        provider,
        requestPath: path,
        isOpenAIProvider: provider.providerType === "openai",
        clientId,
        createdAt: Date.now(),
        res,
      };

      try {
        const result = await targetQueue.submit(task);

        res.off("close", onClientDisconnect);

        if (clientDisconnected || res.writableEnded) {
          this.log.info(`[${clientId}] Client disconnected, skipping response`);
          return;
        }

        if (result.error) {
          if (!res.headersSent) {
            res.writeHead(result.statusCode >= 400 ? result.statusCode : 502, {
              "Content-Type": "application/json",
            });
            res.end(JSON.stringify({ error: result.errorMessage ?? result.error.message }));
          }
          return;
        }

        // Write response
        const responseHeaders: Record<string, string> = {};
        for (const [key, value] of Object.entries(result.headers)) {
          responseHeaders[key] = Array.isArray(value) ? value.join(", ") : value;
        }
        if (!res.headersSent) {
          res.writeHead(result.statusCode, responseHeaders);
          if (result.body) {
            res.end(typeof result.body === "string" ? result.body : result.body);
          } else {
            res.end();
          }
        }
      } catch (err) {
        res.off("close", onClientDisconnect);

        const errMsg = err instanceof Error ? err.message : String(err);
        if (!clientDisconnected && !res.headersSent && !res.writableEnded) {
          // Distinguish between queue/timeout errors (503) and proxy/network errors (502)
          const isQueueError = errMsg.includes("Queue is full") || errMsg.includes("timeout");
          const statusCode = isQueueError ? 503 : 502;
          const code = isQueueError ? "QUEUE_FULL_OR_TIMEOUT" : "PROXY_ERROR";
          res.writeHead(statusCode, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: errMsg, code }));
        }
      }
    } else {
      // Direct execution (no queue)
      const task: RequestTask = {
        id: clientId,
        method,
        targetUrl: `${provider.baseUrl}${path}`,
        headers,
        body,
        provider,
        requestPath: path,
        isOpenAIProvider: provider.providerType === "openai",
        clientId,
        createdAt: Date.now(),
      };

      try {
        const result = await this.executeProxyRequest(task);
        const responseHeaders: Record<string, string> = {};
        for (const [key, value] of Object.entries(result.headers)) {
          responseHeaders[key] = Array.isArray(value) ? value.join(", ") : value;
        }
        if (!res.headersSent) {
          res.writeHead(result.statusCode, responseHeaders);
          if (result.body) {
            res.end(typeof result.body === "string" ? result.body : result.body);
          } else {
            res.end();
          }
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (!res.headersSent) {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: errMsg }));
        }
      }
    }
  }

  /**
   * Execute proxy request to upstream
   */
  private executeProxyRequest(task: RequestTask): Promise<ProxyResult> {
    const { method, targetUrl, headers: taskHeaders, body } = task;

    return new Promise((resolve, reject) => {
      const urlParsed = url.parse(targetUrl);
      const isHttps = urlParsed.protocol === "https:";
      const httpModule = isHttps ? https : http;

      const requestHeaders: Record<string, string> = { ...taskHeaders };
      requestHeaders["accept-encoding"] = "identity";

      // Create AbortController for timeout/cancellation
      const abortController = task.abortController ?? new AbortController();

      const options: http.RequestOptions = {
        hostname: urlParsed.hostname,
        port: urlParsed.port || (isHttps ? 443 : 80),
        path: urlParsed.path,
        method,
        headers: requestHeaders,
        signal: abortController.signal,
      };

      const startTime = Date.now();
      let responseChunks: Buffer[] = [];

      // Track client disconnect during streaming
      let clientDisconnected = false;
      const onClientDisconnect = () => {
        clientDisconnected = true;
        abortController.abort();
      };

      const clientRes = task.res;
      if (clientRes) {
        clientRes.on("close", onClientDisconnect);
      }

      const proxyReq = httpModule.request(options, (proxyRes) => {
        const statusCode = proxyRes.statusCode ?? 0;
        const responseHeaders = { ...proxyRes.headers } as Record<string, string | string[]>;

        // Check if SSE streaming
        const isStreaming =
          proxyRes.headers["content-type"]?.includes("text/event-stream") ?? false;

        if (isStreaming && clientRes && !clientRes.headersSent) {
          // SSE streaming mode
          clientRes.writeHead(statusCode, responseHeaders);
          proxyRes.pipe(clientRes);

          proxyRes.on("data", (chunk: Buffer) => {
            responseChunks.push(chunk);
          });

          proxyRes.on("end", () => {
            if (clientRes) {
              clientRes.off("close", onClientDisconnect);
            }
            resolve({
              statusCode: clientDisconnected ? 499 : statusCode,
              headers: responseHeaders,
              duration: Date.now() - startTime,
              responseBodyChunks: responseChunks,
              streamed: true,
              errorMessage: clientDisconnected ? "Client disconnected" : undefined,
            });
          });

          proxyRes.on("error", (err: Error) => {
            if (clientRes) {
              clientRes.off("close", onClientDisconnect);
            }
            resolve({
              statusCode: 502,
              headers: {},
              duration: Date.now() - startTime,
              error: err,
              errorMessage: err.message,
            });
          });
        } else {
          // Non-streaming
          proxyRes.on("data", (chunk: Buffer) => {
            responseChunks.push(chunk);
          });

          proxyRes.on("end", () => {
            if (clientRes) {
              clientRes.off("close", onClientDisconnect);
            }
            resolve({
              statusCode,
              headers: responseHeaders,
              body: Buffer.concat(responseChunks),
              duration: Date.now() - startTime,
            });
          });
        }
      });

      proxyReq.on("error", (err: NodeJS.ErrnoException) => {
        if (clientRes) {
          clientRes.off("close", onClientDisconnect);
        }

        if (abortController.signal.aborted) {
          resolve({
            statusCode: 499,
            headers: {},
            duration: Date.now() - startTime,
            errorMessage: "Client disconnected",
          });
          return;
        }

        reject(new Error(`Proxy error: ${err.message}`));
      });

      // Set timeout
      const timeoutMs = (this.config.proxyTimeout ?? 300) * 1000;
      if (timeoutMs > 0) {
        proxyReq.setTimeout(timeoutMs, () => {
          if (clientRes) {
            clientRes.off("close", onClientDisconnect);
          }
          abortController.abort();
          reject(new Error("Proxy timeout"));
        });
      }

      if (body) {
        proxyReq.write(body);
      }

      proxyReq.end();
    });
  }

  /**
   * Read request body
   */
  private readBody(req: http.IncomingMessage): Promise<Buffer | null> {
    return new Promise(resolve => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        if (chunks.length === 0) {
          resolve(null);
        } else {
          resolve(Buffer.concat(chunks));
        }
      });
      req.on("error", () => resolve(null));
    });
  }

  /**
   * Extract headers from request
   */
  private extractHeaders(req: http.IncomingMessage): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (value !== undefined) {
        headers[key] = Array.isArray(value) ? value.join(", ") : value;
      }
    }
    return headers;
  }
}
