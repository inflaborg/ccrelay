/* eslint-disable @typescript-eslint/naming-convention -- DB column wire names */
import { describe, expect, it } from "vitest";
import { extractModelsFromBodies } from "@/database/shared-utils";
import { buildServiceRequestLogSnapshot } from "@/server/request/serviceLogSnapshot";
import type { Provider } from "@/types";

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: "p1",
    name: "Provider",
    baseUrl: "https://example.com",
    mode: "inject",
    providerType: "anthropic",
    modelMap: [{ pattern: "claude-*", model: "glm-5.1" }],
    ...overrides,
  };
}

describe("buildServiceRequestLogSnapshot", () => {
  it("records the mapped model in the request log while keeping the client body", () => {
    const raw = Buffer.from(
      JSON.stringify({
        model: "claude-opus-4-6",
        messages: [{ role: "user", content: "search this" }],
      }),
      "utf-8"
    );

    const snapshot = buildServiceRequestLogSnapshot(raw, provider(), true);
    const models = extractModelsFromBodies({
      original_request_body: snapshot.originalRequestBody,
      request_body: snapshot.requestBodyLog,
    });

    expect(models.model).toBe("claude-opus-4-6");
    expect(models.mappedModel).toBe("glm-5.1");
    const original = JSON.parse(snapshot.originalRequestBody ?? "{}") as { model?: string };
    expect(original.model).toBe("claude-opus-4-6");
    expect(raw.toString("utf-8")).toContain("claude-opus-4-6");
  });

  it("leaves both bodies unchanged when mapping does not rewrite the model", () => {
    const raw = Buffer.from(JSON.stringify({ model: "glm-5.1", messages: [] }), "utf-8");
    const snapshot = buildServiceRequestLogSnapshot(
      raw,
      provider({ modelMap: [{ pattern: "glm-5.1", model: "glm-5.1" }] }),
      true
    );

    expect(snapshot.originalRequestBody).toBe(raw.toString("utf-8"));
    expect(snapshot.requestBodyLog).toBe(raw.toString("utf-8"));
  });

  it("skips mapping when the provider disables it", () => {
    const raw = Buffer.from(JSON.stringify({ model: "claude-opus-4-6" }), "utf-8");
    const snapshot = buildServiceRequestLogSnapshot(
      raw,
      provider({ modelMappingEnabled: false }),
      true
    );

    expect(snapshot.requestBodyLog).toBe(raw.toString("utf-8"));
  });
});
