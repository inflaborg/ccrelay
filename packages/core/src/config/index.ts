/**
 * Configuration management for CCRelay
 * Reads configuration from ~/.ccrelay/config.yaml
 * Auto-initializes config file with defaults if not exists
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as yaml from "js-yaml";
import {
  ProviderConfigSchema,
  FileConfigSchema,
  type FileConfigInput,
  type ProviderConfigInput,
  type RouterConfig,
  type Provider,
  type ForwardRule,
  type BlockRule,
  type ConcurrencyConfig,
  type RouteQueueConfig,
  type DatabaseConfig,
  type WebSearchGlobalConfig,
} from "../types";
import { CONFIG_VERSION, DEFAULT_CONFIG_YAML, getDefaultConfig } from "./defaults";
import { expandEnvVarsInObject } from "./env";
import { deepMerge, mergeFileConfigWithDefaults } from "./merge";
import { parseProvider, sortProviderMapKeys, resolveProviderKeyInMap } from "./provider-utils";
import { ConfigState, STATE_FILENAME } from "./state";
import { computeLegacyMigratedRouting } from "./migration";
import { buildRoutingFromMerged } from "./builders/routing";
import { buildConcurrencyConfig, buildRouteQueues } from "./builders/concurrency";
import { buildDatabaseConfig } from "./builders/database";
import { buildWebSearchConfig } from "./builders/web-search";
import { buildSmartRoutingConfig } from "./builders/smart-routing";

export { getDefaultRoutingSettings } from "./defaults";
export { expandEnvVarsInObject } from "./env";
export { mergeFileConfigWithDefaults } from "./merge";
export {
  sortProviderMapKeys,
  providerIdFuzzyBaseForDuplicateKey,
  isDuplicateStyleProviderId,
  resolveProviderKeyInMap,
} from "./provider-utils";
export { computeGlmEndpoint, buildWebSearchConfig } from "./builders/web-search";

function expandPath(filepath: string): string {
  if (filepath.startsWith("~")) {
    return path.join(os.homedir(), filepath.slice(1));
  }
  return filepath;
}

function generateApiBearerToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export class ConfigManager {
  private config: RouterConfig;
  private configPath: string;
  private readonly configState: ConfigState;
  private configChangeCallbacks: Set<() => void> = new Set();

  private fileWatcher: fs.FSWatcher | null = null;
  private fileWatchDebounce: NodeJS.Timeout | null = null;
  private saving = false;

  constructor() {
    this.configPath = expandPath(path.join(os.homedir(), ".ccrelay", "config.yaml"));
    this.configState = new ConfigState(path.join(os.homedir(), ".ccrelay", STATE_FILENAME));

    this.ensureConfigFile();

    this.config = this.loadConfig();

    this.startFileWatcher();
  }

  private startFileWatcher(): void {
    this.stopFileWatcher();

    if (!fs.existsSync(this.configPath)) {
      return;
    }

    try {
      this.fileWatcher = fs.watch(this.configPath, () => {
        if (this.saving) {
          return;
        }
        if (this.fileWatchDebounce) {
          clearTimeout(this.fileWatchDebounce);
        }
        this.fileWatchDebounce = setTimeout(() => {
          this.fileWatchDebounce = null;
          console.log("[ConfigManager] Config file changed externally, reloading...");
          this.reload();
        }, 300);
      });
    } catch {
      // fs.watch may fail on some platforms; non-critical
    }
  }

  private stopFileWatcher(): void {
    if (this.fileWatchDebounce) {
      clearTimeout(this.fileWatchDebounce);
      this.fileWatchDebounce = null;
    }
    if (this.fileWatcher) {
      this.fileWatcher.close();
      this.fileWatcher = null;
    }
  }

  private writeServerBearerToDisk(token: string): void {
    try {
      const raw = fs.existsSync(this.configPath)
        ? ((yaml.load(fs.readFileSync(this.configPath, "utf-8")) as Record<string, unknown>) ?? {})
        : {};
      const prevServer =
        raw.server && typeof raw.server === "object" && !Array.isArray(raw.server)
          ? { ...(raw.server as Record<string, unknown>) }
          : {};
      prevServer.apiBearerToken = token;
      raw.server = prevServer;

      const yamlContent = yaml.dump(raw, {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
        quotingType: '"',
        forceQuotes: false,
      });
      this.saving = true;
      fs.writeFileSync(this.configPath, yamlContent, "utf-8");
      this.saving = false;
      console.warn("[ConfigManager] Wrote server.apiBearerToken after missing merge result");
    } catch (err) {
      this.saving = false;
      console.error("[ConfigManager] writeServerBearerToDisk failed:", err);
    }
  }

  private ensureBearerTokenPersisted(): void {
    if (!fs.existsSync(this.configPath)) {
      return;
    }
    try {
      const content = fs.readFileSync(this.configPath, "utf-8");
      const raw = yaml.load(content) as Record<string, unknown> | null;
      if (!raw || typeof raw !== "object") {
        return;
      }

      let serverRaw = raw.server;
      let serverObj: Record<string, unknown>;
      if (serverRaw && typeof serverRaw === "object" && !Array.isArray(serverRaw)) {
        serverObj = { ...(serverRaw as Record<string, unknown>) };
      } else {
        serverObj = {};
        raw.server = serverObj;
      }

      const existing =
        typeof serverObj.apiBearerToken === "string" ? serverObj.apiBearerToken.trim() : "";
      if (existing.length > 0) {
        return;
      }

      serverObj.apiBearerToken = generateApiBearerToken();
      raw.server = serverObj;

      const yamlContent = yaml.dump(raw, {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
        quotingType: '"',
        forceQuotes: false,
      });
      this.saving = true;
      fs.writeFileSync(this.configPath, yamlContent, "utf-8");
      this.saving = false;
      console.log("[ConfigManager] Generated server.apiBearerToken and persisted to config.yaml");
    } catch (err) {
      this.saving = false;
      console.error("[ConfigManager] ensureBearerTokenPersisted failed:", err);
    }
  }

  private ensureConfigFile(): void {
    const configDir = path.dirname(this.configPath);

    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    if (!fs.existsSync(this.configPath)) {
      console.log(`[ConfigManager] Creating default config at ${this.configPath}`);
      fs.writeFileSync(this.configPath, DEFAULT_CONFIG_YAML, "utf-8");
      return;
    }

    try {
      const content = fs.readFileSync(this.configPath, "utf-8");
      const existingConfig = yaml.load(content) as Record<string, unknown> | null;

      if (!existingConfig || typeof existingConfig !== "object") {
        return;
      }

      const defaults = yaml.load(DEFAULT_CONFIG_YAML) as Record<string, unknown>;
      let changed = false;

      for (const key of Object.keys(defaults)) {
        if (!(key in existingConfig)) {
          existingConfig[key] = defaults[key];
          changed = true;
        } else if (
          typeof defaults[key] === "object" &&
          defaults[key] !== null &&
          !Array.isArray(defaults[key]) &&
          typeof existingConfig[key] === "object" &&
          existingConfig[key] !== null &&
          !Array.isArray(existingConfig[key])
        ) {
          const defObj = defaults[key] as Record<string, unknown>;
          const existObj = existingConfig[key] as Record<string, unknown>;
          for (const subKey of Object.keys(defObj)) {
            if (!(subKey in existObj)) {
              existObj[subKey] = defObj[subKey];
              changed = true;
            }
          }
        }
      }

      if (changed) {
        console.log(`[ConfigManager] Back-filled missing fields in ${this.configPath}`);
        const yamlContent = yaml.dump(existingConfig, {
          indent: 2,
          lineWidth: -1,
          noRefs: true,
          quotingType: '"',
          forceQuotes: false,
        });
        this.saving = true;
        fs.writeFileSync(this.configPath, yamlContent, "utf-8");
        this.saving = false;
      }
    } catch (err) {
      console.error(`[ConfigManager] Error reading config file:`, err);
    }
  }

  private loadConfig(): RouterConfig {
    console.log(`[ConfigManager] Loading config from ${this.configPath}`);

    this.ensureBearerTokenPersisted();

    let fileConfig: FileConfigInput = {};
    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, "utf-8");
        const rawConfig = yaml.load(content);
        if (rawConfig && typeof rawConfig === "object") {
          const expanded = expandEnvVarsInObject(rawConfig);
          const result = FileConfigSchema.safeParse(expanded);
          if (result.success) {
            fileConfig = result.data;
          } else {
            console.warn("[ConfigManager] Config validation failed:", result.error.format());
          }
        }
      }
    } catch (err) {
      console.error(`[ConfigManager] Failed to load config:`, err);
    }

    const defaults = getDefaultConfig();
    const merged = mergeFileConfigWithDefaults(defaults, fileConfig);

    const providers: Record<string, Provider> = {};
    if (merged.providers) {
      for (const [id, config] of Object.entries(merged.providers)) {
        const result = ProviderConfigSchema.safeParse(config);
        if (result.success) {
          providers[id] = parseProvider(id, result.data);
        } else {
          console.warn(`[ConfigManager] Provider ${id} validation failed:`, result.error.format());
        }
      }
    }

    if (!providers.official) {
      providers.official = {
        id: "official",
        name: "Claude Official",
        baseUrl: "https://api.anthropic.com",
        mode: "passthrough",
        providerType: "anthropic",
        headers: {},
        enabled: true,
      };
    }

    const concurrency = buildConcurrencyConfig(merged.concurrency);
    const routeQueues = buildRouteQueues(merged.concurrency?.routes);
    const database = buildDatabaseConfig(merged.logging);

    const rawFileObj = ((): Record<string, unknown> => {
      try {
        const raw = fs.readFileSync(this.configPath, "utf-8");
        return (yaml.load(raw) as Record<string, unknown>) ?? {};
      } catch {
        return {};
      }
    })();
    const fileConfigVersion =
      typeof rawFileObj.configVersion === "string" ? rawFileObj.configVersion : null;
    const needsMigration = !fileConfigVersion;

    const rawRouting = merged.routing ?? {};
    let forwardRules: ForwardRule[];
    let blockRules: BlockRule[];

    if (!needsMigration) {
      const r = buildRoutingFromMerged(rawRouting);
      forwardRules = r.forward;
      blockRules = r.block;
    } else {
      const migrated = computeLegacyMigratedRouting(rawRouting);
      forwardRules = migrated.forward;
      blockRules = migrated.block;

      try {
        merged.configVersion = CONFIG_VERSION;
        merged.routing = { forward: forwardRules, block: blockRules };
        const writeTarget = { ...rawFileObj, ...merged };
        if (writeTarget.routing && typeof writeTarget.routing === "object") {
          const rt = writeTarget.routing as Record<string, unknown>;
          delete rt.proxy;
          delete rt.passthrough;
          delete rt.openaiBlock;
        }
        const yamlContent = yaml.dump(writeTarget, {
          indent: 2,
          lineWidth: -1,
          noRefs: true,
          quotingType: '"',
          forceQuotes: false,
        });
        this.saving = true;
        fs.writeFileSync(this.configPath, yamlContent, "utf-8");
        this.saving = false;
        console.log(`[ConfigManager] Migrated config to version ${CONFIG_VERSION}`);
      } catch (err) {
        this.saving = false;
        console.error("[ConfigManager] Failed to write migrated config:", err);
      }
    }

    const routing = { forward: forwardRules, block: blockRules };

    let apiBearerTok =
      typeof merged.server?.apiBearerToken === "string" ? merged.server.apiBearerToken.trim() : "";
    if (apiBearerTok.length === 0) {
      apiBearerTok = generateApiBearerToken();
      this.writeServerBearerToDisk(apiBearerTok);
    }

    const rawWebSearch = merged.webSearch ?? merged.web_search;
    const webSearchConfig = buildWebSearchConfig(rawWebSearch);
    const smartRouting = buildSmartRoutingConfig(merged.smartRouting);

    return {
      port: merged.server?.port || 7575,
      host: merged.server?.host || "127.0.0.1",
      autoStart: merged.server?.autoStart ?? true,
      apiBearerToken: apiBearerTok,
      defaultProvider: merged.defaultProvider || "official",
      providers,
      routing,
      concurrency,
      routeQueues,
      logging: {
        enabled: merged.logging?.enabled ?? false,
        database,
      },
      locale: merged.server?.locale,
      webSearch: webSearchConfig,
      smartRouting,
    };
  }

  onConfigChanged(callback: () => void): void {
    this.configChangeCallbacks.add(callback);
  }

  offConfigChanged(callback: () => void): void {
    this.configChangeCallbacks.delete(callback);
  }

  private notifyConfigChanged(): void {
    for (const callback of this.configChangeCallbacks) {
      try {
        callback();
      } catch {
        // Ignore callback errors
      }
    }
  }

  reload(): void {
    console.log("[ConfigManager] Reloading configuration...");
    this.ensureConfigFile();
    this.config = this.loadConfig();
    this.notifyConfigChanged();
  }

  get configValue(): RouterConfig {
    return this.config;
  }

  get providers(): Record<string, Provider> {
    return this.config.providers;
  }

  get enabledProviders(): Provider[] {
    return Object.values(this.config.providers).filter(p => p.enabled !== false);
  }

  getProvider(id: string): Provider | undefined {
    return this.config.providers[id];
  }

  get defaultProvider(): string {
    if (this.config.providers[this.config.defaultProvider]) {
      return this.config.defaultProvider;
    }
    const available = Object.keys(this.config.providers);
    if (available.length > 0) {
      return available[0];
    }
    return "official";
  }

  getApiBearerToken(): string {
    return this.config.apiBearerToken;
  }

  get port(): number {
    return this.config.port;
  }

  get host(): string {
    return this.config.host;
  }

  get autoStart(): boolean {
    return this.config.autoStart;
  }

  get locale(): string | undefined {
    return this.config.locale;
  }

  get routing() {
    return this.config.routing;
  }

  get forwardRules(): ForwardRule[] {
    return this.config.routing.forward;
  }

  get blockRules(): BlockRule[] {
    return this.config.routing.block;
  }

  get concurrencyConfig(): ConcurrencyConfig | undefined {
    return this.config.concurrency;
  }

  get routeQueues(): RouteQueueConfig[] | undefined {
    return this.config.routeQueues;
  }

  get database(): DatabaseConfig | undefined {
    return this.config.logging.database;
  }

  get enableLogStorage(): boolean {
    return this.config.logging.enabled;
  }

  get webSearchConfig(): WebSearchGlobalConfig | undefined {
    return this.config.webSearch;
  }

  getCurrentProviderId(): string {
    const persisted = this.configState.readCurrentProviderId();
    if (persisted && this.config.providers[persisted]) {
      return persisted;
    }
    return this.defaultProvider;
  }

  async setCurrentProviderId(id: string): Promise<void> {
    await this.configState.writeCurrentProviderId(id);
  }

  getConfigPath(): string {
    return this.configPath;
  }

  getConfigDir(): string {
    return path.dirname(this.configPath);
  }

  configExists(): boolean {
    return fs.existsSync(this.configPath);
  }

  addProvider(id: string, config: ProviderConfigInput): boolean {
    try {
      const result = ProviderConfigSchema.safeParse(config);
      if (!result.success) {
        console.error("[ConfigManager] Provider validation failed:", result.error.format());
        return false;
      }

      const content = fs.readFileSync(this.configPath, "utf-8");
      const rawConfig = yaml.load(content) as Record<string, unknown>;

      if (!rawConfig.providers) {
        rawConfig.providers = {};
      }

      const providers = rawConfig.providers as Record<string, ProviderConfigInput>;
      providers[id] = {
        name: config.name,
        baseUrl: config.baseUrl,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        base_url: config.base_url,
        mode: config.mode,
        providerType: config.providerType,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        provider_type: config.provider_type,
        apiKey: config.apiKey,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        api_key: config.api_key,
        authHeader: config.authHeader,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        auth_header: config.auth_header,
        modelMap: config.modelMap,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        model_map: config.model_map,
        vlModelMap: config.vlModelMap,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        vl_model_map: config.vl_model_map,
        headers: config.headers,
        enabled: id === "official" ? true : (config.enabled ?? true),
        useCustomModelsList: config.useCustomModelsList,
        // eslint-disable-next-line @typescript-eslint/naming-convention -- YAML snake_case parity
        use_custom_models_list: config.use_custom_models_list,
        customModelsList: config.customModelsList,
        // eslint-disable-next-line @typescript-eslint/naming-convention -- YAML snake_case parity
        custom_models_list: config.custom_models_list,
        ...(config.modelMappingEnabled !== undefined || config.model_mapping_enabled !== undefined
          ? {
              modelMappingEnabled: config.modelMappingEnabled,
              // eslint-disable-next-line @typescript-eslint/naming-convention -- YAML snake_case parity
              model_mapping_enabled: config.model_mapping_enabled,
            }
          : {}),
        ...(config.openaiCompat !== undefined
          ? {
              openaiCompat: config.openaiCompat,
              // eslint-disable-next-line @typescript-eslint/naming-convention -- YAML snake_case parity
              openai_compat: config.openai_compat,
            }
          : {}),
      };

      rawConfig.providers = sortProviderMapKeys(providers);

      const yamlContent = yaml.dump(rawConfig, {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
        quotingType: '"',
        forceQuotes: false,
      });
      this.saving = true;
      fs.writeFileSync(this.configPath, yamlContent, "utf-8");
      this.saving = false;

      this.reload();

      return true;
    } catch (err) {
      this.saving = false;
      console.error("[ConfigManager] Failed to add provider:", err);
      return false;
    }
  }

  deleteProvider(id: string): boolean {
    try {
      const content = fs.readFileSync(this.configPath, "utf-8");
      const rawConfig = yaml.load(content) as Record<string, unknown>;

      const providers = rawConfig.providers as Record<string, unknown> | undefined;
      if (!providers) {
        console.error(`[ConfigManager] Provider "${id}" not found (no providers map)`);
        return false;
      }

      const keys = Object.keys(providers);
      const resolved = resolveProviderKeyInMap(keys, id);
      if (!resolved) {
        console.error(`[ConfigManager] Provider "${id}" not found in config file`);
        return false;
      }

      if (resolved === "official") {
        console.error("[ConfigManager] Cannot delete the official provider");
        return false;
      }

      delete providers[resolved];

      const dfp = rawConfig.defaultProvider;
      if (dfp !== undefined && dfp !== null) {
        const dfpStr = typeof dfp === "string" || typeof dfp === "number" ? String(dfp) : null;
        if (dfpStr) {
          const defKey =
            resolveProviderKeyInMap(keys, dfpStr) ?? (keys.includes(dfpStr) ? dfpStr : null);
          if (defKey === resolved) {
            rawConfig.defaultProvider = "official";
          }
        }
      }

      rawConfig.providers = sortProviderMapKeys(providers);

      const yamlContent = yaml.dump(rawConfig, {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
      });
      this.saving = true;
      fs.writeFileSync(this.configPath, yamlContent, "utf-8");
      this.saving = false;

      this.reload();

      return true;
    } catch (err) {
      this.saving = false;
      console.error("[ConfigManager] Failed to delete provider:", err);
      return false;
    }
  }

  getConfigRawForApi(): Record<string, unknown> {
    const raw = this.getConfigRaw();
    const serverRaw = raw.server as Record<string, unknown> | undefined;
    let serverClone: Record<string, unknown>;

    if (serverRaw && typeof serverRaw === "object" && !Array.isArray(serverRaw)) {
      serverClone = { ...serverRaw };
      if ("apiBearerToken" in serverClone) {
        serverClone.apiBearerToken = "<redacted>";
      }
    } else {
      serverClone = {};
    }

    return {
      ...raw,
      server: serverClone,
    };
  }

  get smartRoutingConfig() {
    return this.config.smartRouting;
  }

  getConfigRaw(): Record<string, unknown> {
    const content = fs.readFileSync(this.configPath, "utf-8");
    const raw = yaml.load(content) as Record<string, unknown>;
    return {
      logging: raw.logging ?? {},
      concurrency: raw.concurrency ?? {},
      server: raw.server ?? {},
      routing: raw.routing ?? {},
      webSearch: raw.webSearch ?? raw.web_search ?? {},
      smartRouting: raw.smartRouting ?? {},
    };
  }

  updateProviderCustomModelsList(providerId: string, list: string[]): boolean {
    try {
      const content = fs.readFileSync(this.configPath, "utf-8");
      const rawConfig = yaml.load(content) as Record<string, unknown>;
      const providers = rawConfig.providers as Record<string, unknown> | undefined;
      if (!providers) {
        return false;
      }
      const keys = Object.keys(providers);
      const resolved = resolveProviderKeyInMap(keys, providerId);
      if (!resolved) {
        return false;
      }
      const providerRaw = providers[resolved];
      if (!providerRaw || typeof providerRaw !== "object" || Array.isArray(providerRaw)) {
        return false;
      }
      const providerObj = { ...(providerRaw as Record<string, unknown>) };
      providerObj.customModelsList = list;
      providerObj.custom_models_list = list;
      providerObj.useCustomModelsList = true;
      providerObj.use_custom_models_list = true;
      providers[resolved] = providerObj;
      rawConfig.providers = sortProviderMapKeys(providers as Record<string, ProviderConfigInput>);

      const yamlContent = yaml.dump(rawConfig, {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
        quotingType: '"',
        forceQuotes: false,
      });
      this.saving = true;
      fs.writeFileSync(this.configPath, yamlContent, "utf-8");
      this.saving = false;
      this.reload();
      return true;
    } catch (err) {
      this.saving = false;
      console.error("[ConfigManager] Failed to update customModelsList:", err);
      return false;
    }
  }

  updateConfigSection(
    section: "logging" | "concurrency" | "server" | "routing" | "webSearch" | "smartRouting",
    data: Record<string, unknown>,
    options?: { merge?: boolean }
  ): { ok: boolean; error?: string } {
    try {
      const content = fs.readFileSync(this.configPath, "utf-8");
      const rawConfig = yaml.load(content) as Record<string, unknown>;

      const merge = options?.merge !== false;
      const existing = (rawConfig[section] as Record<string, unknown>) ?? {};
      rawConfig[section] = merge ? deepMerge(existing, data) : data;

      const yamlContent = yaml.dump(rawConfig, {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
        quotingType: '"',
        forceQuotes: false,
      });
      this.saving = true;
      fs.writeFileSync(this.configPath, yamlContent, "utf-8");
      this.saving = false;

      this.reload();
      return { ok: true };
    } catch (err) {
      this.saving = false;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ConfigManager] Failed to update ${section}:`, err);
      return { ok: false, error: msg };
    }
  }

  dispose(): void {
    this.stopFileWatcher();
  }
}
