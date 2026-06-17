import { describe, expect, it } from "vitest";
import { buildDatabaseConfig } from "@/config/builders/database";

describe("buildDatabaseConfig", () => {
  it("returns undefined when logging is missing", () => {
    expect(buildDatabaseConfig(undefined)).toBeUndefined();
  });

  it("returns undefined when database missing", () => {
    expect(buildDatabaseConfig({ enabled: false })).toBeUndefined();
    expect(buildDatabaseConfig({ enabled: true })).toBeUndefined();
  });

  it("builds sqlite config when database present even if logging disabled", () => {
    expect(
      buildDatabaseConfig({ enabled: false, database: { type: "sqlite", path: "/tmp/x.db" } })
    ).toEqual({ type: "sqlite", path: "/tmp/x.db" });
  });

  it("builds sqlite config with optional executable", () => {
    expect(
      buildDatabaseConfig({
        enabled: true,
        database: { type: "sqlite", path: "/tmp/x.db", sqlite3Executable: " /bin/sqlite3 " },
      })
    ).toEqual({ type: "sqlite", path: "/tmp/x.db", sqlite3Executable: "/bin/sqlite3" });
  });

  it("builds sqlite config with driver", () => {
    expect(
      buildDatabaseConfig({
        enabled: true,
        database: { type: "sqlite", driver: "native" },
      })
    ).toEqual({ type: "sqlite", path: undefined, driver: "native" });
  });

  it("builds postgres with defaults", () => {
    expect(
      buildDatabaseConfig({
        enabled: true,
        database: {
          type: "postgres",
          host: "localhost",
          port: 5432,
          name: "appdb",
          user: "u",
          ssl: false,
        },
      })
    ).toEqual({
      type: "postgres",
      host: "localhost",
      port: 5432,
      name: "appdb",
      user: "u",
      password: undefined,
      ssl: false,
    });
  });
});
