/**
 * Display order for partner vendors (wizard “合作商” / Partners).
 */

/** Partner preset ids in preferred UI order. */
export const PARTNER_PRESET_DISPLAY_ORDER = [
  "glm",
  "xiaomi",
  "deepseek",
  "minimax",
  "azure-openai",
  "gemini-openai",
  "astraflow",
  "tuning-engines",
] as const;

export function partnerPresetSortIndex(presetId: string): number {
  const i = PARTNER_PRESET_DISPLAY_ORDER.indexOf(
    presetId as (typeof PARTNER_PRESET_DISPLAY_ORDER)[number]
  );
  return i === -1 ? PARTNER_PRESET_DISPLAY_ORDER.length : i;
}
