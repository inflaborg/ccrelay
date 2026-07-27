import { describe, it, expect } from "vitest";
import {
  applyClientCorsHeaders,
  hasRequiredUiGateHeader,
  isBearerAuthorized,
  isUpstreamCorsHeaderName,
  timingSafeBearerEqual,
} from "@/server/httpAccessGate";
import { CCRELAY_UI_HEADER_NAME, CCRELAY_UI_HEADER_VALUE } from "@/server/internalUiHeaders";

describe("httpAccessGate", () => {
  it("hasRequiredUiGateHeader matches exact internal header", () => {
    expect(
      hasRequiredUiGateHeader({
        [CCRELAY_UI_HEADER_NAME.toLowerCase()]: CCRELAY_UI_HEADER_VALUE,
      })
    ).toBe(true);
    expect(hasRequiredUiGateHeader({})).toBe(false);
    expect(
      hasRequiredUiGateHeader({
        [CCRELAY_UI_HEADER_NAME.toLowerCase()]: "wrong",
      })
    ).toBe(false);
  });

  it("isBearerAuthorized validates Authorization Bearer", () => {
    const secret = "test-secret-token";
    expect(
      isBearerAuthorized(
        {
          authorization: `Bearer ${secret}`,
        },
        secret
      )
    ).toBe(true);
    expect(
      isBearerAuthorized(
        {
          authorization: `Bearer ${secret}x`,
        },
        secret
      )
    ).toBe(false);
    expect(isBearerAuthorized({}, secret)).toBe(false);
  });

  it("timingSafeBearerEqual rejects length mismatch", () => {
    expect(timingSafeBearerEqual("a", "ab")).toBe(false);
    expect(timingSafeBearerEqual("same", "same")).toBe(true);
  });

  it("isUpstreamCorsHeaderName detects CORS response headers", () => {
    expect(isUpstreamCorsHeaderName("Access-Control-Allow-Origin")).toBe(true);
    expect(isUpstreamCorsHeaderName("access-control-allow-credentials")).toBe(true);
    expect(isUpstreamCorsHeaderName("content-type")).toBe(false);
  });

  it("applyClientCorsHeaders sets CCRelay CORS for writeHead payloads", () => {
    const headers: Record<string, string | string[]> = {
      // eslint-disable-next-line @typescript-eslint/naming-convention -- HTTP header name
      "content-type": "text/event-stream",
    };
    applyClientCorsHeaders(headers);
    expect(headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(headers["Access-Control-Allow-Methods"]).toContain("POST");
    expect(String(headers["Access-Control-Allow-Headers"])).toContain("Authorization");
    expect(String(headers["Access-Control-Allow-Headers"])).toContain("anthropic-version");
  });
});
