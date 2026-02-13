/**
 * Unit tests for api/status.ts
 *
 * Product Requirements:
 * - AS001: Server not initialized -> returns 503 + "Server not initialized"
 * - AS002: Server initialized and running -> status = "running"
 * - AS003: Server stopped -> status = "stopped"
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { handleStatus, setServer } from "@/api/status";
import type { ProxyServer } from "@/server/handler";
import type { Router } from "@/server/router";
import type { ConfigManager } from "@/config";
import type { Provider } from "@/types";
import type { IncomingMessage, ServerResponse } from "node:http";
import { EventEmitter } from "node:events";

// Mock database to prevent loading sqlite-cli and causing EPERM errors
vi.mock("@/database", () => ({
  getDatabase: vi.fn(() => ({
    enabled: false,
    queryLogs: vi.fn(),
    getLogById: vi.fn(),
    deleteLogs: vi.fn(),
    clearAllLogs: vi.fn(),
  })),
}));

// Mock IncomingMessage for testing
class MockIncomingMessage extends EventEmitter {
  url: string;
  method: string;
  headers: Record<string, string>;

  constructor(url: string, method: string = "GET") {
    super();
    this.url = url;
    this.method = method;
    this.headers = {};
  }
}

// Mock ServerResponse for testing
class MockServerResponse extends EventEmitter {
  statusCode: number = 200;
  headers: Record<string, string> = {};
  body: string = "";
  headersSent: boolean = false;
  ended: boolean = false;

  writeHead(statusCode: number, headers?: Record<string, string>): this {
    this.statusCode = statusCode;
    if (headers) {
      this.headers = { ...this.headers, ...headers };
    }
    this.headersSent = true;
    return this;
  }

  setHeader(name: string, value: string | string[]): this {
    this.headers[name] = Array.isArray(value) ? value.join(", ") : value;
    return this;
  }

  getHeader(name: string): string | string[] | undefined {
    return this.headers[name];
  }

  write(chunk: string): boolean {
    this.body += chunk;
    return true;
  }

  end(data?: string): this {
    if (data) {
      this.body += data;
    }
    this.ended = true;
    this.emit("finish");
    return this;
  }
}

// Mock Provider
const mockProvider: Provider = {
  id: "test-provider",
  name: "Test Provider",
  baseUrl: "https://api.test.com",
  mode: "passthrough",
  providerType: "anthropic",
  enabled: true,
};

// Mock Router
class MockRouter {
  private currentProvider: Provider | null = mockProvider;
  private currentProviderId: string | null = "test-provider";

  getCurrentProvider(): Provider | null {
    return this.currentProvider;
  }

  getCurrentProviderId(): string | null {
    return this.currentProviderId;
  }

  setCurrentProvider(provider: Provider | null): void {
    this.currentProvider = provider;
    this.currentProviderId = provider?.id ?? null;
  }
}

// Mock ConfigManager
class MockConfigManager {
  port: number = 7575;
  host: string = "127.0.0.1";

  getPort(): number {
    return this.port;
  }

  getHost(): string {
    return this.host;
  }
}

// Mock ProxyServer
class MockProxyServer {
  private router: Router;
  private config: ConfigManager;
  private isRunning: boolean = false;

  constructor(router: Router, config: ConfigManager) {
    this.router = router;
    this.config = config;
  }

  getRouter(): Router {
    return this.router;
  }

  getConfig(): ConfigManager {
    return this.config;
  }

  get running(): boolean {
    return this.isRunning;
  }

  setRunning(running: boolean): void {
    this.isRunning = running;
  }
}

describe("api/status: handleStatus", () => {
  let mockRouter: MockRouter;
  let mockConfig: MockConfigManager;
  let mockServer: ProxyServer;

  beforeEach(() => {
    // Reset module state by clearing the serverInstance
    vi.clearAllMocks();

    mockRouter = new MockRouter();
    mockConfig = new MockConfigManager();
    mockServer = new MockProxyServer(
      mockRouter as unknown as Router,
      mockConfig as unknown as ConfigManager
    ) as unknown as ProxyServer;
  });

  afterEach(() => {
    // Clean up server instance after each test
    setServer(null as unknown as ProxyServer);
  });

  describe("AS001: Server not initialized", () => {
    it("should return 503 and 'Server not initialized' when server is null", () => {
      const req = new MockIncomingMessage(
        "/ccrelay/api/status",
        "GET"
      ) as unknown as MockIncomingMessage & IncomingMessage;
      const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;

      // Explicitly set server to null
      setServer(null as unknown as ProxyServer);

      handleStatus(req, res, {});

      expect(res.statusCode).toBe(503);
      expect(res.ended).toBe(true);

      const body = JSON.parse(res.body) as { error: string };
      expect(body).toEqual({
        error: "Server not initialized",
      });
    });

    it("should return 503 when server instance is not set", () => {
      const req = new MockIncomingMessage(
        "/ccrelay/api/status",
        "GET"
      ) as unknown as MockIncomingMessage & IncomingMessage;
      const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;

      // Don't set any server instance
      handleStatus(req, res, {});

      expect(res.statusCode).toBe(503);
      expect(res.ended).toBe(true);

      const body = JSON.parse(res.body) as { error: string };
      expect(body.error).toBe("Server not initialized");
    });
  });

  describe("AS002: Server initialized and running", () => {
    it("should return status='running' when server is running", () => {
      const req = new MockIncomingMessage(
        "/ccrelay/api/status",
        "GET"
      ) as unknown as MockIncomingMessage & IncomingMessage;
      const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;

      // Set up a running server
      (mockServer as unknown as MockProxyServer).setRunning(true);
      setServer(mockServer);

      handleStatus(req, res, {});

      expect(res.statusCode).toBe(200);
      expect(res.ended).toBe(true);

      const body = JSON.parse(res.body) as {
        status: string;
        currentProvider: string;
        providerName: string;
        providerMode: string;
        port: number;
      };
      expect(body.status).toBe("running");
      expect(body.currentProvider).toBe("test-provider");
      expect(body.providerName).toBe("Test Provider");
      expect(body.providerMode).toBe("passthrough");
      expect(body.port).toBe(7575);
    });

    it("should include all provider details when server is running", () => {
      const req = new MockIncomingMessage(
        "/ccrelay/api/status",
        "GET"
      ) as unknown as MockIncomingMessage & IncomingMessage;
      const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;

      (mockServer as unknown as MockProxyServer).setRunning(true);
      setServer(mockServer);

      handleStatus(req, res, {});

      const body = JSON.parse(res.body) as Record<string, unknown>;
      expect(body).toHaveProperty("status");
      expect(body).toHaveProperty("currentProvider");
      expect(body).toHaveProperty("providerName");
      expect(body).toHaveProperty("providerMode");
      expect(body).toHaveProperty("port");
    });
  });

  describe("AS003: Server stopped", () => {
    it("should return status='stopped' when server is not running", () => {
      const req = new MockIncomingMessage(
        "/ccrelay/api/status",
        "GET"
      ) as unknown as MockIncomingMessage & IncomingMessage;
      const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;

      // Set up a stopped server
      (mockServer as unknown as MockProxyServer).setRunning(false);
      setServer(mockServer);

      handleStatus(req, res, {});

      expect(res.statusCode).toBe(200);
      expect(res.ended).toBe(true);

      const body = JSON.parse(res.body) as {
        status: string;
        currentProvider: string;
        providerName: string;
        providerMode: string;
      };
      expect(body.status).toBe("stopped");
      expect(body.currentProvider).toBe("test-provider");
      expect(body.providerName).toBe("Test Provider");
      expect(body.providerMode).toBe("passthrough");
    });

    it("should handle null current provider gracefully", () => {
      const req = new MockIncomingMessage(
        "/ccrelay/api/status",
        "GET"
      ) as unknown as MockIncomingMessage & IncomingMessage;
      const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;

      mockRouter.setCurrentProvider(null);
      (mockServer as unknown as MockProxyServer).setRunning(false);
      setServer(mockServer);

      handleStatus(req, res, {});

      expect(res.statusCode).toBe(200);
      expect(res.ended).toBe(true);

      const body = JSON.parse(res.body) as {
        status: string;
        currentProvider: string | null;
        providerName?: string;
        providerMode?: string;
      };
      expect(body.status).toBe("stopped");
      expect(body.currentProvider).toBeNull();
      expect(body.providerName).toBeUndefined();
      expect(body.providerMode).toBeUndefined();
    });
  });

  describe("setServer function", () => {
    it("should set the server instance", () => {
      const req = new MockIncomingMessage(
        "/ccrelay/api/status",
        "GET"
      ) as unknown as MockIncomingMessage & IncomingMessage;
      const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;

      (mockServer as unknown as MockProxyServer).setRunning(true);
      setServer(mockServer);

      // Verify server was set by calling handleStatus
      handleStatus(req, res, {});

      expect(res.statusCode).toBe(200);
    });

    it("should allow updating the server instance", () => {
      const req = new MockIncomingMessage(
        "/ccrelay/api/status",
        "GET"
      ) as unknown as MockIncomingMessage & IncomingMessage;
      const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;

      // Set first server
      (mockServer as unknown as MockProxyServer).setRunning(true);
      setServer(mockServer);

      // Update with new server state
      (mockServer as unknown as MockProxyServer).setRunning(false);
      setServer(mockServer);

      handleStatus(req, res, {});

      const body = JSON.parse(res.body) as { status: string };
      expect(body.status).toBe("stopped");
    });
  });

  describe("params parameter", () => {
    it("should accept and ignore empty params", () => {
      const req = new MockIncomingMessage(
        "/ccrelay/api/status",
        "GET"
      ) as unknown as MockIncomingMessage & IncomingMessage;
      const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;

      (mockServer as unknown as MockProxyServer).setRunning(true);
      setServer(mockServer);

      handleStatus(req, res, {});

      expect(res.statusCode).toBe(200);
    });

    it("should accept and ignore params with values", () => {
      const req = new MockIncomingMessage(
        "/ccrelay/api/status",
        "GET"
      ) as unknown as MockIncomingMessage & IncomingMessage;
      const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;

      (mockServer as unknown as MockProxyServer).setRunning(true);
      setServer(mockServer);

      handleStatus(req, res, { foo: "bar", id: "123" });

      expect(res.statusCode).toBe(200);
    });
  });
});
