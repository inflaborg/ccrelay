/**
 * Layer 2: named outbound message transforms — registry aggregates provider modules.
 */

/* eslint-disable @typescript-eslint/naming-convention -- registry keys are kebab-case wire ids */

import type { OpenAIMessage } from "../adapters/anthropic-to-openai-chat-request";
import { glmFlattenContentTransform } from "./glm";

export type PlatformMessageTransform = (messages: OpenAIMessage[]) => OpenAIMessage[];

export { glmFlattenContentTransform } from "./glm";

export const MESSAGE_TRANSFORM_REGISTRY: Readonly<Record<string, PlatformMessageTransform>> = {
  "glm-flatten-content": glmFlattenContentTransform,
};
