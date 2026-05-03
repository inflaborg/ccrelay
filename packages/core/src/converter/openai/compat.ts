import type { Provider, OpenAICompat } from "../../types";

/**
 * Chat Completions body compat when bridging an Anthropic Messages client to this upstream.
 * Only `azure_openai` enables strict sanitization; everything else behaves as generic OpenAI.
 */
export function resolveOpenAICompatForAnthropicToOpenAI(provider: Provider): OpenAICompat {
  return provider.openaiCompat === "azure_openai" ? "azure_openai" : "default";
}
