/**
 * Serve the bundled Web UI from a custom protocol so the dashboard stays available
 * when the proxy HTTP server on :7575 is stopped.
 */

import { protocol } from "electron";
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";

export const DASHBOARD_PROTOCOL = "ccrelay-dashboard";

export type DashboardInjectConfig = {
  apiOrigin: string;
  apiBearer: string;
  locale?: string;
};

let webDistDir = "";
let injectConfig: DashboardInjectConfig = {
  apiOrigin: "http://127.0.0.1:7575",
  apiBearer: "",
};

export function registerDashboardProtocolSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: DASHBOARD_PROTOCOL,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

function buildInjectScript(config: DashboardInjectConfig): string {
  return `<script>window.CCRELAY_API_URL=${JSON.stringify(config.apiOrigin)};window.CCRELAY_API_BEARER=${JSON.stringify(config.apiBearer)};window.CCRELAY_LOCALE=${JSON.stringify(config.locale ?? "")};</script>`;
}

function resolveAssetPath(urlPathname: string): string | null {
  let relative = decodeURIComponent(urlPathname);
  if (relative.startsWith("/ccrelay/")) {
    relative = relative.slice("/ccrelay/".length);
  } else if (relative.startsWith("/")) {
    relative = relative.slice(1);
  }
  if (relative === "" || relative === "/") {
    relative = "index.html";
  }

  const filePath = path.join(webDistDir, relative);
  const normalizedRoot = path.normalize(webDistDir + path.sep);
  const normalizedFile = path.normalize(filePath);
  if (!normalizedFile.startsWith(normalizedRoot)) {
    return null;
  }
  return normalizedFile;
}

export function registerDashboardProtocolHandler(webDist: string): void {
  webDistDir = webDist;

  protocol.handle(DASHBOARD_PROTOCOL, async request => {
    const filePath = resolveAssetPath(new URL(request.url).pathname);
    if (!filePath) {
      return new Response("Forbidden", { status: 403 });
    }

    if (path.basename(filePath) === "index.html") {
      if (!fs.existsSync(filePath)) {
        return new Response("Web UI not built. Run npm run build:web.", { status: 503 });
      }
      let html = fs.readFileSync(filePath, "utf-8");
      html = html.replace("<head>", `<head>${buildInjectScript(injectConfig)}`);
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" }, // eslint-disable-line @typescript-eslint/naming-convention -- HTTP header
      });
    }

    if (!fs.existsSync(filePath)) {
      return new Response("Not found", { status: 404 });
    }

    return fetch(pathToFileURL(filePath).href);
  });
}

export function setDashboardInjectConfig(config: DashboardInjectConfig): void {
  injectConfig = config;
}

export function dashboardLocalUrl(): string {
  return `${DASHBOARD_PROTOCOL}://app/ccrelay/`;
}
