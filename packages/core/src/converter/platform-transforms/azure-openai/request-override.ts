/**
 * Azure OpenAI: hosted Chat `web_search` is rejected on `/chat/completions`; route to `/responses`.
 */

import type { OpenAIMessageRequest } from "../../adapters/anthropic-to-openai-chat-request";
import { convertOpenAIMessageRequestToResponsesRequest } from "../../adapters/openai-chat-to-responses-request";
import { chatBodyHasHostedTool } from "../../hosted-tools";

import type { PlatformRequestOverrideResult } from "../rules";
import { sanitizeAzureResponsesRequestTools } from "./responses-request-tools";

export function azureWebSearchRequestOverride(
  chatBody: Record<string, unknown>,
  _chatPath: string
): PlatformRequestOverrideResult | null {
  if (!chatBodyHasHostedTool(chatBody, "web_search")) {
    return null;
  }
  const chat = chatBody as unknown as OpenAIMessageRequest;
  const result = convertOpenAIMessageRequestToResponsesRequest(chat);
  sanitizeAzureResponsesRequestTools(result.request);
  return {
    body: result.request,
    path: result.newPath,
    responseFormat: "responses",
  };
}
