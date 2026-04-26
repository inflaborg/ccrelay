# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.6] - 2026-04-26

### Added

- **Web dashboard**
  - **Client configuration** for Claude Code: read/apply `~/.claude/settings.json` `env` (e.g. `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` placeholder) and optional per-tier `ANTHROPIC_DEFAULT_OPUS/SONNET/HAIKU` with UI **Configure default models** and suggested model ids.
  - **Duplicate provider**: duplicate from context menu; new id is always `sourceId + "_copy"`; `POST /ccrelay/api/providers/duplicate` copies the full row including API key; provider id in the editor stays bound to the list row.
- **OpenAI `POST /v1/responses`**: full cross‑protocol path (Chat Completions hub to OpenAI or Anthropic upstream, convert back to Responses JSON); default `routing.proxy` includes `/v1/chat/completions`, `/v1/models`, `/v1/responses`.
- **LLM router** (`ApiSurface`): infer Anthropic Messages vs OpenAI Chat vs Responses from path/method; convert only when the wire does not match `providerType`; same‑family traffic passes through (aside from `modelMap` and auth). Hosted tools (e.g. web search, MCP) stripped in v1 with a warning.
- **Per provider**
  - `modelsListFormat` (`auto` \| `openai` \| `anthropic`, default `auto`): controls inbound face for `GET /v1/models` and synthetic list on upstream error; `auto` follows `providerType`. Dashboard: **GET /v1/models wire**; YAML/API.
  - `openaiChatCompletionsPath` (default `/chat/completions`): for conversion paths, avoids an extra `/v1` when `baseUrl` already has a version segment. Dashboard and `POST /ccrelay/api/providers` accept the field.
- **Converters and tests**: Responses ↔ Chat Completions; Anthropic ↔ Chat for cross‑protocol; unit tests for surface detection and new converters.
- **Synthetic SSE for `POST /v1/responses` with `stream: true` (e.g. Codex)**: when cross‑protocol and upstream is non‑streaming, emit `text/event-stream` with `response.*` and tool events; merge multipart `message.content` for `output_text`. Use `CCRELAY_LOG_RESPONSES_SSE=1` to debug. Empty `output` falls back to minimal `response.created` / `response.completed` / `[DONE]`.

### Fixed

- **Config load / YAML `providers` keys**: do not rewrite provider **ids** when normalizing (e.g. `minimax-m2-5_copy` was turned into `…Copy`); only nested field names (e.g. `base_url`) are normalized. Duplicate UI and file stay aligned.
- **Delete / duplicate by id**: `DELETE /ccrelay/api/providers/:id` uses encoded segments and resolves YAML keys; `…Copy` vs `…_copy` for duplicate-style ids do not drop the wrong row; modal fixes mistyped `Copy` to `_copy` when appropriate.
- **Chat → Anthropic `tool_choice`**: map OpenAI string values (`auto`, `none`, `required`) to Anthropic object form; omit when there are no tools. Responses `required` → Anthropic `{"type":"any"}`.
- **Proxy / Responses (JSON)**: remove `res` `close` listener when conversion finishes so Node does not treat normal completion as client disconnect (fixes spurious 499 and upstream aborts after `200`).

### Changed

- **Provider YAML on write** (`add` / `save` / `delete`): `providers` map keys in **stable order** — `official` first if present, then other ids sorted (English locale, numeric-aware) for readable diffs.
- **`GET /v1/models`**: with `modelsListFormat: auto`, inbound surface and fallback list follow the provider’s `providerType` (use `openai` to keep previous “always OpenAI-shaped list” for OpenAI clients to Anthropic upstreams).
- **Build / packaging**: `build:web` runs `npm install` in `web/`; root `postinstall` installs `web/` dependencies for clean clones and CI.
- **Cross-protocol**: streaming remains disabled on conversion paths; `stream` forced off where converted; non–same-family SSE returns a clear error.

### Documentation

- README / README_CN: Quick Start and Claude Code section centered on `~/.claude/settings.json`; **Web UI** section documents **Client configuration** and default-model screenshots; dashboard images use `raw.githubusercontent.com` for stable absolute URLs in marketplace views.

### Dependencies

- `uuid` override `^14.0.0` for transitive `@vscode/vsce` / `@azure/*` audit [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq); avoid `npm audit fix --force` if it would downgrade `@vscode/vsce`.

## [0.1.5] - 2025-02-27

### Added

- Add 429 retry handling to concurrency manager for better rate limit resilience ([#20](https://github.com/anthropics/ccrelay/pull/20))
- Add Tools tab to display parsed tools array from request body in log details
- Add Markdown viewer component with syntax highlighting support
- Add `useHashTab` hook to sync active tab state with URL hash (supports dashboard/providers/logs)
- Add WebSocket heartbeat mechanism with 30s ping interval and client liveness tracking
- Add package-lock.json for reproducible dependency installation

### Changed

- Move SQLite database operations to a dedicated worker thread to avoid blocking the main event loop ([#21](https://github.com/anthropics/ccrelay/pull/21))
- Refactor `PriorityQueue` to use binary heap implementation for O(log n) enqueue/dequeue operations
- Update logger to support non-VSCode environments (worker threads) with console fallback

### Dependencies

- Add `react-markdown`, `remark-gfm`, `react-syntax-highlighter`, `@tailwindcss/typography` for Markdown rendering
- Bump `@eslint/js` to 10.0.1
- Regenerate package-lock with updated metadata

### CI/CD

- Replace `npm ci` with `npm install` across all GitHub workflows for consistency
