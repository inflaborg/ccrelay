import type { DatabaseConfig, LoggingConfigInput } from "../../types";

export function buildDatabaseConfig(
  logging: LoggingConfigInput | undefined
): DatabaseConfig | undefined {
  if (!logging?.enabled || !logging.database) {
    return undefined;
  }
  const db = logging.database;
  if (db.type === "postgres") {
    return {
      type: "postgres",
      host: db.host || "localhost",
      port: db.port || 5432,
      name: db.name || "ccrelay",
      user: db.user || "",
      password: db.password,
      ssl: db.ssl ?? false,
    };
  }
  const exe = typeof db.sqlite3Executable === "string" ? db.sqlite3Executable.trim() : "";
  return {
    type: "sqlite",
    path: db.path || undefined,
    ...(exe ? { sqlite3Executable: exe } : {}),
  };
}
