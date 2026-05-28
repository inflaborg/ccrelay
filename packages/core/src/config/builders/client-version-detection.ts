import type { ClientVersionDetectionConfig, ClientVersionDetectionConfigInput } from "../../types";

export function buildClientVersionDetectionConfig(
  raw: ClientVersionDetectionConfigInput | undefined
): ClientVersionDetectionConfig {
  const parsed = raw ?? {};
  return {
    enabled: parsed.enabled ?? true,
  };
}
