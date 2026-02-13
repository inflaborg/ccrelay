/**
 * Unit tests for api/index.ts
 *
 * Product Requirements:
 * - API path detection with /ccrelay/api/ prefix
 * - CORS headers for all responses
 * - JSON response formatting
 * - JSON body parsing from requests
 * - Route matching for API endpoints
 */

import { describe, it, expect, vi } from "vitest";
import {
  isApiRequest,
  setCorsHeaders,
  sendJson,
  parseJsonBody,
  handleApiRequest,
} from "@/api/index";
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

  // Simulate data being received
  receiveData(chunk: string): void {
    this.emit("data", Buffer.from(chunk));
  }

  // Simulate end of data
  endData(): void {
    this.emit("end");
  }

  // Simulate error
  emitError(err: Error): void {
    this.emit("error", err);
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

describe("api: isApiRequest", () => {
  it("should return true for /ccrelay/api/ paths", () => {
    expect(isApiRequest("/ccrelay/api/status")).toBe(true);
    expect(isApiRequest("/ccrelay/api/providers")).toBe(true);
    expect(isApiRequest("/ccrelay/api/switch")).toBe(true);
    expect(isApiRequest("/ccrelay/api/logs")).toBe(true);
    expect(isApiRequest("/ccrelay/api/stats")).toBe(true);
    expect(isApiRequest("/ccrelay/api/version")).toBe(true);
  });

  it("should return true for nested /ccrelay/api/ paths", () => {
    expect(isApiRequest("/ccrelay/api/logs/123")).toBe(true);
    expect(isApiRequest("/ccrelay/api/some/nested/path")).toBe(true);
  });

  it("should return false for non-API paths", () => {
    expect(isApiRequest("/v1/messages")).toBe(false);
    expect(isApiRequest("/messages")).toBe(false);
    expect(isApiRequest("/api/status")).toBe(false);
    expect(isApiRequest("/ccrelay/status")).toBe(false);
    expect(isApiRequest("/")).toBe(false);
  });

  it("should return false for paths with ccrelay/api but not as prefix", () => {
    expect(isApiRequest("/other/ccrelay/api/status")).toBe(false);
    expect(isApiRequest("/prefix/ccrelay/api/test")).toBe(false);
  });

  it("should handle empty string", () => {
    expect(isApiRequest("")).toBe(false);
  });

  it("should handle paths with query strings", () => {
    // isApiRequest checks the raw path, query string is included
    expect(isApiRequest("/ccrelay/api/status?foo=bar")).toBe(true);
    expect(isApiRequest("/v1/messages?test=1")).toBe(false);
  });
});

describe("api: setCorsHeaders", () => {
  it("should set all required CORS headers", () => {
    const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;
    setCorsHeaders(res);

    expect(res.getHeader("Access-Control-Allow-Origin")).toBe("*");
    expect(res.getHeader("Access-Control-Allow-Methods")).toBe(
      "GET, POST, PUT, DELETE, PATCH, OPTIONS"
    );
    expect(res.getHeader("Access-Control-Allow-Headers")).toBe(
      "Content-Type, Authorization, X-API-Key"
    );
  });

  it("should overwrite existing CORS headers", () => {
    const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;
    res.setHeader("Access-Control-Allow-Origin", "https://example.com");

    setCorsHeaders(res);

    expect(res.getHeader("Access-Control-Allow-Origin")).toBe("*");
  });

  it("should preserve other existing headers", () => {
    const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;
    res.setHeader("X-Custom-Header", "custom-value");

    setCorsHeaders(res);

    expect(res.getHeader("X-Custom-Header")).toBe("custom-value");
    expect(res.getHeader("Access-Control-Allow-Origin")).toBe("*");
  });
});

describe("api: sendJson", () => {
  it("should send JSON response with status code", () => {
    const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;
    const data = { message: "Hello", status: "ok" };

    sendJson(res, 200, data);

    expect(res.statusCode).toBe(200);
    expect(res.getHeader("Content-Type")).toBe("application/json");
    expect(res.body).toBe(JSON.stringify(data));
    expect(res.ended).toBe(true);
  });

  it("should send error status codes", () => {
    const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;
    const data = { error: "Not found" };

    sendJson(res, 404, data);

    expect(res.statusCode).toBe(404);
    expect(res.body).toBe(JSON.stringify(data));
  });

  it("should send 500 status code", () => {
    const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;
    const data = { error: "Internal server error" };

    sendJson(res, 500, data);

    expect(res.statusCode).toBe(500);
    expect(res.body).toBe(JSON.stringify(data));
  });

  it("should send 503 status code for service unavailable", () => {
    const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;
    const data = { error: "Server not initialized" };

    sendJson(res, 503, data);

    expect(res.statusCode).toBe(503);
    expect(res.body).toBe(JSON.stringify(data));
  });

  it("should handle null data", () => {
    const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;

    sendJson(res, 200, null);

    expect(res.body).toBe("null");
  });

  it("should handle undefined data", () => {
    const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;

    sendJson(res, 200, undefined);

    expect(res.body).toBe("");
  });

  it("should handle complex nested objects", () => {
    const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;
    const data = {
      providers: [
        { id: "official", name: "Official", mode: "passthrough" },
        { id: "custom", name: "Custom", mode: "inject" },
      ],
      current: "official",
    };

    sendJson(res, 200, data);

    expect(res.body).toBe(JSON.stringify(data, null, 0));
  });

  it("should handle arrays", () => {
    const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;
    const data = ["item1", "item2", "item3"];

    sendJson(res, 200, data);

    expect(res.body).toBe(JSON.stringify(data));
  });

  it("should handle special characters in data", () => {
    const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;
    const data = { message: 'Hello\nWorld\t"quoted"' };

    sendJson(res, 200, data);

    expect(res.body).toBe(JSON.stringify(data));
  });
});

describe("api: parseJsonBody", () => {
  it("should parse valid JSON object", async () => {
    const req = new MockIncomingMessage(
      "/ccrelay/api/switch",
      "POST"
    ) as unknown as MockIncomingMessage & IncomingMessage;
    const jsonData = JSON.stringify({ provider: "custom" });

    const promise = parseJsonBody<{ provider: string }>(req);
    req.receiveData(jsonData);
    req.endData();

    const result = await promise;
    expect(result).toEqual({ provider: "custom" });
  });

  it("should parse valid JSON array", async () => {
    const req = new MockIncomingMessage(
      "/ccrelay/api/test",
      "POST"
    ) as unknown as MockIncomingMessage & IncomingMessage;
    const jsonData = JSON.stringify([1, 2, 3]);

    const promise = parseJsonBody<number[]>(req);
    req.receiveData(jsonData);
    req.endData();

    const result = await promise;
    expect(result).toEqual([1, 2, 3]);
  });

  it("should parse valid JSON string", async () => {
    const req = new MockIncomingMessage(
      "/ccrelay/api/test",
      "POST"
    ) as unknown as MockIncomingMessage & IncomingMessage;
    const jsonData = JSON.stringify("test string");

    const promise = parseJsonBody<string>(req);
    req.receiveData(jsonData);
    req.endData();

    const result = await promise;
    expect(result).toBe("test string");
  });

  it("should parse valid JSON number", async () => {
    const req = new MockIncomingMessage(
      "/ccrelay/api/test",
      "POST"
    ) as unknown as MockIncomingMessage & IncomingMessage;
    const jsonData = JSON.stringify(42);

    const promise = parseJsonBody<number>(req);
    req.receiveData(jsonData);
    req.endData();

    const result = await promise;
    expect(result).toBe(42);
  });

  it("should return empty object for empty body", async () => {
    const req = new MockIncomingMessage(
      "/ccrelay/api/test",
      "POST"
    ) as unknown as MockIncomingMessage & IncomingMessage;

    const promise = parseJsonBody(req);
    req.endData();

    const result = await promise;
    expect(result).toEqual({});
  });

  it("should handle chunked data", async () => {
    const req = new MockIncomingMessage(
      "/ccrelay/api/test",
      "POST"
    ) as unknown as MockIncomingMessage & IncomingMessage;
    const jsonData = JSON.stringify({ key: "value" });

    const promise = parseJsonBody<{ key: string }>(req);

    // Send data in chunks
    req.receiveData(jsonData.slice(0, 10));
    req.receiveData(jsonData.slice(10));
    req.endData();

    const result = await promise;
    expect(result).toEqual({ key: "value" });
  });

  it("should reject invalid JSON", async () => {
    const req = new MockIncomingMessage(
      "/ccrelay/api/test",
      "POST"
    ) as unknown as MockIncomingMessage & IncomingMessage;

    const promise = parseJsonBody(req);
    req.receiveData("{ invalid json }");
    req.endData();

    await expect(promise).rejects.toThrow();
  });

  it("should reject on request error", async () => {
    const req = new MockIncomingMessage(
      "/ccrelay/api/test",
      "POST"
    ) as unknown as MockIncomingMessage & IncomingMessage;

    const promise = parseJsonBody(req);
    req.emitError(new Error("Request failed"));

    await expect(promise).rejects.toThrow("Request failed");
  });

  it("should handle unicode characters", async () => {
    const req = new MockIncomingMessage(
      "/ccrelay/api/test",
      "POST"
    ) as unknown as MockIncomingMessage & IncomingMessage;
    const jsonData = JSON.stringify({ message: "Hello 世界 🌍" });

    const promise = parseJsonBody<{ message: string }>(req);
    req.receiveData(jsonData);
    req.endData();

    const result = await promise;
    expect(result.message).toBe("Hello 世界 🌍");
  });

  it("should handle nested objects", async () => {
    const req = new MockIncomingMessage(
      "/ccrelay/api/test",
      "POST"
    ) as unknown as MockIncomingMessage & IncomingMessage;
    const jsonData = JSON.stringify({
      config: {
        server: { port: 8080, host: "localhost" },
        providers: { official: { name: "Official" } },
      },
    });

    const promise = parseJsonBody(req);
    req.receiveData(jsonData);
    req.endData();

    const result = await promise;
    expect(result).toEqual({
      config: {
        server: { port: 8080, host: "localhost" },
        providers: { official: { name: "Official" } },
      },
    });
  });
});

describe("api: handleApiRequest route detection", () => {
  it("should return false for non-API requests", () => {
    const req = new MockIncomingMessage("/v1/messages", "GET") as unknown as MockIncomingMessage &
      IncomingMessage;
    const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;

    const result = handleApiRequest(req, res);

    // Non-API routes return false (not handled)
    expect(result).toBe(false);
  });

  it("should return true for API requests", () => {
    const req = new MockIncomingMessage(
      "/ccrelay/api/status",
      "GET"
    ) as unknown as MockIncomingMessage & IncomingMessage;
    const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;

    const result = handleApiRequest(req, res);

    // API routes return true (handled), even though server is not initialized
    expect(result).toBe(true);
  });

  it("should handle OPTIONS preflight requests", () => {
    const req = new MockIncomingMessage(
      "/ccrelay/api/status",
      "OPTIONS"
    ) as unknown as MockIncomingMessage & IncomingMessage;
    const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;

    const result = handleApiRequest(req, res);

    expect(result).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.getHeader("Access-Control-Allow-Origin")).toBe("*");
  });

  it("should strip query string for route matching", () => {
    const req = new MockIncomingMessage(
      "/ccrelay/api/status?foo=bar&baz=qux",
      "GET"
    ) as unknown as MockIncomingMessage & IncomingMessage;
    const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;

    const result = handleApiRequest(req, res);

    expect(result).toBe(true);
  });

  it("should return 404 for unknown API endpoints", () => {
    const req = new MockIncomingMessage(
      "/ccrelay/api/unknown",
      "GET"
    ) as unknown as MockIncomingMessage & IncomingMessage;
    const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;

    const result = handleApiRequest(req, res);

    expect(result).toBe(true);
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain("API endpoint not found");
  });
});

describe("api: handleApiRequest specific routes", () => {
  it("should handle GET /ccrelay/api/status", () => {
    const req = new MockIncomingMessage(
      "/ccrelay/api/status",
      "GET"
    ) as unknown as MockIncomingMessage & IncomingMessage;
    const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;

    handleApiRequest(req, res);

    // Should respond with 503 since server is not initialized
    expect(res.statusCode).toBe(503);
    expect(res.body).toContain("Server not initialized");
  });

  it("should handle GET /ccrelay/api/providers", () => {
    const req = new MockIncomingMessage(
      "/ccrelay/api/providers",
      "GET"
    ) as unknown as MockIncomingMessage & IncomingMessage;
    const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;

    handleApiRequest(req, res);

    // Should respond with 503 since server is not initialized
    expect(res.statusCode).toBe(503);
  });

  it("should handle POST /ccrelay/api/switch", async () => {
    const req = new MockIncomingMessage(
      "/ccrelay/api/switch",
      "POST"
    ) as unknown as MockIncomingMessage & IncomingMessage;
    const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;

    const jsonData = JSON.stringify({ provider: "test" });
    req.receiveData(jsonData);
    req.endData();

    // Wait for async handler
    await new Promise(resolve => setTimeout(resolve, 10));

    handleApiRequest(req, res);

    // Should respond with 503 since server is not initialized
    expect(res.statusCode).toBe(503);
  });

  it("should handle GET /ccrelay/api/logs", () => {
    const req = new MockIncomingMessage(
      "/ccrelay/api/logs",
      "GET"
    ) as unknown as MockIncomingMessage & IncomingMessage;
    const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;

    handleApiRequest(req, res);

    // Should respond with 200 (empty list) even if server not fully initialized, as DB handles it
    expect(res.statusCode).toBe(200);
  });

  it("should handle GET /ccrelay/api/stats", () => {
    const req = new MockIncomingMessage(
      "/ccrelay/api/stats",
      "GET"
    ) as unknown as MockIncomingMessage & IncomingMessage;
    const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;

    handleApiRequest(req, res);

    // Should respond with 200 (empty stats) even if server not fully initialized
    expect(res.statusCode).toBe(200);
  });

  it("should handle GET /ccrelay/api/version", () => {
    const req = new MockIncomingMessage(
      "/ccrelay/api/version",
      "GET"
    ) as unknown as MockIncomingMessage & IncomingMessage;
    const res = new MockServerResponse() as unknown as MockServerResponse & ServerResponse;

    handleApiRequest(req, res);

    // Version endpoint doesn't require server initialization
    // It should return 200 with version info
    expect(res.statusCode).toBe(200);
  });
});
