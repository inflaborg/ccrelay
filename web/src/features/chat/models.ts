import type { Provider } from "@/types/api";
import { parseCustomModelLineForUi } from "@/features/providers/wizard/engine";
import type { ChatModelOption } from "./types";

function isWildcardPattern(pattern: string): boolean {
  return pattern.includes("*") || pattern.includes("?");
}

/**
 * Models from the active provider config (custom list → exact modelMap).
 * Empty when neither is configured — caller may fall back to GET /models.
 */
export function modelsFromProvider(provider: Provider | null | undefined): ChatModelOption[] {
  const seen = new Set<string>();
  const out: ChatModelOption[] = [];

  const push = (id: string, label?: string) => {
    const slug = id.trim();
    if (!slug || seen.has(slug)) {
      return;
    }
    seen.add(slug);
    const display = (label ?? "").trim();
    out.push({ id: slug, label: display && display !== slug ? `${display} (${slug})` : slug });
  };

  if (provider?.useCustomModelsList && provider.customModelsList?.length) {
    for (const line of provider.customModelsList) {
      const parsed = parseCustomModelLineForUi(line);
      if (parsed) {
        push(parsed.realId, parsed.displayName);
      }
    }
    return out;
  }

  if (provider?.customModelsList?.length) {
    for (const line of provider.customModelsList) {
      const parsed = parseCustomModelLineForUi(line);
      if (parsed) {
        push(parsed.realId, parsed.displayName);
      }
    }
    if (out.length > 0) {
      return out;
    }
  }

  if (provider?.modelMap && provider.modelMappingEnabled !== false) {
    for (const entry of provider.modelMap) {
      const pattern = entry.pattern?.trim() ?? "";
      if (!pattern || isWildcardPattern(pattern)) {
        continue;
      }
      push(pattern);
    }
  }

  return out;
}
