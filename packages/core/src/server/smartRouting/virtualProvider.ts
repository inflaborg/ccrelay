import type { Provider } from "../../types";

/** Synthetic provider id used in logs when smart routing serves GET /models locally. */
export const SMART_ROUTING_PROVIDER_ID = "smart-routing";

export const SMART_ROUTING_VIRTUAL_PROVIDER: Provider = {
  id: SMART_ROUTING_PROVIDER_ID,
  name: "Smart Routing",
  baseUrl: "",
  mode: "passthrough",
  providerType: "anthropic",
  enabled: true,
};

export function isSmartRoutingEnabled(config: {
  smartRoutingConfig?: { enabled?: boolean };
}): boolean {
  return config.smartRoutingConfig?.enabled === true;
}

export function resolveEffectiveRoutingStatus(
  config: { smartRoutingConfig?: { enabled?: boolean } },
  router: { getCurrentProviderId(): string; getCurrentProvider(): Provider | undefined }
): {
  currentProvider: string;
  providerName?: string;
  providerMode?: Provider["mode"];
} {
  if (isSmartRoutingEnabled(config)) {
    return {
      currentProvider: SMART_ROUTING_PROVIDER_ID,
      providerName: SMART_ROUTING_VIRTUAL_PROVIDER.name,
      providerMode: SMART_ROUTING_VIRTUAL_PROVIDER.mode,
    };
  }
  const provider = router.getCurrentProvider();
  return {
    currentProvider: router.getCurrentProviderId(),
    providerName: provider?.name,
    providerMode: provider?.mode,
  };
}
