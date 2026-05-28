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
