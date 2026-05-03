/**
 * Request routing logic for CCRelay
 */

import type { Provider } from "../types";
import { ConfigManager } from "../config";
import { minimatch } from "../utils/helpers";

// Callback type for provider changes
type ProviderChangeCallback = (providerId: string) => void;

/** Unified routing result */
export type RouteResult =
  | { type: "block"; response: string; code: number }
  | { type: "forward"; provider: Provider; isRouted: boolean }
  | { type: "not_found" };

export class Router {
  private config: ConfigManager;
  private currentProviderId: string;
  private providerChangeCallbacks: Set<ProviderChangeCallback> = new Set();

  constructor(config: ConfigManager) {
    this.config = config;
    this.currentProviderId = config.getCurrentProviderId();
  }

  getCurrentProviderId(): string {
    return this.currentProviderId;
  }

  /**
   * Set current provider ID without persisting (for follower sync from leader)
   */
  setCurrentProviderId(id: string): void {
    if (this.config.getProvider(id) && this.currentProviderId !== id) {
      this.currentProviderId = id;
      this.notifyProviderChange(id);
    }
  }

  getCurrentProvider(): Provider | undefined {
    return this.config.getProvider(this.currentProviderId);
  }

  getOfficialProvider(): Provider | undefined {
    return this.config.getProvider("official");
  }

  async switchProvider(id: string): Promise<boolean> {
    if (!this.config.getProvider(id)) {
      return false;
    }
    await this.config.setCurrentProviderId(id);
    if (this.currentProviderId !== id) {
      this.currentProviderId = id;
      this.notifyProviderChange(id);
    }
    return true;
  }

  /**
   * Register a callback for provider changes
   */
  onProviderChanged(callback: ProviderChangeCallback): void {
    this.providerChangeCallbacks.add(callback);
  }

  /**
   * Unregister a provider change callback
   */
  offProviderChanged(callback: ProviderChangeCallback): void {
    this.providerChangeCallbacks.delete(callback);
  }

  /**
   * Notify all registered callbacks of provider change
   */
  private notifyProviderChange(providerId: string): void {
    for (const callback of this.providerChangeCallbacks) {
      try {
        callback(providerId);
      } catch {
        // Ignore callback errors
      }
    }
  }

  /**
   * Unified routing: block → forward → not_found.
   * Block uses path glob plus optional filters on current provider id:
   * - condition.providers: when non-empty, require current id to be listed (skip otherwise).
   * - condition.providerNot: skip when current id is listed.
   * Forward matches first rule; provider="auto" uses current provider.
   * Unmatched paths return not_found (404).
   */
  resolve(path: string): RouteResult {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;

    // 1. Block rules (first match wins)
    for (const rule of this.config.blockRules) {
      if (!minimatch(normalizedPath, rule.path)) {
        continue;
      }
      const currentId = this.getCurrentProviderId();
      const cond = rule.condition;
      if (cond?.providers && cond.providers.length > 0) {
        if (!cond.providers.includes(currentId)) {
          continue;
        }
      }
      if (cond?.providerNot && cond.providerNot.length > 0) {
        if (cond.providerNot.includes(currentId)) {
          continue;
        }
      }
      return { type: "block", response: rule.response, code: rule.code };
    }

    // 2. Forward rules (first match wins)
    for (const rule of this.config.forwardRules) {
      if (!minimatch(normalizedPath, rule.path)) {
        continue;
      }
      const provider = this.resolveProvider(rule.provider);
      if (provider) {
        return { type: "forward", provider, isRouted: rule.provider !== "official" };
      }
    }

    // 3. Fallback: 404
    return { type: "not_found" };
  }

  /**
   * Resolve a provider by ID. "auto" → current provider.
   * Falls back through current → official → first available.
   */
  private resolveProvider(providerId: string): Provider | undefined {
    if (providerId === "auto") {
      return this.getCurrentProvider() ?? this.getOfficialProvider() ?? this.getFirstProvider();
    }
    return (
      this.config.getProvider(providerId) ??
      this.getCurrentProvider() ??
      this.getOfficialProvider() ??
      this.getFirstProvider()
    );
  }

  private getFirstProvider(): Provider | undefined {
    const ids = Object.keys(this.config.providers);
    return ids.length > 0 ? this.config.providers[ids[0]] : undefined;
  }

  /**
   * Prepare headers for the target provider
   */
  prepareHeaders(
    originalHeaders: Record<string, string>,
    provider: Provider
  ): Record<string, string> {
    const headers: Record<string, string> = {};

    // Copy all headers except hop-by-hop ones
    for (const [key, value] of Object.entries(originalHeaders)) {
      const lowerKey = key.toLowerCase();
      if (lowerKey !== "host" && lowerKey !== "content-length") {
        headers[key] = value;
      }
    }

    if (provider.mode === "inject") {
      // Remove original auth headers
      delete headers["authorization"];
      delete headers["x-api-key"];

      // Inject provider's API key
      if (provider.apiKey) {
        const authHeader = provider.authHeader || "authorization";
        if (authHeader.toLowerCase() === "authorization") {
          headers["authorization"] = `Bearer ${provider.apiKey}`;
        } else if (authHeader.toLowerCase() === "x-api-key") {
          headers["x-api-key"] = provider.apiKey;
        } else {
          headers[authHeader] = provider.apiKey;
        }
      }
    }

    // Add custom headers from provider config
    if (provider.headers) {
      for (const [key, value] of Object.entries(provider.headers)) {
        headers[key] = value;
      }
    }

    return headers;
  }

  /**
   * Prepare request body (handle model mapping)
   * Note: This method is deprecated, use BodyProcessor.applyModelMapping instead
   */
  prepareBody(body: Buffer, provider: Provider): Buffer {
    if (!body || body.length === 0) {
      return body;
    }
    if (provider.modelMappingEnabled === false) {
      return body;
    }
    if (!provider.modelMap || provider.modelMap.length === 0) {
      return body;
    }

    try {
      const data = JSON.parse(body.toString("utf8")) as Record<string, unknown>;
      if (typeof data.model === "string") {
        const originalModel = data.model;
        // Find matching pattern in model map array
        for (const entry of provider.modelMap) {
          if (entry.pattern === originalModel) {
            data.model = entry.model;
            return Buffer.from(JSON.stringify(data), "utf8");
          }
          // Check wildcard patterns
          if (entry.pattern.includes("*")) {
            const patternRegex = new RegExp(
              "^" + entry.pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$"
            );
            if (patternRegex.test(originalModel)) {
              data.model = entry.model;
              return Buffer.from(JSON.stringify(data), "utf8");
            }
          }
        }
      }
    } catch {
      // Invalid JSON, return as-is
    }

    return body;
  }

  /**
   * Build target URL for the provider
   */
  getTargetUrl(path: string, provider: Provider): string {
    const baseUrl = provider.baseUrl.replace(/\/$/, "");
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return `${baseUrl}${normalizedPath}`;
  }
}
