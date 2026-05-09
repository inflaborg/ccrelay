# CCRelay

[![VSCode Extension](https://img.shields.io/badge/VSCode-Extension-blue)](https://code.visualstudio.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**CCRelay** is a VS Code extension — with optional **Electron** and **Tauri** desktop apps — that bundles a local API proxy so you can seamlessly switch between AI providers (Anthropic, OpenAI, Gemini, etc.) without losing conversation context. Designed for **Claude Code**, **Claude Cowork**, and **OpenAI Codex**.

**Website**: [https://ccrelay.inflab.org](https://ccrelay.inflab.org)

**[中文文档](./README_CN.md)**

---

## Table of Contents

- [Core Features](#core-features)
- [Verified upstreams (by host)](#verified-upstreams-by-host)
- [Requirements](#requirements)
- [Installation](#installation)
- [Desktop App (Electron)](#desktop-app-electron)
- [Desktop App (Tauri)](#desktop-app-tauri)
- [Quick Start](#quick-start)
- [Client Integrations](#client-integrations)
- [Usage Guide](#usage-guide)
  - [Multi-Instance Mode](#multi-instance-mode)
  - [Provider Modes](#provider-modes)
  - [Model Mapping](#model-mapping)
  - [OpenAI Format Conversion](#openai-format-conversion)
  - [Web UI Dashboard](#web-ui-dashboard)
- [Configuration](#configuration)
- [API Endpoints](#api-endpoints)
- [Commands](#commands)
- [Development](#development)
- [File Locations](#file-locations)
- [TODO](#todo)
- [License](#license)

---

## Core Features

**Proxy & Routing**

- Built-in HTTP proxy (default `http://127.0.0.1:7575`) with path-based routing — forward to a provider, block with a custom response, or return 404
- Multi-protocol: accepts **Anthropic**, **OpenAI Chat Completions**, and **OpenAI Responses API** (`/v1/responses`) on the same port
- Automatic cross-protocol conversion when client and upstream wire formats differ
- URL prefixes `/openai/...` and `/anthropic/v1/...` let different clients target the right protocol explicitly

**Client Integrations**

- First-class support for **Claude Code** (`ANTHROPIC_BASE_URL`), **Claude Cowork**, and **OpenAI Codex** (`~/.codex/config.toml`)
- Web dashboard **Client configuration** tab writes the right env vars for you

**Operations**

- Multi-instance coordination (Leader/Follower) across VS Code windows and the desktop app
- Config hot-reload — edits to `config.yaml` are picked up automatically
- Optional request/response logging (SQLite or PostgreSQL) with a built-in log viewer, token tracking, and performance metrics (TTFB, output TPS, P50/P90 latency)
- Concurrency control with per-route queue limits

**Desktop & UI**

- Optional Electron or Tauri desktop app — run CCRelay without VS Code
- Web dashboard with provider management, settings, and i18n (English + Chinese)
- Provider import/export as JSON

### Verified upstreams (by host)

Relaying uses the **provider `baseUrl` hostname**. The rows below are **upstream endpoints we have validated** when you add them as a provider. Vendors may offer Anthropic APIs, OpenAI-compatible APIs, or both — but your **client protocol** and the **upstream protocol** are often not the same. When they differ, CCRelay applies **generic protocol conversion** first, then **hostname-specific alignment** where we maintain it. When the wire looks the same on both sides, **tooling still differs** by vendor (for example hosted web search, strict Chat schemas, or Responses-only tools).

**Hosts not listed** get **generic conversion only** (no extra platform layer). **Listed hosts** get **generic conversion plus** platform rules for tools, messages, responses, and request URL/body quirks. The last column is where **hosted web search** is supported for that vendor; it does not depend on how you reach the relay.

**Example — Azure OpenAI:** Upstream **hosted web search** exists **only** on the **Responses API** (hence “Responses API only” in the Web search column). You can still point clients at CCRelay using the **OpenAI Chat Completions** surface. After you set **Azure OpenAI** as the provider `baseUrl`, Chat-shaped calls that include hosted web search are **rewritten in the conversion layer** into upstream **Responses** requests so search keeps working—you do not need the client to call `/v1/responses` itself.

| Provider (target host) | Anthropic `/v1/messages` | OpenAI `/chat/completions` | OpenAI `/v1/responses` | Web search |
| --- | --- | --- | --- | --- |
| **Z.ai GLM** (`api.z.ai`, `open.bigmodel.cn`) | Supported | Supported | Not supported | Supported |
| **Xiaomi MiMo** (`api.xiaomimimo.com`) | Supported | Supported | Not supported | Chat only |
| **Google Gemini** (OpenAI-compatible, `generativelanguage.googleapis.com`) | Not supported | Supported | Not supported | Not supported |
| **Azure OpenAI** (`*.cognitiveservices.azure.com`) | Not supported | Supported | Supported | Responses API only |
| *Other hosts* | *Varies* | *Varies* | *Varies* | Generic conversion only |

**Screenshots (Claude Code through CCRelay)**

![Claude Code — GLM hosted web search](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-claude-glm-web-search.png)

![Claude Code — Xiaomi MiMo hosted web search](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-claude-xiaomi-mimo-web-search.png)

---

## Requirements

- VS Code 1.80.0 or higher
- Node.js (for development)

---

## Installation

### Install from VSIX

1. Download the latest `.vsix` from [Releases](https://github.com/inflaborg/ccrelay/releases)
2. In VS Code: `Cmd+Shift+P` (macOS) or `Ctrl+Shift+P` → `Extensions: Install from VSIX...`
3. Select the downloaded file

### Build from Source

```bash
git clone https://github.com/inflaborg/ccrelay.git
cd ccrelay
npm install
npm run build
npm run package        # produces dists/ccrelay-vscode-*.vsix
```

### Development Mode

```bash
npm install
npm run compile        # or npm run watch
# Press F5 in VS Code to launch Extension Development Host
```

---

## Desktop App (Electron)

An optional Electron desktop app (`packages/desktop`) runs the same core as the VS Code extension:

- Shares `~/.ccrelay/` config, state, and Leader election with the extension
- Tray menu → **Open Dashboard** loads the web UI in an app window
- Download from [GitHub Releases](https://github.com/inflaborg/ccrelay/releases):
  - **macOS**: `CCRelay-<version>-darwin-arm64.zip` or `-darwin-x64.zip`
  - **Windows**: `CCRelay-<version>-win32-x64.exe` or `-win32-arm64.exe`

### macOS: First Launch

Release builds are not Apple-notarized. If Gatekeeper blocks the app:

```bash
xattr -cr /path/to/CCRelay.app
```

Or **Control-click** the app → **Open** the first time.

---

## Desktop App (Tauri)

A lightweight Tauri desktop app (`packages/desktop-tauri`) runs the same core as the VS Code extension and Electron app:

- Shares `~/.ccrelay/` config, state, and Leader election with all other instances
- Uses a sidecar architecture: Rust shell manages a Node.js server process
- Tray menu with Start/Stop Server and Open Dashboard
- Download from [GitHub Releases](https://github.com/inflaborg/ccrelay/releases):
  - **macOS**: `CCRelay.app` (Apple Silicon and Intel)
  - **Windows**: `CCRelay.exe` (x64 and arm64)

### Development

```bash
npm install
npm run tauri:dev         # Dev mode with hot reload
npm run tauri:pack:mac    # Build macOS app
npm run tauri:pack:win    # Build Windows app
```

---

## Quick Start

### 1. Add a provider

Edit `~/.ccrelay/config.yaml` (auto-created on first launch):

```yaml
providers:
  glm:
    name: "Z.AI-GLM-5"
    baseUrl: "https://api.z.ai/api/anthropic"
    mode: "inject"
    apiKey: "${GLM_API_KEY}"
    modelMap:
      - pattern: "claude-opus-*"
        model: "glm-5"
      - pattern: "claude-sonnet-*"
        model: "glm-5"
      - pattern: "claude-haiku-*"
        model: "glm-4.7"
    enabled: true

defaultProvider: "glm"
```

### 2. Point Claude Code at CCRelay

Add to `~/.claude/settings.json`:

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "ccrelay_apikey_placehold_do_not_need_to_setup_here",
    "ANTHROPIC_BASE_URL": "http://localhost:7575/anthropic",
    "API_TIMEOUT_MS": "3000000",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": 1
  }
}
```

Optional per-tier model names — only needed if you want to override Claude Code's defaults:

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "ccrelay_apikey_placehold_do_not_need_to_setup_here",
    "ANTHROPIC_BASE_URL": "http://localhost:7575/anthropic",
    "API_TIMEOUT_MS": "3000000",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": 1,
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-opus-4-7",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-sonnet-4-6",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "claude-haiku-4-5"
  }
}
```

You can also set these from the Web dashboard: **Client configuration** tab.

### 3. Switch providers

- Click the CCRelay icon in the VS Code status bar
- Or Command Palette: `CCRelay: Switch Provider`

---

## Client Integrations

CCRelay exposes both **Anthropic** and **OpenAI** compatible routes on the same port (default **7575**). Use URL prefixes to pick the right protocol:

| Client | Protocol | Base URL |
|--------|----------|----------|
| **Claude Code** | Anthropic | `http://127.0.0.1:7575/anthropic` |
| **Claude Cowork** | Anthropic | `http://127.0.0.1:7575/anthropic` |
| **Codex** | OpenAI | `http://127.0.0.1:7575/openai` |

Legacy `/v1/...` paths still work when pointed at `http://127.0.0.1:7575` directly.

### Claude Code

See [Quick Start](#quick-start) for the recommended `~/.claude/settings.json` config.

Quick test (current shell only):

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:7575/anthropic
claude
```

### Claude Cowork

Set the app's **Anthropic Base URL** to `http://127.0.0.1:7575/anthropic`. Switch providers via the CCRelay extension or `config.yaml`.

### Codex

Create or edit `~/.codex/config.toml`:

```toml
model = "gpt-5.4-mini"
model_provider = "ccrelay"

[model_providers.ccrelay]
name = "CCRelay"
base_url = "http://localhost:7575/openai"
```

Adjust `model` to one your CCRelay provider can route (via `modelMap`).

---

## Usage Guide

### Multi-Instance Mode

When multiple VS Code windows are open:

- One instance becomes the **Leader** and runs the HTTP server; others are **Followers**
- Leader broadcasts provider changes to Followers via WebSocket
- If the Leader exits, a Follower takes over automatically
- Status bar shows role: `$(broadcast)` = Leader, `$(radio-tower)` = Follower

**Logging**: request logs are persisted only by the Leader. Followers proxy log API calls to the Leader; if the Leader is unreachable, those calls return 503.

**IPC lock** (`~/.ccrelay/ccrelay-lock.sock` on Unix/macOS, named pipe on Windows) coordinates Leader election across VS Code and the desktop app.

### Provider Modes

| Mode | Auth behavior | Use case |
|------|---------------|----------|
| `passthrough` | Preserves original auth headers | Official Claude API with OAuth |
| `inject` | Replaces auth with provider API key | Third-party providers (GLM, OpenRouter, etc.) |

### Model Mapping

Map Claude model names to provider-specific models with wildcard support:

```yaml
modelMap:
  - pattern: "claude-opus-*"
    model: "glm-5"
  - pattern: "claude-sonnet-*"
    model: "glm-4.7"
```

**Vision model mapping** — separate mapping for multimodal requests:

```yaml
vlModelMap:
  - pattern: "claude-*"
    model: "vision-model"
```

`modelMap` applies only to request bodies (`model` field). `GET /models` responses are not rewritten.

### OpenAI Format Conversion

CCRelay accepts three inbound protocols and converts when the upstream provider speaks a different wire:

| Inbound path | Client protocol |
|--------------|-----------------|
| `/v1/messages`, `/anthropic/v1/messages` | Anthropic Messages |
| `/v1/chat/completions`, `/openai/chat/completions` | OpenAI Chat Completions |
| `/v1/responses` | OpenAI Responses API |
| `/v1/models`, `/openai/models` | OpenAI models list |
| `/anthropic/v1/models` | Anthropic models list |

**Conversion rules**:

- Same family on both sides (e.g. Chat + `openai` provider) → passthrough (model mapping and auth still apply)
- Cross-family → request/response body conversion via Chat Completions hub
- `GET /models` → list format converted when entry path and `providerType` disagree; upstream errors forwarded as-is

**Streaming limitations**:

- Cross-protocol paths force `stream: false` for conversion. If the client sends `stream: true`, CCRelay synthesizes a minimal SSE envelope so the client SDK can finish; model output arrives in the final payload, not token-by-token.
- Same-family streaming passes through normally.

**Example: OpenAI-compatible provider (Gemini)**

```yaml
gemini:
  name: "Gemini"
  baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai"
  providerType: "openai"
  mode: "inject"
  apiKey: "${GEMINI_API_KEY}"
  modelMap:
    - pattern: "claude-*"
      model: "gemini-2.5-pro"
```

### Web UI Dashboard

Built-in web dashboard accessible via Command Palette → `CCRelay: Open Dashboard` (VS Code) or tray menu → **Open Dashboard** (desktop app).

- **Dashboard** — server status, current provider, token usage, performance metrics (TTFB, P50/P90 latency, output TPS) with time range selector
- **Providers** — view, switch, duplicate, import/export providers
- **Logs** — request/response log viewer with token columns, TTFB, output TPS, and model mapping display (hidden when logging is disabled)
- **Settings** — manage YAML config in the UI; routing and concurrency hot-reload on save, server and logging changes require a restart
- **Client configuration** — write Claude Code env vars and Codex config from the UI

> **Note**: The dashboard is not accessible by directly opening `http://127.0.0.1:7575/ccrelay/` in a browser. Access is restricted to requests originating from within the VS Code extension or the desktop app, which include an internal header. Open the dashboard via the extension command or the desktop tray menu instead.

**Web UI**

![Client configuration](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-ccrelay-setup-1.png)

![Configure default models](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-ccrelay-setup-2.png)

![Request Logs](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-ccrelay-1.png)

![Log Details](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-ccrelay-3.png)

**Desktop app**

![Desktop — Dashboard](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-desktop-1.png)

![Desktop — Provider list](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-desktop-2.png)

---

## Configuration

CCRelay uses `~/.ccrelay/config.yaml` (auto-created on first launch). On startup the bundled defaults are merged with your file — **your values always win**, missing keys are filled from defaults. List sections (`routing.forward`, `routing.block`, `concurrency.routes`) merge by identity key, with your rows first and new defaults appended. Omit a list to inherit full defaults; set `[]` for intentionally empty.

> YAML config supports both `camelCase` and `snake_case` keys.

### VS Code Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `ccrelay.configPath` | `~/.ccrelay/config.yaml` | Path to the YAML config file |

### Server

| Setting | Default | Description |
|---------|---------|-------------|
| `server.port` | `7575` | Proxy server port |
| `server.host` | `127.0.0.1` | Bind address |
| `server.autoStart` | `true` | Auto-start server on extension load |
| `server.locale` | `""` | Web UI language (`"en"` or `"zh"`). First visit shows a picker if unset. |

### Providers

| Setting | Default | Description |
|---------|---------|-------------|
| `defaultProvider` | `official` | Default provider ID |
| `providers` | `{...}` | Provider map (see below) |

Each provider supports:

| Field | Default | Description |
|-------|---------|-------------|
| `name` | — | Display name |
| `baseUrl` | — | API base URL |
| `mode` | `"passthrough"` | `passthrough` (keep auth) or `inject` (replace auth) |
| `providerType` | `"anthropic"` | `"anthropic"`, `"openai"` (full passthrough), or `"openai_chat"` (Chat Completions only) |
| `apiKey` | — | API key for inject mode. Supports `${ENV_VAR}`. |
| `authHeader` | `"authorization"` | Auth header name |
| `modelMap` | — | Model name mappings (`[{pattern, model}]`, wildcards supported) |
| `vlModelMap` | — | Vision model mappings (for multimodal requests) |
| `headers` | — | Custom request headers |
| `enabled` | `true` | Enable/disable |

### Routing

| Setting | Default | Description |
|---------|---------|-------------|
| `configVersion` | `"0.2.0"` | Config schema version. Legacy configs auto-migrated. |
| `routing.forward` | `[{path, provider}]` | Forward rules — first match wins. `provider: "auto"` = current provider. Unmatched → 404. |
| `routing.block` | `[{path, response, code, condition?}]` | Block rules — return custom response. Optional `condition.providers` (allowlist) and `condition.providerNot` (exclusion list). |

### Concurrency

| Setting | Default | Description |
|---------|---------|-------------|
| `concurrency.enabled` | `true` | Enable request queue |
| `concurrency.maxWorkers` | `3` | Max concurrent requests |
| `concurrency.maxQueueSize` | `100` | Max queued requests (0 = unlimited) |
| `concurrency.requestTimeout` | `60` | Queue timeout in seconds (0 = unlimited) |
| `concurrency.routes` | `[]` | Per-route queue config (by `pattern`) |

### Logging

| Setting | Default | Description |
|---------|---------|-------------|
| `logging.enabled` | `false` | Enable request logging |
| `logging.database.type` | `"sqlite"` | `"sqlite"` or `"postgres"` |

**SQLite:**

| Setting | Default | Description |
|---------|---------|-------------|
| `logging.database.path` | `""` | DB file path (empty = `~/.ccrelay/logs.db`) |
| `logging.database.sqlite3_executable` | `""` | Path to `sqlite3` binary (empty = resolve from `PATH`) |

If `sqlite3` cannot be resolved, the proxy runs without log persistence (warning in logs).

**PostgreSQL:**

| Setting | Default | Description |
|---------|---------|-------------|
| `logging.database.host` | `localhost` | Server host |
| `logging.database.port` | `5432` | Server port |
| `logging.database.name` | `ccrelay` | Database name |
| `logging.database.user` | `""` | Username |
| `logging.database.password` | `""` | Password (supports `${ENV_VAR}`) |
| `logging.database.ssl` | `false` | Enable SSL |

### Full Example

```yaml
configVersion: "0.2.0"

server:
  port: 7575
  host: "127.0.0.1"
  autoStart: true

providers:
  official:
    name: "Claude Official"
    baseUrl: "https://api.anthropic.com"
    mode: "passthrough"
    providerType: "anthropic"
    enabled: true

  glm:
    name: "Z.AI-GLM-5"
    baseUrl: "https://api.z.ai/api/anthropic"
    mode: "inject"
    apiKey: "${GLM_API_KEY}"
    modelMap:
      - pattern: "claude-opus-*"
        model: "glm-5"
      - pattern: "claude-sonnet-*"
        model: "glm-5"
      - pattern: "claude-haiku-*"
        model: "glm-4.7"
    enabled: true

  gemini:
    name: "Gemini"
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai"
    providerType: "openai"
    mode: "inject"
    apiKey: "${GEMINI_API_KEY}"
    modelMap:
      - pattern: "claude-*"
        model: "gemini-2.5-pro"
    enabled: true

defaultProvider: "official"

routing:
  forward:
    - path: "/v1/messages"
      provider: "auto"
    - path: "/v1/chat/completions"
      provider: "auto"
    - path: "/v1/responses"
      provider: "auto"
    - path: "/v1/models"
      provider: "auto"
    - path: "/v1/messages/count_tokens"
      provider: "auto"
  block:
    - path: "/api/event_logging/*"
      response: ""
      code: 200
    - path: "/v1/messages/count_tokens"
      response: '{"input_tokens": 0}'
      code: 200

concurrency:
  enabled: true
  maxWorkers: 3
  maxQueueSize: 100
  requestTimeout: 60

logging:
  enabled: true
  database:
    type: "sqlite"
    path: ""
```

---

## API Endpoints

Management endpoints at `/ccrelay/`:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/ccrelay/api/status` | GET | Proxy status |
| `/ccrelay/api/providers` | GET | List providers |
| `/ccrelay/api/switch/{id}` | GET | Switch to provider |
| `/ccrelay/api/switch` | POST | Switch provider (JSON body) |
| `/ccrelay/api/providers/export` | POST | Export providers by ID |
| `/ccrelay/api/providers/import` | POST | Import providers (merge by ID) |
| `/ccrelay/api/queue` | GET | Queue statistics |
| `/ccrelay/api/logs` | GET | Request logs |
| `/ccrelay/api/config` | GET, PATCH | Read/write config sections |
| `/ccrelay/ws` | WebSocket | Follower sync |
| `/ccrelay/` | GET | Web UI dashboard |

All other requests are proxied to the current provider.

---

## Commands

| Command | ID | Description |
|---------|-----|-------------|
| CCRelay: Show Menu | `ccrelay.showMenu` | Show main menu |
| CCRelay: Switch Provider | `ccrelay.switchProvider` | Provider picker |
| CCRelay: Start Server | `ccrelay.startServer` | Start server |
| CCRelay: Stop Server | `ccrelay.stopServer` | Stop server |
| CCRelay: Open Settings | `ccrelay.openSettings` | Extension settings |
| CCRelay: Show Logs | `ccrelay.showLogs` | Output logs |
| CCRelay: Clear Logs | `ccrelay.clearLogs` | Clear output logs |
| CCRelay: Open Dashboard | `ccrelay.openWebUI` | Web dashboard |

---

## Development

```bash
npm run compile        # Type-check
npm run watch          # Watch & recompile
npm run lint           # Lint
npm run format         # Format
npm run test           # Unit tests
npm run test:integration
npm run test:all
npm run test:coverage
npm run package        # Build VSIX
npm run build:dev      # Dev build
npm run build:prod     # Prod build

# Electron desktop app
npm run desktop:start
npm run desktop:pack:mac
npm run desktop:pack:win

# Tauri desktop app
npm run tauri:dev
npm run tauri:pack:mac
npm run tauri:pack:win
```

### Project Structure

```
ccrelay/
├── packages/
│   ├── core/              # Shared runtime (proxy, config, converters)
│   ├── vscode/            # VS Code extension
│   ├── desktop/           # Electron desktop app
│   └── desktop-tauri/     # Tauri desktop app
├── web/                   # Web UI (React + Vite)
├── tests/                 # Vitest unit + integration
├── scripts/               # Build & packaging helpers
└── dists/                 # Packaged .vsix
```

---

## File Locations

| File | Location | Description |
|------|----------|-------------|
| Config | `~/.ccrelay/config.yaml` | Main config (auto-created) |
| State | `~/.ccrelay/state.json` | Active provider ID |
| IPC lock | `~/.ccrelay/ccrelay-lock.sock` (Unix) / named pipe (Win) | Leader election |
| Log DB | `~/.ccrelay/logs.db` | Request logs (Leader only) |

---

## TODO

- macOS: Apple Developer ID signing + notarization in CI to remove Gatekeeper prompts
- Re-enable DMG packaging once signing works

---

## Contributing

Issues and Pull Requests are welcome!

---

## Acknowledgments

This project is **100% AI-generated code**. Special thanks to:

- **[Claude Code](https://claude.ai/code)** — AI coding assistant
- **[GLM](https://z.ai/model-api)** — GLM models as the backend provider

---

## License

[MIT License](LICENSE)

Copyright (c) 2026 [inflab.org](https://inflab.org)
