import type { Provider } from "../../types/api";

/** Same id the providers API returns in `current` while smart routing is on. */
export const SMART_ROUTING_CHAT_PROVIDER_ID = "smart-routing";

/** Chat has no row in the providers list while smart routing is the active route. */
export function resolveChatActiveProvider(
  data: { providers: Provider[]; current: string } | undefined,
  smartRoutingName: string
): Provider | null {
  if (!data) {
    return null;
  }
  if (data.current === SMART_ROUTING_CHAT_PROVIDER_ID) {
    return {
      id: SMART_ROUTING_CHAT_PROVIDER_ID,
      name: smartRoutingName,
      mode: "passthrough",
      providerType: "anthropic",
      active: true,
      enabled: true,
    };
  }
  return data.providers.find(p => p.id === data.current) ?? null;
}
