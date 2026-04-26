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

export {
  convertAnthropicResponseToOpenAI,
  isAnthropicMessageResponse,
} from "./anthropic-to-openai-response";

export { buildModelsListFromProvider, type OpenAIModelsListResponse } from "./modelsFallback";
