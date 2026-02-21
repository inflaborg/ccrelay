import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

export class DashboardWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = "ccrelay.dashboardView";

    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _getConfig: () => { leaderUrl: string; role: string; host?: string; port?: number }
    ) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, "out", "web")],
        };

        this.updateWebview();
    }

    public updateWebview() {
        if (this._view) {
            const { leaderUrl, role, host, port } = this._getConfig();
            this._view.webview.html = this.getWebviewContent(this._view.webview, leaderUrl, role, host, port);
        }
    }

    private getWebviewContent(webview: vscode.Webview, leaderUrl: string, role: string, host?: string, port?: number): string {
        const webDistPath = path.join(this._extensionUri.fsPath, "out", "web");

        const apiUrl =
            role === "follower" && leaderUrl
                ? new URL("/ccrelay/api", leaderUrl).origin
                : `http://${host || "127.0.0.1"}:${port || 7575}`;

        const assetsPath = path.join(webDistPath, "assets");
        let jsFile = "";
        let cssFile = "";

        try {
            if (fs.existsSync(assetsPath)) {
                const files = fs.readdirSync(assetsPath);
                jsFile = files.find(f => f.startsWith("index-") && f.endsWith(".js")) || "";
                cssFile = files.find(f => f.startsWith("index-") && f.endsWith(".css")) || "";
            }
        } catch (err) {
            console.error("Failed to read assets directory:", err);
        }

        if (!jsFile || !cssFile) {
            return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 20px; font-family: var(--vscode-font-family);">
  <h2>Dashboard Not Found</h2>
  <p>The React web application is not built. Please run:</p>
  <pre style="background: var(--vscode-textCodeBlock-background); padding: 10px; border-radius: 4px;">npm run build:web</pre>
</body>
</html>`;
        }

        const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "out", "web", "assets", jsFile));
        const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "out", "web", "assets", cssFile));

        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-inline' 'unsafe-eval'; connect-src http: https:; img-src ${webview.cspSource} data:; font-src ${webview.cspSource};">
  <title>CCRelay Dashboard</title>
  <link rel="stylesheet" href="${cssUri.toString()}">
  <style>
    /* Make sure the #root takes up full height for the sidebar */
    html, body, #root {
      height: 100%;
      margin: 0;
      padding: 0;
      background: var(--vscode-sideBar-background);
    }
  </style>
  <script>
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
}
