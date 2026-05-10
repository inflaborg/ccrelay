import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeWizardEndpointTest, executeWizardProbeModels } from "@/api/wizardUpstream";

describe("executeWizardProbeModels", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns model ids on 200 with OpenAI-style payload", async () => {
    vi.mocked(fetch).mockResolvedValue({
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ data: [{ id: "gpt-4o" }, { id: "gpt-4" }] })),
    } as Response);

    const r = await executeWizardProbeModels({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      providerType: "openai",
    });
    expect(r).toEqual({ ok: true, modelIds: ["gpt-4o", "gpt-4"] });
  });

  it("maps 401 to auth errorCode", async () => {
    vi.mocked(fetch).mockResolvedValue({
      status: 401,
      text: () => Promise.resolve("{}"),
    } as Response);

    const r = await executeWizardProbeModels({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "bad",
      providerType: "openai",
    });
    expect(r).toEqual({ ok: false, errorCode: "auth" });
  });
});

describe("executeWizardEndpointTest", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function jsonOkResponse(): Response {
    return {
      status: 200,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "content-type" ? "application/json; charset=utf-8" : null,
      },
    } as unknown as Response;
  }

  it("marks pass when upstream returns 200 JSON", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonOkResponse());

    const r = await executeWizardEndpointTest({
      apiKey: "k",
      modelId: "gpt-4o",
      variants: [
        {
          id: "v1",
          name: "openai-default",
          baseUrl: "https://api.openai.com/v1",
          providerType: "openai",
        },
      ],
    });

    expect(r.ok).toBe(true);
    expect(r.results).toHaveLength(1);
    expect(r.results[0]).toMatchObject({ id: "v1", pass: true, httpStatus: 200 });
  });

  it("marks fail with auth detail on 401", async () => {
    vi.mocked(fetch).mockResolvedValue({
      status: 401,
      headers: { get: () => "application/json" },
      text: () => Promise.resolve('{"error":"unauthorized"}'),
    } as unknown as Response);

    const r = await executeWizardEndpointTest({
      apiKey: "k",
      modelId: "gpt-4o",
      variants: [
        {
          id: "v1",
          name: "t",
          baseUrl: "https://api.openai.com/v1",
          providerType: "openai",
        },
      ],
    });

    expect(r.results[0]).toMatchObject({
      id: "v1",
      pass: false,
      httpStatus: 401,
      detail: "auth",
    });
  });
});
