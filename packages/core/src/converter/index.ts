/**
 * API format converters: adapters (protocol conversion), rules (model/platform shaping), streaming (SSE).
 */

export {
  convertRequestToOpenAI,
  type AnthropicMessageRequest,
  type OpenAIMessageRequest,
  type ConversionResult,
  type ConvertRequestToOpenAIOptions,
} from "./adapters/anthropic-to-openai-chat-request";

export {
  convertResponseToAnthropic,
  type OpenAIChatCompletionResponse,
  type AnthropicMessageResponse,
} from "./adapters/openai-chat-to-anthropic-response";

export {
  convertOpenAIRequestToAnthropic,
  isOpenAIChatCompletionsRequest,
} from "./adapters/openai-chat-to-anthropic-request";

export { isOpenAIChatCompletionsWirePath, isOpenAIType } from "./paths";

export {
  mapAnthropicWirePathToOpenAiUpstream,
  mapOpenAiWirePathToAnthropicUpstream,
} from "./paths";

export {
  convertAnthropicResponseToOpenAI,
  isAnthropicMessageResponse,
} from "./adapters/anthropic-to-openai-chat-response";

export {
  isModelsListUpstreamPath,
  isOpenAIModelsListJson,
  isAnthropicModelsListJson,
  convertOpenAIModelsToAnthropic,
  convertAnthropicModelsToOpenAI,
  parseModelsListLimitFromTargetUrl,
  buildOpenAIModelsListFromIds,
  openAiModelsPageToAnthropicModelsList,
  synthesizeCustomModelsListBody,
  rewriteModelsListPayloadInPlace,
  type OpenAIModelsListResponse,
  type AnthropicModelsListResponse,
} from "./models-fallback";

export {
  convertResponsesRequestToChatCompletions,
  isOpenAIResponsesRequest,
  type ResponsesToChatResult,
  extractResponsesEcho,
  mergedResponseShellEcho,
  extractFunctionToolsForEcho,
} from "./adapters/openai-responses-to-chat";

export type { ResponsesRequestEcho } from "../types";

export {
  convertChatCompletionToResponses,
  type OpenAIResponsesApiObject,
} from "./adapters/openai-chat-to-responses";

export {
  formatOpenAIResponsesSse,
  formatOpenAIChatCompletionsSse,
} from "./streaming/sse-formatters";

export {
  createStreamingState,
  processStreamingChunk,
  createSseLineBuffer,
  type StreamingConversionState,
} from "./streaming/openai-chat-stream-to-responses";

export {
  assignOpenAiChatMaxOutput,
  openaiChatUsesMaxCompletionTokens,
  type OpenAiChatMaxOutputTarget,
} from "./rules/openai-chat-model-rules";

export {
  resolveOpenAICompatForAnthropicToOpenAI,
  sanitizeAzureOpenAiChatRequest,
  isGeminiOpenAiModel,
  withOptionalGeminiThoughtSignature,
} from "./rules/openai-chat-platform-transforms";
