/**
 * Configuration management for CCRelay
 * Reads configuration from yaml file specified by vscode setting
 * Auto-initializes config file with defaults if not exists
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
  type Retry429Config,
  type DatabaseConfig,
  type RouteQueueConfig,
  type BlockPattern,
} from "../types";

const CONFIG_STATE_KEY = "ccrelay.currentProvider";

// Environment variable pattern for substitution
const ENV_VAR_PATTERN = /\$\{(\w+)\}/g;

// Default config with comments template
const DEFAULT_CONFIG_YAML = `# CCRelay Configuration
# Docs: https://github.com/inflaborg/ccrelay#configuration

# ==================== Server Configuration ====================
server:
  port: 7575                    # Proxy server port
  host: "127.0.0.1"             # Bind address
  autoStart: true               # Auto-start server when extension loads

# ==================== Provider Configuration ====================
providers:
  official:
    name: "Claude Official"
    baseUrl: "https://api.anthropic.com"
    mode: "passthrough"         # passthrough | inject
    providerType: "anthropic"   # anthropic | openai
    enabled: true

  # Example: Custom provider
  # custom:
  #   name: "Custom Provider"
  #   baseUrl: "https://api.example.com/anthropic"
  #   mode: "inject"
  #   providerType: "anthropic"
  #   apiKey: "\${API_KEY}"      # Supports environment variables
  #   authHeader: "authorization"
  #   modelMap:
  #     "claude-*": "custom-model"
  #   enabled: true

# Default provider ID
defaultProvider: "official"

# ==================== Routing Configuration ====================
routing:
  # Proxy routes: Forward to current provider
  proxy:
    - "/v1/messages"
    - "/messages"

  # Passthrough routes: Always go to official API
  passthrough:
    - "/v1/users/*"
    - "/v1/organizations/*"

  # Block routes (inject mode): Return custom response
  block:
    - path: "/api/event_logging/*"
      response: ""
      code: 200

  # OpenAI format block routes
  openaiBlock:
    - path: "/v1/messages/count_tokens"
      response: '{"input_tokens": 0}'
      code: 200

# ==================== Concurrency Control ====================
concurrency:
  enabled: true                 # Enable concurrency queue
  maxWorkers: 3                 # Maximum concurrent workers
  maxQueueSize: 100             # Maximum queue size (0=unlimited)

  # Request timeout: Maximum wait time in queue (seconds)
  # Requests exceeding this will return 503
  # 0 or not set = unlimited
  requestTimeout: 60

  # 429 Retry configuration
  retry429:
    enabled: false              # Enable automatic retry on 429 responses
    maxRetries: 3               # Maximum retry attempts
    delayMs: 1000               # Delay between retries (milliseconds)

  # Per-route queue configuration
  routes:
    - pattern: "/v1/messages/count_tokens"
      name: "count_tokens"
      maxWorkers: 30
      maxQueueSize: 1000

# ==================== Logging Storage ====================
logging:
  enabled: false                # Enable request log storage

  database:
    type: "sqlite"              # sqlite | postgres
    # SQLite configuration (default)
    path: ""                    # Empty = ~/.ccrelay/logs.db

    # PostgreSQL configuration
    # type: "postgres"
    # host: "localhost"
    # port: 5432
    # name: "ccrelay"
    # user: ""
    # password: "\${POSTGRES_PASSWORD}"
    # ssl: false
`;

/**
 * Default configuration object (parsed from DEFAULT_CONFIG_YAML)
 */
function getDefaultConfig(): FileConfigInput {
  const parsed = yaml.load(DEFAULT_CONFIG_YAML);
  return FileConfigSchema.parse(parsed);
}

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
 * Deep merge two objects, with source overwriting target
 */
function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key of Object.keys(source) as (keyof T)[]) {
    if (source[key] !== undefined) {
      if (
        typeof source[key] === "object" &&
        source[key] !== null &&
        !Array.isArray(source[key]) &&
        typeof target[key] === "object" &&
        target[key] !== null &&
        !Array.isArray(target[key])
      ) {
        result[key] = deepMerge(
          target[key] as Record<string, unknown>,
          source[key] as Record<string, unknown>
        ) as T[keyof T];
      } else {
        result[key] = source[key] as T[keyof T];
      }
    }
  }
  return result;
}

/**
 * Expand ~ to home directory in path
 */
function expandPath(filepath: string): string {
  if (filepath.startsWith("~")) {
    return path.join(os.homedir(), filepath.slice(1));
  }
  return filepath;
}

/**
 * Parse provider from validated config
 */
function parseProvider(id: string, config: ProviderConfigInput): Provider {
  // Support both camelCase and snake_case variants
  const baseUrl = config.baseUrl || config.base_url || "";
  const apiKey = config.apiKey || config.api_key;
  const authHeader = config.authHeader || config.auth_header;
  const modelMap = config.modelMap || config.model_map;
  const vlModelMap = config.vlModelMap || config.vl_model_map;
  const providerType = (config.providerType || config.provider_type || "anthropic") as ProviderType;

  return {
    id,
    name: config.name || id,
    baseUrl,
    mode: config.mode as ProviderMode,
    providerType,
    apiKey,
    authHeader: authHeader || "authorization",
    modelMap: modelMap && modelMap.length > 0 ? modelMap : undefined,
    vlModelMap: vlModelMap && vlModelMap.length > 0 ? vlModelMap : undefined,
    headers: config.headers ?? {},
    enabled: config.enabled !== false,
  };
}

export class ConfigManager {
  private config: RouterConfig;
  private context: vscode.ExtensionContext;
  private disposables: vscode.Disposable[] = [];
  private configPath: string;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;

    // Get config path from vscode settings
    const vscodeConfig = vscode.workspace.getConfiguration("ccrelay");
    const configPathSetting = vscodeConfig.get<string>("configPath", "~/.ccrelay/config.yaml");
    this.configPath = expandPath(configPathSetting);

    // Ensure config file exists with defaults
    this.ensureConfigFile();

    // Load configuration
    this.config = this.loadConfig();

    // Watch for configuration changes
    const configWatcher = vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration("ccrelay.configPath")) {
        // Config path changed, reload everything
        const newPath = vscodeConfig.get<string>("configPath", "~/.ccrelay/config.yaml");
        this.configPath = expandPath(newPath);
        this.ensureConfigFile();
        this.config = this.loadConfig();
      }
    });
    this.disposables.push(configWatcher);
  }

  /**
   * Ensure config file exists, create with defaults if not
   */
  private ensureConfigFile(): void {
    const configDir = path.dirname(this.configPath);

    // Create directory if not exists
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    // Create config file if not exists
    if (!fs.existsSync(this.configPath)) {
      console.log(`[ConfigManager] Creating default config at ${this.configPath}`);
      fs.writeFileSync(this.configPath, DEFAULT_CONFIG_YAML, "utf-8");
      return;
    }

    // File exists, merge with defaults for missing fields
    try {
      const content = fs.readFileSync(this.configPath, "utf-8");
      const existingConfig = yaml.load(content);

      if (existingConfig && typeof existingConfig === "object") {
        const defaults = getDefaultConfig();
        const merged = deepMerge(defaults, existingConfig as Partial<FileConfigInput>);

        // Only rewrite if there are new fields added
        if (JSON.stringify(merged) !== JSON.stringify(existingConfig)) {
          console.log(`[ConfigManager] Merging new default fields into ${this.configPath}`);
          // Preserve comments by not overwriting if user has a customized file
          // For now, we just use the merged config without rewriting the file
          // This allows users to keep their comments
        }
      }
    } catch (err) {
      console.error(`[ConfigManager] Error reading config file:`, err);
    }
  }

  /**
   * Load and parse configuration from yaml file
   */
  private loadConfig(): RouterConfig {
    console.log(`[ConfigManager] Loading config from ${this.configPath}`);

    // Load from file
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

    // Merge with defaults
    const defaults = getDefaultConfig();
    const merged = deepMerge(defaults, fileConfig);

    // Build providers map
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

    // Build concurrency config
    let concurrency: ConcurrencyConfig | undefined;
    if (merged.concurrency?.enabled) {
      // Build retry429 config with defaults
      let retry429: Retry429Config | undefined;
      if (merged.concurrency.retry429) {
        retry429 = {
          enabled: merged.concurrency.retry429.enabled ?? false,
          maxRetries: merged.concurrency.retry429.maxRetries ?? 3,
          delayMs: merged.concurrency.retry429.delayMs ?? 1000,
        };
      } else {
        // Default retry429 config
        retry429 = {
          enabled: false,
          maxRetries: 3,
          delayMs: 1000,
        };
      }

      concurrency = {
        enabled: true,
        maxWorkers: merged.concurrency.maxWorkers || 3,
        maxQueueSize: merged.concurrency.maxQueueSize,
        requestTimeout: merged.concurrency.requestTimeout,
        retry429,
      };
    }

    // Build route queues config
    let routeQueues: RouteQueueConfig[] | undefined;
    const routes = merged.concurrency?.routes;
    if (routes && routes.length > 0) {
      routeQueues = routes.map((route, index) => {
        let compiledPattern: RegExp;
        try {
          compiledPattern = new RegExp(route.pattern);
        } catch {
          console.warn(
            `[ConfigManager] Invalid regex pattern "${route.pattern}" at index ${index}`
          );
          compiledPattern = /^$/; // Match nothing on error
        }
        return {
          pattern: route.pattern,
          maxWorkers: route.maxWorkers ?? 10,
          maxQueueSize: route.maxQueueSize,
          requestTimeout: route.requestTimeout,
          name: route.name,
          compiledPattern,
        };
      });
    }

    // Build database config
    let database: DatabaseConfig | undefined;
    if (merged.logging?.enabled && merged.logging?.database) {
      const db = merged.logging.database;
      if (db.type === "postgres") {
        database = {
          type: "postgres",
          host: db.host || "localhost",
          port: db.port || 5432,
          name: db.name || "ccrelay",
          user: db.user || "",
          password: db.password,
          ssl: db.ssl ?? false,
        };
      } else {
        database = {
          type: "sqlite",
          path: db.path || undefined,
        };
      }
    }

    // Build routing config
    const routing = {
      proxy: merged.routing?.proxy || ["/v1/messages", "/messages"],
      passthrough: merged.routing?.passthrough || ["/v1/users/*", "/v1/organizations/*"],
      block: (merged.routing?.block || []).map(
        (b): BlockPattern => ({
          path: b.path,
          response: b.response || "",
          code: b.code ?? 200,
        })
      ),
      openaiBlock: (merged.routing?.openaiBlock || []).map(
        (b): BlockPattern => ({
          path: b.path,
          response: b.response || "",
          code: b.code ?? 200,
        })
      ),
    };

    return {
      port: merged.server?.port || 7575,
      host: merged.server?.host || "127.0.0.1",
      autoStart: merged.server?.autoStart ?? true,
      defaultProvider: merged.defaultProvider || "official",
      providers,
      routing,
      concurrency,
      routeQueues,
      logging: {
        enabled: merged.logging?.enabled ?? false,
        database,
      },
    };
  }

  /**
   * Reload configuration from file
   */
  reload(): void {
    console.log("[ConfigManager] Reloading configuration...");
    this.ensureConfigFile();
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

  get autoStart(): boolean {
    return this.config.autoStart;
  }

  get routing() {
    return this.config.routing;
  }

  get routePatterns(): string[] {
    return this.config.routing.proxy;
  }

  get passthroughPatterns(): string[] {
    return this.config.routing.passthrough;
  }

  get blockPatterns(): BlockPattern[] {
    return this.config.routing.block;
  }

  get openaiBlockPatterns(): BlockPattern[] {
    return this.config.routing.openaiBlock;
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
  getConfigPath(): string {
    return this.configPath;
  }

  /**
   * Get the config directory path
   */
  getConfigDir(): string {
    return path.dirname(this.configPath);
  }

  /**
   * Check if config file exists
   */
  configExists(): boolean {
    return fs.existsSync(this.configPath);
  }

  /**
   * Add a new provider to the config file
   */
  addProvider(id: string, config: ProviderConfigInput): boolean {
    try {
      // Validate the provider config
      const result = ProviderConfigSchema.safeParse(config);
      if (!result.success) {
        console.error("[ConfigManager] Provider validation failed:", result.error.format());
        return false;
      }

      // Read current file content
      const content = fs.readFileSync(this.configPath, "utf-8");
      const rawConfig = yaml.load(content) as Record<string, unknown>;

      // Ensure providers object exists
      if (!rawConfig.providers) {
        rawConfig.providers = {};
      }

      // Add the new provider (use snake_case for file)
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
        enabled: config.enabled,
      };

      // Write back to file
      const yamlContent = yaml.dump(rawConfig, {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
        quotingType: '"',
        forceQuotes: false,
      });
      fs.writeFileSync(this.configPath, yamlContent, "utf-8");

      // Reload in-memory config
      this.reload();

      return true;
    } catch (err) {
      console.error("[ConfigManager] Failed to add provider:", err);
      return false;
    }
  }

  /**
   * Delete a provider from the config file
   */
  deleteProvider(id: string): boolean {
    try {
      // Don't allow deleting the official provider
      if (id === "official") {
        console.error("[ConfigManager] Cannot delete the official provider");
        return false;
      }

      // Read current file content
      const content = fs.readFileSync(this.configPath, "utf-8");
      const rawConfig = yaml.load(content) as Record<string, unknown>;

      // Check if provider exists
      const providers = rawConfig.providers as Record<string, unknown> | undefined;
      if (!providers || !providers[id]) {
        console.error(`[ConfigManager] Provider "${id}" not found`);
        return false;
      }

      // Delete the provider
      delete providers[id];

      // If deleted provider was default, update default to official
      if (rawConfig.defaultProvider === id) {
        rawConfig.defaultProvider = "official";
      }

      // Write back to file
      const yamlContent = yaml.dump(rawConfig, {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
      });
      fs.writeFileSync(this.configPath, yamlContent, "utf-8");

      // Reload in-memory config
      this.reload();

      return true;
    } catch (err) {
      console.error("[ConfigManager] Failed to delete provider:", err);
      return false;
    }
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
