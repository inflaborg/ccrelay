/**
 * Unit tests for api/switch.ts
 *
 * Product Requirements:
 * - ASW001: Server not initialized -> returns 503
 * - ASW002: Missing provider field -> returns 400
 * - ASW003: Provider not found -> returns 404 + available list
 * - ASW004: Switch success -> returns 200 + provider info
 * - ASW005: Invalid JSON -> returns 400
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { handleSwitchProvider, setServer } from "@/api/switch";
import type { ProxyServer } from "@/server/handler";
import type { ConfigManager } from "@/config";
import type { SwitchResponse } from "@/types";
import type { IncomingMessage, ServerResponse } from "node:http";
import { EventEmitter } from "stream";

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

/* eslint-disable @typescript-eslint/naming-convention -- Testing snake_case provider IDs for mock data */

// Mock IncomingMessage for testing
class MockIncomingMessage extends EventEmitter {
  url: string;
  method: string;
  headers: Record<string, string>;

  constructor(url: string, method: string = "POST") {
    super();
    this.url = url;
    this.method = method;
    this.headers = {};
  }

  // Simulate data being received
  receiveData(chunk: string): void {
    this.emit("data", Buffer.from(chunk));
  }

  // Simulate end of data
  endData(): void {
    this.emit("end");
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
const mockProvider: {
  id: string;
  name: string;
  baseUrl: string;
  mode: "passthrough" | "inject";
  providerType: "anthropic" | "openai";
  enabled: boolean;
} = {
  id: "test-provider",
  name: "Test Provider",
  baseUrl: "https://api.test.com",
  mode: "passthrough",
  providerType: "anthropic",
  enabled: true,
};

type ProviderType = typeof mockProvider;

// Mock Router
class MockRouter {
  private providers: Record<string, ProviderType>;
  private currentProviderId: string | null = "test-provider";

  constructor() {
    this.providers = {
      "test-provider": mockProvider,
      "another-provider": {
        id: "another-provider",
        name: "Another Provider",
        baseUrl: "https://api2.test.com",
        mode: "inject",
        providerType: "openai",
        enabled: true,
      },
    };
  }

  getCurrentProvider(): ProviderType | null {
    if (this.currentProviderId) {
      return this.providers[this.currentProviderId] ?? null;
    }
    return null;
  }

  getCurrentProviderId(): string | null {
    return this.currentProviderId;
  }

  switchProvider(providerId: string): boolean {
    if (this.providers[providerId]) {
      this.currentProviderId = providerId;
      return true;
    }
    return false;
  }

  getProviders(): Record<string, ProviderType> {
    return this.providers;
  }
}

// Mock ConfigManager
class MockConfigManager {
  private router: MockRouter;

  constructor(router: MockRouter) {
    this.router = router;
  }

  get providers(): Record<string, ProviderType> {
    return this.router.getProviders();
  }

  // Add missing property to satisfy partial ConfigManager
  get router_(): MockRouter {
    return this.router;
  }
}

// Mock ProxyServer
class MockProxyServer {
  private router: MockRouter;
  private config: ConfigManager;

  constructor(router: MockRouter, config: ConfigManager) {
    this.router = router;
    this.config = config;
  }

  getRouter(): MockRouter {
    return this.router;
  }

  getConfig(): MockConfigManager {
    return this.config as unknown as MockConfigManager;
  }
}

describe("api/switch: handleSwitchProvider", () => {
  let mockRouter: MockRouter;
  let mockConfig: MockConfigManager;
  let mockServer: ProxyServer;

  beforeEach(() => {
    vi.clearAllMocks();

    mockRouter = new MockRouter();
    mockConfig = new MockConfigManager(mockRouter);
    mockServer = new MockProxyServer(
      mockRouter,
      mockConfig as unknown as ConfigManager
    ) as unknown as ProxyServer;
  });

  afterEach(() => {
    setServer(null as unknown as ProxyServer);
  });

  describe("ASW001: Server not initialized", () => {
    it("should return 503 when server is null", async () => {
      const req = new MockIncomingMessage(
        "/ccrelay/api/switch",
        "POST"
      ) as unknown as MockIncomingMessage & IncomingMessage;
      const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;

      // Explicitly set server to null
      setServer(null as unknown as ProxyServer);

      await handleSwitchProvider(req, res, {});

      expect(res.statusCode).toBe(503);
      expect(res.ended).toBe(true);

      const body = JSON.parse(res.body) as { error: string };
      expect(body.error).toBe("Server not initialized");
    });
  });

  describe("ASW002: Missing provider field", () => {
    it("should return 400 when provider field is missing", async () => {
      const req = new MockIncomingMessage(
        "/ccrelay/api/switch",
        "POST"
      ) as unknown as MockIncomingMessage & IncomingMessage;
      const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;

      setServer(mockServer);

      const promise = handleSwitchProvider(req, res, {});

      req.receiveData('{"other_field": "value"}');
      req.endData();

      await promise;

      expect(res.statusCode).toBe(400);
      expect(res.ended).toBe(true);

      const body = JSON.parse(res.body) as SwitchResponse;
      expect(body.status).toBe("error");
      expect(body.message).toBe("Missing provider field in request body");
    });

    it("should return 400 when provider is empty string", async () => {
      const req = new MockIncomingMessage(
        "/ccrelay/api/switch",
        "POST"
      ) as unknown as MockIncomingMessage & IncomingMessage;
      const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;

      setServer(mockServer);

      const promise = handleSwitchProvider(req, res, {});

      req.receiveData('{"provider": ""}');
      req.endData();

      await promise;

      expect(res.statusCode).toBe(400);
      expect(res.ended).toBe(true);

      const body = JSON.parse(res.body) as SwitchResponse;
      expect(body.status).toBe("error");
      expect(body.message).toBe("Missing provider field in request body");
    });

    it("should return 400 when body is empty object", async () => {
      const req = new MockIncomingMessage(
        "/ccrelay/api/switch",
        "POST"
      ) as unknown as MockIncomingMessage & IncomingMessage;
      const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;

      setServer(mockServer);

      const promise = handleSwitchProvider(req, res, {});

      req.receiveData("{}");
      req.endData();

      await promise;

      expect(res.statusCode).toBe(400);
      expect(res.ended).toBe(true);

      const body = JSON.parse(res.body) as SwitchResponse;
      expect(body.status).toBe("error");
    });
  });

  describe("ASW003: Provider not found", () => {
    it("should return 404 with available list when provider not found", async () => {
      const req = new MockIncomingMessage(
        "/ccrelay/api/switch",
        "POST"
      ) as unknown as MockIncomingMessage & IncomingMessage;
      const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;

      setServer(mockServer);

      const promise = handleSwitchProvider(req, res, {});

      req.receiveData('{"provider": "non-existent"}');
      req.endData();

      await promise;

      expect(res.statusCode).toBe(404);
      expect(res.ended).toBe(true);

      const body = JSON.parse(res.body) as SwitchResponse;
      expect(body.status).toBe("error");
      expect(body.message).toBe("Provider 'non-existent' not found");
      expect(body.available).toEqual(["test-provider", "another-provider"]);
    });

    it("should include all available provider IDs in error response", async () => {
      const req = new MockIncomingMessage(
        "/ccrelay/api/switch",
        "POST"
      ) as unknown as MockIncomingMessage & IncomingMessage;
      const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;

      setServer(mockServer);

      const promise = handleSwitchProvider(req, res, {});

      req.receiveData('{"provider": "unknown"}');
      req.endData();

      await promise;

      const body = JSON.parse(res.body) as SwitchResponse;
      expect(body.available).toBeDefined();
      expect(Array.isArray(body.available)).toBe(true);
      expect(body.available?.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("ASW004: Switch success", () => {
    it("should return 200 with provider info on successful switch", async () => {
      const req = new MockIncomingMessage(
        "/ccrelay/api/switch",
        "POST"
      ) as unknown as MockIncomingMessage & IncomingMessage;
      const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;

      setServer(mockServer);

      const promise = handleSwitchProvider(req, res, {});

      req.receiveData('{"provider": "another-provider"}');
      req.endData();

      await promise;

      expect(res.statusCode).toBe(200);
      expect(res.ended).toBe(true);

      const body = JSON.parse(res.body) as SwitchResponse;
      expect(body.status).toBe("ok");
      expect(body.provider).toBe("another-provider");
      expect(body.name).toBe("Another Provider");
    });

    it("should update current provider after successful switch", async () => {
      const req = new MockIncomingMessage(
        "/ccrelay/api/switch",
        "POST"
      ) as unknown as MockIncomingMessage & IncomingMessage;
      const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;

      setServer(mockServer);

      const promise = handleSwitchProvider(req, res, {});

      req.receiveData('{"provider": "another-provider"}');
      req.endData();

      await promise;

      // Verify the router's current provider was updated
      expect(mockRouter.getCurrentProviderId()).toBe("another-provider");
    });

    it("should handle switching to the same provider", async () => {
      const req = new MockIncomingMessage(
        "/ccrelay/api/switch",
        "POST"
      ) as unknown as MockIncomingMessage & IncomingMessage;
      const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;

      setServer(mockServer);

      const promise = handleSwitchProvider(req, res, {});

      req.receiveData('{"provider": "test-provider"}');
      req.endData();

      await promise;

      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.body) as SwitchResponse;
      expect(body.status).toBe("ok");
      expect(body.provider).toBe("test-provider");
      expect(body.name).toBe("Test Provider");
    });
  });

  describe("ASW005: Invalid JSON", () => {
    it("should return 400 for invalid JSON", async () => {
      const req = new MockIncomingMessage(
        "/ccrelay/api/switch",
        "POST"
      ) as unknown as MockIncomingMessage & IncomingMessage;
      const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;

      setServer(mockServer);

      const promise = handleSwitchProvider(req, res, {});

      req.receiveData('{"provider": "test" invalid json }');
      req.endData();

      await promise;

      expect(res.statusCode).toBe(400);
      expect(res.ended).toBe(true);

      const body = JSON.parse(res.body) as SwitchResponse;
      expect(body.status).toBe("error");
      expect(body.message).toBe("Invalid JSON in request body");
    });

    it("should return 400 for malformed JSON syntax", async () => {
      const req = new MockIncomingMessage(
        "/ccrelay/api/switch",
        "POST"
      ) as unknown as MockIncomingMessage & IncomingMessage;
      const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;

      setServer(mockServer);

      const promise = handleSwitchProvider(req, res, {});

      req.receiveData('{provider: "test"}');
      req.endData();

      await promise;

      expect(res.statusCode).toBe(400);
      expect(res.ended).toBe(true);

      const body = JSON.parse(res.body) as SwitchResponse;
      expect(body.status).toBe("error");
      expect(body.message).toBe("Invalid JSON in request body");
    });
  });

  describe("params parameter", () => {
    it("should ignore params parameter", async () => {
      const req = new MockIncomingMessage(
        "/ccrelay/api/switch",
        "POST"
      ) as unknown as MockIncomingMessage & IncomingMessage;
      const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;

      setServer(mockServer);

      const promise = handleSwitchProvider(req, res, {});

      req.receiveData('{"provider": "test-provider"}');
      req.endData();

      await promise;

      expect(res.statusCode).toBe(200);
    });
  });
});
