# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Dashboard — Duplicate provider**: Context menu "Duplicate" asks for **display name** only; the new id is **always** `sourceId + "_copy"` (read-only) so it matches YAML and Edit. `POST /ccrelay/api/providers/duplicate` copies the full provider (including API key). Edit modal binds the Provider ID field to `editingProvider.id` (not only `formData`) so the open row and the form stay in sync.
- Per-provider **`modelsListFormat`** (`auto` | `openai` | `anthropic`, default `auto`): for `GET /v1/models` there is no body, so the inbound client surface and error fallback list shape are driven by this setting. `auto` matches `providerType`. Web dashboard (“GET /v1/models wire”) and YAML/API accept the field.
- Per-provider optional **`openaiChatCompletionsPath`**: path appended to `baseUrl` for OpenAI Chat Completions when converting (Anthropic→OpenAI, Responses→Chat hub); default `/chat/completions` so providers whose `baseUrl` already ends in a version segment (e.g. some Z.AI URLs) are not given an extra `/v1` in the path. Web dashboard and `POST /ccrelay/api/providers` accept the field.
- **LLM router**: detect inbound API surface from path/method (`ApiSurface`: Anthropic Messages, OpenAI Chat Completions, OpenAI Responses) and convert only when it does not match the provider’s `providerType`; same-family traffic passes through aside from model mapping and auth.
- OpenAI **`POST /v1/responses`** support: requests are converted via a Chat Completions hub to OpenAI-compatible or Anthropic upstreams; responses are converted back to the Responses JSON shape. Hosted-only tools (e.g. web search, MCP) are stripped in v1 with a warning.
- Default `routing.proxy` entries for `/v1/chat/completions`, `/v1/models`, and `/v1/responses`; `GET /v1/models` error fallback builds a minimal model list from `modelMap` in OpenAI or Anthropic shape per `modelsListFormat`.
- Converters: Responses ↔ Chat Completions (`responses-to-chat-completions`, `chat-completions-to-responses`), plus existing Anthropic ↔ Chat bidirectional conversion for cross-protocol paths.
- Unit tests for surface detection and new converters.

### Fixed

- **Config load — provider id keys**: `expandEnvVarsInObject` was converting every object key from snake_case to camelCase, including keys under `providers` (which are **provider ids**, not field names). Ids like `minimax-m2-5_copy` were corrupted to `minimax-m2-5Copy` (the `_c` in `_copy` was turned into `C`), so the duplicate UI showed `…_copy` but the list/API showed `…Copy` after reload. **Provider map keys are now preserved;** only nested config fields (e.g. `base_url`) are normalized.
- **Dashboard — delete provider**: `DELETE /ccrelay/api/providers/:id` used a strict path segment regex that could miss valid ids; the client now uses `encodeURIComponent`, the server accepts any single path segment, and `resolveProviderKeyInMap` maps the request to the YAML key. Duplicate id variants: `…Copy` in the request align with `…_copy` in the file **only** among `isDuplicateStyleProviderId` keys, so a source id like `minimax-m2-5` does not collide with `minimax-m2-5_copy` (same fuzzy base) and the wrong row is not dropped. The duplicate modal rewrites a mistyped `source+Copy` to `source+_copy` and warns that `…Copy` and `…_copy` are different ids.
- **Chat → Anthropic (`tool_choice`)**: OpenAI-style string values (`"auto"`, `"none"`, `"required"`) are now mapped to Anthropic Messages object form (`{"type":"auto"}`, etc.); `tool_choice` is omitted when there are no tools. This matches strict Anthropic-compatible gateways (Pydantic) and the real API. Responses `tool_choice: "required"` is passed through as OpenAI `"required"` then mapped to Anthropic `{"type":"any"}`.
- **OpenAI Responses + `stream: true` (e.g. Codex)**: Clients that send `stream: true` on `POST /v1/responses` expect an **SSE** body (`text/event-stream`) with `response.completed` (and similar) events, not a single `application/json`. Cross-protocol mode still uses a non-streaming upstream, but when the client had requested streaming, the proxy **synthesizes** a stream: `response.created` → per-`output` item events. For `message` items: `response.output_item.added` → `response.output_text.delta` / `response.output_text.done` → `response.output_item.done`. For `function_call` items: `response.output_item.added` (in progress) → `response.function_call_arguments.delta` / `response.function_call_arguments.done` → `response.output_item.done` — so tool runners (e.g. Codex) see tool calls in the event stream, not only inside the final `response.completed`. Unknown item types get `output_item.added` / `output_item.done` only. `response.created`+`response.completed`+`[DONE]` (minimal) is used only when `output` is empty. Chat Completions `message.content` as an array of `{ type, text }` parts is merged for `output_text` so the UI is not empty when the upstream returns multipart content. Set `CCRELAY_LOG_RESPONSES_SSE=1` to log the first part of the synthetic SSE (debugging empty-Codex issues).
- **Proxy / Responses API**: After a successful cross-protocol JSON response (e.g. Chat Completions → Responses for Codex), the listener on the client `ServerResponse` was not removed. Node emits `close` on that object when the response finishes normally, which was mis-handled as a client disconnect and could abort the upstream request and log `499` / `Client disconnected during streaming` even when the client received `200`. JSON conversion paths now call `res.off("close", ...)` when the upstream body is fully read, matching buffered passthrough behavior.

### Changed

- **Web dashboard (add / save / delete provider)**: When persisting providers through `POST /ccrelay/api/providers` or `DELETE`, the `providers` map in the YAML file is **rewritten in a stable key order** (`official` first if present, then other ids sorted with English locale and numeric awareness). This keeps config diffs readable and list order consistent with the file (`sortProviderMapKeys` before each write).
- **`GET /v1/models`**: Default inbound surface is no longer always OpenAI: with `modelsListFormat: auto` (default), it follows the provider’s `providerType`, so same-family clients get passthrough and Anthropic-shaped fallback when the upstream errors. Set `modelsListFormat: openai` to preserve the previous “always OpenAI list” behavior for OpenAI clients against Anthropic upstreams.
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
