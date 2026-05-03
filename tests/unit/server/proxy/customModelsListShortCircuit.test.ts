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
      data: Array<{ id: string }>;
      has_more: boolean;
    };
    expect(parsed.data.map(e => e.id)).toEqual(["a", "b", "c"]);
    expect(parsed.has_more).toBe(false);
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
});
