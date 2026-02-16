/**
 * Mock configuration for integration tests
 * Provides a minimal ConfigManager-like interface without VSCode dependencies
 */

import type { Provider, ConcurrencyConfig, RouteQueueConfig } from "../../../src/types";

export interface MockConfigOptions {
  port?: number;
  host?: string;
  provider?: Provider;
  concurrency?: ConcurrencyConfig;
  routeQueues?: RouteQueueConfig[];
}

export class MockConfig {
  public port: number;
  public host: string;
  public provider: Provider;
  public concurrency: ConcurrencyConfig | undefined;
  public routeQueues: RouteQueueConfig[];

  constructor(options: MockConfigOptions = {}) {
    this.port = options.port ?? 7575;
    this.host = options.host ?? "127.0.0.1";
    this.provider = options.provider ?? {
      id: "test-provider",
      name: "Test Provider",
      baseUrl: "https://api.anthropic.com",
      mode: "passthrough",
      providerType: "anthropic",
      apiKey: "test-api-key",
    };
    this.concurrency = options.concurrency;
    this.routeQueues = options.routeQueues ?? [];
  }

  // Minimal interface compatible with ConfigManager methods used by ProxyServer
  get configValue() {
    return {
      port: this.port,
      host: this.host,
      autoStart: true,
      defaultProvider: this.provider.id,
      providers: {
        [this.provider.id]: this.provider,
      },
      routing: {
        proxy: [],
        passthrough: [],
        block: [],
        openaiBlock: [],
      },
      concurrency: this.concurrency,
      routeQueues: this.routeQueues,
      logging: {
        enabled: false,
      },
    };
  }

  get enableLogStorage(): boolean {
    return false;
  }

  getCurrentProvider(): Provider {
    return this.provider;
  }

  getProvider(id: string): Provider | undefined {
    if (id === this.provider.id) {
      return this.provider;
    }
    return undefined;
  }
}
