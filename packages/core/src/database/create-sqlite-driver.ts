/**
 * SQLite driver factory for the database worker (native vs CLI selection).
 */

import { SqliteCliDriver } from "./drivers/sqlite-cli";
import { SqliteNativeDriver } from "./drivers/sqlite-native";
import { Logger } from "../utils/logger";
import type { SqliteDriverConfig, DatabaseDriver } from "./types";

const log = Logger.getInstance();

export async function createSqliteDriver(config: SqliteDriverConfig): Promise<DatabaseDriver> {
  if (config.driver === "cli") {
    const d = new SqliteCliDriver(config);
    await d.initialize();
    return d;
  }

  const tryNative = async (): Promise<DatabaseDriver> => {
    const d = new SqliteNativeDriver(config);
    await d.initialize();
    return d;
  };

  if (config.driver === "native") {
    return tryNative();
  }

  try {
    return await tryNative();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log.warn(`[DatabaseWorker] Native driver unavailable, falling back to CLI: ${detail}`);
    const d = new SqliteCliDriver(config);
    await d.initialize();
    return d;
  }
}
