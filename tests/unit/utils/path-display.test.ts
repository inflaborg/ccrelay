import { describe, expect, it } from "vitest";
import { redactHomeInPath } from "@/utils/path-display";

describe("redactHomeInPath", () => {
  it("replaces homedir prefix with $HOME on unix", () => {
    expect(
      redactHomeInPath("/Users/alice/.claude/settings.json", {
        home: "/Users/alice",
        platform: "darwin",
      })
    ).toBe("$HOME/.claude/settings.json");
    expect(
      redactHomeInPath(
        "/Users/alice/Library/Application Support/Claude-3p/configLibrary/uuid.json",
        { home: "/Users/alice", platform: "darwin" }
      )
    ).toBe("$HOME/Library/Application Support/Claude-3p/configLibrary/uuid.json");
  });

  it("replaces homedir prefix with %HOME% on windows", () => {
    expect(
      redactHomeInPath("C:\\Users\\alice\\.claude\\settings.json", {
        home: "C:\\Users\\alice",
        platform: "win32",
      })
    ).toBe("%HOME%\\.claude\\settings.json");
  });

  it("returns path unchanged when outside homedir", () => {
    expect(
      redactHomeInPath("/etc/hosts", {
        home: "/Users/alice",
        platform: "darwin",
      })
    ).toBe("/etc/hosts");
  });
});
