/**
 * API format converters
 * Exports converters for Anthropic <-> OpenAI API format translation
 */

export {
  convertRequestToOpenAI,
  type AnthropicMessageRequest,
  type OpenAIMessageRequest,
  type ConversionResult,
  type ConvertRequestToOpenAIOptions,
} from "./anthropic-to-openai";

export {
  convertResponseToAnthropic,
  type OpenAIChatCompletionResponse,
  type AnthropicMessageResponse,
} from "./openai-to-anthropic";

export {
  convertOpenAIRequestToAnthropic,
  isOpenAIChatCompletionsRequest,
} from "./openai-to-anthropic-request";

export { isOpenAIChatCompletionsWirePath, isOpenAIType } from "./openaiPath";

export {
  mapAnthropicWirePathToOpenAiUpstream,
  mapOpenAiWirePathToAnthropicUpstream,
} from "./crossProtocolUpstreamPath";

export {
  convertAnthropicResponseToOpenAI,
  isAnthropicMessageResponse,
} from "./anthropic-to-openai-response";

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
} from "./modelsFallback";

export {
  convertResponsesRequestToChatCompletions,
  isOpenAIResponsesRequest,
  type ResponsesToChatResult,
} from "./responses-to-chat-completions";

export {
  convertChatCompletionToResponses,
  formatOpenAIResponsesSse,
  formatOpenAIChatCompletionsSse,
  type OpenAIResponsesApiObject,
} from "./chat-completions-to-responses";

export {
  createStreamingState,
  processStreamingChunk,
  createSseLineBuffer,
  type StreamingConversionState,
} from "./chat-completions-streaming-to-responses";

export {
  extractResponsesEcho,
  mergedResponseShellEcho,
  type ResponsesRequestEcho,
} from "./responses-echo";
