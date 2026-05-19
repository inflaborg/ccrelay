/**
 * CCRelay Tauri sidecar — standalone Node.js server process
 *
 * Started by the Tauri Rust shell as a sidecar binary.
 * Participates in leader election: becomes leader or follower.
 * Outputs CCRELAY_PORT, CCRELAY_HOST, CCRELAY_ROLE, CCRELAY_UI_TOKEN on stdout.
 * When follower, PORT/HOST point to the leader's server.
 */

import * as http from "http";
import * as path from "path";
import * as fs from "fs";
import {
  Api,
  ConfigManager,
  LeaderElection,
  Logger,
  ProxyServer,
  getUiAccessToken,
  loggingDatabaseConfigToDriver,
  setLogDatabaseDriverConfigResolver,
  setWebDistPath,
} from "@ccrelay/core";

function resolveWebDist(): string {
  // Bundled resources: __dirname is resources/out/, web/ is resources/web/
  const resourceWebDir = path.join(__dirname, "..", "web");
  if (fs.existsSync(path.join(resourceWebDir, "index.html"))) {
    return resourceWebDir;
  }
  // Fallback: web/ next to the Node sidecar binary (binaries/)
  const exeWebDir = path.join(path.dirname(process.execPath), "web");
  if (fs.existsSync(path.join(exeWebDir, "index.html"))) {
    return exeWebDir;
  }
  return resourceWebDir;
}

function parseHostFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url.replace(/^https?:\/\//, "").split(":")[0];
  }
}

function parsePortFromUrl(url: string): number {
  try {
    return parseInt(new URL(url).port, 10);
  } catch {
    const m = url.match(/:(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }
}

/** Fetch the leader's UI access token via internal API (bearer-authenticated). */
function fetchLeaderUiToken(leaderUrl: string, bearerToken: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL("/ccrelay/api/internal/ui-token", leaderUrl);
    const req = http.get(
      url,
      {
        headers: { ["Authorization"]: `Bearer ${bearerToken}` },
        timeout: 3000,
      },
      res => {
        let body = "";
        res.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on("end", () => {
          try {
            const data = JSON.parse(body) as { token?: string };
            if (data.token) {
              resolve(data.token);
            } else {
              reject(new Error(`No token in response: ${body}`));
            }
          } catch {
            reject(new Error(`Failed to parse response: ${body}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
  });
}

async function main(): Promise<void> {
  const logger = Logger.getInstance();

  setWebDistPath(resolveWebDist());

  const configManager = new ConfigManager();

  setLogDatabaseDriverConfigResolver(() => {
    const base = loggingDatabaseConfigToDriver(configManager.configValue.logging.database);
    if (base?.type === "sqlite") {
      return { ...base, driver: base.driver === "cli" ? "cli" : "native" };
    }
    return base;
  });

  const leaderElection = new LeaderElection(configManager.port, configManager.host, () =>
    configManager.getApiBearerToken()
  );
  const server = new ProxyServer(configManager, leaderElection);

  Api.setServer(server);

  let effectivePort = configManager.port;
  let effectiveHost = configManager.host;
  let role = "leader";
  let leaderUrl: string | undefined;

  try {
    const result = await server.start();
    role = result.role;
    leaderUrl = result.leaderUrl;

    if (result.role === "follower" && result.leaderUrl) {
      effectiveHost = parseHostFromUrl(result.leaderUrl);
      effectivePort = parsePortFromUrl(result.leaderUrl);
      logger.info(
        `[Sidecar] Running as follower, leader at ${result.leaderUrl} (dashboard: http://${effectiveHost}:${effectivePort})`
      );
    } else {
      logger.info(`[Sidecar] Running as leader on http://${effectiveHost}:${effectivePort}`);
    }
  } catch (err: unknown) {
    logger.error("[Sidecar] Failed to start server", err);
    process.exit(1);
  }

  // Signal server info to the Rust shell AFTER server is ready
  process.stdout.write(`CCRELAY_ROLE=${role}\n`);
  process.stdout.write(`CCRELAY_PORT=${effectivePort}\n`);
  process.stdout.write(`CCRELAY_HOST=${effectiveHost}\n`);

  if (role === "follower" && leaderUrl) {
    // Follower: fetch the leader's UI token so the Tauri WebView can authenticate
    try {
      const leaderToken = await fetchLeaderUiToken(leaderUrl, configManager.getApiBearerToken());
      process.stdout.write(`CCRELAY_UI_TOKEN=${leaderToken}\n`);
    } catch {
      logger.warn("[Sidecar] Failed to fetch leader UI token, using local token");
      process.stdout.write(`CCRELAY_UI_TOKEN=${getUiAccessToken()}\n`);
    }
  } else {
    process.stdout.write(`CCRELAY_UI_TOKEN=${getUiAccessToken()}\n`);
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`[Sidecar] Received ${signal}, stopping server`);
    try {
      await server.stop();
    } catch (err: unknown) {
      logger.error("[Sidecar] Error stopping server", err);
    }
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch(err => {
  console.error("[Sidecar] Fatal error:", err);
  process.exit(1);
});
