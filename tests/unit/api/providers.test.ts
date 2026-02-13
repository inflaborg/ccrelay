/**
 * Unit tests for api/providers.ts
 *
 * Product Requirements:
 * - AP001: Server not initialized -> returns 503
 * - AP002: Normal request -> returns providers array + current
 * - AP003: No enabled providers -> returns empty array
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { handleListProviders, setServer } from "@/api/providers";
import type { ProxyServer } from "@/server/handler";
import type { ConfigManager } from "@/config";
import type { Provider, ProvidersResponse } from "@/types";
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

// Mock Provider type
type MockProviderType = {
  id: string;
  name: string;
  baseUrl: string;
  mode: "passthrough" | "inject";
  providerType: "anthropic" | "openai";
  enabled: boolean;
};

// Mock Router
class MockRouter {
  private providers: Record<string, MockProviderType>;
  private currentProviderId: string | null = "testProvider";

  constructor(providers: Record<string, MockProviderType>) {
    this.providers = providers;
    if (Object.keys(providers).length === 0) {
      this.currentProviderId = null;
    }
  }

  getCurrentProvider(): MockProviderType | null {
    if (this.currentProviderId) {
      return this.providers[this.currentProviderId] ?? null;
    }
    return null;
  }

  getCurrentProviderId(): string | null {
    return this.currentProviderId;
  }

  setCurrentProvider(providerId: string | null): void {
    this.currentProviderId = providerId;
  }

  getProviders(): Record<string, MockProviderType> {
    return this.providers;
  }
}

// Mock ConfigManager
class MockConfigManager {
  private router: MockRouter;

  constructor(router: MockRouter) {
    this.router = router;
  }

  get enabledProviders(): Provider[] {
    const providers = this.router.getProviders();
    return Object.values(providers).filter(p => p.enabled);
  }

  get providers(): Record<string, Provider> {
    return this.router.getProviders() as unknown as Record<string, Provider>;
  }
}

// Mock ProxyServer
class MockProxyServer {
  private router: MockRouter;
  private config: ConfigManager;

  constructor(router: MockRouter, config: MockConfigManager) {
    this.router = router;
    this.config = config as unknown as ConfigManager;
  }

  getRouter(): MockRouter {
    return this.router;
  }

  getConfig(): MockConfigManager {
    return this.config as unknown as MockConfigManager;
  }
}

describe("api/providers: handleListProviders", () => {
  let mockRouter: MockRouter;
  let mockConfig: MockConfigManager;
  let mockServer: ProxyServer;

  beforeEach(() => {
    vi.clearAllMocks();

    mockRouter = new MockRouter({
      testProvider: {
        id: "testProvider",
        name: "Test Provider",
        baseUrl: "https://api.test.com",
        mode: "passthrough",
        providerType: "anthropic",
        enabled: true,
      },
      anotherProvider: {
        id: "anotherProvider",
        name: "Another Provider",
        baseUrl: "https://api2.test.com",
        mode: "inject",
        providerType: "openai",
        enabled: true,
      },
      disabledProvider: {
        id: "disabledProvider",
        name: "Disabled Provider",
        baseUrl: "https://api3.test.com",
        mode: "passthrough",
        providerType: "anthropic",
        enabled: false,
      },
    });
    mockConfig = new MockConfigManager(mockRouter);
    mockServer = new MockProxyServer(mockRouter, mockConfig) as unknown as ProxyServer;
  });

  afterEach(() => {
    // Reset to null by importing and directly setting module state
    // The module starts with serverInstance = null
    // We don't need to explicitly set it back
  });

  describe("AP001: Server not initialized", () => {
    it("should return 503 when server is null", () => {
      const req = new MockIncomingMessage("/ccrelay/api/providers", "GET");
      const res = new MockServerResponse();

      // Explicitly set server to null
      setServer(null as unknown as ProxyServer);

      handleListProviders(req as unknown as IncomingMessage, res as unknown as ServerResponse, {});

      expect(res.statusCode).toBe(503);
      expect(res.ended).toBe(true);

      const body = JSON.parse(res.body) as { error: string };
      expect(body.error).toBe("Server not initialized");
    });

    it("should return 503 when server instance is not set", () => {
      const req = new MockIncomingMessage("/ccrelay/api/providers", "GET");
      const res = new MockServerResponse();

      // Don't set any server instance
      handleListProviders(req as unknown as IncomingMessage, res as unknown as ServerResponse, {});

      expect(res.statusCode).toBe(503);
      expect(res.ended).toBe(true);

      const body = JSON.parse(res.body) as { error: string };
      expect(body.error).toBe("Server not initialized");
    });
  });

  describe("AP002: Normal request", () => {
    it("should return providers array and current provider", () => {
      const req = new MockIncomingMessage("/ccrelay/api/providers", "GET");
      const res = new MockServerResponse();

      setServer(mockServer);

      handleListProviders(req as unknown as IncomingMessage, res as unknown as ServerResponse, {});

      expect(res.statusCode).toBe(200);
      expect(res.ended).toBe(true);

      const body = JSON.parse(res.body) as ProvidersResponse;
      expect(body.providers).toBeDefined();
      expect(Array.isArray(body.providers)).toBe(true);
      expect(body.providers).toHaveLength(2);
      expect(body.current).toBe("testProvider");
    });

    it("should only include enabled providers", () => {
      const req = new MockIncomingMessage("/ccrelay/api/providers", "GET");
      const res = new MockServerResponse();

      setServer(mockServer);

      handleListProviders(req as unknown as IncomingMessage, res as unknown as ServerResponse, {});

      const body = JSON.parse(res.body) as ProvidersResponse;

      expect(body.providers).toHaveLength(2);
      expect(body.providers.map(p => p.id)).toEqual(
        expect.arrayContaining(["testProvider", "anotherProvider"])
      );
      expect(body.providers.map(p => p.id)).not.toContain("disabledProvider");
    });

    it("should mark current provider as active", () => {
      const req = new MockIncomingMessage("/ccrelay/api/providers", "GET");
      const res = new MockServerResponse();

      setServer(mockServer);

      handleListProviders(req as unknown as IncomingMessage, res as unknown as ServerResponse, {});

      const body = JSON.parse(res.body) as ProvidersResponse;

      const currentProvider = body.providers.find(p => p.id === body.current);
      expect(currentProvider?.active).toBe(true);

      const otherProviders = body.providers.filter(p => p.id !== body.current);
      for (const provider of otherProviders) {
        expect(provider.active).toBe(false);
      }
    });

    it("should include all provider fields in response", () => {
      const req = new MockIncomingMessage("/ccrelay/api/providers", "GET");
      const res = new MockServerResponse();

      setServer(mockServer);

      handleListProviders(req as unknown as IncomingMessage, res as unknown as ServerResponse, {});

      const body = JSON.parse(res.body) as ProvidersResponse;

      for (const provider of body.providers) {
        expect(provider).toHaveProperty("id");
        expect(provider).toHaveProperty("name");
        expect(provider).toHaveProperty("mode");
        expect(provider).toHaveProperty("providerType");
        expect(provider).toHaveProperty("active");
      }
    });

    it("should handle null current provider gracefully", () => {
      const req = new MockIncomingMessage("/ccrelay/api/providers", "GET");
      const res = new MockServerResponse();

      mockRouter.setCurrentProvider(null);
      setServer(mockServer);

      handleListProviders(req as unknown as IncomingMessage, res as unknown as ServerResponse, {});

      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.body) as ProvidersResponse;
      expect(body.current).toBeNull();

      for (const provider of body.providers) {
        expect(provider.active).toBe(false);
      }
    });
  });

  describe("AP003: No enabled providers", () => {
    it("should return empty array when all providers are disabled", () => {
      const req = new MockIncomingMessage("/ccrelay/api/providers", "GET");
      const res = new MockServerResponse();

      const routerWithDisabled = new MockRouter({
        disabledProvider: {
          id: "disabledProvider",
          name: "Disabled Provider",
          baseUrl: "https://api3.test.com",
          mode: "passthrough",
          providerType: "anthropic",
          enabled: false,
        },
      });
      const configWithDisabled = new MockConfigManager(routerWithDisabled);
      const serverWithDisabled = new MockProxyServer(routerWithDisabled, configWithDisabled);

      // Explicitly set current provider to null since default "testProvider" doesn't exist
      routerWithDisabled.setCurrentProvider(null);

      setServer(serverWithDisabled as unknown as ProxyServer);

      handleListProviders(req as unknown as IncomingMessage, res as unknown as ServerResponse, {});

      expect(res.statusCode).toBe(200);
      expect(res.ended).toBe(true);

      const body = JSON.parse(res.body) as ProvidersResponse;
      expect(body.providers).toEqual([]);
      expect(body.current).toBeNull();
    });

    it("should return empty providers list with null current", () => {
      const req = new MockIncomingMessage("/ccrelay/api/providers", "GET");
      const res = new MockServerResponse();

      const routerWithNone = new MockRouter({});
      const configWithNone = new MockConfigManager(routerWithNone);
      const serverWithNone = new MockProxyServer(routerWithNone, configWithNone);

      setServer(serverWithNone as unknown as ProxyServer);

      handleListProviders(req as unknown as IncomingMessage, res as unknown as ServerResponse, {});

      expect(res.statusCode).toBe(200);

      const body = JSON.parse(res.body) as ProvidersResponse;
      expect(body.providers).toEqual([]);
      expect(body.current).toBeNull();
    });
  });

  describe("setServer function", () => {
    it("should set server instance", () => {
      const req = new MockIncomingMessage("/ccrelay/api/providers", "GET");
      const res = new MockServerResponse();

      setServer(mockServer);

      handleListProviders(req as unknown as IncomingMessage, res as unknown as ServerResponse, {});

      expect(res.statusCode).toBe(200);
    });
  });

  describe("params parameter", () => {
    it("should accept and ignore empty params", () => {
      const req = new MockIncomingMessage("/ccrelay/api/providers", "GET");
      const res = new MockServerResponse();

      setServer(mockServer);

      handleListProviders(req as unknown as IncomingMessage, res as unknown as ServerResponse, {});

      expect(res.statusCode).toBe(200);
    });

    it("should accept and ignore params with values", () => {
      const req = new MockIncomingMessage("/ccrelay/api/providers", "GET");
      const res = new MockServerResponse();

      setServer(mockServer);

      handleListProviders(req as unknown as IncomingMessage, res as unknown as ServerResponse, {
        foo: "bar",
        id: "123",
      });

      expect(res.statusCode).toBe(200);
    });
  });
});
