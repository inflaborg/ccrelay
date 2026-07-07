# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

**Protocol/Conversion**

- Strip unsupported reasoning parameters when forwarding to models that do not support them (e.g. effort on Claude Haiku), preventing client-injected fields from causing upstream errors.
- Strip inline `system` role messages when forwarding to models that reject them (e.g. Claude Haiku), merging content into the top-level `system` field.

## [0.2.7] - 2026-06-28 (pre-release)

Pre-release line for 0.2.7.

## [0.2.6] - 2026-06-26

Request logs now capture request and response headers with sensitive auth values masked. Dashboard token and performance metrics are stored separately from request bodies, so clearing logs or resetting stats affects only the intended data. Relays from Claude or Cowork strip volatile billing metadata from system prompts so upstream prompt caching is not invalidated on every request.

### Added

**Logging**

- Request logs now record the request and response headers alongside the bodies (shown in the log detail panel). Sensitive auth headers, such as API keys and Bearer tokens, are masked before storage so secrets are never written to the log database.

### Changed

**UI**

- Token usage and performance metrics on the Dashboard are always recorded when the local database is available, even if request/response body logging is disabled. The logging toggle now only controls the Logs tab and stored request bodies.
- When the local database cannot be opened (for example, sqlite3 CLI is missing in the VS Code extension), the Dashboard shows a clear unavailable state instead of empty statistics.

**Logging database**

- Clearing all logs in the Logs tab removes only stored request/response bodies; dashboard token and performance metrics are kept.
- **Reset stats** on the Dashboard clears token and performance metrics only; stored request logs are not affected.

### Fixed

**Protocol/Conversion**

- Relaying requests from Claude or Cowork now removes volatile billing metadata injected into the system prompt, so prompt caching on upstream Anthropic-compatible providers is not invalidated on every request.

## [0.2.5] - 2026-06-02

Smart Routing aggregates provider models with unified `/v1/models` routing and optional `modelRules` for custom model mapping. The dashboard adds an offline gate, client configuration, release update checks, and log metrics that only count genuine SSE streams. Request log Analysis and model mapping are more reliable for large bodies and cross-protocol streams. Desktop can open the bundled UI without a running proxy; multi-instance leader election follows the active proxy port. Default queue wait timeout is removed (`requestTimeout` `0`).

### Added

**UI**

- When the proxy is stopped or unreachable, the dashboard shows a **Server not running** screen and polls until the server is back.
- **Smart Routing** tab between Dashboard and Providers: aggregates all provider model lists, exposes unified `/v1/models` with `<providerId>:<modelId>` ids, and routes requests by model without switching the active provider.
- **Providers** page: Smart Routing card and provider cards are mutually exclusive routing modes — enable Smart Routing from the Providers tab; selecting a fallback provider disables Smart Routing. Aggregated catalog shows provider fetch errors when upstream model lists fail.
- **Client configuration** page shows installed Claude Desktop claude-code bundles (scanned from the Claude-3p directory) and the Claude Code CLI version (via `claude --version`). CLI version detection can be disabled on the page.
- **Release update check** in the footer: compares your build to the latest formal GitHub Release (not the development version on `main`). Checks run about one minute after the proxy starts and once every 24 hours while it keeps running; you can also check immediately from the footer.
- When a newer release is available, the dashboard opens an update dialog with release notes and a link to download on GitHub (opened in your system browser on desktop). The dialog refreshes if a later release appears on a subsequent check.

**Smart Routing**

- `smartRouting.modelRules`: optional custom model routing checked before the aggregated catalog. Map client model ids (exact or `*`/`?` wildcards) to a target provider and upstream model; rules are not listed in `/v1/models`.

**Config**

- `smartRouting` section in `config.yaml` (`enabled`, include/exclude filters, alias prefix, upstream models cache TTL). Optional alias-drift migration when enabling smart routing updates legacy custom model aliases that collide across providers.
- `clientVersionDetection` section in `config.yaml` (`enabled`, default true) controls whether the dashboard runs `claude --version` for Client configuration.

**Desktop**

- Electron desktop app serves the dashboard from bundled UI assets, so the window can open even when the HTTP proxy is not running.
- Electron and Tauri log build version at startup (version, build hash, git hash), matching the VS Code extension.
- Dashboard external links (including the update download page on GitHub) open in the system default browser instead of inside the app window.

### Changed

**Logging database**

- Token usage, model, timing, and success status are stored separately from request log bodies, so clearing request logs does not reset dashboard statistics.
- Log database schema upgrades are version-tracked; startup logs report the current schema version and any migration steps applied.
- Native SQLite logging requires SQLite 3.35 or newer; older system SQLite disables request log storage (same behavior as when the sqlite3 CLI is unavailable).

**UI**

- Dashboard **Overview** combines server status, current provider, and total requests in one card, aligned with Performance and Token Usage.
- Provider wizard and Cowork quick-fill generate canonical alias hashes (`claude-{8 hex}` from `providerId:protocol:upstreamModelId`); the same upstream model on different providers or protocols gets a different alias.
- Request log **TTFB** and **TPS**, plus dashboard **Avg TTFB** and **Output TPS**, apply only to genuine SSE streaming; non-streaming and synthetic-stream responses show `-` instead of misleading values. Short streamed replies (e.g. a few tokens) now show TTFB/TPS in the log list when the proxy recorded stream metrics.

**Config**

- Default `concurrency.requestTimeout` is now `0` (no queue wait timeout). Configs below `configVersion` `0.2.5` are auto-upgraded on startup; installs that still had the previous default of `60` seconds are migrated to `0`. Set `requestTimeout` explicitly if you need a queue limit.

### Fixed

**UI**

- Dashboard and VS Code status bar show **Smart Routing** as the current provider when smart routing is enabled; the status bar **Switch Provider** menu can enable or disable Smart Routing.
- Smart Routing settings list excluded models again (non-excluded first) while runtime routing still omits them from `/v1/models`.
- Electron desktop dashboard no longer fails to load scripts and styles when opened while the proxy is stopped.
- Request log **Response → Analysis** now reconstructs OpenAI Chat Completions streaming bodies (including `reasoning_content` and streamed tool calls) and OpenAI Responses API streaming bodies, so MiMo and cross-protocol Responses streams show a readable merged JSON instead of a blank panel.
- Request log list **Model** column again shows client → upstream mapping for large Chat Completions bodies where `model` appears after a long `messages` array (previously only the first 500 bytes were scanned).

**Multi-instance**

- Leader election across VS Code extension and desktop instances now follows the active HTTP proxy port: only the serving instance holds the leader role, stale instances release coordination after reload or shutdown, and followers recover within a short polling window when the leader stops.

**Config**

- Smart Routing alias-drift migration rebuilds `modelMap` alongside `customModelsList`, keeping Cowork alias routing in sync after migration.
- Multi-variant wizard presets (e.g. GLM Anthropic + OpenAI) no longer share one alias set across provider variants.
- Cowork auto-generated `modelMap` now includes identity rules (`realId` → `realId`) before wildcard catch-alls, so clients sending real model ids are not misrouted by `claude-*` / `gpt-*`.
- **Rebuild model map** fully rebuilds from `customModelsList` and does not preserve manually added wildcard rules.

**Protocol/Conversion**

- Cross-protocol streaming now forwards upstream errors as native SSE events for Anthropic, OpenAI Chat, and OpenAI Responses clients instead of returning a misleading 502.
- Streaming requests that finish normally (e.g. Codex on Azure Responses API ending with `response.completed`) are no longer mislogged as 499 "Client disconnected" when the client tears down the connection after reading the final event, even when the upstream FIN is delayed.
- Cross-protocol Responses to OpenAI Chat now strips unsupported hosted tools on GLM, MiMo, DeepSeek, Gemini, and MiniMax; Codex `apply_patch` freeform tools are downgraded to string-arg functions so Chat-only upstreams no longer reject requests with `Param Incorrect`.
- Request logs for cross-protocol streaming (Chat SSE to Responses SSE) now update from `pending` to `completed` when the stream finishes, matching passthrough streaming behavior.
- Cross-protocol streaming request logs now store the converted Responses SSE sent to the client and the upstream wire body, not only status and duration.
- Cross-protocol Chat-to-Responses streaming no longer opens an empty assistant message item when the model goes from reasoning straight to tool calls; function calls keep the correct output index and clients parse the stream reliably.

## [0.2.4] - 2026-05-19

Admin UI on shadcn/ui, Claude Desktop and Web search controls, and **DeepSeek** / **Astraflow (UCloud)** add-provider presets. Request logs move to a compact v2 table with automatic migration; desktop apps use in-process SQLite and Tauri bundles a Node sidecar. Reasoning-effort mapping updates and macOS Tahoe fixes for desktop, VS Code, and proxy streaming.

### Added

**UI**

- Capabilities **Web search**: **Enable** toggle, **Select all**, and **Invert selection** for provider assignment.
- Dashboard **Client configuration**: **Claude Desktop** (macOS and Windows) with Claude Code and Codex; Apply/Restore for proxy settings in the platform `Claude-3p` config directory.
- **Add provider** wizard presets: **DeepSeek** (OpenAI Chat and Anthropic endpoints, common v4 model IDs) and **Astraflow (UCloud)** (international and China API hosts, OpenAI Chat, custom model list).

**Config**

- `webSearch.enabled` master switch in `config.yaml`. The `providers` list is kept when disabled; legacy configs without `enabled` still treat a non-empty `providers` list as on.

**Diagnostics**

- Dated runtime log files under `~/.ccrelay/logs/` (daily rotation, about one week retention), separate from dashboard request history.
- **Open Logs Folder** from the desktop tray (Electron and Tauri) or the VS Code command opens that directory.

**Desktop**

- In-process SQLite for request logs on Electron and Tauri (faster than the CLI subprocess backend; the VS Code extension may still use the sqlite3 CLI). After upgrading Electron from source, run `npm install` to rebuild the native module.
- **Tauri** installer bundles a Node.js runtime and server assets (replacing the previous single-executable sidecar); end users do not install Node separately.

**Protocol/Conversion**

- **DeepSeek**: Chat Completions requests to the official API host receive a compatible thinking toggle and normalized reasoning effort for extended-thinking mode.

### Changed

**Logging database**

- Request log bodies in `request_logs_v2` as binary BLOBs (~33% smaller than Base64-in-TEXT), with automatic migration from legacy rows. The sqlite3 CLI backend encodes BLOBs only for pipe transport.

**UI**

- Admin UI migrated to [shadcn/ui](https://ui.shadcn.com) across Settings, Providers, Capabilities, Logs, and Dashboard; layout conventions in `web/DESIGN.md`.
- Provider cards: protocol and status on one row (e.g. **OpenAI Chat**), name truncation when space is tight, updated tag padding and square header corners.

**Protocol/Conversion**

- **Reasoning effort**: Anthropic thinking/output effort and inbound OpenAI Chat map to standard `reasoning_effort` (better OpenAI, Gemini, Azure, and GLM compatibility); GLM outbound uses native thinking fields; `"none"` disables Anthropic thinking.
- **Gemini**: thought-signature handling in dedicated platform transforms; adapters emit one canonical OpenAI shape.

### Fixed

**UI**

- Admin UI theme and density after shadcn migration: restored dark semantic colors, compact typography, clearer control borders.
- Settings and Capabilities: save status hints sit left of **Save** so the button no longer shifts.
- Provider cards: header labels no longer overflow the card.
- Request logs: manual refresh always loads the latest entries.

**Desktop & platform**

- **macOS Tahoe (26)**: signed Electron and Tauri builds include local-network entitlements; long proxy waits and streaming no longer drop (desktop apps and VS Code extension).
- Request log list empty while the total count was non-zero with the sqlite3 CLI backend (including VS Code); list and detail views work again.

## [0.2.3] - 2026-05-12

Cowork-safe model aliases with an optional client header, quick-fill for custom model lists, optional **GLM (Z.ai)** web search next to Tavily, and clearer **MiniMax** reasoning handling for Anthropic clients. Build scripts for desktop releases are fixed.

### Added

**UI**

- Manual **Add provider** flow: **Quick fill custom models** builds the custom model list and model map from upstream model rows (optional display names) and can seed from the current textarea.

**Config**

- Built-in web search adds a **GLM (Z.ai)** backend alongside Tavily: set API key, endpoint, OpenAI Chat or Anthropic protocol, region, and optional default search backend in **Capabilities** (or YAML).

**Protocol**

- Custom model list lines support display names and per-model aliases (triple format). Synthesized model list and detail responses return real wire ids by default, or alias ids when the client sends the `x-ccrelay-model-alias` header.

**Docs**

- README and README_CN: WebP screenshots for custom model configuration, quick-fill, and Cowork **Gateway extra headers**.

### Changed

**UI**

- Add-provider dialog is wider so long model-ID labels wrap cleanly. Provider wizard help text is shorter; the Cowork / Claude Code / Codex option is relabeled and clarified; hash-based aliases in the generated custom list apply only when that option is on.

### Fixed

**Protocol**

- **MiniMax**: upstream reasoning output maps to Anthropic-style thinking blocks more reliably for streamed and non-streamed replies.

**Build**

- Version bump scripts (`version:bump`, `version:beta`, `version:release`) now correctly update Tauri's `Cargo.toml` and `tauri.conf.json` alongside all other package files.

## [0.2.2] - 2026-05-10

Release **0.2.2** adds optional **Tavily**-backed web search for allowlisted providers, improves log inspection for Anthropic streaming replies, and ships the macOS Electron build as a **DMG** with a stricter CI upload check.

### Added

**Config**

- Optional **external web search**: set a **Tavily** API key and allowlist provider IDs so matching Anthropic-style web search tool calls are answered locally instead of being proxied to the upstream model.

**UI**

- Dashboard **Capabilities** tab for **Tavily** web search settings (API key, depth, max results, provider allowlist).
- Log detail **Response** analysis rebuilds Anthropic-style streaming bodies into a single merged **message** JSON for easier reading.

### Changed

**Desktop/CI**

- macOS Electron packaging switched from `.zip` to `.dmg`; CI now runs a post-build integrity check (size + disk-image signature) before uploading.

**Config**

- Removed deprecated `ccrelay.configPath` VS Code setting from documentation; config file path is fixed at `~/.ccrelay/config.yaml`.

**Docs**

- README and README_CN: Tavily web search configuration, **MiniMax** in the verified-upstreams table, screenshots as **WebP**, and a **Capabilities** / Tavily screenshot in the Web UI section.

**Proxy**

- When a built-in service handler claims a request (for example web search) but that work fails, the relay returns an error to the client instead of silently forwarding the same request upstream.

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
