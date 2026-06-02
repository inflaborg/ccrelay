/**
 * Display order for partner vendors (wizard “合作商” / Partners) and provider list grouping.
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

/** Lower rank sorts earlier (after `official` and enabled-state groups). */
export function providerVendorSortRank(provider: { id: string; name: string }): number {
  const id = provider.id.toLowerCase();
  const name = provider.name.toLowerCase();

  const matches = (needles: readonly string[]): boolean =>
    needles.some(
      n =>
        id === n ||
        id.startsWith(`${n}-`) ||
        id.startsWith(`${n}_`) ||
        id.includes(`-${n}-`) ||
        id.includes(`-${n}_`) ||
        name.includes(n)
    );

  if (provider.id === "official") {
    return 0;
  }
  if (matches(["glm", "z.ai", "bigmodel", "智谱"])) {
    return 10;
  }
  if (matches(["mimo", "xiaomi", "xiaomimimo", "小米"])) {
    return 20;
  }
  if (matches(["deepseek"])) {
    return 30;
  }
  if (matches(["minimax", "minimaxi"])) {
    return 40;
  }
  if (matches(["azure"])) {
    return 50;
  }
  if (matches(["openai"]) && !matches(["azure"])) {
    return 60;
  }
  if (matches(["gemini", "generativelanguage"])) {
    return 70;
  }
  if (matches(["astraflow", "umodelverse", "modelverse"])) {
    return 80;
  }
  if (matches(["tuning-engines", "tuningengines"])) {
    return 90;
  }
  return 1000;
}
