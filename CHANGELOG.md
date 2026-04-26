# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Per-provider optional **`openaiChatCompletionsPath`**: path appended to `baseUrl` for OpenAI Chat Completions when converting (Anthropic→OpenAI, Responses→Chat hub); default `/chat/completions` so providers whose `baseUrl` already ends in a version segment (e.g. some Z.AI URLs) are not given an extra `/v1` in the path. Web dashboard and `POST /ccrelay/api/providers` accept the field.
- **LLM router**: detect inbound API surface from path/method (`ApiSurface`: Anthropic Messages, OpenAI Chat Completions, OpenAI Responses) and convert only when it does not match the provider’s `providerType`; same-family traffic passes through aside from model mapping and auth.
- OpenAI **`POST /v1/responses`** support: requests are converted via a Chat Completions hub to OpenAI-compatible or Anthropic upstreams; responses are converted back to the Responses JSON shape. Hosted-only tools (e.g. web search, MCP) are stripped in v1 with a warning.
- Default `routing.proxy` entries for `/v1/chat/completions`, `/v1/models`, and `/v1/responses`; `GET /v1/models` fallback builds a minimal model list from provider `modelMap` when the upstream errors.
- Converters: Responses ↔ Chat Completions (`responses-to-chat-completions`, `chat-completions-to-responses`), plus existing Anthropic ↔ Chat bidirectional conversion for cross-protocol paths.
- Unit tests for surface detection and new converters.

### Fixed

- **OpenAI Responses + `stream: true` (e.g. Codex)**: Clients that send `stream: true` on `POST /v1/responses` expect an **SSE** body (`text/event-stream`) with `response.completed` (and similar) events, not a single `application/json`. Cross-protocol mode still uses a non-streaming upstream, but when the client had requested streaming, the proxy **synthesizes** a stream: `response.created` → `response.output_item.added` → `response.output_text.delta` / `response.output_text.done` → `response.output_item.done` → `response.completed` → `data: [DONE]` (falls back to `created`+`completed`+`[DONE]` when there is no assistant text, e.g. tool-only). Chat Completions `message.content` as an array of `{ type, text }` parts is merged for `output_text` so the UI is not empty when the upstream returns multipart content. Set `CCRELAY_LOG_RESPONSES_SSE=1` to log the first part of the synthetic SSE (debugging empty-Codex issues).
- **Proxy / Responses API**: After a successful cross-protocol JSON response (e.g. Chat Completions → Responses for Codex), the listener on the client `ServerResponse` was not removed. Node emits `close` on that object when the response finishes normally, which was mis-handled as a client disconnect and could abort the upstream request and log `499` / `Client disconnected during streaming` even when the client received `200`. JSON conversion paths now call `res.off("close", ...)` when the upstream body is fully read, matching buffered passthrough behavior.

### Changed

- **Build**: `build:web` runs `npm install` in `web/` before build; root `postinstall` installs `web/` dependencies so packaging works on a clean clone.
- Cross-protocol **streaming** remains unsupported: `stream` is forced off for conversion paths; SSE from upstream in those cases returns a clear error unless client and upstream share the same API family.

### Dependencies

- **npm overrides**: `uuid` pinned to `^14.0.0` to satisfy transitive `@vscode/vsce` → `@azure/*` audit ([GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq)); do not use `npm audit fix --force` if it suggests downgrading `@vscode/vsce`.

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
