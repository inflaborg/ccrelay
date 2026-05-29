import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getBuildVersionInfo } = vi.hoisted(() => ({
  getBuildVersionInfo: vi.fn(() => ({
    version: "0.2.5",
    packageVersion: "0.2.5",
    date: "2026-01-01",
    hash: "abc",
    gitHash: "def",
  })),
}));

vi.mock("@/api/version", () => ({
  getBuildVersionInfo,
}));

import {
  cancelUpdateCheck,
  getUpdateCheckState,
  requestUpdateCheck,
  runUpdateCheck,
  scheduleUpdateCheck,
} from "@/server/updateCheck";

function mockLatestRelease(payload: {
  // eslint-disable-next-line @typescript-eslint/naming-convention -- GitHub API field
  tag_name: string;
  prerelease?: boolean;
  draft?: boolean;
  // eslint-disable-next-line @typescript-eslint/naming-convention -- GitHub API field
  html_url?: string;
  body?: string;
}): void {
  mockFetch(url => {
    if (url.includes("/releases/latest")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(payload),
      });
    }
    return Promise.reject(new Error(`unexpected url: ${url}`));
  });
}

function mockFetch(
  handler: (url: string) => Promise<{
    ok: boolean;
    status?: number;
    json?: () => Promise<unknown>;
  }>
): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => handler(url))
  );
}

/* eslint-disable @typescript-eslint/naming-convention -- GitHub API response fixtures */
describe("updateCheck", () => {
  beforeEach(() => {
    cancelUpdateCheck();
    getBuildVersionInfo.mockReturnValue({
      version: "0.2.5",
      packageVersion: "0.2.5",
      date: "2026-01-01",
      hash: "abc",
      gitHash: "def",
    });
  });

  afterEach(() => {
    cancelUpdateCheck();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("starts in pending state", () => {
    expect(getUpdateCheckState().status).toBe("pending");
    expect(getUpdateCheckState().currentVersion).toBe("0.2.5");
  });

  it("reports available when latest release is newer than current", async () => {
    getBuildVersionInfo.mockReturnValue({
      version: "0.2.3",
      packageVersion: "0.2.3",
      date: "2026-01-01",
      hash: "abc",
      gitHash: "def",
    });
    mockLatestRelease({
      tag_name: "v0.2.4",
      prerelease: false,
      html_url: "https://github.com/inflaborg/ccrelay/releases/tag/v0.2.4",
      body: "## What's Changed\n- Feature",
    });

    await runUpdateCheck();

    const state = getUpdateCheckState();
    expect(state.status).toBe("available");
    expect(state.latestVersion).toBe("0.2.4");
    expect(state.releaseUrl).toContain("v0.2.4");
    expect(state.releaseNotes).toContain("What's Changed");
    expect(state.checkedAt).toBeDefined();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("reports idle when latest release is not newer (ignores main bump)", async () => {
    mockLatestRelease({
      tag_name: "v0.2.4",
      prerelease: false,
      html_url: "https://github.com/inflaborg/ccrelay/releases/tag/v0.2.4",
      body: "",
    });

    await runUpdateCheck();
    expect(getUpdateCheckState().status).toBe("idle");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("reports idle when current is ahead of latest release", async () => {
    getBuildVersionInfo.mockReturnValue({
      version: "0.2.6",
      packageVersion: "0.2.6",
      date: "2026-01-01",
      hash: "abc",
      gitHash: "def",
    });
    mockLatestRelease({
      tag_name: "v0.2.4",
      prerelease: false,
    });

    await runUpdateCheck();
    expect(getUpdateCheckState().status).toBe("idle");
  });

  it("reports idle when latest release endpoint returns 404", async () => {
    mockFetch(() => Promise.resolve({ ok: false, status: 404 }));

    await runUpdateCheck();
    expect(getUpdateCheckState().status).toBe("idle");
  });

  it("reports idle when latest release is prerelease", async () => {
    mockLatestRelease({
      tag_name: "v0.2.6",
      prerelease: true,
    });

    await runUpdateCheck();
    expect(getUpdateCheckState().status).toBe("idle");
  });

  it("reports idle when fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network")))
    );

    await runUpdateCheck();
    expect(getUpdateCheckState().status).toBe("idle");
  });

  it("scheduleUpdateCheck runs after 60s", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/releases/latest")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              tag_name: "v0.2.5",
              prerelease: false,
            }),
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    scheduleUpdateCheck();
    expect(getUpdateCheckState().status).toBe("pending");

    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() => expect(getUpdateCheckState().status).toBe("idle"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("requestUpdateCheck runs immediately and cancels scheduled timer", async () => {
    vi.useFakeTimers();
    mockLatestRelease({
      tag_name: "v0.2.5",
      prerelease: false,
    });

    scheduleUpdateCheck();
    const state = await requestUpdateCheck();

    expect(state.status).toBe("idle");
    expect(state.checkedAt).toBeDefined();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("cancelUpdateCheck clears scheduled timer", async () => {
    vi.useFakeTimers();
    mockLatestRelease({
      tag_name: "v0.2.6",
      prerelease: false,
    });

    scheduleUpdateCheck();
    cancelUpdateCheck();

    await vi.advanceTimersByTimeAsync(120_000);
    expect(getUpdateCheckState().status).toBe("pending");
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("scheduleUpdateCheck runs again after 24h interval", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/releases/latest")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              tag_name: "v0.2.5",
              prerelease: false,
            }),
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    scheduleUpdateCheck();
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("updates available state when a newer release is found on recheck", async () => {
    getBuildVersionInfo.mockReturnValue({
      version: "0.2.3",
      packageVersion: "0.2.3",
      date: "2026-01-01",
      hash: "abc",
      gitHash: "def",
    });

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementationOnce(() =>
          Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                tag_name: "v0.2.4",
                prerelease: false,
                html_url: "https://github.com/inflaborg/ccrelay/releases/tag/v0.2.4",
                body: "Notes for 0.2.4",
              }),
          })
        )
        .mockImplementationOnce(() =>
          Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                tag_name: "v0.2.5",
                prerelease: false,
                html_url: "https://github.com/inflaborg/ccrelay/releases/tag/v0.2.5",
                body: "Notes for 0.2.5",
              }),
          })
        )
    );

    await runUpdateCheck();
    expect(getUpdateCheckState().latestVersion).toBe("0.2.4");
    expect(getUpdateCheckState().releaseNotes).toContain("0.2.4");

    await runUpdateCheck();
    const state = getUpdateCheckState();
    expect(state.status).toBe("available");
    expect(state.latestVersion).toBe("0.2.5");
    expect(state.releaseNotes).toContain("0.2.5");
  });
});
