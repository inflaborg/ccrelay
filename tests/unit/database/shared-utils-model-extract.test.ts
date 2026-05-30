/* eslint-disable @typescript-eslint/naming-convention -- DB column wire names */
import { describe, expect, it } from "vitest";
import {
  extractModelFromPartialJson,
  extractModelsFromBodies,
  LIST_LOG_MODEL_BODY_HEAD_BYTES,
} from "@/database/shared-utils";

describe("extractModelFromPartialJson", () => {
  it("finds model after a long messages prefix (list-view truncation)", () => {
    const padding = "x".repeat(8_000);
    const body = `{"messages":[{"role":"user","content":"${padding}"}],"model":"mimo-v2.5-pro"}`;
    const truncated = body.slice(0, LIST_LOG_MODEL_BODY_HEAD_BYTES);
    expect(extractModelFromPartialJson(truncated)).toBe("mimo-v2.5-pro");
  });

  it("prefers the last model field when multiple appear in partial JSON", () => {
    const body =
      '{"messages":[{"role":"user","content":"see \\"model\\": \\"decoy\\""}],"model":"upstream-real"}';
    expect(extractModelFromPartialJson(body)).toBe("upstream-real");
  });
});

describe("extractModelsFromBodies", () => {
  it("maps client model from original preview and upstream from request preview", () => {
    const padding = "y".repeat(8_000);
    const original = `{"messages":[{"role":"user","content":"${padding}"}],"model":"openai:gpt-4o"}`;
    const request = `{"messages":[{"role":"user","content":"${padding}"}],"model":"mimo-v2.5-pro"}`;
    const models = extractModelsFromBodies({
      original_request_body: original.slice(0, LIST_LOG_MODEL_BODY_HEAD_BYTES),
      request_body: request.slice(0, LIST_LOG_MODEL_BODY_HEAD_BYTES),
    });
    expect(models.model).toBe("openai:gpt-4o");
    expect(models.mappedModel).toBe("mimo-v2.5-pro");
  });

  it("uses metrics_model fallback for mappedModel when request preview has no model", () => {
    const models = extractModelsFromBodies({
      request_body: '{"messages":[{"role":"user","content":"short"}]}',
      metrics_model: "mimo-v2.5-pro",
    });
    expect(models.mappedModel).toBe("mimo-v2.5-pro");
  });
});
