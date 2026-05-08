/**
 * Layer 3: generic dispatch — hostname match → registry message transform for Chat bodies.
 */

import type { OpenAIMessage } from "../adapters/anthropic-to-openai-chat-request";
import { hostnameMatchesDomain, normalizedHostnameFromBaseUrl } from "../hosted-tools";
import { PLATFORM_MESSAGE_RULES } from "./rules";
import { MESSAGE_TRANSFORM_REGISTRY } from "./transforms";

export type { PlatformMessageRule } from "./rules";
export type { PlatformMessageTransform } from "./transforms";
export { glmFlattenContentTransform } from "./transforms";

/** Apply the first matching platform rule's message transform for `baseUrl`. */
export function applyPlatformMessageTransforms(
  messages: OpenAIMessage[],
  baseUrl: string
): OpenAIMessage[] {
  const hostname = normalizedHostnameFromBaseUrl(baseUrl);
  if (!hostname) {
    return messages;
  }

  for (const rule of PLATFORM_MESSAGE_RULES) {
    for (const domain of rule.domains) {
      if (hostnameMatchesDomain(hostname, domain)) {
        const transform = MESSAGE_TRANSFORM_REGISTRY[rule.transform];
        if (transform) {
          return transform(messages);
        }
        return messages;
      }
    }
  }
  return messages;
}
