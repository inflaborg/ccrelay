# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Desktop tray app (Electron)**: packaged `CCRelay` app with system tray, shared `~/.ccrelay` config and leader election with the VS Code extension. **Open Dashboard** loads the `/ccrelay/` web UI inside an Electron `BrowserWindow` over HTTP; duplicate launches focus that window.
- **CI desktop installers**: GitHub Actions `build-dev-auto`, `build-dev-manual`, and `build-prod` workflows build desktop artifacts after the VSIX — matrix **macOS** (`x64` + `arm64`, **zip only**; DMG removed because unsigned electron-builder DMGs on CI produced invalid zlib blobs, not openable UDIF disks) and **Windows** (`x64` + `arm64`, NSIS `.exe`). `build-dev-auto` and `build-prod` aggregate assets into a prerelease/release; `build-dev-manual` uploads workflow artifacts only.
- **`providerType` split**: `providerType` now has three values — `"anthropic"` (unchanged), `"openai"` (full passthrough — both Chat Completions and Responses API are forwarded without conversion), `"openai_chat"` (Chat Completions only — Responses API requests are converted to Chat Completions before forwarding). Existing `"openai"` configs are treated as full passthrough; update to `"openai_chat"` to preserve the previous Responses→Chat conversion behavior.
- **Synthetic SSE for `POST /v1/chat/completions` with `stream: true` (cross-protocol)**: when upstream returns non-streaming but the client requested streaming, ccrelay emits `text/event-stream` with `chat.completion.chunk` deltas (text, thinking, tool calls) and `[DONE]`. Previously this path only existed for `POST /v1/responses`.
- **Cross-protocol `GET /v1/models` conversion**: when the client's API surface (OpenAI vs Anthropic) differs from the upstream provider type, the response is automatically converted to the client's expected format.
- **Cross-protocol error format conversion**: error responses (status >= 400) are re-wrapped to match the client's expected API surface — Anthropic `{ type, error: { type, message } }` or OpenAI `{ error: { type, message, code } }` shapes.
- **`GET /v1/models`**: model list now shows both pattern names and target model names from `modelMap`, with deduplication when they match.
- **Converters**: `convertOpenAIModelsToAnthropic` and `convertAnthropicModelsToOpenAI` for bidirectional models list format conversion.
- **Config hot-reload**: `ConfigManager` now watches the YAML config file with `fs.watch` (300ms debounce). External edits to `~/.ccrelay/config.yaml` are picked up automatically without needing to click Reload.
- **Config change event bus**: `ConfigManager.onConfigChanged` event notifies all subscribers (status bar, server, WebSocket broadcaster) when config is reloaded, whether from file watch or API mutation.
- **WebSocket `config_changed` broadcast**: Leader broadcasts config changes to all Follower instances via WebSocket, so Followers reload their local config automatically.
- **Duplicate provider: editable New provider ID**: the Duplicate dialog now lets you customize the new provider ID instead of being locked to `<sourceId>_copy`.
- **Codex model input**: applying the Codex CCRelay template now shows a model input dialog before writing `~/.codex/config.toml`, defaulting to `gpt-5.4-mini` when left empty (replaces the previous hardcoded `glm-5-turbo`).
- **Codex "Configure model" button**: the Codex section of Client configuration now shows the current model value and a "Configure model" button (like Claude Code's "Configure default models") that patches only the `model` field in an existing `~/.codex/config.toml` without replacing the full file. Backend exposes `model` in the GET response and accepts `patchCodexModelOnly` in the apply POST body.
- **Provider protocol badge**: each provider card now displays a colored protocol label (Anthropic / OpenAI / OpenAI Chat) in the top-right corner for quick identification.
- **Settings tab**: new dashboard tab exposes all YAML config groups — Logging (toggle, database type/path/host/port), Concurrency (maxWorkers, maxQueueSize, requestTimeout, retry429), Server (port, host, autoStart), and Routing (forward rules, block rules). Changes are persisted via `PATCH /ccrelay/api/config`; concurrency and routing settings hot-reload, while server and logging changes require a restart.
- **Unified routing config**: replaced `routing.proxy`/`routing.passthrough`/`routing.block`/`routing.openaiBlock` with two unified constructs: `routing.forward` (path → provider mapping, first match wins) and `routing.block` (path + optional `condition.kind` filter → custom response). Unmatched paths now return 404 instead of silently routing to the current provider. Old config files are auto-migrated at load time.
- **Config version tracking**: added `configVersion` field to the YAML config (set to `"0.2.0"`). Legacy configs without this field are automatically migrated and rewritten with the version stamp on first load.
- **Streaming Chat→Responses SSE** (`chat-completions-streaming-to-responses`): for `POST /v1/responses` with `stream: true` and upstream `openai_chat`, converts Chat Completions SSE to OpenAI Responses API SSE in real time (e.g. `reasoning_content` → `response.reasoning_text.*`, assistant text wrapped in `content_part` / `output_text` events). Emits `event:` lines alongside `data:`, plus `response.created`, `response.in_progress`, and schema-aligned shells.
- **Responses request echo** (`responses-echo`, plumbed via `originalResponsesEcho`): echoes client `tools` (function definitions and nested `namespace` tools only — hosted tools omitted to match upstream stripping), plus `reasoning`, `text`, `tool_choice`, `parallel_tool_calls`, `instructions`, `metadata`, `truncation`, `store`, etc. into `response.*` for both streaming SSE and non-streaming `convertChatCompletionToResponses` JSON.
- **Build fingerprint**: `scripts/generate-version.mjs` adds a random per-build `BUILD_HASH`; `/ccrelay/api/version` and extension activation log expose `hash` / `gitHash` so running VSIX matches the packaged build.

### Changed

- **Desktop packaging**: Electron `build.mac` (`identity: null`, **zip** targets only) / `build.win` declare **`x64` and `arm64`** explicitly. Packaged desktop **app icons** are generated from `packages/vscode/assets/icon.svg`.
- **Windows / Linux Electron window**: removes the default in-window menu bar (**File / Edit / View / Window**) via `Menu.setApplicationMenu(null)`; macOS continues to use the system menu bar only.
- **Converter simplification**: `convertRequestToOpenAI`, `convertOpenAIRequestToAnthropic`, and `convertResponsesRequestToChatCompletions` no longer accept a `provider` parameter for custom path resolution — paths are now deterministic (`/chat/completions` for OpenAI, `/v1/messages` for Anthropic).
- **Cross-protocol conversion guard**: `needsConversion` and upstream wire detection now correctly distinguish all three provider types (`"anthropic"`, `"openai"`, `"openai_chat"`) instead of treating anything non-Anthropic as full OpenAI passthrough.
- **Model Map field**: no longer marked as required; empty means models are passed through without remapping.
- **Delete provider confirmation**: deleting a provider now requires confirmation via a dialog showing the provider name and ID.
- **`response.completed` usage on streaming conversions**: emits final completion and `[DONE]` only after upstream `[DONE]` (or EOF fallback) so a trailing usage-only chunk is merged when upstream sends `finish_reason` before `usage` (MiMo-style split chunks).
- **Database worker client**: restarts the worker thread automatically with exponential backoff after an unexpected exit; outer RPC timeout is slightly longer than the CLI driver command timeout; read APIs (`queryLogs`, `getLogById`, `getStats`) degrade to empty or null results on transient failures instead of always surfacing errors to callers.
- **SQLite CLI IPC logging**: INFO for subprocess spawn, sentinel handshake, and channel close; WARN for recoverable faults (health check failure, unexpected exit, channel faults/timeouts, rebuild); ERROR for spawn errors (`proc` `"error"`), restart failure, and max-restart exhaustion.

### Removed

- **`openaiChatCompletionsPath` provider setting**: the Chat Completions endpoint is always `/chat/completions`; adjust `baseUrl` to include any path prefix (e.g. change `baseUrl: "https://example.com"` + `openaiChatCompletionsPath: "/v1/chat/completions"` to `baseUrl: "https://example.com/v1"`).
- **Temporary SSE debug dumps** to `/tmp/ccrelay-sse-dump` from the Chat→Responses streaming handler (use logs and unit tests for diagnosis instead).

### Fixed

- **Desktop CI (Windows / macOS matrix)**: set `build.artifactName` to `${productName}-${version}-${arch}.${ext}` so parallel `electron-builder` jobs no longer emit identical NSIS / zip filenames that overwrote each other when GitHub Actions merged release assets (which caused a single corrupted-looking `.exe` and NSIS “integrity check” failures).
- **Desktop macOS packaging (unsigned CI)**: `electron-builder` DMG output on GitHub Actions produced **invalid disk images** (`hdiutil`: "image not recognized"; `file` reported raw zlib). macOS artifacts are now **ZIP only** with `mac.identity: null` so releases ship openable `CCRelay.app` archives.
- **SQLite log storage without `sqlite3` CLI**: when `logging.enabled` uses SQLite but the **`sqlite3` executable is not installed or not on `PATH`**, the proxy starts **without** persisted request logs (warning logged); config is unchanged until you install SQLite or switch the logging driver.
- **Desktop packaged builds**: trays ship platform-appropriate PNGs via `extraResources`; **`database-worker.cjs`** is listed in **`asarUnpack`** so Worker threads load correctly; **`sqlite3` discovery** tries common paths (e.g. `/usr/bin/sqlite3`, Homebrew on macOS, `PATH`/`where` on Windows) when the environment trims `PATH`.
- **SQLite log database (CLI driver)**: eliminated the race between manual `restart()` and the subprocess `exit` handler spawning overlapping sqlite3 processes (which broke sentinel framing on the stdin/stdout pipe); stale I/O is ignored via a process generation counter and listeners are stripped before kill. Stdin writes respect pipe backpressure; list queries use explicit columns plus a short `request_body` preview to shrink IPC traffic; pragma cache/mmap limits tightened for extension RAM.
- **VSIX packaging**: `.vscodeignore` is now an explicit whitelist (`**/*` plus selective `!` entries). Documents vsce’s rule expansion for trailing `/` (never use bare `!node_modules/` — it becomes `!node_modules/**` and pulled in every prod dependency). Stray trees such as `internal-docs/` are excluded unless explicitly listed.
- **Anthropic → OpenAI thinking blocks**: multiple thinking blocks in a single assistant message are now merged (content joined, last non-empty signature used) instead of only using the first one.
- **Reasoning budget thresholds**: Anthropic `thinking.budget_tokens` 4097–8192 now maps to OpenAI `"high"` effort instead of `"medium"`, avoiding round-trip budget loss (medium → 4096 would reduce the budget).
- **Orphaned tool messages**: `buildAnthropicMessages` now skips `role: "tool"` messages that don't follow an assistant message with tool calls, preventing upstream 400 errors.
- **Empty choices handling**: `convertChatCompletionToResponses` and `convertResponseToAnthropic` now handle upstream responses with empty `choices` arrays gracefully instead of crashing.
- **Cross-protocol streaming guard**: `stream: "true"` (string) is now also detected and forced to `false` for cross-protocol conversion, not just `stream: true` (boolean).
- **Custom auth headers**: router now supports any custom `authHeader` value on a provider, not just `authorization` or `x-api-key`.
- **Delete active provider**: deleting the currently active provider now automatically switches to the default provider instead of leaving a stale `currentProviderId` that caused incorrect status bar display.
- **Streaming task lifecycle (queue mode)**: `streamCompleted` on `RequestTask` / `ProxyResult` and updated `TaskExecutor` / `ResponseWriter` handling avoid spurious `Marked as cancelled`, “client disconnected, skipping response”, and unnecessary upstream aborts after a successful streamed response when the client closes the socket post-`[DONE]`.

## [0.2.0] - 2026-04-26 (pre-release)

This is the **0.2.0** development line until a stable release is tagged. **Packaging:** `npm run package:beta` rewrites the version to `0.2.0-beta.<build>` and runs `package`; `npm run package:release` strips a `-beta…` suffix for a `0.2.0` build, then `package` (see root `package.json` scripts).

### Fixed

- **Web dashboard in browser-backed editors (e.g. code-server)**: sidebar and log-viewer webviews no longer hardcode `http://127.0.0.1:<port>` for API calls, which in a browser targets the user’s local machine. The extension resolves the ccrelay HTTP base with `vscode.env.asExternalUri` so requests use the workbench port proxy (e.g. code-server’s `/proxy/<port>`) and hit the ccrelay server on the same host as the extension. On resolution failure, falls back to the previous local URL. **Follower** mode still uses the leader origin only.
- **Converters (cross-protocol)**
  - Anthropic `tool_choice` with `type: "any"` now maps to OpenAI `"required"` (matches “must use a tool”), not `"auto"`.
  - Responses → Chat Completions: `namespace` tools are expanded to nested `function` tools; they were previously counted as stripped and never reached the expansion branch.
  - Anthropic `stop_reason: "stop_sequence"` maps to OpenAI `finish_reason: "stop"` (not `"content_filter"`). OpenAI `finish_reason: "content_filter"` maps to Anthropic `stop_reason: "end_turn"` (not `"stop_sequence"`).
  - Anthropic → OpenAI user images: incomplete `base64` sources (missing `media_type` or `data`) yield an empty `image_url` URL instead of `data:undefined;base64,...`.
  - OpenAI → Anthropic requests: when system messages mix plain string and array `content`, string parts are merged into the Anthropic `system` block list instead of being dropped.

### Changed

- **Converters**: `parseFunctionArguments` simplified (removed unreachable branch); tool message `content` serialization uses a shared helper; Anthropic → OpenAI request conversion no longer deep-clones messages or keeps an unreachable post-`user`/`assistant` fallback in `convertMessage`.

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
