/**
 * Configuration management for CCRelay
 * Supports reading from ~/.ccrelay/config.yaml
 * and VSCode settings (which take precedence)
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as yaml from "js-yaml";
import {
  RouterConfig,
  Provider,
  ProviderMode,
  ProviderType,
  ProviderConfigSchema,
  FileConfigSchema,
  type FileConfigInput,
  type ProviderConfigInput,
  type ConcurrencyConfig,
  type DatabaseConfig,
} from "../types";

const CONFIG_STATE_KEY = "ccrelay.currentProvider";
const DEFAULT_PORT = 7575;
const DEFAULT_HOST = "127.0.0.1";

// Config directory and file
const CONFIG_DIR = path.join(os.homedir(), ".ccrelay");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.yaml");

// Environment variable pattern for substitution
const ENV_VAR_PATTERN = /\$\{(\w+)\}/g;

/**
 * Expand environment variables in a string
 * Supports ${VAR_NAME} syntax
 */
function expandEnvVars(value: string): string {
  if (!value || typeof value !== "string") {
    return value;
  }
  return value.replace(ENV_VAR_PATTERN, (_, varName: string) => {
    return process.env[varName] || "";
  });
}

/**
 * Recursively expand environment variables in an object
 * Preserves the structure of the input object
 */
function expandEnvVarsInObject<T>(obj: T): T {
  if (!obj) {
    return obj;
  }
  if (typeof obj === "string") {
    return expandEnvVars(obj) as T;
  }
  if (Array.isArray(obj)) {
    return obj.map(expandEnvVarsInObject) as T;
  }
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      // Convert snake_case to camelCase for API compatibility
      const camelKey = key.replace(/(?<!^)_([a-zA-Z])/g, (_, letter: string) =>
        letter.toUpperCase()
      );
      result[camelKey] = expandEnvVarsInObject(value);
    }
    return result as T;
  }
  return obj;
}

/**
 * Load and parse configuration from ~/.ccrelay/config.yaml
 * Returns the validated config or a default empty config
 */
function loadFileConfig(): FileConfigInput {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const content = fs.readFileSync(CONFIG_FILE, "utf-8");
      const rawConfig = yaml.load(content);
      if (rawConfig && typeof rawConfig === "object") {
        const expanded = expandEnvVarsInObject(rawConfig);
        const result = FileConfigSchema.safeParse(expanded);
        if (result.success) {
          return result.data;
        }
        console.warn("Config file validation failed:", result.error.format());
      }
    } catch (err) {
      console.error(`Failed to load config from ${CONFIG_FILE}:`, err);
    }
  }
  return {} as FileConfigInput;
}

/**
 * Get a string value from provider config with fallback
 */
function getString(
  config: ProviderConfigInput,
  key: keyof ProviderConfigInput,
  fallback: string
): string {
  const value = config[key];
  return typeof value === "string" ? value : fallback;
}

/**
 * Get an optional string value from provider config
 */
function getOptionalString(
  config: ProviderConfigInput,
  key: keyof ProviderConfigInput
): string | undefined {
  const value = config[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Get a record value from provider config
 */
function getRecord(
  config: ProviderConfigInput,
  key: keyof ProviderConfigInput
): Record<string, string> {
  const value = config[key];
  if (value && typeof value === "object" && !Array.isArray(value)) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- Zod inferred type needs assertion
    return value as Record<string, string>;
  }
  return {};
}

/**
 * Parse provider from validated config
 */
function parseProvider(id: string, config: ProviderConfigInput): Provider {
  // Support both camelCase and snake_case variants
  const baseUrl = getString(config, "baseUrl", "") || getString(config, "base_url", "");
  const apiKey = getOptionalString(config, "apiKey") || getOptionalString(config, "api_key");
  const authHeader =
    getOptionalString(config, "authHeader") || getOptionalString(config, "auth_header");
  const modelMap = getRecord(config, "modelMap") || getRecord(config, "model_map");
  const vlModelMap = getRecord(config, "vlModelMap") || getRecord(config, "vl_model_map");
  // Get providerType, default to "anthropic"
  const providerType =
    (config.providerType as ProviderType) || (config.provider_type as ProviderType) || "anthropic";

  return {
    id,
    name: getString(config, "name", id),
    baseUrl,
    mode: config.mode as ProviderMode,
    providerType,
    apiKey,
    authHeader: authHeader || "authorization",
    modelMap,

    vlModelMap: Object.keys(vlModelMap).length > 0 ? vlModelMap : undefined,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- Zod inferred type needs assertion
    headers: (config.headers as Record<string, string> | undefined) ?? {},
    enabled: config.enabled !== false,
  };
}

/**
 * Parse provider from unknown config object (for VSCode settings)
 */
function parseProviderFromUnknown(id: string, rawProvider: unknown): Provider | null {
  if (!rawProvider || typeof rawProvider !== "object" || Array.isArray(rawProvider)) {
    return null;
  }

  const result = ProviderConfigSchema.safeParse(rawProvider);
  if (!result.success) {
    console.warn(`Provider ${id} validation failed:`, result.error.format());
    return null;
  }

  return parseProvider(id, result.data);
}

/**
 * Extract server config from validated file config
 */
function getServerConfig(
  fileConfig: FileConfigInput,
  vscodeConfig: vscode.WorkspaceConfiguration
): { port: number; host: string } {
  const serverConfig = fileConfig.server;
  const fallbackPort = serverConfig?.port ?? DEFAULT_PORT;
  const fallbackHost = serverConfig?.host ?? DEFAULT_HOST;

  return {
    port: vscodeConfig.get<number>("server.port", fallbackPort),
    host: vscodeConfig.get<string>("server.host", fallbackHost) ?? DEFAULT_HOST,
  };
}

/**
 * Extract string array config with fallback
 */
function getStringArray(
  vscodeConfig: vscode.WorkspaceConfiguration,
  key: string,
  fallback: string[] = []
): string[] {
  const value = vscodeConfig.get<string[]>(key);
  return Array.isArray(value) ? value : fallback;
}

/**
 * Extract block pattern array config with fallback
 */
function getBlockPatternArray(
  vscodeConfig: vscode.WorkspaceConfiguration,
  key: string,
  fallback: { path: string; response: string; responseCode?: number }[] = []
): { path: string; response: string; responseCode?: number }[] {
  const value = vscodeConfig.get<{ path: string; response: string; responseCode?: number }[]>(key);
  return Array.isArray(value) ? value : fallback;
}

/**
 * Extract concurrency config from file and VSCode settings
 */
function getConcurrencyConfig(
  fileConfig: FileConfigInput,
  vscodeConfig: vscode.WorkspaceConfiguration
): ConcurrencyConfig | undefined {
  // Get from file config
  const fileConcurrency = fileConfig.concurrency;

  // Get from VSCode settings (takes precedence)
  const enabled = vscodeConfig.get<boolean>(
    "concurrency.enabled",
    fileConcurrency?.enabled ?? false
  );
  const maxConcurrency = vscodeConfig.get<number>(
    "concurrency.maxConcurrency",
    fileConcurrency?.maxConcurrency ?? 5
  );
  const maxQueueSize = vscodeConfig.get<number | undefined>(
    "concurrency.maxQueueSize",
    fileConcurrency?.maxQueueSize
  );
  const timeout = vscodeConfig.get<number | undefined>(
    "concurrency.timeout",
    fileConcurrency?.timeout
  );

  // Only return config if enabled
  if (!enabled) {
    return undefined;
  }

  return {
    enabled,
    maxConcurrency,
    maxQueueSize,
    timeout,
  };
}

/**
 * Extract database config from file and VSCode settings
 */
function getDatabaseConfig(
  fileConfig: FileConfigInput,
  vscodeConfig: vscode.WorkspaceConfiguration
): DatabaseConfig | undefined {
  // Get database type from VSCode settings (takes precedence) or file config
  const dbType = vscodeConfig.get<string>("database.type", fileConfig.database?.type ?? "sqlite");

  if (dbType === "postgres") {
    // PostgreSQL configuration
    const fileDb = fileConfig.database?.type === "postgres" ? fileConfig.database : undefined;

    const host = vscodeConfig.get<string>("database.postgresHost", fileDb?.host ?? "localhost");
    const port = vscodeConfig.get<number>("database.postgresPort", fileDb?.port ?? 5432);
    const database = vscodeConfig.get<string>(
      "database.postgresDatabase",
      fileDb?.database ?? "ccrelay"
    );
    const user = vscodeConfig.get<string>("database.postgresUser", fileDb?.user ?? "");
    const rawPassword = vscodeConfig.get<string>(
      "database.postgresPassword",
      fileDb?.password ?? ""
    );
    const password = expandEnvVars(rawPassword);
    const ssl = vscodeConfig.get<boolean>("database.postgresSsl", fileDb?.ssl ?? false);

    if (!user) {
      console.warn("[ConfigManager] PostgreSQL user is required but not configured");
      return undefined;
    }

    return {
      type: "postgres",
      host,
      port,
      database,
      user,
      password,
      ssl,
    };
  } else {
    // SQLite configuration (default)
    const fileDb = fileConfig.database?.type === "sqlite" ? fileConfig.database : undefined;
    const dbPath = vscodeConfig.get<string>("database.sqlitePath", fileDb?.path ?? "");

    return {
      type: "sqlite",
      path: dbPath || undefined,
    };
  }
}

export class ConfigManager {
  private config: RouterConfig;
  private context: vscode.ExtensionContext;
  private disposables: vscode.Disposable[] = [];

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.config = this.loadConfig();

    // Watch for configuration changes
    const configWatcher = vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration("ccrelay")) {
        this.config = this.loadConfig();
      }
    });
    this.disposables.push(configWatcher);
  }

  private loadConfig(): RouterConfig {
    const vscodeConfig = vscode.workspace.getConfiguration("ccrelay");
    const useConfigFile = vscodeConfig.get<boolean>("config.useFile", false);

    console.log(`[ConfigManager] Loading config... useConfigFile=${useConfigFile}`);

    // Load from ~/.ccrelay/config.yaml only if enabled
    const fileConfig = useConfigFile ? loadFileConfig() : {};
    if (useConfigFile) {
      console.log(
        `[ConfigManager] File config loaded: ${JSON.stringify(fileConfig.concurrency || "none")}`
      );
    }

    // Get server config
    const { port, host } = getServerConfig(fileConfig, vscodeConfig);

    // Build providers map
    const providers: Record<string, Provider> = {};

    // Add providers from file config (only if enabled)
    if (useConfigFile && fileConfig.providers) {
      for (const [id, config] of Object.entries(fileConfig.providers)) {
        providers[id] = parseProvider(id, config);
      }
    }

    // Add/override with VSCode providers
    const vscodeProviders = vscodeConfig.get<Record<string, unknown>>("provider.list", {});
    for (const [id, rawProvider] of Object.entries(vscodeProviders)) {
      const provider = parseProviderFromUnknown(id, rawProvider);
      if (provider) {
        providers[id] = provider;
      }
    }

    // Ensure official provider exists
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

    // Get default provider
    const defaultProvider =
      vscodeConfig.get<string>("provider.default") ?? fileConfig.defaultProvider ?? "official";

    // Get patterns
    const routePatterns = getStringArray(
      vscodeConfig,
      "route.patterns",
      fileConfig.routePatterns ?? ["/v1/messages", "/messages"]
    );
    const passthroughPatterns = getStringArray(
      vscodeConfig,
      "route.passthroughPatterns",
      fileConfig.passthroughPatterns ?? ["/v1/users/*", "/v1/organizations/*"]
    );
    const blockPatterns = getBlockPatternArray(
      vscodeConfig,
      "route.blockPatterns",
      fileConfig.blockPatterns ?? [{ path: "/api/event_logging/*", response: "Blocked" }]
    );
    const openaiBlockPatterns = getBlockPatternArray(
      vscodeConfig,
      "route.openaiBlockPatterns",
      fileConfig.openaiBlockPatterns ?? []
    );

    // Get concurrency config
    const concurrency = getConcurrencyConfig(fileConfig, vscodeConfig);
    console.log(`[ConfigManager] Concurrency config resolved: ${JSON.stringify(concurrency)}`);

    // Get log storage enabled setting
    const enableLogStorage = vscodeConfig.get<boolean>(
      "log.enableStorage",
      fileConfig.enableLogStorage ?? false
    );

    // Get database config (only if log storage is enabled)
    const database = enableLogStorage ? getDatabaseConfig(fileConfig, vscodeConfig) : undefined;
    console.log(
      `[ConfigManager] Log storage: ${enableLogStorage}, database type: ${database?.type ?? "none"}`
    );

    return {
      port,
      host,
      defaultProvider,
      providers,
      routePatterns,
      passthroughPatterns,
      blockPatterns,
      openaiBlockPatterns,
      concurrency,
      database,
      enableLogStorage,
    };
  }

  /**
   * Reload configuration from files
   */
  reload(): void {
    console.log("[ConfigManager] Reloading configuration...");
    this.config = this.loadConfig();
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
    // Ensure default provider exists
    if (this.config.providers[this.config.defaultProvider]) {
      return this.config.defaultProvider;
    }
    // Fall back to first available provider
    const available = Object.keys(this.config.providers);
    if (available.length > 0) {
      return available[0];
    }
    return "official";
  }

  get port(): number {
    return this.config.port;
  }

  get host(): string {
    return this.config.host;
  }

  get routePatterns(): string[] {
    return this.config.routePatterns;
  }

  get passthroughPatterns(): string[] {
    return this.config.passthroughPatterns;
  }

  get blockPatterns(): { path: string; response: string; responseCode?: number }[] {
    return this.config.blockPatterns;
  }

  get openaiBlockPatterns(): { path: string; response: string; responseCode?: number }[] {
    return this.config.openaiBlockPatterns;
  }

  get database(): DatabaseConfig | undefined {
    return this.config.database;
  }

  get enableLogStorage(): boolean {
    return this.config.enableLogStorage;
  }

  /**
   * Get a specific VSCode configuration value
   */
  getSetting<T>(key: string, defaultValue?: T): T {
    return vscode.workspace.getConfiguration("ccrelay").get<T>(key, defaultValue as T);
  }

  /**
   * Get the current provider ID from state
   */
  getCurrentProviderId(): string {
    return this.context.globalState.get<string>(CONFIG_STATE_KEY, this.defaultProvider);
  }

  /**
   * Set the current provider ID in state
   */
  async setCurrentProviderId(id: string): Promise<void> {
    await this.context.globalState.update(CONFIG_STATE_KEY, id);
  }

  /**
   * Get the config file path
   */
  static getConfigFilePath(): string {
    return CONFIG_FILE;
  }

  /**
   * Get the config directory path
   */
  static getConfigDirPath(): string {
    return CONFIG_DIR;
  }

  /**
   * Check if config file exists
   */
  static configExists(): boolean {
    return fs.existsSync(CONFIG_FILE);
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
