import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchServerStatus,
  isServerUnreachableHttpStatus,
  probeServerReachable,
  STOPPED_SERVER_STATUS,
} from "../../../web/src/api/serverReachability";

describe("serverReachability", () => {
  beforeEach(() => {
    /* eslint-disable @typescript-eslint/naming-convention -- mirrors window injection keys */
    vi.stubGlobal("window", {
      CCRELAY_API_URL: undefined,
      CCRELAY_API_BEARER: "",
    });
    /* eslint-enable @typescript-eslint/naming-convention */
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("isServerUnreachableHttpStatus treats 503 and 5xx gateway errors as unreachable", () => {
    expect(isServerUnreachableHttpStatus(503)).toBe(true);
    expect(isServerUnreachableHttpStatus(502)).toBe(true);
    expect(isServerUnreachableHttpStatus(504)).toBe(true);
    expect(isServerUnreachableHttpStatus(401)).toBe(false);
    expect(isServerUnreachableHttpStatus(200)).toBe(false);
  });

  it("probeServerReachable returns true when status endpoint responds ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: "running" }),
      })
    );

    await expect(probeServerReachable()).resolves.toBe(true);
  });

  it("probeServerReachable returns false on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(probeServerReachable()).resolves.toBe(false);
  });

  it("fetchServerStatus returns stopped snapshot when API is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(fetchServerStatus()).resolves.toEqual(STOPPED_SERVER_STATUS);
  });

  it("fetchServerStatus returns stopped snapshot for 503", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ error: "not ready" }),
      })
    );

    await expect(fetchServerStatus()).resolves.toEqual(STOPPED_SERVER_STATUS);
  });
});
