/**
 * Configuration initializer for CCRelay
 * Automatically initializes default configuration values on first run
 */

import * as vscode from "vscode";

/**
 * Default configuration entry with key and value
 */
interface DefaultConfigEntry {
  key: string;
  value: unknown;
}

/**
 * Default configuration values to initialize
 * These will be written to user settings if not already set
 */
const DEFAULT_CONFIGS: DefaultConfigEntry[] = [
  {
    key: "route.blockPatterns",
    value: [
      {
        path: "/api/event_logging/*",
        response: "",
        responseCode: 200,
      },
    ],
  },
  {
    key: "route.passthroughPatterns",
    value: ["/v1/users/*", "/v1/organizations/*"],
  },
  {
    key: "route.patterns",
    value: ["/v1/messages", "/messages"],
  },
  {
    key: "route.openaiBlockPatterns",
    value: [
      {
        path: "/v1/messages/count_tokens",
        response: '{"input_tokens": 0}',
        responseCode: 200,
      },
    ],
  },
  {
    key: "concurrency.enabled",
    value: true,
  },
  {
    key: "concurrency.maxConcurrency",
    value: 3,
  },
  {
    key: "concurrency.routeQueues",
    value: [
      {
        pathPattern: "/v1/messages/count_tokens",
        maxConcurrency: 30,
        name: "count_tokens",
      },
    ],
  },
  {
    key: "database.type",
    value: "sqlite",
  },
  {
    key: "provider.list",
    value: {
      official: {
        name: "Claude Official",
        baseUrl: "https://api.anthropic.com",
        mode: "passthrough",
      },
    },
  },
  {
    key: "log.enableStorage",
    value: false,
  },
];

/**
 * Check if a configuration key has been set by the user
 * Returns true if any of the configuration targets have a value
 */
function isConfigSet(
  inspectResult: ReturnType<ReturnType<typeof vscode.workspace.getConfiguration>["inspect"]>
): boolean {
  return (
    inspectResult?.globalValue !== undefined ||
    inspectResult?.workspaceValue !== undefined ||
    inspectResult?.globalLanguageValue !== undefined ||
    inspectResult?.workspaceLanguageValue !== undefined
  );
}

/**
 * Initialize default configuration values
 * Only writes to settings if the configuration key is not already set
 */
export async function initializeDefaultConfig(): Promise<void> {
  const config = vscode.workspace.getConfiguration("ccrelay");

  for (const entry of DEFAULT_CONFIGS) {
    const inspectResult = config.inspect(entry.key);

    // Only initialize if the configuration is not set at any level
    if (!isConfigSet(inspectResult)) {
      try {
        await config.update(entry.key, entry.value, vscode.ConfigurationTarget.Global);
        console.log(`[ConfigInitializer] Initialized default value for: ccrelay.${entry.key}`);
      } catch (err) {
        console.error(`[ConfigInitializer] Failed to initialize ${entry.key}:`, err);
      }
    }
  }
}
