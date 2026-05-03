/**
 * @ccrelay/core — platform-independent CCRelay runtime (proxy server, config, APIs).
 */

export {
  ConfigManager,
  expandEnvVarsInObject,
  sortProviderMapKeys,
  getDefaultRoutingSettings,
  mergeFileConfigWithDefaults,
} from "./config";

export { ProxyServer } from "./server/handler";
export { LeaderElection } from "./server/leaderElection";
export { Router } from "./server/router";
export { setWebDistPath } from "./server/static";
export {
  CCRELAY_UI_HEADER_NAME,
  CCRELAY_UI_HEADER_VALUE,
} from "./server/internalUiHeaders";

export { Logger, ScopedLogger, LogLevel } from "./utils/logger";

export * as Api from "./api/index";

export {
  BUILD_HASH,
  BUILD_DATE,
  BUILD_VERSION,
  GIT_HASH,
  PACKAGE_VERSION,
} from "./api/version.generated";

export * from "./types";
