import { describe, expect, it } from "vitest";
import {
  defaultModelIdsAsText,
  getPresetById,
  upstreamModelIdToDisplayName,
} from "../../../web/src/features/providers/wizard/presets";

describe("upstreamModelIdToDisplayName", () => {
  it("formats GLM-style ids", () => {
    expect(upstreamModelIdToDisplayName("glm-5.1")).toBe("GLM 5.1");
    expect(upstreamModelIdToDisplayName("glm-5-turbo")).toBe("GLM 5 Turbo");
    expect(upstreamModelIdToDisplayName("glm-4.7")).toBe("GLM 4.7");
  });

  it("formats MiMo and GPT ids", () => {
    expect(upstreamModelIdToDisplayName("mimo-v2.5-pro")).toBe("MiMo V2.5 Pro");
    expect(upstreamModelIdToDisplayName("gpt-5.4-mini")).toBe("GPT 5.4 Mini");
  });

  it("preserves mixed-case brand segments", () => {
    expect(upstreamModelIdToDisplayName("MiniMax-M2.7")).toBe("MiniMax M2.7");
  });

  it("formats Gemini preview ids", () => {
    expect(upstreamModelIdToDisplayName("gemini-3.1-pro-preview")).toBe("Gemini 3.1 Pro Preview");
  });
});

describe("defaultModelIdsAsText", () => {
  it("expands GLM preset with id;display lines", () => {
    const p = getPresetById("glm");
    expect(p).toBeDefined();
    const text = defaultModelIdsAsText(p!);
    expect(text).toBe("glm-5.1;GLM 5.1\nglm-5-turbo;GLM 5 Turbo\nglm-4.7;GLM 4.7");
  });

  it("keeps explicit display name after semicolon", () => {
    const p = getPresetById("glm");
    expect(p).toBeDefined();
    const custom = {
      ...p!,
      defaultModelIds: ["glm-5.1;My Label", "glm-4.7"],
    };
    expect(defaultModelIdsAsText(custom)).toBe("glm-5.1;My Label\nglm-4.7;GLM 4.7");
  });

  it("fills empty display segment from id", () => {
    const p = getPresetById("glm");
    expect(p).toBeDefined();
    const custom = { ...p!, defaultModelIds: ["glm-5.1;"] };
    expect(defaultModelIdsAsText(custom)).toBe("glm-5.1;GLM 5.1");
  });
});
