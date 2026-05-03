import { describe, it, expect } from "vitest";
import {
  hasRequiredUiGateHeader,
  isBearerAuthorized,
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
});
