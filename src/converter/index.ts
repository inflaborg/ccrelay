/**
 * API format converters
 * Exports converters for Anthropic <-> OpenAI API format translation
 */

export {
  convertRequestToOpenAI,
  type AnthropicMessageRequest,
  type OpenAIMessageRequest,
  type ConversionResult,
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
  convertAnthropicResponseToOpenAI,
  isAnthropicMessageResponse,
} from "./anthropic-to-openai-response";

export {
  buildModelsListFromProvider,
  buildOpenAIModelsListFromProvider,
  buildAnthropicModelsListFromProvider,
  buildModelsListFallback,
  convertOpenAIModelsToAnthropic,
  convertAnthropicModelsToOpenAI,
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
