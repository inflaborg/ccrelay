import { describe, expect, it } from "vitest";
import { PARTNER_PRESETS } from "../../../web/src/features/providers/wizard/presets";
import { PARTNER_PRESET_DISPLAY_ORDER } from "../../../web/src/features/providers/providerSortOrder";

describe("PARTNER_PRESETS display order", () => {
  it("matches product partner vendor order", () => {
    expect(PARTNER_PRESETS.map(p => p.id)).toEqual([...PARTNER_PRESET_DISPLAY_ORDER]);
  });
});
