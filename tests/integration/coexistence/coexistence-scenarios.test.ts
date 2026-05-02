import { describe, it } from "vitest";

/**
 * Leader election uses IPC (`ServerLock`) under `~/.ccrelay/` so any two processes
 * (VS Code extension host + Electron desktop) coordinate the same way.
 *
 * Full cross-process checks require running real Desktop + VS Code; automate later if needed.
 */
describe.skip("Coexistence (manual QA): Desktop app + VS Code extension", () => {
  it("Scenario A — Desktop starts first: desktop becomes leader and serves HTTP; extension joins as follower", () => {
    // Manual: npm run desktop:start, then open VS Code with CCRelay — only one listener on configured port.
  });

  it("Scenario B — Extension starts first: extension is leader; desktop is follower", () => {
    // Manual: open VS Code first, then launch desktop tray — follower connects WebSocket to leader.
  });

  it("Scenario C — Leader exits: remaining instance promotes and binds HTTP port", () => {
    // Manual: stop whichever process was leader; the other should become leader within probe/backoff window.
  });
});
