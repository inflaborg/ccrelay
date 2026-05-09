export type { HostedToolKind, HostedToolMatcher } from "./types";

export { HOSTED_TOOL_MATCHERS } from "./matchers";

export {
  chatBodyHasHostedTool,
  anthropicBodyHasHostedTool,
  detectChatHostedToolKinds,
} from "./detect";
