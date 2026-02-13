/**
 * Log Viewer Webview Panel for CCRelay
 * Loads the React web application from web/dist
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

let currentPanel: LogViewerPanel | null = null;

export class LogViewerPanel {
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private disposables: vscode.Disposable[] = [];

  public static createOrShow(
    leaderUrl: string,
    role: string,
    host?: string,
    port?: number,
    extensionUri?: vscode.Uri
  ): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // Get extension URI from context if not provided
    const extUri =
      extensionUri || vscode.extensions.getExtension("inflab.ccrelay-vscode")?.extensionUri;
    if (!extUri) {
      vscode.window.showErrorMessage("Failed to get extension URI");
      return;
    }

    if (currentPanel) {
      currentPanel.panel.reveal(column);
      // Update webview content with new state
      currentPanel.panel.webview.html = currentPanel.getWebviewContent(leaderUrl, role, host, port);
      return;
    }

    // Web dist directory
    const webDistUri = vscode.Uri.joinPath(extUri, "out", "web");

    const panel = vscode.window.createWebviewPanel(
      "ccrelay.logViewer",
      "CCRelay Log Viewer",
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        // Allow loading local resources from out/web
        localResourceRoots: [webDistUri],
      }
    );

    currentPanel = new LogViewerPanel(panel, extUri, leaderUrl, role, host, port);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    leaderUrl: string,
    role: string,
    host?: string,
    port?: number
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.panel.webview.html = this.getWebviewContent(leaderUrl, role, host, port);

    // Handle state restore
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private updateState(leaderUrl: string, role: string, host?: string, port?: number): void {
    this.panel.webview.html = this.getWebviewContent(leaderUrl, role, host, port);
  }

  private getWebviewContent(leaderUrl: string, role: string, host?: string, port?: number): string {
    const webview = this.panel.webview;
    const webDistPath = path.join(this.extensionUri.fsPath, "out", "web");

    // Determine the API base URL
    const apiUrl =
      role === "follower" && leaderUrl
        ? new URL("/ccrelay/api", leaderUrl).origin
        : `http://${host || "127.0.0.1"}:${port || 7575}`;

    // Find the actual asset filenames (they have hashes)
    const assetsPath = path.join(webDistPath, "assets");
    let jsFile = "";
    let cssFile = "";

    try {
      const files = fs.readdirSync(assetsPath);
      jsFile = files.find(f => f.startsWith("index-") && f.endsWith(".js")) || "";
      cssFile = files.find(f => f.startsWith("index-") && f.endsWith(".css")) || "";
    } catch (err) {
      console.error("Failed to read assets directory:", err);
    }

    if (!jsFile || !cssFile) {
      return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 20px; font-family: var(--vscode-font-family);">
  <h2>Web UI Not Found</h2>
  <p>The React web application is not built. Please run:</p>
  <pre style="background: var(--vscode-textCodeBlock-background); padding: 10px; border-radius: 4px;">npm run build:web</pre>
</body>
</html>`;
    }

    // Get webview URIs for the assets
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "out", "web", "assets", jsFile)
    );
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "out", "web", "assets", cssFile)
    );

    // CSP needs 'unsafe-inline' for Vite-built module scripts and inline scripts
    // connect-src needs the full API URL pattern
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-inline' 'unsafe-eval'; connect-src http: https:; img-src ${webview.cspSource} data:; font-src ${webview.cspSource};">
  <title>CCRelay Log Viewer</title>
  <link rel="stylesheet" href="${cssUri.toString()}">
  <script>
    // Inject API base URL for the React app
    window.CCRELAY_API_URL = "${apiUrl}";
    window.CCRELAY_ROLE = "${role}";
    window.CCRELAY_LEADER_URL = "${leaderUrl || ""}";
  </script>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="${jsUri.toString()}"></script>
</body>
</html>`;
  }

  public dispose(): void {
    currentPanel = null;
    this.panel.dispose();
    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}
