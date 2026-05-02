/**
 * Database driver factory
 * Creates driver instances based on configuration
 */

import type { DatabaseDriver, DatabaseDriverConfig } from "./types";
import { SqliteCliDriver, PostgresDriver } from "./drivers";
import { DatabaseWorkerClient } from "./database-worker-client";

// Check if running in test environment (vitest sets this)
const isTestEnvironment = process.env.VITEST === "true" || process.env.NODE_ENV === "test";

/**
 * Factory function for creating database driver instances
 * @param config Database configuration
 */
export function createDriver(config: DatabaseDriverConfig): DatabaseDriver {
  // SQLite uses worker thread for event loop isolation (except in test environment)
  // In tests, we use SqliteCliDriver directly since worker bundle doesn't exist
  if (config.type === "sqlite") {
    if (isTestEnvironment) {
      return new SqliteCliDriver(config);
    }
    return new DatabaseWorkerClient(config);
  }

  switch (config.type) {
    case "postgres":
      return new PostgresDriver(config);
    default: {
      // TypeScript exhaustiveness check
      const exhaustive: never = config;
      throw new Error(`Unknown database type: ${String(exhaustive)}`);
    }
  }
}
