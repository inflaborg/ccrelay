# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

**Protocol/Conversion**

- Hosted Chat hosted-tool requests are inferred from the provider URL (no extra settings): rules map known upstreams to outbound tool shapes internally.

### Fixed

**Protocol/Conversion**

- OpenAI Chat → Anthropic completions for **Z.ai GLM** preserve upstream **web search** results on the response body, so Anthropic clients receive those citations.
- Anthropic → OpenAI Chat conversion now carries the native **web search** server tool correctly for upstream **Z.ai GLM** (including `open.bigmodel.cn`) and **Xiaomi MiMo**, so relayed completions can use those providers’ hosted search instead of losing or mis-shaping the tool.
- Streaming **Anthropic Messages** to **GLM** with hosted web search now normalizes SSE: GLM `web_search_prime` results are rewritten to standard **`web_search` / `web_search_tool_result`**, so citations and client UI behave like native Anthropic search.
- The same GLM SSE normalization now activates for **`/anthropic/v1/messages`** clients (not only legacy `/v1/messages` URLs).
- GLM **text** scaffolding that still mentions **`web_search_prime`** is rewritten to **`web_search`** so it matches normalized tool blocks in the same stream.

### Added

**Desktop**

- Tauri desktop app: lightweight alternative to Electron using sidecar architecture (Rust shell + Node.js server process).
- Dynamic UI access token with HMAC-signed session cookies for secure WebView authentication.
- Internal API endpoint for follower instances to fetch leader's UI token for dashboard access.

## [0.2.1] - 2026-05-07 (pre-release)

Enhanced log viewer and dashboard with token tracking, performance metrics, and model mapping display.

### Added

**Log Viewer**

- Model mapping display in log list: shows `original → mapped` (e.g. `claude-sonnet-4-6 → glm-5.1`) when model mapping is active.
- Token columns (Input / Output / Cache) in the log list table and detail panel.
- TTFB (Time To First Byte) and output TPS (tokens per second) displayed in log list and detail panel.
- TPS calculation treats generation time under 1 second as 1 second to avoid inflated values.
- Request path and upstream URL shown in log detail panel.

**Dashboard**

- Time range selector (1d / 7d / 30d / All, default 7d) for all dashboard statistics.
- Token usage stats: total input, output, cache tokens with cache hit rate.
- Performance metrics: average TTFB, P50/P90 latency percentiles, filtered output TPS.
- Output TPS only counts genuinely streamed requests (generation time > 500ms) to exclude fake SSE responses.
- Per-provider breakdown table with request count and token usage.

**Metrics Pipeline**

- Token extraction from both JSON and SSE response bodies (Anthropic and OpenAI formats).
- TTFB tracked through the entire proxy pipeline (executor → response logger → database).
- Token and TTFB data stored in `request_logs` table (new columns: `input_tokens`, `output_tokens`, `cache_tokens`, `ttfb`).
- Database stats API supports `?range=1d|7d|30d|all` query parameter.

### Fixed

- Log detail now shows "Pending" badge for in-progress requests instead of "Err".
- Correctly extract model name from truncated base64-encoded request bodies.

## [0.2.0] - 2026-05-04

## [0.2.0] - 2026-05-04

Unified routing, Electron desktop tray, web i18n, config hot-reload, `providerType` split, and cross-protocol streaming. **Packaging:** `npm run package:beta` / `package:release` for pre-release vs stable VSIX.

### Added

**Routing & Config**

- Unified routing: `routing.forward` (path → provider, first match) and `routing.block` (path glob → custom response with optional conditions). Old `proxy`/`passthrough`/`openaiBlock` auto-migrated.
- Block rule conditions: `condition.providers` (allowlist) and `condition.providerNot` (exclusion list) for provider-aware routing.
- Inbound URL prefixes: `/openai/...` (OpenAI wire) and `/anthropic/v1/...` (Anthropic wire) on the same port.
- Config hot-reload: file changes picked up automatically with `fs.watch` (300ms debounce).
- Config change event bus + WebSocket `config_changed` broadcast to Followers.
- `configVersion` field in YAML; legacy configs auto-migrated on load.
- `mergeFileConfigWithDefaults`: list sections merge by identity key (your rows first, new defaults appended).

**UI & i18n**

- Web dashboard Settings tab: manage Logging, Concurrency, Server, Routing in the UI. Routing and concurrency hot-reload on save.
- i18n: Web UI supports English and Chinese. Language picker on first visit; persisted in `config.yaml` (`server.locale`).
- Provider import/export: multi-select providers and export as JSON; import merges by ID (overwrite existing, add new, never delete).
- Provider protocol badge: colored label (Anthropic / OpenAI / OpenAI Chat) on each provider card.
- Duplicate provider: editable new provider ID in the dialog.
- Delete provider: confirmation dialog before deleting.

**Client Integrations**

- Codex "Configure model" button: patches only the `model` field in `~/.codex/config.toml`.
- Codex model input dialog when applying the CCRelay template (defaults to `gpt-5.4-mini`).
- Claude Code template now sets `ANTHROPIC_BASE_URL` to `.../anthropic`; Codex uses `.../openai`.

**Protocol & Conversion**

- `providerType` split: `"anthropic"`, `"openai"` (full passthrough), `"openai_chat"` (Chat Completions only — Responses converted before forwarding).
- Synthetic SSE for `POST /v1/chat/completions` with `stream: true` when cross-protocol and upstream is non-streaming.
- Streaming Chat → Responses SSE: real-time Chat Completions SSE to Responses API SSE conversion.
- Responses request echo: client `tools`, `reasoning`, `tool_choice`, etc. echoed into `response.*` for both streaming and non-streaming.
- Cross-protocol error format conversion: error responses re-wrapped to match the client's expected shape.
- Bidirectional models list format conversion when entry path and upstream protocol differ.

**Desktop**

- Electron tray app: shared config + Leader election with VS Code extension. Opens dashboard in a `BrowserWindow` over HTTP.
- CI desktop installers: macOS (zip, x64 + arm64) and Windows (NSIS exe, x64 + arm64) built in GitHub Actions.
- Dashboard opens automatically on desktop app launch.
- Windows/Linux: hidden in-window menu bar; macOS uses system menu bar.

**Build & Packaging**

- Build fingerprint: per-build `BUILD_HASH` exposed via `/ccrelay/api/version`.
- CI selective build targets: `workflow_dispatch` input `build_targets` for partial builds (VSIX only, desktop only, per-OS, per-arch).
- Logging / SQLite CLI path: optional `logging.database.sqlite3_executable`; blank resolves from `PATH` only.

### Changed

- `modelMap` / `vlModelMap` apply only to request bodies; `GET /models` responses no longer rewritten.
- `modelsListFormat` and `openaiChatCompletionsPath` removed — protocol inferred from path, endpoint always `/chat/completions`.
- Multi-instance logging: SQLite logging runs on Leader only; Followers proxy to Leader.
- IPC leadership lifecycle: lock server closed on release; bounded retries on transient failures.
- Cross-protocol conversion guard: correctly distinguishes all three provider types.
- `routing.block[].condition.kind` removed (redundant with HTTP path).
- `GET /v1/models` remains legacy OpenAI-shaped; `GET /anthropic/v1/models` returns Anthropic-shaped list.
- Provider YAML keys written in stable order (`official` first, then sorted).

### Removed

- Undocumented root `POST /messages` (without `/v1`) — use `/v1/messages` or `/anthropic/v1/messages`.
- Synthetic fallback model list on upstream `GET /models` errors — real status/body forwarded.
- Temporary SSE debug dumps and verbose `ModelsDebug` logging.

### Fixed

- Cross-protocol `GET /models` path: avoids doubled `/v1/v1` in upstream URLs.
- Cross-protocol `GET /models` body: models list JSON no longer treated as Chat Completions body.
- Upstream path resolution: canonical wire paths without `/v1` dedup.
- IPC lock takeover after orphaned socket/pipe; cooldown-limited retries.
- Desktop CI artifact naming: per-arch filenames prevent parallel build overwrites.
- Desktop macOS: zip-only output (unsigned DMGs were invalid).
- SQLite log storage: proxy starts without logs when `sqlite3` not found (warning logged).
- SQLite CLI driver: eliminated race between restart and subprocess exit; backpressure-aware writes.
- VSIX packaging: explicit `.vscodeignore` whitelist prevents stray files.
- Anthropic → OpenAI: multiple thinking blocks merged; `stop_reason: "stop_sequence"` → `"stop"`.
- OpenAI → Anthropic: mixed system message content preserved; `tool_choice: "any"` → `"required"`.
- Orphaned tool messages skipped to prevent upstream 400 errors.
- Empty `choices` arrays handled gracefully in Responses converters.
- `stream: "true"` (string) detected and forced off for cross-protocol conversion.
- Custom `authHeader` values supported on providers.
- Deleting the active provider switches to default instead of leaving stale state.
- Streaming task lifecycle: avoids spurious cancellation and upstream aborts after successful response.
- Web dashboard in code-server: API calls use `vscode.env.asExternalUri` port proxy instead of hardcoded localhost.

## [0.1.6] - 2026-04-26

### Added

- Web dashboard: Client configuration for Claude Code (`~/.claude/settings.json` env), provider duplicate, and Configure default models UI.
- OpenAI `POST /v1/responses`: full cross-protocol path (Chat Completions hub); default routing includes `/v1/responses`.
- LLM router (`ApiSurface`): infer protocol from path/method; convert only when wire mismatches.
- Per-provider `modelsListFormat` and `openaiChatCompletionsPath` settings.
- Converters and tests: Responses ↔ Chat Completions; Anthropic ↔ Chat.
- Synthetic SSE for `POST /v1/responses` with `stream: true` when cross-protocol and non-streaming upstream.

### Fixed

- Config load: provider IDs no longer rewritten during YAML normalization.
- Delete/duplicate by ID: encoded segments resolve YAML keys correctly.
- Chat → Anthropic `tool_choice`: string values mapped to Anthropic object form.
- Proxy Responses (JSON): removed spurious 499 after successful 200 conversion.

### Changed

- Provider YAML keys in stable order on write.
- `GET /v1/models`: inbound surface follows `providerType` with `modelsListFormat: auto`.
- Build/packaging: `build:web` runs `npm install` in `web/`.
- Cross-protocol: streaming disabled on conversion paths; `stream` forced off.

### Dependencies

- `uuid` override `^14.0.0` for transitive audit [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq).

## [0.1.5] - 2025-02-27

### Added

- 429 retry handling in concurrency manager ([#20](https://github.com/inflaborg/ccrelay/pull/20))
- Tools tab in log details, Markdown viewer with syntax highlighting
- `useHashTab` hook for URL hash ↔ tab sync
- WebSocket heartbeat (30s ping interval)
- `package-lock.json` for reproducible installs

### Changed

- SQLite operations moved to dedicated worker thread ([#21](https://github.com/inflaborg/ccrelay/pull/21))
- `PriorityQueue` refactored to binary heap (O(log n))
- Logger supports non-VSCode environments (worker threads)

### Dependencies

- Added `react-markdown`, `remark-gfm`, `react-syntax-highlighter`, `@tailwindcss/typography`
- Bumped `@eslint/js` to 10.0.1

### CI/CD

- Replaced `npm ci` with `npm install` across all workflows
