import { describe, expect, it } from "vitest";
import type { LogEntry } from "../../../web/src/types/api";
import {
  buildLogExportFilesForEntry,
  logExportFilename,
} from "../../../web/src/features/logs/log-export";

function sampleLog(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id: 42,
    timestamp: 1_700_000_000_000,
    providerId: "p1",
    providerName: "Provider 1",
    method: "POST",
    path: "/v1/messages",
    requestBody: JSON.stringify({
      model: "claude-sonnet-4",
      system: "You are helpful.",
      messages: [{ role: "user", content: "Hello" }],
      tools: [
        {
          name: "lookup",
          description: "Look something up",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    }).replace("inputSchema", "input_schema"),
    originalRequestBody: JSON.stringify({ model: "claude-sonnet-4", messages: [] }),
    responseBody: JSON.stringify({
      role: "assistant",
      content: [{ type: "text", text: "Hi there" }],
    }),
    originalResponseBody: JSON.stringify({ role: "assistant", content: [] }),
    requestHeaders: '{"content-type":"application/json","authorization":"sk-***"}',
    responseHeaders: '{"content-type":"application/json"}',
    statusCode: 200,
    duration: 120,
    success: true,
    ...overrides,
  };
}

describe("buildLogExportFilesForEntry", () => {
  it("writes one directory per id with converted/original JSON, headers, and analysis markdown", () => {
    const files = buildLogExportFilesForEntry(sampleLog());
    const byPath = Object.fromEntries(files.map(f => [f.path, f.content]));

    expect(Object.keys(byPath).sort()).toEqual(
      [
        "42/meta.json",
        "42/request-analysis.md",
        "42/request-converted.json",
        "42/request-headers.json",
        "42/request-original.json",
        "42/request-tools.md",
        "42/response-analysis.md",
        "42/response-converted.json",
        "42/response-headers.json",
        "42/response-original.json",
      ].sort()
    );

    expect(byPath["42/request-analysis.md"]).toContain("### System");
    expect(byPath["42/request-analysis.md"]).toContain("Hello");
    expect(byPath["42/request-tools.md"]).toContain("lookup");
    const headers = JSON.parse(byPath["42/request-headers.json"]) as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    const converted = JSON.parse(byPath["42/response-converted.json"]) as {
      content: Array<{ text: string }>;
    };
    expect(converted.content[0].text).toBe("Hi there");
    expect(byPath["42/response-analysis.md"]).toContain("```json");
    const meta = JSON.parse(byPath["42/meta.json"]) as { path: string };
    expect(meta.path).toBe("/v1/messages");
  });

  it("omits tools markdown when the request has no tools", () => {
    const files = buildLogExportFilesForEntry(
      sampleLog({
        requestBody: JSON.stringify({ messages: [{ role: "user", content: "Hi" }] }),
      })
    );
    expect(files.some(f => f.path.endsWith("request-tools.md"))).toBe(false);
  });
});

describe("logExportFilename", () => {
  it("uses a timestamped zip name", () => {
    expect(logExportFilename(new Date("2026-08-13T19:35:00"))).toBe(
      "ccrelay-logs-20260813-193500.zip"
    );
  });
});
