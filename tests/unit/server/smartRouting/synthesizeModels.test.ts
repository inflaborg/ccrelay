import { describe, expect, it } from "vitest";
import type { SmartRoutingCatalogEntry } from "@/types";
import {
  buildSmartRoutingModelDisplayName,
  synthesizeSmartRoutingModelsListBody,
} from "@/server/smartRouting/synthesizeModels";

function entry(
  partial: Partial<SmartRoutingCatalogEntry> &
    Pick<SmartRoutingCatalogEntry, "providerId" | "upstreamModelId">
): SmartRoutingCatalogEntry {
  return {
    publicId: `${partial.providerId}:${partial.upstreamModelId}`,
    aliasHash: "claude-deadbeef",
    protocol: "anthropic",
    source: "custom",
    fetchedAt: Date.now(),
    ...partial,
  };
}

describe("buildSmartRoutingModelDisplayName", () => {
  it("combines provider and model display names", () => {
    const label = buildSmartRoutingModelDisplayName(
      entry({
        providerId: "cn",
        providerDisplayName: "CN Gateway",
        upstreamModelId: "glm-5.1",
        displayName: "GLM 5.1",
      })
    );
    expect(label).toBe("CN Gateway · GLM 5.1");
  });

  it("falls back to ids when display names match ids", () => {
    const label = buildSmartRoutingModelDisplayName(
      entry({
        providerId: "cn",
        upstreamModelId: "glm-5.1",
      })
    );
    expect(label).toBe("cn · glm-5.1");
  });
});

describe("synthesizeSmartRoutingModelsListBody", () => {
  it("includes combined display_name in anthropic models list", () => {
    const body = synthesizeSmartRoutingModelsListBody({
      clientSurface: "anthropic",
      useAlias: false,
      entries: [
        entry({
          providerId: "cn",
          providerDisplayName: "CN",
          upstreamModelId: "glm-5.1",
          displayName: "GLM 5.1",
        }),
      ],
    });
    const parsed = JSON.parse(body) as { data: Array<Record<string, unknown>> };
    expect(parsed.data[0]?.id).toBe("cn:glm-5.1");
    expect(parsed.data[0]?.display_name).toBe("CN · GLM 5.1");
  });
});
