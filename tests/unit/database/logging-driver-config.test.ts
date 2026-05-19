import { describe, it, expect } from "vitest";
import * as os from "os";
import * as path from "path";
import { loggingDatabaseConfigToDriver } from "@/database/logging-driver-config";

describe("loggingDatabaseConfigToDriver", () => {
  it("returns undefined when database config is absent", () => {
    expect(loggingDatabaseConfigToDriver(undefined)).toBeUndefined();
  });

  it("sqlite: uses default ~/.ccrelay/logs.db when path empty", () => {
    const expected = path.join(os.homedir(), ".ccrelay", "logs.db");
    expect(loggingDatabaseConfigToDriver({ type: "sqlite" })).toEqual({
      type: "sqlite",
      path: expected,
    });
  });

  it("sqlite: expands tilde path and passes sqlite3Executable", () => {
    const drv = loggingDatabaseConfigToDriver({
      type: "sqlite",
      path: "~/logs/cc.db",
      sqlite3Executable: "/opt/bin/sqlite3",
    });
    expect(drv).toEqual({
      type: "sqlite",
      path: path.join(os.homedir(), "logs/cc.db"),
      sqlite3Executable: "/opt/bin/sqlite3",
    });
  });

  it("sqlite: passes driver when set", () => {
    expect(loggingDatabaseConfigToDriver({ type: "sqlite", driver: "cli" })).toMatchObject({
      type: "sqlite",
      driver: "cli",
    });
  });

  it("postgres: maps name -> database field", () => {
    expect(
      loggingDatabaseConfigToDriver({
        type: "postgres",
        host: "h",
        port: 5432,
        name: "n",
        user: "u",
        password: "p",
        ssl: true,
      })
    ).toEqual({
      type: "postgres",
      host: "h",
      port: 5432,
      database: "n",
      user: "u",
      password: "p",
      ssl: true,
    });
  });
});
