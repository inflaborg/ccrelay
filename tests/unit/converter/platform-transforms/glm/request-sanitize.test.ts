/* eslint-disable @typescript-eslint/naming-convention -- OpenAI wire uses snake_case reasoning_effort */

import { applyPlatformRequestSanitize, glmChatSanitize } from "@/converter/platform-transforms";
import { describe, expect, it } from "vitest";

const GLM_Z_AI_BASE = "https://api.z.ai/v1";
const GLM_BIGMODEL_BASE = "https://open.bigmodel.cn/v1";

describe("glmChatSanitize", () => {
  it("maps reasoning_effort medium to thinking enabled and removes reasoning_effort", () => {
    const body: Record<string, unknown> = {
      model: "glm-4.7",
      messages: [],
      reasoning_effort: "medium",
    };
    glmChatSanitize(body);
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.reasoning).toBeUndefined();
  });

  it("maps reasoning_effort none to thinking disabled and removes reasoning_effort", () => {
    const body: Record<string, unknown> = {
      model: "glm-4.7",
      messages: [],
      reasoning_effort: "none",
    };
    glmChatSanitize(body);
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.reasoning).toBeUndefined();
  });

  it("maps empty reasoning_effort string to thinking enabled", () => {
    const body: Record<string, unknown> = {
      model: "glm-4.7",
      messages: [],
      reasoning_effort: "",
    };
    glmChatSanitize(body);
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.reasoning).toBeUndefined();
  });

  it("does not add thinking when reasoning_effort is absent", () => {
    const body: Record<string, unknown> = { model: "glm-4.7", messages: [] };
    glmChatSanitize(body);
    expect(body.thinking).toBeUndefined();
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.reasoning).toBeUndefined();
  });
});

describe("applyPlatformRequestSanitize (GLM)", () => {
  it("applies glm sanitize for api.z.ai baseUrl", () => {
    const body: Record<string, unknown> = {
      model: "glm-4.7",
      messages: [],
      reasoning_effort: "high",
    };
    applyPlatformRequestSanitize(body, `${GLM_Z_AI_BASE}/chat/completions`);
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.reasoning).toBeUndefined();
  });

  it("applies glm sanitize for open.bigmodel.cn baseUrl", () => {
    const body: Record<string, unknown> = {
      model: "glm-4.7",
      messages: [],
      reasoning_effort: "none",
    };
    applyPlatformRequestSanitize(body, `${GLM_BIGMODEL_BASE}/chat/completions`);
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.reasoning).toBeUndefined();
  });

  it("does not mutate unrelated upstream", () => {
    const body: Record<string, unknown> = {
      model: "gpt-4o",
      messages: [],
      reasoning_effort: "medium",
    };
    applyPlatformRequestSanitize(body, "https://api.openai.com/v1");
    expect(body.thinking).toBeUndefined();
    expect(body.reasoning_effort).toBe("medium");
  });
});
