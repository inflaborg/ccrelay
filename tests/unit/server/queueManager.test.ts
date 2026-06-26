import { describe, it, expect, vi, afterEach } from "vitest";
import type { ConfigManager } from "@/config";
import { QueueManager } from "@/server/queueManager";
import type { ConcurrencyConfig, ProxyResult, RequestTask, RouteQueueConfig } from "@/types";

vi.mock("vscode", () => ({
  window: {
    createOutputChannel: vi.fn().mockReturnValue({
      appendLine: vi.fn(),
      show: vi.fn(),
      clear: vi.fn(),
      dispose: vi.fn(),
    }),
  },
}));

interface MockConfigState {
  concurrency?: ConcurrencyConfig;
  routeQueues?: RouteQueueConfig[];
}

function createMockConfigManager(initial: MockConfigState = {}) {
  const state: MockConfigState = {
    concurrency: initial.concurrency,
    routeQueues: initial.routeQueues ?? [],
  };

  const manager = {
    get configValue() {
      return {
        concurrency: state.concurrency,
        routeQueues: state.routeQueues,
      };
    },
    get routeQueues() {
      return state.routeQueues;
    },
  } as unknown as ConfigManager;

  return {
    manager,
    setConcurrency(concurrency: ConcurrencyConfig | undefined) {
      state.concurrency = concurrency;
    },
    setRouteQueues(routeQueues: RouteQueueConfig[] | undefined) {
      state.routeQueues = routeQueues;
    },
  };
}

const createMockTask = (id: string): RequestTask => ({
  id,
  method: "POST",
  targetUrl: "https://api.example.com/v1/messages",
  headers: {},
  body: Buffer.from("{}"),
  provider: {
    id: "test",
    name: "Test",
    baseUrl: "https://api.example.com",
    mode: "passthrough",
    providerType: "anthropic",
  },
  inboundPath: "/v1/messages",
  requestPath: "/v1/messages",
  requestBodyLog: "",
  originalRequestBody: "",
  isOpenAIProvider: false,
  clientSurface: "anthropic",
  originalModel: "claude-sonnet-4",
  clientId: "client-1",
  createdAt: Date.now(),
});

describe("QueueManager.reloadFromConfig", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is a no-op before setExecutor", () => {
    const mock = createMockConfigManager({
      concurrency: { enabled: true, maxWorkers: 2, maxQueueSize: 5 },
    });
    const queueManager = new QueueManager(mock.manager);

    expect(() => queueManager.reloadFromConfig()).not.toThrow();
    expect(queueManager.getQueueForPath("/v1/messages")).toBeNull();
  });

  it("applies increased maxWorkers without recreating the default queue", async () => {
    const mock = createMockConfigManager({
      concurrency: { enabled: true, maxWorkers: 1, maxQueueSize: 10 },
    });

    let releaseTask1: () => void;
    const blockingTask = new Promise<ProxyResult>(resolve => {
      releaseTask1 = () => resolve({ statusCode: 200, headers: {}, duration: 0 });
    });
    const executor = vi.fn().mockImplementation(() => blockingTask);

    const queueManager = new QueueManager(mock.manager);
    queueManager.setExecutor(executor);
    const defaultQueue = queueManager.getDefaultQueue()!;

    const p1 = defaultQueue.submit(createMockTask("task1"));
    const p2 = defaultQueue.submit(createMockTask("task2"));

    await new Promise(r => setTimeout(r, 10));
    expect(defaultQueue.getStats().activeWorkers).toBe(1);
    expect(defaultQueue.getStats().queueLength).toBe(1);

    mock.setConcurrency({ enabled: true, maxWorkers: 2, maxQueueSize: 10 });
    queueManager.reloadFromConfig();

    expect(queueManager.getDefaultQueue()).toBe(defaultQueue);

    await new Promise(r => setTimeout(r, 200));
    expect(defaultQueue.getStats().activeWorkers).toBe(2);
    expect(defaultQueue.getStats().queueLength).toBe(0);

    releaseTask1!();
    await Promise.all([p1, p2]);
    defaultQueue.shutdown();
  });

  it("disables the default queue when concurrency.enabled becomes false", () => {
    const mock = createMockConfigManager({
      concurrency: { enabled: true, maxWorkers: 2, maxQueueSize: 5 },
    });

    const queueManager = new QueueManager(mock.manager);
    queueManager.setExecutor(() => Promise.resolve({ statusCode: 200, headers: {}, duration: 0 }));

    expect(queueManager.getQueueForPath("/v1/messages")).not.toBeNull();

    mock.setConcurrency(undefined);
    queueManager.reloadFromConfig();

    expect(queueManager.getQueueForPath("/v1/messages")).toBeNull();
    expect(queueManager.getDefaultQueue()).toBeNull();
  });

  it("creates the default queue when concurrency becomes enabled", async () => {
    const mock = createMockConfigManager({
      concurrency: undefined,
    });

    const executor = vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: {},
      duration: 0,
    } satisfies ProxyResult);
    const queueManager = new QueueManager(mock.manager);
    queueManager.setExecutor(executor);

    expect(queueManager.getQueueForPath("/v1/messages")).toBeNull();

    mock.setConcurrency({ enabled: true, maxWorkers: 1, maxQueueSize: 5 });
    queueManager.reloadFromConfig();

    const queueInfo = queueManager.getQueueForPath("/v1/messages");
    expect(queueInfo).not.toBeNull();
    await queueInfo!.queue.submit(createMockTask("task1"));
    expect(executor).toHaveBeenCalledTimes(1);
    queueInfo!.queue.shutdown();
  });

  it("syncs route queues on add, update, and remove", () => {
    const route: RouteQueueConfig = {
      pattern: "^/v1/messages/count_tokens$",
      name: "count_tokens",
      maxWorkers: 5,
      maxQueueSize: 100,
      compiledPattern: /^\/v1\/messages\/count_tokens$/,
    };

    const mock = createMockConfigManager({
      concurrency: { enabled: true, maxWorkers: 1, maxQueueSize: 5 },
      routeQueues: [route],
    });

    const queueManager = new QueueManager(mock.manager);
    queueManager.setExecutor(() => Promise.resolve({ statusCode: 200, headers: {}, duration: 0 }));

    const path = "/v1/messages/count_tokens";
    const initial = queueManager.getQueueForPath(path);
    expect(initial?.name).toBe("count_tokens");
    expect(initial?.queue.getStats().maxWorkers).toBe(5);

    mock.setRouteQueues([
      {
        ...route,
        maxWorkers: 20,
      },
    ]);
    queueManager.reloadFromConfig();

    const updated = queueManager.getQueueForPath(path);
    expect(updated?.queue).toBe(initial?.queue);
    expect(updated?.queue.getStats().maxWorkers).toBe(20);

    mock.setRouteQueues([]);
    queueManager.reloadFromConfig();
    expect(queueManager.getQueueForPath(path)?.name).toBe("default");
    updated?.queue.shutdown();
    queueManager.getDefaultQueue()?.shutdown();
  });
});
