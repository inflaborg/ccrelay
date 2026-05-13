/* eslint-disable @typescript-eslint/naming-convention -- models list JSON uses snake_case */
import { describe, it, expect } from "vitest";
import { ProxyExecutor } from "@/server/proxy/executor";
import { ResponseLogger } from "@/server/responseLogger";
import type { LogDatabase } from "@/database";
import type { Provider, RequestTask } from "@/types";

describe("ProxyExecutor custom models list short-circuit", () => {
  const baseProvider: Provider = {
    id: "p",
    name: "P",
    baseUrl: "https://api.example.com",
    mode: "passthrough",
    providerType: "anthropic",
    headers: {},
    useCustomModelsList: true,
    customModelsList: ["a", "b", "c"],
  };

  async function executeModelsTask(partial: Pick<RequestTask, "targetUrl" | "clientId">): Promise<{
    statusCode: number;
    body?: string | Buffer;
  }> {
    const task: RequestTask = {
      id: partial.clientId,
      ...partial,
      method: "GET",
      headers: {},
      body: null,
      provider: baseProvider,
      inboundPath: "/anthropic/v1/models",
      requestPath: "/v1/models",
      isOpenAIProvider: false,
      clientSurface: "anthropic",
      createdAt: Date.now(),
    };
    const db = { enabled: false } as unknown as LogDatabase;
    const executor = new ProxyExecutor(new ResponseLogger(db));
    return executor.execute(task);
  }

  it("returns synthetic Anthropic-shaped models without upstream conversion path", async () => {
    const result = await executeModelsTask({
      clientId: "c1",
      targetUrl: "https://api.example.com/v1/models",
    });

    expect(result.statusCode).toBe(200);
    expect(typeof result.body).toBe("string");
    const parsed = JSON.parse(result.body as string) as {
      data: Array<{
        id: string;
        display_name: string;
        created_at: string;
        max_input_tokens: number;
        max_tokens: number;
      }>;
      has_more: boolean;
    };
    expect(parsed.data.map(e => e.id)).toEqual(["a", "b", "c"]);
    expect(parsed.data.map(e => e.display_name)).toEqual(["a", "b", "c"]);
    expect(parsed.data[0].max_input_tokens).toBe(0);
    expect(parsed.data[0].max_tokens).toBe(0);
    expect(typeof parsed.data[0].created_at).toBe("string");
    expect(parsed.has_more).toBe(false);
  });

  it("sets Anthropic display_name from id;display_name lines", async () => {
    const task: RequestTask = {
      id: "c4",
      clientId: "c4",
      method: "GET",
      targetUrl: "https://api.example.com/v1/models",
      headers: {},
      body: null,
      provider: {
        ...baseProvider,
        customModelsList: ["a;Alpha", "b", "c;Gamma"],
      },
      inboundPath: "/anthropic/v1/models",
      requestPath: "/v1/models",
      isOpenAIProvider: false,
      clientSurface: "anthropic",
      createdAt: Date.now(),
    };
    const db = { enabled: false } as unknown as LogDatabase;
    const executor = new ProxyExecutor(new ResponseLogger(db));
    const result = await executor.execute(task);
    const parsed = JSON.parse(result.body as string) as {
      data: Array<{ id: string; display_name: string }>;
    };
    expect(parsed.data.map(e => e.id)).toEqual(["a", "b", "c"]);
    expect(parsed.data.map(e => e.display_name)).toEqual(["Alpha", "b", "Gamma"]);
  });

  it("returns synthetic single model for GET /v1/models/{id} when id is in list", async () => {
    const task: RequestTask = {
      id: "c5",
      clientId: "c5",
      method: "GET",
      targetUrl: "https://api.example.com/v1/models/b",
      headers: {},
      body: null,
      provider: baseProvider,
      inboundPath: "/anthropic/v1/models/b",
      requestPath: "/v1/models/b",
      isOpenAIProvider: false,
      clientSurface: "anthropic",
      createdAt: Date.now(),
    };
    const db = { enabled: false } as unknown as LogDatabase;
    const executor = new ProxyExecutor(new ResponseLogger(db));
    const result = await executor.execute(task);
    expect(result.statusCode).toBe(200);
    const parsed = JSON.parse(result.body as string) as {
      id: string;
      type: string;
      display_name: string;
      created_at: string;
      max_input_tokens: number;
      max_tokens: number;
    };
    expect(parsed.id).toBe("b");
    expect(parsed.type).toBe("model");
    expect(parsed.display_name).toBe("b");
    expect(parsed.max_input_tokens).toBe(0);
    expect(parsed.max_tokens).toBe(0);
  });

  it("returns 404 for GET /v1/models/{id} when id is not in custom list", async () => {
    const task: RequestTask = {
      id: "c6",
      clientId: "c6",
      method: "GET",
      targetUrl: "https://api.example.com/v1/models/zzz",
      headers: {},
      body: null,
      provider: baseProvider,
      inboundPath: "/anthropic/v1/models/zzz",
      requestPath: "/v1/models/zzz",
      isOpenAIProvider: false,
      clientSurface: "anthropic",
      createdAt: Date.now(),
    };
    const db = { enabled: false } as unknown as LogDatabase;
    const executor = new ProxyExecutor(new ResponseLogger(db));
    const result = await executor.execute(task);
    expect(result.statusCode).toBe(404);
    const parsed = JSON.parse(result.body as string) as { type: string; error: { type: string } };
    expect(parsed.type).toBe("error");
    expect(parsed.error.type).toBe("not_found_error");
  });

  it("returns OpenAI single model for openai surface custom list detail", async () => {
    const task: RequestTask = {
      id: "c7",
      clientId: "c7",
      method: "GET",
      targetUrl: "https://api.example.com/models/a",
      headers: {},
      body: null,
      provider: baseProvider,
      inboundPath: "/openai/models/a",
      requestPath: "/models/a",
      isOpenAIProvider: false,
      clientSurface: "openai",
      createdAt: Date.now(),
    };
    const db = { enabled: false } as unknown as LogDatabase;
    const executor = new ProxyExecutor(new ResponseLogger(db));
    const result = await executor.execute(task);
    expect(result.statusCode).toBe(200);
    const parsed = JSON.parse(result.body as string) as { id: string; object: string };
    expect(parsed.id).toBe("a");
    expect(parsed.object).toBe("model");
  });

  it("honors limit in targetUrl for synthetic response", async () => {
    const result = await executeModelsTask({
      clientId: "c2",
      targetUrl: "https://api.example.com/v1/models?limit=2",
    });

    const parsed = JSON.parse(result.body as string) as {
      data: Array<{ id: string }>;
      has_more: boolean;
    };
    expect(parsed.data.map(e => e.id)).toEqual(["a", "b"]);
    expect(parsed.has_more).toBe(true);
  });

  it("does not rewrite synthetic custom list ids through modelMap", async () => {
    const task: RequestTask = {
      id: "c3",
      clientId: "c3",
      method: "GET",
      targetUrl: "https://api.example.com/v1/models",
      headers: {},
      body: null,
      provider: {
        ...baseProvider,
        modelMap: [{ pattern: "claude-sonnet", model: "a" }],
      },
      inboundPath: "/anthropic/v1/models",
      requestPath: "/v1/models",
      isOpenAIProvider: false,
      clientSurface: "anthropic",
      createdAt: Date.now(),
    };
    const db = { enabled: false } as unknown as LogDatabase;
    const executor = new ProxyExecutor(new ResponseLogger(db));
    const result = await executor.execute(task);
    const parsed = JSON.parse(result.body as string) as { data: Array<{ id: string }> };
    expect(parsed.data.map(e => e.id)).toEqual(["a", "b", "c"]);
  });

  it("returns real ids without header when triple format has alias", async () => {
    const task: RequestTask = {
      id: "c8",
      clientId: "c8",
      method: "GET",
      targetUrl: "https://api.example.com/v1/models",
      headers: {},
      body: null,
      provider: {
        ...baseProvider,
        customModelsList: ["glm-5.1;GLM 5.1;claude-a1", "glm-4.7;;claude-a2"],
      },
      inboundPath: "/anthropic/v1/models",
      requestPath: "/v1/models",
      isOpenAIProvider: false,
      clientSurface: "anthropic",
      createdAt: Date.now(),
    };
    const db = { enabled: false } as unknown as LogDatabase;
    const executor = new ProxyExecutor(new ResponseLogger(db));
    const result = await executor.execute(task);
    const parsed = JSON.parse(result.body as string) as { data: Array<{ id: string }> };
    expect(parsed.data.map(e => e.id)).toEqual(["glm-5.1", "glm-4.7"]);
  });

  it("returns alias ids when x-ccrelay-model-alias header is set", async () => {
    const task: RequestTask = {
      id: "c9",
      clientId: "c9",
      method: "GET",
      targetUrl: "https://api.example.com/v1/models",
      headers: { "x-ccrelay-model-alias": "true" },
      body: null,
      provider: {
        ...baseProvider,
        customModelsList: ["glm-5.1;GLM 5.1;claude-a1", "glm-4.7;;claude-a2"],
      },
      inboundPath: "/anthropic/v1/models",
      requestPath: "/v1/models",
      isOpenAIProvider: false,
      clientSurface: "anthropic",
      createdAt: Date.now(),
    };
    const db = { enabled: false } as unknown as LogDatabase;
    const executor = new ProxyExecutor(new ResponseLogger(db));
    const result = await executor.execute(task);
    const parsed = JSON.parse(result.body as string) as { data: Array<{ id: string }> };
    expect(parsed.data.map(e => e.id)).toEqual(["claude-a1", "claude-a2"]);
  });

  it("GET /v1/models/{alias} resolves when x-ccrelay-model-alias is set", async () => {
    const task: RequestTask = {
      id: "c10",
      clientId: "c10",
      method: "GET",
      targetUrl: "https://api.example.com/v1/models/claude-a1",
      headers: { "x-ccrelay-model-alias": "1" },
      body: null,
      provider: {
        ...baseProvider,
        customModelsList: ["glm-5.1;GLM 5.1;claude-a1"],
      },
      inboundPath: "/anthropic/v1/models/claude-a1",
      requestPath: "/v1/models/claude-a1",
      isOpenAIProvider: false,
      clientSurface: "anthropic",
      createdAt: Date.now(),
    };
    const db = { enabled: false } as unknown as LogDatabase;
    const executor = new ProxyExecutor(new ResponseLogger(db));
    const result = await executor.execute(task);
    expect(result.statusCode).toBe(200);
    const parsed = JSON.parse(result.body as string) as { id: string; display_name: string };
    expect(parsed.id).toBe("claude-a1");
    expect(parsed.display_name).toBe("GLM 5.1");
  });
});
