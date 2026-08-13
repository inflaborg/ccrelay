import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  executeWizardEndpointTest,
  executeWizardProbeModels,
  resolveWizardApiKey,
  setServer,
} from "@/api/wizardUpstream";

describe("resolveWizardApiKey", () => {
  afterEach(() => {
    setServer(null);
  });

  it("returns a non-masked apiKey as-is", () => {
    expect(resolveWizardApiKey("sk-real", undefined)).toBe("sk-real");
  });

  it("resolves stored key when client sends a masked value", () => {
    setServer({
      getConfig: () => ({
        providers: {
          p1: { apiKey: "sk-stored-secret" },
        },
      }),
    } as never);

    expect(resolveWizardApiKey("sk-s************cret", "p1")).toBe("sk-stored-secret");
  });

  it("resolves stored key when apiKey is empty and providerId is set", () => {
    setServer({
      getConfig: () => ({
        providers: {
          p1: { apiKey: "sk-from-config" },
        },
      }),
    } as never);

    expect(resolveWizardApiKey("", "p1")).toBe("sk-from-config");
    expect(resolveWizardApiKey(undefined, "p1")).toBe("sk-from-config");
  });
});

describe("executeWizardProbeModels", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setServer(null);
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

  it("uses stored provider apiKey when client key is masked", async () => {
    setServer({
      getConfig: () => ({
        providers: {
          longcat: { apiKey: "sk-real-longcat" },
        },
      }),
    } as never);

    vi.mocked(fetch).mockResolvedValue({
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ data: [{ id: "LongCat-2.0" }] })),
    } as Response);

    const r = await executeWizardProbeModels({
      baseUrl: "https://api.longcat.chat/openai",
      apiKey: "sk-r************cat",
      providerId: "longcat",
      providerType: "openai",
    });
    expect(r).toEqual({ ok: true, modelIds: ["LongCat-2.0"] });
    const init = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({
      authorization: "Bearer sk-real-longcat",
    });
  });
});

describe("executeWizardEndpointTest", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setServer(null);
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

  it("uses stored provider apiKey for endpoint test when client key is masked", async () => {
    setServer({
      getConfig: () => ({
        providers: {
          p1: { apiKey: "sk-stored" },
        },
      }),
    } as never);
    vi.mocked(fetch).mockResolvedValue(jsonOkResponse());

    const r = await executeWizardEndpointTest({
      apiKey: "sk-s************ored",
      providerId: "p1",
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

    expect(r.results[0]?.pass).toBe(true);
    const init = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({
      authorization: "Bearer sk-stored",
    });
  });

  function fetchUrl(callIndex = 0): string {
    const url = vi.mocked(fetch).mock.calls[callIndex]?.[0];
    return typeof url === "string" ? url : "";
  }

  function fetchJsonBody(callIndex = 0): Record<string, unknown> {
    const raw = vi.mocked(fetch).mock.calls[callIndex]?.[1]?.body;
    const text = Buffer.isBuffer(raw)
      ? raw.toString("utf-8")
      : raw instanceof Uint8Array
        ? Buffer.from(raw).toString("utf-8")
        : typeof raw === "string"
          ? raw
          : "";
    return JSON.parse(text) as Record<string, unknown>;
  }

  it("omits max_tokens on OpenAI Chat outbound after Anthropic inbound conversion", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonOkResponse());

    await executeWizardEndpointTest({
      apiKey: "k",
      modelId: "gpt-4o",
      variants: [
        {
          id: "v1",
          name: "t",
          baseUrl: "https://api.openai.com/v1",
          providerType: "openai_chat",
        },
      ],
    });

    expect(fetchUrl()).toBe("https://api.openai.com/v1/chat/completions");
    const body = fetchJsonBody();
    expect(body.max_tokens).toBeUndefined();
    expect(body.max_completion_tokens).toBeUndefined();
    expect(body.model).toBe("gpt-4o");
    expect(body.stream).toBe(false);
  });

  it("fills Anthropic max_tokens only after pipeline when upstream is Messages", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonOkResponse());

    await executeWizardEndpointTest({
      apiKey: "k",
      modelId: "claude-sonnet-4",
      variants: [
        {
          id: "v1",
          name: "t",
          baseUrl: "https://api.anthropic.com",
          providerType: "anthropic",
        },
      ],
    });

    expect(fetchUrl()).toBe("https://api.anthropic.com/v1/messages");
    const body = fetchJsonBody();
    expect(body.max_tokens).toBe(4096);
    expect(body.model).toBe("claude-sonnet-4");
  });

  it("applies modelMap from the temporary provider snapshot", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonOkResponse());

    await executeWizardEndpointTest({
      apiKey: "k",
      modelId: "claude-sonnet-4",
      variants: [
        {
          id: "v1",
          name: "t",
          baseUrl: "https://api.openai.com/v1",
          providerType: "openai_chat",
          modelMap: [{ pattern: "claude-*", model: "gpt-4o-mini" }],
        },
      ],
    });

    expect(fetchJsonBody().model).toBe("gpt-4o-mini");
  });

  it("sends custom headers from the temporary provider snapshot", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonOkResponse());
    const customHeader = "X-Custom";

    await executeWizardEndpointTest({
      apiKey: "k",
      modelId: "gpt-4o",
      variants: [
        {
          id: "v1",
          name: "t",
          baseUrl: "https://api.openai.com/v1",
          providerType: "openai_chat",
          headers: { [customHeader]: "from-config" },
        },
      ],
    });

    const init = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({ [customHeader]: "from-config" });
  });
});
