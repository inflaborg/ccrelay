/**
 * Map RouterConfig-style logging.database to {@link DatabaseDriverConfig} for {@link LogDatabase}.
 */

import * as path from "path";
import * as os from "os";
import type { DatabaseConfig } from "../types";
import type { DatabaseDriverConfig } from "./types";

function expandLoggingDbPath(filepath: string): string {
  const trimmed = filepath.trim();
  if (trimmed.startsWith("~/")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  if (trimmed === "~") {
    return os.homedir();
  }
  return trimmed;
}

/** Returns driver config derived from persisted logging.database, or undefined to use builtin default SQLite (~/.ccrelay/logs.db). */
export function loggingDatabaseConfigToDriver(
  ldb: DatabaseConfig | undefined
): DatabaseDriverConfig | undefined {
  if (!ldb) {
    return undefined;
  }
  if (ldb.type === "postgres") {
    return {
      type: "postgres",
      host: ldb.host,
      port: ldb.port,
      database: ldb.name,
      user: ldb.user,
      password: ldb.password ?? "",
      ssl: ldb.ssl,
    };
  }
  const defaultPath = path.join(os.homedir(), ".ccrelay", "logs.db");
  const raw = ldb.path?.trim();
  const dbPath = raw ? expandLoggingDbPath(raw) : defaultPath;
  const exe = ldb.sqlite3Executable?.trim();
  const driver =
    ldb.driver === "auto" || ldb.driver === "native" || ldb.driver === "cli"
      ? ldb.driver
      : undefined;
  return {
    type: "sqlite",
    path: dbPath,
    ...(exe ? { sqlite3Executable: exe } : {}),
    ...(driver ? { driver } : {}),
  };
}
