/**
 * Request routing logic for CCRelay
 */

import { Provider } from "../types";
import { ConfigManager } from "../config";
import { minimatch } from "../utils/helpers";

// Callback type for provider changes
type ProviderChangeCallback = (providerId: string) => void;

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
   * Check if path should be blocked (return mock OK)
   * Returns { blocked: boolean; response?: string; responseCode?: number }
   */
  shouldBlock(path: string): { blocked: boolean; response?: string; responseCode?: number } {
    const provider = this.getCurrentProvider();
    if (!provider || provider.mode !== "inject") {
      return { blocked: false };
    }

    const normalizedPath = path.startsWith("/") ? path : `/${path}`;

    for (const pattern of this.config.blockPatterns) {
      if (minimatch(normalizedPath, pattern.path)) {
        return { blocked: true, response: pattern.response, responseCode: pattern.code };
      }
    }

    // Check OpenAI block patterns if current provider is OpenAI
    if (provider.providerType === "openai") {
      for (const pattern of this.config.openaiBlockPatterns) {
        if (minimatch(normalizedPath, pattern.path)) {
          return { blocked: true, response: pattern.response, responseCode: pattern.code };
        }
      }
    }

    return { blocked: false };
  }

  /**
   * Check if path should be routed to current provider
   */
  shouldRoute(path: string): boolean {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;

    // Check passthrough patterns first (always go to official)
    for (const pattern of this.config.passthroughPatterns) {
      if (minimatch(normalizedPath, pattern)) {
        return false;
      }
    }

    // Check route patterns
    for (const pattern of this.config.routePatterns) {
      if (minimatch(normalizedPath, pattern)) {
        return true;
      }
    }

    // Default: route to current provider
    return true;
  }

  /**
   * Get the target provider for this path
   * Always returns a valid provider (falls back to official if needed)
   */
  getTargetProvider(path: string): Provider {
    const shouldRoute = this.shouldRoute(path);

    let provider: Provider | undefined;
    if (shouldRoute) {
      provider = this.getCurrentProvider();
    } else {
      provider = this.getOfficialProvider();
    }

    // Fallback logic: try alternative providers
    if (!provider) {
      provider = this.getCurrentProvider();
    }
    if (!provider) {
      provider = this.getOfficialProvider();
    }

    // Final fallback: get the first available provider
    if (!provider) {
      const providers = this.config.providers;
      const firstProviderId = Object.keys(providers)[0];
      if (firstProviderId) {
        provider = providers[firstProviderId];
      }
    }

    // This should never happen given the initialization logic
    if (!provider) {
      throw new Error("No provider available. Please configure at least one provider.");
    }

    return provider;
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
        } else {
          headers["x-api-key"] = provider.apiKey;
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
    if (!body || body.length === 0 || !provider.modelMap || provider.modelMap.length === 0) {
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
