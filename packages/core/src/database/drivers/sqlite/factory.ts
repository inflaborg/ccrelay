/**
 * SQLite driver factory for the database worker (native vs CLI selection).
 */

import { SqliteCliDriver } from "./cli";
import { SqliteNativeDriver } from "./native";
import { Logger } from "../../../utils/logger";
import type { SqliteDriverConfig, DatabaseDriver } from "../../types";

const log = Logger.getInstance();

/** Create a SQLite driver instance without initializing (call {@link DatabaseDriver.initialize} next). */
export function createSqliteDriver(config: SqliteDriverConfig): DatabaseDriver {
  if (config.driver === "cli") {
    return new SqliteCliDriver(config);
  }

  if (config.driver === "native") {
    return new SqliteNativeDriver(config);
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("better-sqlite3") as typeof import("better-sqlite3");
    return new SqliteNativeDriver(config);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log.warn(`[DatabaseWorker] Native driver unavailable, will use CLI: ${detail}`);
    return new SqliteCliDriver(config);
  }
}
