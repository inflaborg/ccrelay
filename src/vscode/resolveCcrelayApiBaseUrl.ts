import * as vscode from "vscode";

/**
 * Resolves the base URL the webview should use to reach the ccrelay HTTP API.
 * Uses vscode.env.asExternalUri so code-server and Remote browsers reach the
 * extension host via the product proxy (e.g. /proxy/7575) instead of 127.0.0.1
 * on the client machine. Follower mode uses the leader origin unchanged.
 */
export async function resolveCcrelayApiBaseUrl(options: {
  role: string;
  leaderUrl: string;
  host?: string;
  port?: number;
}): Promise<string> {
  const { role, leaderUrl, host, port } = options;
  if (role === "follower" && leaderUrl) {
    return new URL("/ccrelay/api", leaderUrl).origin;
  }

  const h = host || "127.0.0.1";
  const p = port ?? 7575;
  const fallback = `http://${h}:${p}`;

  try {
    const localUri = vscode.Uri.parse(fallback);
    const externalUri = await vscode.env.asExternalUri(localUri);
    return externalUri.toString().replace(/\/$/, "");
  } catch (err) {
    console.error("[CCRelay] asExternalUri failed, using local URL", err);
    return fallback;
  }
}
