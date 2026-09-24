import { describe, expect, it } from "vitest";
import {
  resolveChatActiveProvider,
  SMART_ROUTING_CHAT_PROVIDER_ID,
} from "../../../web/src/features/chat/activeProvider";
import type { Provider } from "../../../web/src/types/api";

const provider: Provider = {
  id: "official",
  name: "Official",
  mode: "passthrough",
  providerType: "openai",
  active: true,
  enabled: true,
};

describe("resolveChatActiveProvider", () => {
  it("uses the smart-routing route when that is the current id", () => {
    const active = resolveChatActiveProvider(
      { providers: [provider], current: SMART_ROUTING_CHAT_PROVIDER_ID },
      "Smart Routing"
    );
    expect(active?.id).toBe(SMART_ROUTING_CHAT_PROVIDER_ID);
    expect(active?.name).toBe("Smart Routing");
  });

  it("uses the matching provider when smart routing is off", () => {
    const active = resolveChatActiveProvider(
      { providers: [provider], current: "official" },
      "Smart Routing"
    );
    expect(active?.id).toBe("official");
  });
});
