/**
 * Layer 2: named outbound transforms per hosted `tools[]` entry — registry aggregates provider modules.
 */

/* eslint-disable @typescript-eslint/naming-convention -- wire tool payload keys */

import { glmWebSearchEnvelopeTransform } from "./glm";
import { mimoWebSearchTransform } from "./xiaomimimo";
import { passthroughTransform } from "./passthrough";

export type HostedToolTransform = (tool: Record<string, unknown>) => Record<string, unknown>;

export { passthroughTransform, isPlainObject } from "./passthrough";
export { glmWebSearchEnvelopeTransform } from "./glm";
export { mimoWebSearchTransform } from "./xiaomimimo";

export const TRANSFORM_REGISTRY: Readonly<Record<string, HostedToolTransform>> = {
  "glm-web-search-envelope": glmWebSearchEnvelopeTransform,
  "mimo-web-search": mimoWebSearchTransform,
  passthrough: passthroughTransform,
};
