import type { Provider, SmartRoutingCatalogEntry, SmartRoutingConfig } from "../../types";
import type { ConfigManager } from "../../config";
import { sortProviderMapKeys } from "../../config/provider-utils";
import { parseCustomModelLine } from "../../converter/models-fallback";
import { minimatch } from "../../utils/helpers";
import { ScopedLogger } from "../../utils/logger";
import { buildPublicModelId, computeCanonicalAliasHash, looksLikeAliasWireId } from "./aliasHash";
import { fetchProviderModels, type FetchProviderModelsError } from "./fetchProviderModels";

const log = new ScopedLogger("ModelCatalog");

export type SmartRoutingProviderErrorCode = FetchProviderModelsError["errorCode"];

export interface SmartRoutingProviderError {
  providerId: string;
  errorCode: SmartRoutingProviderErrorCode;
}

export interface SmartRoutingCatalogStats {
  providerCount: number;
  modelCount: number;
  lastRefreshedAt?: number;
}

interface ProviderModelsCache {
  modelIds: string[];
  fetchedAt: number;
}

export interface ModelCatalogSnapshot {
  entries: SmartRoutingCatalogEntry[];
  aliasIndex: Map<string, SmartRoutingCatalogEntry>;
  publicIdIndex: Map<string, SmartRoutingCatalogEntry>;
}

export class ModelCatalog {
  private entries: SmartRoutingCatalogEntry[] = [];
  private aliasIndex = new Map<string, SmartRoutingCatalogEntry>();
  private publicIdIndex = new Map<string, SmartRoutingCatalogEntry>();
  private upstreamCache = new Map<string, ProviderModelsCache>();
  private providerErrors = new Map<string, SmartRoutingProviderErrorCode>();
  private refreshPromise: Promise<void> | null = null;

  constructor(private readonly config: ConfigManager) {
    this.config.onConfigChanged(() => {
      void this.refreshAll();
    });
    void this.refreshAll();
  }

  get smartRouting(): SmartRoutingConfig {
    return (
      this.config.configValue.smartRouting ?? {
        enabled: false,
        modelsCache: { ttlSeconds: 600, refreshOnStart: true, onUpstreamFail: "stale" },
        aliasPrefix: "claude-",
        bareModelFallback: { mode: "first-match" },
      }
    );
  }

  isEnabled(): boolean {
    return this.smartRouting.enabled === true;
  }

  async ensureReady(): Promise<void> {
    if (this.entries.length > 0) {
      return;
    }
    await this.refreshAll();
  }

  async refreshAll(): Promise<void> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }
    this.refreshPromise = this.doRefreshAll().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  async refreshProvider(providerId: string): Promise<void> {
    const provider = this.config.getProvider(providerId);
    if (!provider || provider.enabled === false) {
      return;
    }
    if (!provider.useCustomModelsList) {
      await this.fetchUpstreamForProvider(provider, true);
    }
    this.rebuildCatalog();
  }

  /** Entries visible to clients (include/exclude filters applied). */
  getAll(): SmartRoutingCatalogEntry[] {
    return this.applyRoutingFilters([...this.entries]);
  }

  /** Full catalog for settings UI — exclude filter not applied so excluded models stay manageable. */
  getManageableEntries(): SmartRoutingCatalogEntry[] {
    return this.applyIncludeFilter([...this.entries]);
  }

  getStats(): SmartRoutingCatalogStats {
    const entries = this.getAll();
    const providerIds = new Set(entries.map(e => e.providerId));
    let lastRefreshedAt = 0;
    for (const cache of this.upstreamCache.values()) {
      if (cache.fetchedAt > lastRefreshedAt) {
        lastRefreshedAt = cache.fetchedAt;
      }
    }
    for (const entry of this.entries) {
      if (entry.fetchedAt > lastRefreshedAt) {
        lastRefreshedAt = entry.fetchedAt;
      }
    }
    return {
      providerCount: providerIds.size,
      modelCount: entries.length,
      ...(lastRefreshedAt > 0 ? { lastRefreshedAt } : {}),
    };
  }

  getManageableStats(): SmartRoutingCatalogStats {
    const entries = this.getManageableEntries();
    const providerIds = new Set(entries.map(e => e.providerId));
    let lastRefreshedAt = 0;
    for (const cache of this.upstreamCache.values()) {
      if (cache.fetchedAt > lastRefreshedAt) {
        lastRefreshedAt = cache.fetchedAt;
      }
    }
    for (const entry of this.entries) {
      if (entry.fetchedAt > lastRefreshedAt) {
        lastRefreshedAt = entry.fetchedAt;
      }
    }
    return {
      providerCount: providerIds.size,
      modelCount: entries.length,
      ...(lastRefreshedAt > 0 ? { lastRefreshedAt } : {}),
    };
  }

  getProviderErrors(): SmartRoutingProviderError[] {
    return [...this.providerErrors.entries()].map(([providerId, errorCode]) => ({
      providerId,
      errorCode,
    }));
  }

  lookupByPublicId(id: string): SmartRoutingCatalogEntry | null {
    return this.publicIdIndex.get(id) ?? null;
  }

  lookupByAlias(alias: string): SmartRoutingCatalogEntry | null {
    return this.aliasIndex.get(alias) ?? null;
  }

  lookupByBareId(modelId: string): SmartRoutingCatalogEntry | null {
    const providers = this.enabledProvidersInOrder();
    for (const provider of providers) {
      const publicId = buildPublicModelId(provider.id, modelId);
      const hit = this.publicIdIndex.get(publicId);
      if (hit && this.isEntryVisible(hit)) {
        return hit;
      }
    }
    return null;
  }

  resolveModelWireId(model: string): SmartRoutingCatalogEntry | null {
    const trimmed = model.trim();
    if (!trimmed) {
      return null;
    }

    const colon = trimmed.indexOf(":");
    if (colon > 0) {
      const providerId = trimmed.slice(0, colon);
      const upstreamModelId = trimmed.slice(colon + 1);
      if (!upstreamModelId) {
        return null;
      }
      const provider = this.config.getProvider(providerId);
      if (!provider || provider.enabled === false) {
        return null;
      }
      const publicId = buildPublicModelId(providerId, upstreamModelId);
      return this.publicIdIndex.get(publicId) ?? null;
    }

    if (looksLikeAliasWireId(trimmed, this.smartRouting.aliasPrefix)) {
      return this.aliasIndex.get(trimmed) ?? null;
    }

    if (this.smartRouting.bareModelFallback.mode === "first-match") {
      return this.lookupByBareId(trimmed);
    }

    return null;
  }

  private async doRefreshAll(): Promise<void> {
    const providers = this.enabledProvidersInOrder();
    const cacheCfg = this.smartRouting.modelsCache;
    const now = Date.now();
    const isInitial = this.entries.length === 0;

    await Promise.all(
      providers.map(async provider => {
        if (provider.useCustomModelsList) {
          return;
        }
        const cached = this.upstreamCache.get(provider.id);
        const expired = !cached || now - cached.fetchedAt >= cacheCfg.ttlSeconds * 1000;
        if (expired || (isInitial && cacheCfg.refreshOnStart)) {
          await this.fetchUpstreamForProvider(provider, true);
        }
      })
    );

    this.rebuildCatalog();
    log.info(`[catalog] rebuilt ${this.entries.length} entries`);
  }

  private async fetchUpstreamForProvider(provider: Provider, force: boolean): Promise<void> {
    const cached = this.upstreamCache.get(provider.id);
    const now = Date.now();
    const ttlMs = this.smartRouting.modelsCache.ttlSeconds * 1000;
    if (!force && cached && now - cached.fetchedAt < ttlMs) {
      return;
    }

    const result = await fetchProviderModels(provider);
    if (result.ok) {
      this.providerErrors.delete(provider.id);
      this.upstreamCache.set(provider.id, {
        modelIds: result.modelIds,
        fetchedAt: now,
      });
      return;
    }

    log.warn(`[catalog] upstream fetch failed for ${provider.id}: ${result.errorCode}`);
    this.providerErrors.set(provider.id, result.errorCode);
    if (cached && this.smartRouting.modelsCache.onUpstreamFail === "stale") {
      this.upstreamCache.set(provider.id, cached);
      return;
    }
    this.upstreamCache.set(provider.id, {
      modelIds: [],
      fetchedAt: now,
    });
  }

  private isAggregatableProvider(provider: Provider): boolean {
    if (provider.enabled === false) {
      return false;
    }
    if (provider.id === "official" && provider.mode === "passthrough") {
      return false;
    }
    return true;
  }

  private enabledProvidersInOrder(): Provider[] {
    const map = this.config.providers;
    const sorted = sortProviderMapKeys(map);
    return Object.values(sorted).filter(p => this.isAggregatableProvider(p));
  }

  private rebuildCatalog(): void {
    const providers = this.enabledProvidersInOrder();
    const sr = this.smartRouting;
    const draft: SmartRoutingCatalogEntry[] = [];
    const legacyAliasCounts = new Map<string, number>();

    for (const provider of providers) {
      const protocol = provider.providerType;
      const fetchedAt = Date.now();
      if (provider.useCustomModelsList) {
        this.providerErrors.delete(provider.id);
        const lines = provider.customModelsList ?? [];
        for (const line of lines) {
          const parsed = parseCustomModelLine(line);
          if (!parsed.id) {
            continue;
          }
          const publicId = buildPublicModelId(provider.id, parsed.id);
          const aliasHash = computeCanonicalAliasHash(
            provider.id,
            protocol,
            parsed.id,
            sr.aliasPrefix
          );
          const legacyAlias = parsed.alias !== parsed.id ? parsed.alias : undefined;
          if (legacyAlias) {
            legacyAliasCounts.set(legacyAlias, (legacyAliasCounts.get(legacyAlias) ?? 0) + 1);
          }
          draft.push({
            publicId,
            aliasHash,
            providerId: provider.id,
            ...(provider.name !== provider.id ? { providerDisplayName: provider.name } : {}),
            protocol,
            upstreamModelId: parsed.id,
            displayName: parsed.displayName !== parsed.id ? parsed.displayName : undefined,
            ...(legacyAlias ? { legacyAlias } : {}),
            source: "custom",
            fetchedAt,
          });
        }
        continue;
      }

      const cache = this.upstreamCache.get(provider.id);
      const modelIds = cache?.modelIds ?? [];
      for (const modelId of modelIds) {
        draft.push({
          publicId: buildPublicModelId(provider.id, modelId),
          aliasHash: computeCanonicalAliasHash(provider.id, protocol, modelId, sr.aliasPrefix),
          providerId: provider.id,
          ...(provider.name !== provider.id ? { providerDisplayName: provider.name } : {}),
          protocol,
          upstreamModelId: modelId,
          source: "upstream",
          fetchedAt: cache?.fetchedAt ?? fetchedAt,
        });
      }
    }

    this.entries = draft;
    this.publicIdIndex = new Map(draft.map(e => [e.publicId, e]));
    this.aliasIndex = new Map<string, SmartRoutingCatalogEntry>();

    for (const entry of draft) {
      this.aliasIndex.set(entry.aliasHash, entry);
      if (entry.legacyAlias) {
        const count = legacyAliasCounts.get(entry.legacyAlias) ?? 0;
        if (count === 1) {
          this.aliasIndex.set(entry.legacyAlias, entry);
        }
      }
    }
  }

  private applyIncludeFilter(entries: SmartRoutingCatalogEntry[]): SmartRoutingCatalogEntry[] {
    const sr = this.smartRouting;
    if (sr.include?.length) {
      return entries.filter(e => sr.include!.some(p => minimatch(e.publicId, p)));
    }
    return entries;
  }

  private applyRoutingFilters(entries: SmartRoutingCatalogEntry[]): SmartRoutingCatalogEntry[] {
    const filtered = this.applyIncludeFilter(entries);
    const sr = this.smartRouting;
    if (sr.exclude?.length) {
      return filtered.filter(e => !sr.exclude!.some(p => minimatch(e.publicId, p)));
    }
    return filtered;
  }

  private isEntryVisible(entry: SmartRoutingCatalogEntry): boolean {
    return this.applyRoutingFilters([entry]).length > 0;
  }
}
