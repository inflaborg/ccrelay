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
  type OpenAIModelsListResponse,
  type AnthropicModelsListResponse,
} from "./models-fallback";

export {
  convertResponsesRequestToChatCompletions,
  isOpenAIResponsesRequest,
  type ResponsesToChatResult,
  type ResponsesToChatOptions,
  extractResponsesEcho,
  mergedResponseShellEcho,
  extractFunctionToolsForEcho,
} from "./adapters/openai-responses-to-chat";

export type { ResponsesRequestEcho } from "../types";

export {
  stripAnthropicToolVersionSuffix,
  anthropicToolBaseToChatHostedType,
  CHAT_HOSTED_TOOL_TO_ANTHROPIC,
  anthropicServerToolDefToOpenAIHosted,
  openAIHostedToolToAnthropicServerToolDef,
  normalizeToolForProvider,
  normalizeToolsForProvider,
  normalizedHostnameFromBaseUrl,
  hostnameMatchesDomain,
  matchHostedToolRuleForBaseUrl,
} from "./tool-schema-conversion";

export type { HostedToolRule, HostedToolTransform, NormalizeToolsResult } from "./hosted-tools";

export {
  glmWebSearchEnvelopeTransform,
  mimoWebSearchTransform,
  passthroughTransform,
  TRANSFORM_REGISTRY,
} from "./hosted-tools";

export type { PlatformMessageRule, PlatformMessageTransform } from "./platform-messages";

export { applyPlatformMessageTransforms, glmFlattenContentTransform } from "./platform-messages";

export {
  convertChatCompletionToResponses,
  type OpenAIResponsesApiObject,
} from "./adapters/openai-chat-to-responses";

export {
  formatOpenAIResponsesSse,
  formatOpenAIChatCompletionsSse,
} from "./streaming/sse-formatters";

export {
  createAnthropicToOpenAISseState,
  processAnthropicStreamEnvelope,
  flushAnthropicToOpenAISseFinal,
  createAnthropicSseEnvelopeBuffer,
  type AnthropicToOpenAISseState,
} from "./streaming/anthropic-sse-to-openai-chat";

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
