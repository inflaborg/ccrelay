/**
 * Mock provider server for integration tests
 * Simulates upstream API responses with event-driven request tracking
 */

/* eslint-disable @typescript-eslint/naming-convention */
// HTTP headers use Content-Type format

import * as http from "http";
import type { AddressInfo } from "net";
import { EventEmitter } from "events";

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

export interface HangingResponse {
  type: "hanging";
  headers?: Record<string, string>;
}

/**
 * Request state tracking
 */
export interface RequestState {
  id: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
  receivedAt: number;
  state: "pending" | "responding" | "completed" | "aborted";
  responseStarted: boolean;
  clientConnected: boolean;
}

type MockProviderEvent =
  | { event: "request:received"; state: RequestState }
  | { event: "response:sent"; state: RequestState }
  | { event: "response:chunk"; requestId: string; chunkIndex: number }
  | { event: "client:disconnect"; state: RequestState };

let requestCounter = 0;

export class MockProvider extends EventEmitter {
  private server: http.Server | null = null;
  private port: number;
  private host: string;
  private responseQueue: Array<{
    path: string;
    method: string;
    response: MockResponse | SSEMockResponse | HangingResponse | ((req: http.IncomingMessage) => MockResponse);
    isSSE?: boolean;
    isHanging?: boolean;
  }> = [];
  private requestStates: Map<string, RequestState> = new Map();
  private responseResolvers: Map<string, () => void> = new Map();
  private paused = false;
  private pendingResponses: Array<{ id: string; fn: () => void }> = [];

  constructor(options: MockProviderOptions = {}) {
    super();
    this.port = options.port ?? 0;
    this.host = options.host ?? "127.0.0.1";
  }

  /**
   * Start the mock provider server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.listen(this.port, this.host, () => {
        const addr = this.server!.address() as AddressInfo;
        this.port = addr.port;
        resolve();
      });

      this.server.on("error", reject);
    });
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const requestId = `req-${++requestCounter}`;
    let body = "";

    req.on("data", chunk => {
      body += chunk;
    });

    req.on("end", () => {
      // Track request state
      const state: RequestState = {
        id: requestId,
        method: req.method ?? "GET",
        path: req.url ?? "/",
        headers: req.headers as Record<string, string>,
        body: body || undefined,
        receivedAt: Date.now(),
        state: "pending",
        responseStarted: false,
        clientConnected: true,
      };
      this.requestStates.set(requestId, state);

      // Emit request received event
      this.emitEvent({ event: "request:received", state });

      // Track client disconnect
      res.on("close", () => {
        const currentState = this.requestStates.get(requestId);
        if (currentState && currentState.state !== "completed") {
          currentState.clientConnected = false;
          currentState.state = "aborted";
          this.emitEvent({ event: "client:disconnect", state: currentState });
        }
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

        if (matched.isHanging) {
          void this.handleHangingResponse(requestId, res, responseData as HangingResponse);
        } else if (matched.isSSE) {
          void this.handleSSEResponse(requestId, res, responseData as SSEMockResponse);
        } else {
          void this.handleNormalResponse(requestId, res, responseData as MockResponse);
        }
      } else {
        // Default 404
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
        this.markCompleted(requestId);
      }
    });
  }

  private emitEvent(event: MockProviderEvent): void {
    this.emit(event.event, event);
  }

  private async handleNormalResponse(
    requestId: string,
    res: http.ServerResponse,
    data: MockResponse
  ): Promise<void> {
    // Wait if paused
    await this.waitForResume(requestId);

    const state = this.requestStates.get(requestId);
    if (!state) {
      return;
    }

    // Check if client still connected
    if (!state.clientConnected) {
      return;
    }

    state.state = "responding";
    state.responseStarted = true;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...data.headers,
    };

    const sendResponse = () => {
      if (!state.clientConnected) {
        return;
      }

      res.writeHead(data.status, headers);
      res.end(JSON.stringify(data.body));
      this.markCompleted(requestId);
    };

    if (data.delay && data.delay > 0) {
      setTimeout(sendResponse, data.delay);
    } else {
      sendResponse();
    }
  }

  private async handleSSEResponse(
    requestId: string,
    res: http.ServerResponse,
    data: SSEMockResponse
  ): Promise<void> {
    // Wait if paused
    await this.waitForResume(requestId);

    const state = this.requestStates.get(requestId);
    if (!state || !state.clientConnected) {
      return;
    }

    state.state = "responding";
    state.responseStarted = true;

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
      const currentState = this.requestStates.get(requestId);
      if (!currentState || !currentState.clientConnected) {
        return;
      }

      if (index < data.chunks.length) {
        res.write(data.chunks[index]);
        this.emitEvent({ event: "response:chunk", requestId, chunkIndex: index });
        index++;
        setTimeout(sendChunk, chunkDelay);
      } else {
        res.end();
        this.markCompleted(requestId);
      }
    };

    if (data.chunks.length > 0) {
      setTimeout(sendChunk, chunkDelay);
    }
  }

  private async handleHangingResponse(
    requestId: string,
    res: http.ServerResponse,
    data: HangingResponse
  ): Promise<void> {
    const state = this.requestStates.get(requestId);
    if (!state) {
      return;
    }

    state.state = "responding";
    state.responseStarted = true;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...data.headers,
    };

    // Send headers but never send body
    res.writeHead(200, headers);

    // Create a promise that resolves when response should complete
    const completionPromise = new Promise<void>(resolve => {
      this.responseResolvers.set(requestId, resolve);
    });

    // Wait for either completion signal or client disconnect
    await Promise.race([
      completionPromise,
      new Promise<void>(resolve => {
        const checkDisconnect = () => {
          const currentState = this.requestStates.get(requestId);
          if (currentState && !currentState.clientConnected) {
            resolve();
          }
        };
        const interval = setInterval(() => {
          void checkDisconnect();
        }, 50);
        // Cleanup on resolution
        void completionPromise.finally(() => clearInterval(interval));
      }),
    ]);

    // Cleanup
    this.responseResolvers.delete(requestId);
  }

  private markCompleted(requestId: string): void {
    const state = this.requestStates.get(requestId);
    if (state) {
      state.state = "completed";
      this.emitEvent({ event: "response:sent", state });
    }
  }

  private async waitForResume(requestId: string): Promise<void> {
    if (!this.paused) {
      return;
    }
    return new Promise(resolve => {
      this.pendingResponses.push({ id: requestId, fn: resolve });
    });
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

  // === Response Configuration ===

  mockResponse(path: string, method: string, response: MockResponse): this {
    this.responseQueue.push({ path, method, response });
    return this;
  }

  onGet(path: string, response: MockResponse): this {
    return this.mockResponse(path, "GET", response);
  }

  onPost(path: string, response: MockResponse): this {
    return this.mockResponse(path, "POST", response);
  }

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

  onSSE(path: string, method: string, response: SSEMockResponse): this {
    this.responseQueue.push({ path, method, response, isSSE: true });
    return this;
  }

  onHanging(path: string, method: string): this {
    this.responseQueue.push({
      path,
      method,
      response: { type: "hanging" },
      isHanging: true,
    });
    return this;
  }

  onDynamic(
    path: string,
    method: string,
    handler: (req: http.IncomingMessage) => MockResponse
  ): this {
    this.responseQueue.push({ path, method, response: handler });
    return this;
  }

  // === Pause/Resume Control ===

  pauseResponses(): void {
    this.paused = true;
  }

  resumeResponses(): void {
    this.paused = false;
    this.pendingResponses.forEach(({ fn }) => fn());
    this.pendingResponses = [];
  }

  completeHangingRequest(requestId: string, _response?: MockResponse): void {
    const resolver = this.responseResolvers.get(requestId);
    if (resolver) {
      // This will cause the hanging response to complete
      resolver();
    }
  }

  // === Reset ===

  reset(): this {
    this.responseQueue = [];
    this.requestStates.clear();
    this.responseResolvers.clear();
    this.pendingResponses = [];
    this.paused = false;
    return this;
  }

  // === Wait Methods ===

  /**
   * Wait for a specific number of requests to be received
   */
  async waitForRequests(count: number, timeout = 10000): Promise<RequestState[]> {
    if (this.getReceivedRequestCount() >= count) {
      return this.getAllRequests().slice(0, count);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeListener("request:received", onReceived);
        reject(new Error(`Timeout waiting for ${count} requests, got ${this.getReceivedRequestCount()}`));
      }, timeout);

      const onReceived = () => {
        if (this.getReceivedRequestCount() >= count) {
          clearTimeout(timer);
          this.removeListener("request:received", onReceived);
          resolve(this.getAllRequests().slice(0, count));
        }
      };

      this.addListener("request:received", onReceived);
    });
  }

  /**
   * Wait for a request to a specific path
   */
  async waitForRequestTo(path: string, timeout = 10000): Promise<RequestState> {
    const existing = this.getAllRequests().find(r => r.path === path);
    if (existing) {
      return existing;
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeListener("request:received", onReceived);
        reject(new Error(`Timeout waiting for request to ${path}`));
      }, timeout);

      const onReceived = (event: MockProviderEvent) => {
        if (event.event === "request:received" && event.state.path === path) {
          clearTimeout(timer);
          this.removeListener("request:received", onReceived);
          resolve(event.state);
        }
      };

      this.addListener("request:received", onReceived as () => void);
    });
  }

  /**
   * Wait for all responses to complete
   */
  async waitForAllResponses(timeout = 10000): Promise<void> {
    const pendingRequests = this.getPendingRequests();
    if (pendingRequests.length === 0) {
      return;
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeListener("response:sent", onSent);
        reject(new Error(`Timeout waiting for all responses, ${this.getPendingRequests().length} still pending`));
      }, timeout);

      const onSent = () => {
        if (this.getPendingRequests().length === 0) {
          clearTimeout(timer);
          this.removeListener("response:sent", onSent);
          resolve();
        }
      };

      this.addListener("response:sent", onSent as () => void);
    });
  }

  /**
   * Wait for a specific number of responses to complete
   */
  async waitForResponses(count: number, timeout = 10000): Promise<void> {
    if (this.getCompletedRequestCount() >= count) {
      return;
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeListener("response:sent", onSent);
        reject(new Error(`Timeout waiting for ${count} responses, got ${this.getCompletedRequestCount()}`));
      }, timeout);

      const onSent = () => {
        if (this.getCompletedRequestCount() >= count) {
          clearTimeout(timer);
          this.removeListener("response:sent", onSent);
          resolve();
        }
      };

      this.addListener("response:sent", onSent as () => void);
    });
  }

  /**
   * Wait for client disconnect on a specific request
   */
  async waitForClientDisconnect(timeout = 10000): Promise<RequestState> {
    const disconnected = this.getAllRequests().find(r => !r.clientConnected);
    if (disconnected) {
      return disconnected;
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeListener("client:disconnect", onDisconnect);
        reject(new Error("Timeout waiting for client disconnect"));
      }, timeout);

      const onDisconnect = (event: MockProviderEvent) => {
        if (event.event === "client:disconnect") {
          clearTimeout(timer);
          this.removeListener("client:disconnect", onDisconnect);
          resolve(event.state);
        }
      };

      this.addListener("client:disconnect", onDisconnect as () => void);
    });
  }

  // === Request State Query ===

  getRequestState(requestId: string): RequestState | undefined {
    return this.requestStates.get(requestId);
  }

  getAllRequests(): RequestState[] {
    return Array.from(this.requestStates.values());
  }

  getReceivedRequestCount(): number {
    return this.requestStates.size;
  }

  getCompletedRequestCount(): number {
    return Array.from(this.requestStates.values()).filter(r => r.state === "completed").length;
  }

  getPendingRequests(): RequestState[] {
    return Array.from(this.requestStates.values()).filter(
      r => r.state === "pending" || r.state === "responding"
    );
  }

  getActiveRequests(): RequestState[] {
    return Array.from(this.requestStates.values()).filter(r => r.clientConnected);
  }

  getActiveRequestCount(): number {
    return this.getActiveRequests().length;
  }

  // === Legacy Compatibility ===

  /**
   * @deprecated Use getReceivedRequestCount() instead
   */
  getRequestCount(): number {
    return this.getReceivedRequestCount();
  }

  /**
   * @deprecated Use getAllRequests() instead
   */
  getRequests(): Array<{
    method: string;
    path: string;
    headers: Record<string, string>;
    body?: string;
    timestamp: number;
  }> {
    return this.getAllRequests().map(r => ({
      method: r.method,
      path: r.path,
      headers: r.headers,
      body: r.body,
      timestamp: r.receivedAt,
    }));
  }

  clearRequestLog(): void {
    this.requestStates.clear();
  }
}
