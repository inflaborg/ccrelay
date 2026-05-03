/**
 * Served when `/ccrelay` static routes lack the internal UI gate header.
 * Self-contained HTML (no external assets).
 */

/** Single-line style for readability in source; browser receives minified-ish block via template. */
export const WEB_UI_GATE_FALLBACK_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CCRelay</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      background: radial-gradient(circle at 20% 20%, #1e293b 0%, #0f172a 45%, #020617 100%);
      color: #e2e8f0;
      padding: 1.5rem;
    }
    .card {
      max-width: 28rem;
      padding: 1.75rem 1.5rem;
      border-radius: 12px;
      background: rgba(15, 23, 42, 0.85);
      border: 1px solid rgba(148, 163, 184, 0.2);
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
    }
    h1 {
      margin: 0 0 0.5rem;
      font-size: 1.25rem;
      font-weight: 600;
      letter-spacing: -0.02em;
    }
    p {
      margin: 0;
      font-size: 0.9rem;
      line-height: 1.55;
      color: #94a3b8;
    }
    .muted { margin-top: 1rem; font-size: 0.8rem; color: #64748b; }
  </style>
</head>
<body>
  <div class="card">
    <h1>CCRelay web UI</h1>
    <p>This dashboard is meant to be opened from the <strong>CCRelay desktop app</strong> or the <strong>VS Code / Cursor extension</strong>, which attach the required request headers automatically.</p>
    <p class="muted">Direct browser access to this URL is intentionally blocked on the local relay.</p>
  </div>
</body>
</html>`;
