import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const probeMock = vi.fn<(host: string, port: number, timeoutMs: number) => Promise<boolean>>();

const fakeLock = {
  release: vi.fn(() => Promise.resolve()),
  close: vi.fn(() => Promise.resolve()),
  updateHeartbeat: vi.fn(() => Promise.resolve()),
  getCurrentLeader: vi.fn(() =>
    Promise.resolve({
      instanceId: "4242-other",
      pid: 4242,
      port: 7575,
      host: "127.0.0.1",
      startTime: 0,
      lastHeartbeat: 0,
    })
  ),
  cleanupStaleLocks: vi.fn(() => Promise.resolve()),
  invalidateInheritedLeaderIfHttpDown: vi.fn(() => Promise.resolve()),
};

vi.mock("@/server/httpLeaderProbe", () => ({
  probeCcrelayHttp: (host: string, port: number, timeoutMs: number) =>
    probeMock(host, port, timeoutMs),
  setLeaderHttpProbeBearer: vi.fn(),
}));

vi.mock("@/server/serverLock", () => ({
  getServerLock: () => fakeLock,
}));

import { LeaderElection, describePortConflict } from "@/server/leaderElection";
import type { RoleChangeInfo } from "@/types";

const HEARTBEAT_MS = 3_000;

function activeLeader(): LeaderElection {
  const election = new LeaderElection(7575, "127.0.0.1", () => "");
  (election as unknown as { role: string }).role = "leader";
  election.notifyServerStarted();
  return election;
}

async function tick(): Promise<void> {
  await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
}

describe("LeaderElection self-probe tolerance", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    probeMock.mockReset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses a 2s timeout and keeps leadership through transient probe failures", async () => {
    const election = activeLeader();
    probeMock.mockResolvedValue(false);

    await tick();
    await tick();

    expect(probeMock).toHaveBeenCalledWith("127.0.0.1", 7575, 2_000);
    expect(election.getState()).toBe("leader_active");
    expect(fakeLock.release).not.toHaveBeenCalled();
    // Lock heartbeat continues during the grace period.
    expect(fakeLock.updateHeartbeat).toHaveBeenCalledTimes(2);
    await election.stop();
  });

  it("resets the failure count after a successful probe", async () => {
    const election = activeLeader();
    probeMock
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);

    for (let i = 0; i < 5; i++) {
      await tick();
    }

    expect(election.getState()).toBe("leader_active");
    expect(fakeLock.release).not.toHaveBeenCalled();
    await election.stop();
  });

  it("self-evicts after three consecutive failures", async () => {
    const election = activeLeader();
    const changes: RoleChangeInfo[] = [];
    election.onRoleChanged(info => changes.push(info));
    probeMock.mockResolvedValue(false);

    await tick();
    await tick();
    await tick();

    expect(election.getState()).toBe("waiting");
    expect(election.getRole()).toBe("follower");
    expect(fakeLock.release).toHaveBeenCalledTimes(1);
    expect(changes.at(-1)?.role).toBe("follower");
    await election.stop();
  });

  it("does not overlap heartbeat ticks while a probe is still pending", async () => {
    const election = activeLeader();
    let resolveProbe: (up: boolean) => void = () => {};
    probeMock.mockImplementationOnce(
      () =>
        new Promise<boolean>(resolve => {
          resolveProbe = resolve;
        })
    );

    await tick();
    await tick();
    expect(probeMock).toHaveBeenCalledTimes(1);

    resolveProbe(true);
    probeMock.mockResolvedValue(true);
    await tick();
    expect(probeMock).toHaveBeenCalledTimes(2);
    await election.stop();
  });
});

describe("LeaderElection port conflict reporting", () => {
  beforeEach(() => {
    probeMock.mockReset();
    vi.clearAllMocks();
  });

  it("records the last leader PID when the port is held but HTTP is silent", async () => {
    const election = new LeaderElection(7575, "127.0.0.1", () => "");
    probeMock.mockResolvedValue(false);

    const result = await election.handlePortConflict();
    expect(result.becameFollower).toBe(false);
    expect(probeMock).toHaveBeenCalledWith("127.0.0.1", 7575, 2_000);

    for (let i = 0; i < 3; i++) {
      election.recordLeadershipFailure();
    }
    expect(election.hasExternalPortConflict()).toBe(true);

    const conflict = election.getPortConflict();
    expect(conflict).toEqual({ host: "127.0.0.1", port: 7575, holderPid: 4242 });
    expect(describePortConflict(conflict)).toContain("PID 4242");
  });

  it("describes an unknown holder as another process", () => {
    expect(describePortConflict({ host: "127.0.0.1", port: 7575 })).toContain("another process");
  });
});
