# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

**Config**

- Optional **external web search**: set a **Tavily** API key and allowlist provider IDs so matching Anthropic-style web search tool calls are answered locally instead of being proxied to the upstream model.

**UI**

- Dashboard **Capabilities** tab for **Tavily** web search settings (API key, depth, max results, provider allowlist).

## [0.2.2] - 2026-05-10 (pre-release)

Pre-release line for 0.2.2.

### Changed

**Desktop/CI**

- macOS Electron packaging switched from `.zip` to `.dmg`; CI now runs a post-build integrity check (size + disk-image signature) before uploading.

**Config**

- Removed deprecated `ccrelay.configPath` VS Code setting from documentation; config file path is fixed at `~/.ccrelay/config.yaml`.

## [0.2.1] - 2026-05-09

This release expands the web dashboard (logs, stats, provider wizard) and tightens protocol handling for Gemini, GLM, MiMo, and Azure. **Desktop:** optional Tauri build with secure dashboard auth.

### Added

**UI**

- **Add provider** wizard: single scrollable flow with preset cards (manual setup, Zhipu GLM, Xiaomi MiMo, Azure OpenAI, Gemini OpenAI-compatible), connection fields, inline summary, and **Create**. Upstream model list and endpoint checks run via authenticated **same-origin** API routes so the browser does not call provider URLs directly (avoids CORS).

**Log Viewer**

- Model mapping in the log list when active (`original → mapped`, e.g. `claude-sonnet-4-6 → glm-5.1`).
- Token columns (input / output / cache), TTFB, output TPS, request path, and upstream URL in list and detail. TPS treats generation under 1s as 1s to avoid spikes.

**Dashboard**

- Stats time range (1d / 7d / 30d / All, default 7d); token totals and cache hit rate; TTFB average and P50/P90; output TPS for streamed requests only (generation over 500 ms); per-provider breakdown.

**Metrics**

- Tokens parsed from JSON and SSE responses; TTFB traced end-to-end; `request_logs` gains `input_tokens`, `output_tokens`, `cache_tokens`, `ttfb`; stats API accepts `?range=1d|7d|30d|all`.

**Protocol/Conversion**

- **Azure OpenAI**: Anthropic inbound requests using Web Search Server Tools are sent to the **Responses** API when Chat Completions would reject those tools.
- Hosted Chat **hosted-tool** shaping for outbound requests is inferred from the provider URL (no separate UI toggle).

**Desktop**

- **Tauri** desktop variant (Rust shell + Node sidecar).
- HMAC-backed UI access token and session cookies for the WebView; followers can fetch the leader UI token from an internal API.

### Changed

**Config**

- Provider field **`openaiCompat`** is legacy (YAML/API may still include it); behavior no longer depends on it. Azure OpenAI Chat shaping applies when the upstream host matches **`*.cognitiveservices.azure.com`**.

**UI**

- Provider dialog drops the cross-protocol **Azure OpenAI** toggle; routing follows the configured upstream URL.

### Fixed

**Log Viewer**

- In-progress requests show a **Pending** badge instead of **Err**.
- Model name extraction works when request bodies are truncated base64.

**Protocol/Conversion**

- **Gemini** (OpenAI-compatible): strip unsupported URL query flags; outbound Chat bodies omit Responses-only fields and unsupported tool types.
- **Z.ai GLM** (including `open.bigmodel.cn`): preserve Web Search Server Tools across OpenAI Chat ↔ Anthropic; normalize streaming SSE (`web_search_prime` → standard `web_search` / `web_search_tool_result`) for **`/v1/messages`** and **`/anthropic/v1/messages`**; align assistant text that still references `web_search_prime`.
- **Xiaomi MiMo**: carry Web Search Server Tools in Anthropic ↔ OpenAI conversions; map **`url_citation`** to **`web_search` / `web_search_tool_result`** instead of a trailing JSON-only blob.

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
