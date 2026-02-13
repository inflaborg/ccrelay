/**
 * Database driver factory
 * Creates driver instances based on configuration
 */

import type { DatabaseDriver, DatabaseDriverConfig } from "./types";
import { SqliteCliDriver, PostgresDriver } from "./drivers";

/**
 * Factory function for creating database driver instances
 */
export function createDriver(config: DatabaseDriverConfig): DatabaseDriver {
  switch (config.type) {
    case "sqlite":
      return new SqliteCliDriver(config);
    case "postgres":
      return new PostgresDriver(config);
    default: {
      // TypeScript exhaustiveness check
      const exhaustive: never = config;
      throw new Error(`Unknown database type: ${String(exhaustive)}`);
    }
  }
}
