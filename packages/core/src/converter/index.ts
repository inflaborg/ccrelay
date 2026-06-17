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
  isModelDetailUpstreamPath,
  extractModelIdFromDetailPath,
  isOpenAIModelsListJson,
  isAnthropicModelsListJson,
  isOpenAIModelEntryJson,
  isAnthropicModelInfoJson,
  convertOpenAIModelsToAnthropic,
  convertAnthropicModelsToOpenAI,
  convertOpenAISingleModelToAnthropic,
  convertAnthropicSingleModelToOpenAI,
  parseModelsListLimitFromTargetUrl,
  parseCustomModelLine,
  collectParsedCustomModelsDeduped,
  buildOpenAIModelsListFromIds,
  openAiModelsPageToAnthropicModelsList,
  synthesizeCustomModelsListBody,
  synthesizeCustomModelDetailBody,
  synthesizeModelNotFoundBody,
  CCRELAY_MODEL_ALIAS_HEADER,
  readUseModelAliasFromHeaders,
  type OpenAIModelsListResponse,
  type AnthropicModelsListResponse,
  type ParsedCustomModelLine,
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

export {
  convertOpenAIMessageRequestToResponsesRequest,
  convertOpenAiChatBodyBufferToResponsesRequest,
  type ChatToResponsesRequestResult,
} from "./adapters/openai-chat-to-responses-request";

export {
  chatBodyHasHostedTool,
  anthropicBodyHasHostedTool,
  detectChatHostedToolKinds,
  HOSTED_TOOL_MATCHERS,
} from "./hosted-tools";

export type { HostedToolKind, HostedToolMatcher } from "./hosted-tools";

export {
  convertResponsesApiJsonToAnthropicMessageResponse,
  isOpenAIResponsesApiResultBody,
} from "./adapters/openai-responses-to-anthropic-response";

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

export type {
  HostedToolRule,
  HostedToolTransform,
  NormalizeToolsResult,
  PlatformMessageRule,
  PlatformMessageTransform,
  PlatformAnthropicSseTransform,
  PlatformTransformRule,
  PlatformResponseTransform,
  PlatformToolTransform,
  AnthropicSseEventRow,
} from "./platform-transforms";

export {
  glmWebSearchEnvelopeTransform,
  mimoWebSearchTransform,
  passthroughTransform,
  TRANSFORM_REGISTRY,
  TOOL_TRANSFORM_REGISTRY,
  MESSAGE_TRANSFORM_REGISTRY,
  RESPONSE_TRANSFORM_REGISTRY,
  ANTHROPIC_SSE_TRANSFORM_REGISTRY,
  applyPlatformMessageTransforms,
  applyPlatformResponseTransforms,
  applyPlatformToolTransforms,
  applyAnthropicSseRowsPlatformTransform,
  glmFlattenContentTransform,
  glmWebSearchResponseTransform,
  mimoAnnotationsWebSearchResponseTransform,
  isPlainObject,
  matchAnthropicSseRule,
  anthropicMessagesBodyHasHostedWebSearch,
  parseAnthropicSseRows,
  serializeAnthropicSseRows,
  parseGlmToolResultAsSearchEntries,
  transformGlmAnthropicSearchSseRows,
  glmWebSearchServerToolName,
} from "./platform-transforms";

export {
  convertChatCompletionToResponses,
  type OpenAIResponsesApiObject,
} from "./adapters/openai-chat-to-responses";

export {
  formatOpenAIResponsesSse,
  formatOpenAIChatCompletionsSse,
  formatAnthropicSseError,
  formatOpenAIChatSseError,
  formatOpenAIResponsesSseError,
  extractUpstreamSseError,
  type UpstreamSseErrorInfo,
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
  stripBillingHeaderFromAnthropicBody,
  isBillingHeaderBlock,
} from "./anthropic-request-sanitize";
