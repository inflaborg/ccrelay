import * as yaml from "js-yaml";
import { FileConfigSchema, type BlockRule, type FileConfigInput, type ForwardRule } from "../types";

export const CONFIG_VERSION = "0.2.0";

// Default config with comments template
export const DEFAULT_CONFIG_YAML = `# CCRelay Configuration
# Docs: https://github.com/inflaborg/ccrelay#configuration
configVersion: "${CONFIG_VERSION}"

# ==================== Server Configuration ====================
server:
  port: 7575                    # Proxy server port
  host: "127.0.0.1"             # Bind address
  autoStart: true               # Auto-start server when extension loads
  # apiBearerToken: (optional — auto-generated and written on first load if omitted)

# ==================== Provider Configuration ====================
providers:
  official:
    name: "Claude Official"
    baseUrl: "https://api.anthropic.com"
    mode: "passthrough"         # passthrough | inject
    providerType: "anthropic"   # anthropic | openai | openai_chat
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
  #     - { pattern: "claude-*", model: "custom-model" }
  #   model_mapping_enabled: false   # optional: keep maps in config but disable remap (default: true)
  #   enabled: true

# Default provider ID
defaultProvider: "official"

# ==================== Routing Configuration ====================
routing:
  # Forward rules: path → provider mapping. First match wins.
  # provider: "auto" = current active provider; or a specific provider ID.
  # Unmatched paths return 404.
  forward:
    - path: "/v1/messages"
      provider: "auto"
    - path: "/v1/chat/completions"
      provider: "auto"
    - path: "/v1/responses"
      provider: "auto"
    - path: "/v1/models"
      provider: "auto"
    - path: "/v1/messages/count_tokens"
      provider: "auto"
    # OpenAI-prefixed — base URL e.g. http://127.0.0.1:7575/openai (SDK path rewritten upstream)
    - path: "/openai/chat/completions"
      provider: "auto"
    - path: "/openai/responses"
      provider: "auto"
    - path: "/openai/models"
      provider: "auto"
    # Anthropic-prefixed — base URL e.g. http://127.0.0.1:7575/anthropic
    - path: "/anthropic/v1/messages"
      provider: "auto"
    - path: "/anthropic/v1/models"
      provider: "auto"
    - path: "/anthropic/v1/messages/count_tokens"
      provider: "auto"

  # Block rules: return custom response instead of forwarding.
  # Checked before forward. Optional condition.providers: rule applies only when current provider id is in the list (allowlist).
  # Optional condition.providerNot: skip when current id is in the list.
  block:
    - path: "/api/event_logging/*"
      response: ""
      code: 200
    - path: "/v1/messages/count_tokens"
      response: '{"input_tokens": 0}'
      code: 200
    - path: "/v1/users/*"
      condition:
        providerNot: ["official"]
      response: ""
      code: 200
    - path: "/v1/organizations/*"
      condition:
        providerNot: ["official"]
      response: ""
      code: 200
    - path: "/anthropic/v1/users/*"
      condition:
        providerNot: ["official"]
      response: ""
      code: 200
    - path: "/anthropic/v1/organizations/*"
      condition:
        providerNot: ["official"]
      response: ""
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
    # Optional sqlite3 CLI path; empty = resolve from PATH only
    # sqlite3_executable: ""

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
export function getDefaultConfig(): FileConfigInput {
  const parsed = yaml.load(DEFAULT_CONFIG_YAML);
  return FileConfigSchema.parse(parsed);
}

/** Bundled forward + block rules from `DEFAULT_CONFIG_YAML` (Settings “restore routing defaults”). */
export function getDefaultRoutingSettings(): {
  forward: ForwardRule[];
  block: BlockRule[];
} {
  const d = getDefaultConfig();
  const r = d.routing;
  return {
    forward: [...(r?.forward ?? [])],
    block: [...(r?.block ?? [])],
  };
}
