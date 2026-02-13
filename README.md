# CCRelay

[![VSCode Extension](https://img.shields.io/badge/VSCode-Extension-blue)](https://code.visualstudio.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**CCRelay** is a VSCode extension with a built-in API proxy server that allows you to seamlessly switch between different AI providers without losing conversation context. Fully compatible with Claude Code and other Anthropic API clients.

**Website**: [https://ccrelay.inflab.org](https://ccrelay.inflab.org)

**[中文文档 (Chinese Documentation)](./README_CN.md)**

---

## Table of Contents

- [Core Features](#core-features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Usage Guide](#usage-guide)
  - [Basic Setup](#basic-setup)
  - [Multi-Instance Mode](#multi-instance-mode)
  - [Provider Modes](#provider-modes)
  - [Model Mapping](#model-mapping)
  - [OpenAI Format Conversion](#openai-format-conversion)
  - [Web UI Dashboard](#web-ui-dashboard)
- [Configuration](#configuration)
  - [VSCode Settings](#vscode-settings)
  - [YAML Configuration File](#yaml-configuration-file)
- [API Endpoints](#api-endpoints)
- [Commands](#commands)
- [Development](#development)
- [File Locations](#file-locations)
- [License](#license)

---

## Core Features

- **Built-in API Proxy Server**: Runs a local HTTP server (default: `http://127.0.0.1:7575`) that proxies requests to different AI providers
- **Multi-Instance Coordination**: Leader/Follower mode for multiple VSCode windows - only one instance runs the server
- **Status Bar Indicator**: Shows current provider, role (Leader/Follower/Standalone), and server status
- **Quick Provider Switching**: Click the status bar or use commands to switch providers
- **Provider Modes**:
  - `passthrough` - Preserves original authentication headers for official API
  - `inject` - Injects provider-specific API Key
- **Model Mapping**: Automatically translates Claude model names to provider-specific models with wildcard support (e.g., `claude-*` → `glm-4.7`)
- **Vision Model Mapping**: Separate model mapping for visual/multimodal requests (`vlModelMap`)
- **OpenAI Format Conversion**: Automatically converts Anthropic API format to OpenAI format, supporting Gemini, OpenRouter, and other OpenAI-compatible APIs
- **Request Logging**: Optional SQLite/PostgreSQL request/response logging with Web UI viewer
- **Concurrency Control**: Built-in request queue and concurrency limits to prevent API overload
- **Auto-start**: Automatically starts the proxy server when VSCode launches

---

## Requirements

- VSCode version 1.80.0 or higher
- Node.js (for development)

---

## Installation

### Install from VSIX

1. Download the latest `.vsix` file
2. In VSCode, press `Cmd+Shift+P` (macOS) or `Ctrl+Shift+P` (Windows/Linux)
3. Type `Extensions: Install from VSIX...`
4. Select the downloaded `.vsix` file

### Build from Source

```bash
# Clone the repository
git clone https://github.com/inflaborg/ccrelay.git
cd ccrelay

# Install dependencies
npm install

# Build the extension
npm run build

# Package VSIX
npm run package
```

### Development Mode

```bash
# Install dependencies
npm install

# Compile
npm run compile

# Press F5 in VSCode to open Extension Development Host window
```

---

## Quick Start

### 1. Configure Claude Code to use the proxy

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:7575
claude
```

### 2. Configure providers

Add provider configuration in VSCode settings:

```json
{
  "ccrelay.provider.list": {
    "official": {
      "name": "Claude Official",
      "baseUrl": "https://api.anthropic.com",
      "mode": "passthrough"
    },
    "glm": {
      "name": "Z.AI-GLM-5",
      "baseUrl": "https://api.z.ai/api/anthropic",
      "mode": "inject",
      "apiKey": "<YOUR-API-KEY>",
      "modelMap": {
        "claude-opus-*": "glm-5",
        "claude-sonnet-*": "glm-5",
        "claude-haiku-*": "glm-4.7"
      }
    }
  }
}
```

### 3. Switch providers

- Click the CCRelay icon in the VSCode status bar at the bottom
- Or use Command Palette: `CCRelay: Switch Provider`

---

## Usage Guide

### Basic Setup

1. Install and enable the extension
2. Configure providers in VSCode settings
3. The server will auto-start (configurable via `ccrelay.server.autoStart`)
4. Click the status bar to switch providers or access the menu

### Multi-Instance Mode

When multiple VSCode windows are open:

- One instance becomes the **Leader** and runs the HTTP server
- Other instances become **Followers** and connect to the Leader
- If the Leader closes, a Follower automatically becomes the new Leader
- Status bar shows your role: `$(broadcast)` for Leader, `$(radio-tower)` for Follower

### Provider Modes

#### Passthrough Mode (Official Claude API)

- Preserves original authentication headers
- Used for official Claude API with OAuth sessions
- No API key required

#### Inject Mode (Third-party Providers)

- Replaces authentication with provider-specific API Key
- Requires API key configuration
- Supports GLM, OpenRouter, and other Claude-compatible APIs

### Model Mapping

Supports wildcard pattern matching for model names:

```json
{
  "modelMap": {
    "claude-opus-*": "glm-5",
    "claude-sonnet-*": "glm-4.7",
    "claude-haiku-*": "glm-4.5"
  }
}
```

**Vision Model Mapping**: For requests containing images, you can configure `vlModelMap` separately:

```json
{
  "modelMap": {
    "claude-*": "text-model"
  },
  "vlModelMap": {
    "claude-*": "vision-model"
  }
}
```

### OpenAI Format Conversion

> 📋 **Feature Note**: OpenAI format conversion enables CCRelay to work with OpenAI-compatible providers (Gemini, OpenRouter, etc.). This feature handles bidirectional conversion between Anthropic and OpenAI API formats. If you encounter any compatibility issues, please report them on GitHub.

CCRelay supports OpenAI-compatible providers (like Gemini):

```json
{
  "gemini": {
    "name": "Gemini",
    "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai",
    "providerType": "openai",
    "mode": "inject",
    "apiKey": "<YOUR-API-KEY>",
    "modelMap": {
      "claude-*": "gemini-3-pro-preview"
    }
  }
}
```

Conversion process:
- **Request**: Anthropic Messages API format → OpenAI Chat Completions format
- **Response**: OpenAI format → Anthropic format

### Web UI Dashboard

CCRelay has a built-in Web UI dashboard that provides:

- **Dashboard**: Server status, current provider, request statistics
- **Providers**: View and switch providers
- **Logs**: Request/response log viewer (requires enabling log storage)

![Request Logs](docs/screenshot-ccrelay-1.png)

![Log Details](docs/screenshot-ccrelay-3.png)

Access methods:
- Command Palette: `CCRelay: Open Web UI`
- Browser: `http://127.0.0.1:7575/ccrelay/`

---

## Configuration

### VSCode Settings

#### Server Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `ccrelay.server.port` | `7575` | Proxy server port |
| `ccrelay.server.host` | `127.0.0.1` | Proxy server host |
| `ccrelay.server.autoStart` | `true` | Automatically start server on VSCode startup |

#### Config File Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `ccrelay.config.useFile` | `false` | Read configuration from `~/.ccrelay/config.yaml` |

#### Provider Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `ccrelay.provider.default` | `official` | Default provider ID |
| `ccrelay.provider.list` | `{...}` | Provider configurations |

Each provider supports:
- `name` - Display name
- `baseUrl` - API base URL
- `mode` - `passthrough` or `inject`
- `providerType` - `anthropic` (default) or `openai`
- `apiKey` - API key (inject mode, supports `${ENV_VAR}` environment variables)
- `authHeader` - Authorization header name (default: `authorization`)
- `modelMap` - Model name mappings (supports wildcards)
- `vlModelMap` - Vision model mappings (for multimodal requests)
- `headers` - Custom request headers
- `enabled` - Whether enabled (default: `true`)

#### Routing Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `ccrelay.route.patterns` | `["/v1/messages", "/messages"]` | Paths routed to current provider |
| `ccrelay.route.passthroughPatterns` | `["/v1/users/*", "/v1/organizations/*"]` | Paths always going to official API |
| `ccrelay.route.blockPatterns` | `[{path: "/api/event_logging/*", response: "..."}]` | Paths returning custom response in inject mode |
| `ccrelay.route.openaiBlockPatterns` | `[]` | Block patterns for OpenAI providers |

#### Concurrency Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `ccrelay.concurrency.enabled` | `false` | Enable concurrency control |
| `ccrelay.concurrency.maxConcurrency` | `5` | Maximum concurrent requests |
| `ccrelay.concurrency.maxQueueSize` | - | Maximum queued requests (0 or unset = unlimited) |
| `ccrelay.concurrency.timeout` | - | Request timeout in milliseconds |

#### Logging Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `ccrelay.log.enableStorage` | `false` | Enable request/response logging to database |

#### Database Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `ccrelay.database.type` | `sqlite` | Database type (`sqlite` or `postgres`) |
| `ccrelay.database.sqlitePath` | `""` | SQLite database file path (default: `~/.ccrelay/logs.db`) |
| `ccrelay.database.postgresHost` | `localhost` | PostgreSQL server host |
| `ccrelay.database.postgresPort` | `5432` | PostgreSQL server port |
| `ccrelay.database.postgresDatabase` | `ccrelay` | PostgreSQL database name |
| `ccrelay.database.postgresUser` | `""` | PostgreSQL username |
| `ccrelay.database.postgresPassword` | `""` | PostgreSQL password (supports `${ENV_VAR}`) |
| `ccrelay.database.postgresSsl` | `false` | Enable SSL connection |

#### UI Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `ccrelay.ui.statusBarPosition` | `right` | Status bar position (`left` or `right`) |
| `ccrelay.ui.statusBarPriority` | `100` | Status bar priority |

### Complete Configuration Example

#### VSCode settings.json

```json
{
  "ccrelay.server.port": 7575,
  "ccrelay.server.autoStart": true,

  "ccrelay.route.blockPatterns": [
    {
      "path": "/api/event_logging/*",
      "response": "",
      "responseCode": 200
    }
  ],
  "ccrelay.route.passthroughPatterns": [
    "/v1/users/*",
    "/v1/organizations/*"
  ],
  "ccrelay.route.patterns": [
    "/v1/messages",
    "/messages"
  ],
  "ccrelay.route.openaiBlockPatterns": [
    {
      "path": "/v1/messages/count_tokens",
      "response": "{\"input_tokens\": 0}",
      "responseCode": 200
    }
  ],

  "ccrelay.concurrency.enabled": true,
  "ccrelay.concurrency.maxConcurrency": 3,

  "ccrelay.log.enableStorage": true,
  "ccrelay.database.type": "sqlite",

  "ccrelay.provider.list": {
    "official": {
      "name": "Claude Official",
      "baseUrl": "https://api.anthropic.com",
      "mode": "passthrough"
    },
    "glm": {
      "name": "Z.AI-GLM-5",
      "baseUrl": "https://api.z.ai/api/anthropic",
      "mode": "inject",
      "authHeader": "authorization",
      "apiKey": "<YOUR-API-KEY>",
      "modelMap": {
        "claude-opus-*": "glm-5",
        "claude-sonnet-*": "glm-5",
        "claude-haiku-*": "glm-4.7"
      }
    },
    "gemini": {
      "name": "Gemini",
      "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai",
      "providerType": "openai",
      "mode": "inject",
      "authHeader": "authorization",
      "apiKey": "<YOUR-API-KEY>",
      "modelMap": {
        "claude-*": "gemini-3-pro-preview"
      }
    }
  }
}
```

#### YAML Configuration File (`~/.ccrelay/config.yaml`)

Enable with: `ccrelay.config.useFile: true`

```yaml
server:
  port: 7575
  host: 127.0.0.1

defaultProvider: official

providers:
  official:
    name: Claude Official
    baseUrl: https://api.anthropic.com
    mode: passthrough

  glm:
    name: Z.AI-GLM-5
    base_url: https://api.z.ai/api/anthropic
    mode: inject
    api_key: ${GLM_API_KEY}
    auth_header: authorization
    model_map:
      "claude-opus-*": "glm-5"
      "claude-haiku-*": "glm-4.7"

  gemini:
    name: Gemini
    base_url: https://generativelanguage.googleapis.com/v1beta/openai
    provider_type: openai
    mode: inject
    api_key: ${GEMINI_API_KEY}
    model_map:
      "claude-*": "gemini-3-pro-preview"

routePatterns:
  - /v1/messages
  - /messages

passthroughPatterns:
  - /v1/users/*
  - /v1/organizations/*

blockPatterns:
  - path: /api/event_logging/*
    response: '{"ok": true}'
    responseCode: 200

concurrency:
  enabled: true
  maxConcurrency: 3

enableLogStorage: true
```

> **Note**: YAML config supports both `camelCase` and `snake_case` keys.

---

## API Endpoints

The proxy server exposes management endpoints at `/ccrelay/`:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/ccrelay/status` | GET | Get current proxy status |
| `/ccrelay/providers` | GET | List all available providers |
| `/ccrelay/switch/{id}` | GET | Switch to a provider by ID |
| `/ccrelay/switch` | POST | Switch provider (JSON body) |
| `/ccrelay/` | GET | Web UI dashboard |

All other requests are proxied to the current provider.

---

## Commands

| Command | ID | Description |
|---------|-----|-------------|
| CCRelay: Show Menu | `ccrelay.showMenu` | Show main menu |
| CCRelay: Switch Provider | `ccrelay.switchProvider` | Open provider picker |
| CCRelay: Start Server | `ccrelay.startServer` | Manually start the server |
| CCRelay: Stop Server | `ccrelay.stopServer` | Stop the server |
| CCRelay: Open Settings | `ccrelay.openSettings` | Open extension settings |
| CCRelay: Show Logs | `ccrelay.showLogs` | View output logs |
| CCRelay: Clear Logs | `ccrelay.clearLogs` | Clear output logs |
| CCRelay: Open Web UI | `ccrelay.openWebUI` | Open Web dashboard |

---

## Development

```bash
# Compile TypeScript
npm run compile

# Watch for changes and recompile
npm run watch

# Run ESLint
npm run lint

# Auto-fix lint issues
npm run lint:fix

# Format code
npm run format

# Run unit tests
npm run test:unit

# Run tests with coverage
npm run test:coverage

# Build VSIX package
npm run package

# Development build
npm run build:dev

# Production build
npm run build:prod
```

### Project Structure

```
ccrelay/
├── src/
│   ├── extension.ts          # Extension entry point
│   ├── api/                  # API endpoint handlers
│   ├── config/               # Configuration management
│   ├── converter/            # Anthropic ↔ OpenAI format conversion
│   ├── database/             # Database drivers (SQLite/PostgreSQL)
│   ├── queue/                # Concurrency control and request queue
│   ├── server/               # HTTP server and routing
│   ├── types/                # TypeScript type definitions
│   ├── utils/                # Utility functions
│   └── vscode/               # VSCode integration (status bar, log viewer)
├── web/                      # Web UI (React + Vite)
├── tests/                    # Test files
└── assets/                   # Extension assets
```

---

## File Locations

| File | Location | Description |
|------|----------|-------------|
| VSCode Settings | VSCode `settings.json` | Primary configuration (default) |
| YAML Config | `~/.ccrelay/config.yaml` | Alternative config (requires `ccrelay.config.useFile: true`) |
| Log database | `~/.ccrelay/logs.db` | Request/response logs (when enabled) |

---

## Contributing

Issues and Pull Requests are welcome!

---

## Acknowledgments

This project is **100% AI-generated code**. Special thanks to:

- **[Claude Code](https://claude.ai/code)** - The AI coding assistant that wrote all the code
- **[GLM](https://www.z.ai/)** - GLM models (glm-4.7, later glm-5) served as the backend provider

---

## License

[MIT License](LICENSE)

Copyright (c) 2026 [inflab.org](https://inflab.org)
