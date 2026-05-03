# CCRelay

[![VSCode Extension](https://img.shields.io/badge/VSCode-Extension-blue)](https://code.visualstudio.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**CCRelay** 是一套 VS Code 扩展，并提供可选的 **Electron 托盘应用**（`packages/desktop`）；内置 HTTP 代理，可在不同 AI 提供商之间平滑切换且不丢失会话上下文。现已明确支持 **Claude Code**、**Claude Cowork** 与 **OpenAI Codex** 等客户端，详见[客户端对接](#客户端对接)。

**项目官网**: [https://ccrelay.inflab.org](https://ccrelay.inflab.org)

**[English Documentation](./README.md)**

---

## 目录

- [核心特性](#核心特性)
- [系统要求](#系统要求)
- [安装](#安装)
- [桌面托盘应用（Electron）](#桌面托盘应用electron)
- [快速开始](#快速开始)
- [客户端对接](#客户端对接)
- [使用指南](#使用指南)
  - [基础设置](#基础设置)
  - [多实例模式](#多实例模式)
  - [Provider 模式](#provider-模式)
  - [模型映射](#模型映射)
  - [OpenAI 格式转换](#openai-格式转换)
  - [Web UI 管理界面](#web-ui-管理界面)
- [配置](#配置)
  - [VSCode 设置](#vscode-设置)
  - [YAML 配置文件](#yaml-配置文件)
- [API 端点](#api-端点)
- [命令](#命令)
- [开发](#开发)
- [文件位置](#文件位置)
- [TODO](#todo)
- [许可证](#许可证)

---

## 核心特性

- **内置 API 代理服务器**: 运行本地 HTTP 服务器（默认：`http://127.0.0.1:7575`），将请求代理到不同的 AI 提供商
- **多实例协调**: Leader/Follower 模式支持多个 VSCode 窗口 - 只有一个实例运行服务器
- **WebSocket 同步**: Leader 与 Follower 之间通过 WebSocket 实时同步提供商状态
- **状态栏指示器**: 显示当前提供商、角色（Leader/Follower）和服务器状态
- **快速切换提供商**: 点击状态栏或使用命令切换提供商
- **Provider 模式**:
  - `passthrough` - 保留原始认证头，用于官方 API
  - `inject` - 注入提供商特定的 API Key
- **模型映射**: 自动将 Claude 模型名称转换为提供商特定模型，支持通配符（如 `claude-*` → `glm-4.7`）
- **视觉模型映射**: 单独配置视觉/多模态请求的模型映射（`vlModelMap`）
- **OpenAI 格式转换（LLM 路由）**: 支持 Anthropic、OpenAI Chat Completions 与 Responses（`/v1/responses`）；跨厂商时经 Chat Completions 枢纽转换，一致时透传
- **请求日志**: 可选的 SQLite/PostgreSQL 请求/响应日志存储（带 Web UI）；SQLite 使用 **`sqlite3` 命令行**。默认仅从 **`PATH`** 解析该可执行文件；也可选配置 **`logging.database.sqlite3_executable`** 指向 **`sqlite3` 的完整路径**。若启用日志且为 SQLite，但无法解析 **`sqlite3`**，代理仍会运行，**不写库**（日志中会给出警告）；安装 [SQLite CLI](https://www.sqlite.org/download.html)、修正 **`PATH`/配置路径**，或改用 PostgreSQL 后即可持久化。
- **并发控制**: 内置请求队列和并发限制，防止 API 过载
- **自动启动**: VSCode 启动时自动启动代理服务器
- **客户端对接**: 可与 **Claude Code**、**Claude Cowork**（Anthropic 协议）和 **Codex**（OpenAI 协议 + `~/.codex/config.toml`）配合使用，详见[客户端对接](#客户端对接)
- **可选桌面托盘（Electron）**: 可使用独立 Electron 应用运行 CCRelay，无需打开 VS Code；与扩展共用 `~/.ccrelay` 配置与 Leader 选举；托盘「打开控制台」在当前应用窗口内通过 **HTTP** 加载 `/ccrelay/` 界面（详见[桌面托盘应用](#桌面托盘应用electron)）

---

## 系统要求

- VSCode 版本 1.80.0 或更高
- Node.js（用于开发）

---

## 安装

### 从 VSIX 安装

1. 下载最新的 `.vsix` 文件
2. 在 VSCode 中按 `Cmd+Shift+P`（macOS）或 `Ctrl+Shift+P`（Windows/Linux）
3. 输入 `Extensions: Install from VSIX...`
4. 选择下载的 `.vsix` 文件

### 从源码构建

```bash
# 克隆仓库
git clone https://github.com/inflaborg/ccrelay.git
cd ccrelay

# 安装依赖
npm install

# 构建扩展
npm run build

# 打包 VSIX
npm run package
```

### 开发模式

```bash
# 安装依赖
npm install

# 编译
npm run compile

# 在 VSCode 中按 F5 打开扩展开发主机窗口
```

---

## 桌面托盘应用（Electron）

本仓库 **`packages/desktop`** 提供可选的 Electron **托盘**应用，与 VS Code 扩展共用 **`@ccrelay/core`** 运行时：

- **`~/.ccrelay/config.yaml`**、**`~/.ccrelay/state.json`**、Leader/Follower 选举、WebSocket 同步、Provider 切换、HTTP API、`/ccrelay/` Web UI 等与扩展保持一致。
- 托盘菜单 **打开控制台**：在 Electron **`BrowserWindow`** 内通过 **HTTP** 访问本地代理加载仪表盘（不用 `file://`）；再次启动应用会聚焦已有窗口。
- **Windows / Linux**：隐藏 Electron 内置的窗口内菜单栏（**文件 / 编辑 / 视图 / 窗口**）；**macOS** 继续使用系统顶层菜单。
- 安装包输出在 **`packages/desktop/dist/`**（**macOS：** **仅 zip**，文件名为「产品名-版本-平台-架构」，如 `CCRelay-0.2.0-darwin-arm64.zip`，CI 默认不打 DMG；**Windows：** NSIS `*.exe`，如 `CCRelay-0.2.0-win32-x64.exe` 与 `CCRelay-0.2.0-win32-arm64.exe`（平台为 Node 的 `darwin` / `win32`）。本地需在目标系统上执行 `npm run desktop:pack:mac` 或 `desktop:pack:win`。
- **`electron-builder` 产物**面向 **`x64` 与 `arm64`**（Intel / Apple Silicon Mac；x64 / ARM64 Windows）。**GitHub Actions**（**Build Dev** 自动与 Manual、**Build Prod**）先跑 **`configure`**，再通过 **`workflow_dispatch`** 参数 **`build_targets`** 决定要构建的产物：默认 **`all`**（push / 留空等价于全量）；还可选 **`vscode`**、**desktop**（四门矩阵）、**desktop-mac** / **desktop-win**（该系统下两架构）；或 **单架构**：**`desktop-mac-x64`**、**`desktop-mac-arm64`**、**`desktop-win-x64`**、**`desktop-win-arm64`**。**VSIX** 与 **桌面**任务按选择执行；**Build Dev (Auto)** 也支持手动触发做部分产物构建。**Build Dev (Manual)** 仍只上传 workflow artifact；**Build Dev (Auto)** 与 **Build Prod** 的 Release 与本次勾选一致。

### macOS：从 GitHub Release zip 首次打开

正式发布包当前 **未经 Apple 公证**。浏览器下载_zip 解压后，`CCRelay.app` 可能带有 **隔离（quarantine）** 标记，Gatekeeper 会提示 *「Apple 无法验证 …」*。

1. 去掉扩展属性后再双击（路径按实际解压位置修改）：

   ```bash
   xattr -cr ~/Downloads/CCRelay.app
   ```

   若 `.app` 在解压后的子目录内，改用该路径，例如：`xattr -cr ~/Downloads/CCRelay-darwin-arm64/CCRelay.app`。

2. 或 **按住 Control 点击** → **打开** 并在弹窗中选择打开；或在 **系统设置 → 隐私与安全性** 中允许。

本机 `packages/desktop/dist/` 下直接构建的产物通常没有隔离属性，故往往无需上述步骤。根本方案见 [TODO](#todo)（签名 + 公证）。

- SQLite **日志持久化**通过 **`PATH`** 解析 **`sqlite3`**（或配置 **`logging.database.sqlite3_executable`**）；无法满足时本轮进程不写库但仍可启动——见上文「请求日志」说明。

---

## 快速开始

### 1. 配置提供商

CCRelay 使用 YAML 配置文件（默认为 `~/.ccrelay/config.yaml`）。首次启动时会自动创建默认配置文件。

编辑配置文件添加你的提供商：

```yaml
providers:
  glm:
    name: "Z.AI-GLM-5"
    baseUrl: "https://api.z.ai/api/anthropic"
    mode: "inject"
    apiKey: "${GLM_API_KEY}"  # 支持环境变量
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

### 2. 将 Claude Code 指向 CCRelay

在 **`~/.claude/settings.json`** 中通过 `env` 配置环境变量（如 `ANTHROPIC_BASE_URL`）。推荐始终使用该文件，而非依赖 VS Code 工作区设置或在扩展里做临时操作。完整 `env` 示例见下节 [Claude Code](#claude-code)；也可用 Web 面板 **Client configuration** 写入相同键值。

### 3. 切换提供商

- 点击 VSCode 底部状态栏的 CCRelay 图标
- 或使用命令面板：`CCRelay: Switch Provider`

---

## 客户端对接

**Claude Code**、**Claude Cowork** 与 **OpenAI Codex** 均为推荐对接的客户端。CCRelay 在同一端口（默认 **7575**）上提供 **Anthropic 兼容**（含 `/anthropic/v1/...` 专用入口）与 **OpenAI 兼容**（含 `/openai/...` 专用入口）；也仍支持直接在根地址上使用 `/v1/...`。**Claude Code / Cowork** 请将 **`ANTHROPIC_BASE_URL` 设为 `http://127.0.0.1:7575/anthropic`**；**Codex** 请将 **`base_url` 设为 `http://127.0.0.1:7575/openai`**（详见下文）。

| 客户端 | 协议 | 对接方式 |
|--------|------|----------|
| **Claude Code** | Anthropic | 在 `~/.claude/settings.json` 的 `env` 中设置 `ANTHROPIC_BASE_URL` 及可选的 `ANTHROPIC_DEFAULT_*_MODEL` — 见 [Claude Code](#claude-code) |
| **Claude Cowork** | Anthropic | 在应用中将 **API / Anthropic Base URL** 设为 `http://127.0.0.1:7575/anthropic`，不要指向上游厂商地址 |
| **Codex**（OpenAI Codex CLI） | OpenAI | 在 `~/.codex/config.toml` 中将 CCRelay 注册为自定义 **model provider**（见下例） |

### Claude Code

**持久化配置（`~/.claude/settings.json`）— 推荐**

在 `env` 中配置，使每次启动 Claude Code 都走 CCRelay。当 CCRelay 当前 provider 为 **inject** 模式时，由代理注入真实 API Key，`ANTHROPIC_AUTH_TOKEN` 可使用下方占位；若你的环境需要真实 token，再自行填写。若只依赖 CCRelay 的 **`modelMap`** 做模型名映射，**不必**配置 `ANTHROPIC_DEFAULT_*_MODEL`；需要时可打开 Web 面板 **Client configuration → Configure default models** 单独写入这三项。

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

**可选** — Claude Code 请求的默认模型名（`ANTHROPIC_DEFAULT_OPUS_MODEL` / `SONNET` / `HAIKU`）。面板上 **Client configuration → Configure default models** 的推荐值与下例一致。若 `settings.json` 已有其他顶层键，请合并或扩写 `env` 对象，不要整文件覆盖。

含可选默认模型名的 `env` 示例（与 Web 面板建议一致）：

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

本地绑定时 `http://127.0.0.1:7575/anthropic` 与 `http://localhost:7575/anthropic` 可互换。

**可选（仅当前终端、非持久化）** — 不想先改 `~/.claude/settings.json` 时，可快速试跑：

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:7575/anthropic
claude
```

日常使用仍建议用上文 `~/.claude/settings.json` 的 `env` 配置。

### Claude Cowork

与 Claude Code 相同：将 **Anthropic Base URL** 指到 `http://127.0.0.1:7575/anthropic`，通过扩展或 `config.yaml` 切换上游与模型。

### Codex（`~/.codex/config.toml`）

**Codex** 通过自定义 model provider，把 `base_url` 指到 CCRelay 的 **`/openai`** OpenAI 兼容路径。

示例（请把 `model` 换成当前 CCRelay 提供方与 `modelMap` 能映射到的模型名，默认 `gpt-5.4-mini`）：

```toml
# ~/.codex/config.toml
model = "gpt-5.4-mini"
model_provider = "ccrelay"

[model_providers.ccrelay]
name = "CCRelay"
base_url = "http://localhost:7575/openai"
```

- **`base_url`** 使用 `http://<主机>:<端口>/openai`，Codex 会请求 `http://localhost:7575/openai/chat/completions` 等路径。
- 需先启动 CCRelay（VSCode 扩展），并在扩展中选好与目标模型路由一致的 provider。

---

## 使用指南

### 基础设置

1. 安装并启用扩展
2. 配置文件（`~/.ccrelay/config.yaml`）会自动创建
3. 编辑配置文件添加你的提供商
4. 服务器将自动启动（可通过配置中的 `server.autoStart` 设置）
5. 点击状态栏切换提供商或访问菜单

### 多实例模式

当打开多个 VSCode 窗口时：

- 一个实例成为 **Leader** 并运行 HTTP 服务器
- 其他实例成为 **Follower** 并通过 WebSocket 连接到 Leader
- Leader 向所有 Follower 实时广播提供商变更
- Follower 可以通过 Leader 请求切换提供商
- 如果 Leader 关闭，Follower 会自动成为新的 Leader
- 状态栏显示角色：`$(broadcast)` 表示 Leader，`$(radio-tower)` 表示 Follower
- **请求日志持久化**（`logging.enabled` / `logs.db`）仅在 **Leader 进程**中进行；Follower **不会**打开日志数据库；仪表盘与日志查看器会解析 Leader 的 HTTP 地址，并在 Leader 上调用 `/ccrelay/api/logs`、`/ccrelay/api/stats` 获取历史与统计。若 Leader 地址不可用或无法连通，上述接口返回 **503**。
- **IPC Leader 锁**（Unix/macOS：`~/.ccrelay/ccrelay-lock.sock`；Windows：命名管道 `ccrelay-lock`）与 **HTTP 代理的 Leader** 为同一实例，用于 VS Code 多窗口与桌面托盘进程之间的选举；Leader 正常退出后会释放锁文件端点，其它实例可重新绑定；IPC 短暂故障时会有限次重试，避免 Follower 持续 **ECONNREFUSED**。

### Provider 模式

#### Passthrough 模式（官方 Claude API）

- 保留原始认证头
- 用于带有 OAuth 会话的官方 Claude API
- 无需 API Key

#### Inject 模式（第三方提供商）

- 用提供商特定的 API Key 替换认证
- 需要 API Key 配置
- 支持 GLM、OpenRouter 和其他 Claude 兼容 API

### 模型映射

支持通配符模式映射模型名称，使用数组格式：

```yaml
modelMap:
  - pattern: "claude-opus-*"
    model: "glm-5"
  - pattern: "claude-sonnet-*"
    model: "glm-4.7"
  - pattern: "claude-haiku-*"
    model: "glm-4.5"
```

**视觉模型映射**：对于包含图像的请求，可以单独配置 `vlModelMap`：

```yaml
modelMap:
  - pattern: "claude-*"
    model: "text-model"
vlModelMap:
  - pattern: "claude-*"
    model: "vision-model"
```

### OpenAI 格式转换（LLM 路由）

> 📋 **功能说明**: CCRelay 可同时接受 **Anthropic**、**OpenAI Chat Completions** 与 **OpenAI Responses**（`/v1/responses`）等端点。入站为 Responses 时会经 Chat Completions 形态与上游对接；仅当与 provider 所需 wire 不一致时做转换，一致时**透传**（仍会做 `modelMap`、鉴权等）。

**入站端点**

| 路径 | 方法 | 客户端协议 |
|------|------|--------------|
| `/v1/messages`, `/messages` | POST | Anthropic Messages |
| `/v1/messages/count_tokens` | POST | Anthropic |
| `/v1/chat/completions` | POST | OpenAI Chat Completions |
| `/v1/responses` | POST | OpenAI Responses API（create） |
| `/v1/models` | GET | OpenAI 模型列表 |

`config.yaml` 中 `routing.forward` 应包含你实际使用的路径（默认已包含上表路径）。未匹配路径返回 404。

**转换规则**

- 入站 **Anthropic** + 提供商 `openai`：请求 A→O、响应 O→A（与此前行为一致）
- 入站 **OpenAI（chat）** + 提供商 `anthropic`：请求 O→A、响应 A→O
- 入站 **OpenAI Responses**：先转为 Chat Completions，再按需转 Anthropic；响应再转回 Responses 形状。`web_search` / `mcp` 等仅 OpenAI 托管的 tool 在 v1 会剥离
- 两侧**协议族相同**时（如 chat + `openai` provider）：无格式互转，仅做模型名等映射

**当前限制**

- 到上游的跨协议路径**不做真正的流式**（为转换会把请求里 `stream` 强制为 `false`）。若客户端仍对 `POST /v1/responses` 发送 `stream: true`（如 OpenAI Codex），CCRelay 会**合成**一小段 SSE（含 `response.created` / `response.completed` / `[DONE]`），让客户端 SDK 能正常结束；模型内容仍在最终 `response.completed` 里一次性给出，无 token 级流式。若需要转换时上游却返回 SSE，将报错。与上游类型一致时可原样流式透传。
- **Responses（v1）**：`previous_response_id`、`conversation` 及仅托管侧工具不保证；尽量使用常规 function 工具。

**示例：OpenAI 兼容厂商（如 Gemini）**

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

**GET /v1/models**（`modelsListFormat`，可选，默认 `auto`）

该请求没有 body，CCRelay 无法判断客户端要 OpenAI 还是 Anthropic 形态的模型列表。可在每个 provider 上设置 `modelsListFormat`：既决定此路径上的**入站客户端面**（与成功响应的跨协议转换一致），也决定**上游错误时**合成列表的 JSON 形状。

- **`auto`**（默认）：与 `providerType` 一致；与上游同族时成功响应直接透传，错误时生成对应形态列表。
- **`openai`**：始终按 OpenAI 列表处理（例如 OpenAI 客户端对接 Anthropic 上游时）。
- **`anthropic`**：始终按 Anthropic 列表处理。

若你之前依赖「Anthropic 上游仍返回 OpenAI 形 `/v1/models`」，请显式设置 `modelsListFormat: openai`（或在 Web 里选择 **GET /v1/models wire**）。

`GET /v1/models` 会透传到当前提供商；上游错误时按上述规则用 `modelMap` 生成后备列表。

### Web UI 管理界面

CCRelay 内置 Web UI 管理界面，提供：

- **Dashboard**: 服务器状态、当前提供商、请求统计
- **Client configuration**（可选）：在面板中设置 Claude Code 的 `~/.claude/settings.json` 内 `env`（如 `ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN` 占位）以及可选的分档 `ANTHROPIC_DEFAULT_*_MODEL`；详见上文 [Claude Code](#claude-code)。
- **Providers**: 查看和切换提供商
- **Logs**: 请求/响应日志查看器（需启用日志存储）
- **Settings**: 在 UI 中管理所有 YAML 配置项（日志、并发、服务器、路由）。并发和路由变更即时生效；服务器和日志变更需重启。**路由**：**Routing and 404** 说明在保存行上方；**Save routing** 与磁盘一致时禁用（**Up to date**），有未保存修改时显示 **Unsaved changes**；**Restore default routing** 与保存按钮同一行靠右，经与其他面板一致的 **AlertDialog** 确认后仅更新编辑器中的列表，需再点 **Save routing** 才写入 `config.yaml`。**`GET /ccrelay/api/config`** 响应含 **`routingDefaults`**（内置 forward/block 模板）供恢复默认预览。

面板上 **Client configuration** 与 **Configure default models**（与下图一致）：

![Client configuration — 在 UI 中写入 ~/.claude/settings.json 的 env](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-ccrelay-setup-1.png)

![Configure default models — 可选的 ANTHROPIC_DEFAULT_OPUS/SONNET/HAIKU 模型名](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-ccrelay-setup-2.png)

**Logs** 界面示例：

![请求日志](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-ccrelay-1.png)

![日志详情](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-ccrelay-3.png)

访问方式：
- 命令面板：`CCRelay: Open Dashboard`
- 浏览器访问：`http://127.0.0.1:7575/ccrelay/`

---

## 配置

CCRelay 使用 YAML 配置文件（默认为 `~/.ccrelay/config.yaml`）。首次启动时会自动创建默认配置文件。

### VSCode 设置

| 设置 | 默认值 | 描述 |
|------|--------|------|
| `ccrelay.configPath` | `~/.ccrelay/config.yaml` | YAML 配置文件路径 |

### YAML 配置文件

#### 服务器配置

| 设置 | 默认值 | 描述 |
|------|--------|------|
| `server.port` | `7575` | 代理服务器端口 |
| `server.host` | `127.0.0.1` | 绑定地址 |
| `server.autoStart` | `true` | 扩展加载时自动启动服务器 |

#### 提供商配置

| 设置 | 默认值 | 描述 |
|------|--------|------|
| `defaultProvider` | `official` | 默认提供商 ID |
| `providers` | `{...}` | 提供商配置 |

每个提供商支持：
- `name` - 显示名称
- `baseUrl` - API 基础 URL
- `modelsListFormat`（可选）- `auto` | `openai` | `anthropic`，用于 `GET /v1/models`（默认 `auto` 与 `providerType` 一致）
- `mode` - `passthrough` 或 `inject`
- `providerType` - `anthropic`（默认）、`openai`（完全透传）或 `openai_chat`（仅 Chat Completions）
- `apiKey` - API Key（inject 模式，支持 `${ENV_VAR}` 环境变量）
- `authHeader` - 认证头名称（默认：`authorization`）
- `modelMap` - 模型名称映射（数组格式 `{pattern, model}`，支持通配符）
- `vlModelMap` - 视觉模型映射（用于多模态请求）
- `headers` - 自定义请求头
- `enabled` - 是否启用（默认：`true`）

#### 路由配置

| 设置 | 默认值 | 描述 |
|------|--------|------|
| `configVersion` | `"0.2.0"` | 配置架构版本。旧版配置缺少此字段时会在加载时自动迁移。 |
| `routing.forward` | `[{path, provider}, ...]` | 转发规则 — 首条匹配生效。`provider: "auto"` = 当前活跃提供商；或指定具体提供商 ID（如 `"official"`）。未匹配路径返回 404。 |
| `routing.block` | `[{path, response, code, condition?}, ...]` | 拦截规则 — 返回自定义响应而非转发。优先于 forward 检查。按路径 glob 匹配。可选 **`condition.providers`**（ID 数组）— **仅当**当前 provider ID 在其中时生效；可选 **`condition.providerNot`**—当前 ID 在列表中时**跳过**该规则。 |

#### 并发控制

| 设置 | 默认值 | 描述 |
|------|--------|------|
| `concurrency.enabled` | `true` | 启用并发队列 |
| `concurrency.maxWorkers` | `3` | 最大并发工作数 |
| `concurrency.maxQueueSize` | `100` | 最大队列大小（0 = 无限制） |
| `concurrency.requestTimeout` | `60` | 队列中请求超时时间（秒，0 = 无限制） |
| `concurrency.routes` | `[]` | 按路由配置队列 |

#### 日志存储

| 设置 | 默认值 | 描述 |
|------|--------|------|
| `logging.enabled` | `false` | 启用请求日志存储 |
| `logging.database.type` | `sqlite` | 数据库类型（`sqlite` 或 `postgres`） |

**SQLite 配置：**
| 设置 | 默认值 | 描述 |
|------|--------|------|
| `logging.database.path` | `""` | 数据库文件路径（空 = `~/.ccrelay/logs.db`） |
| `logging.database.sqlite3_executable` | `""` | **`sqlite3`** 可执行文件路径（空 = 仅从 **`PATH`** 解析） |

**PostgreSQL 配置：**
| 设置 | 默认值 | 描述 |
|------|--------|------|
| `logging.database.host` | `localhost` | 服务器主机 |
| `logging.database.port` | `5432` | 服务器端口 |
| `logging.database.name` | `ccrelay` | 数据库名 |
| `logging.database.user` | `""` | 用户名 |
| `logging.database.password` | `""` | 密码（支持 `${ENV_VAR}`） |
| `logging.database.ssl` | `false` | 启用 SSL 连接 |

### 完整配置示例

```yaml
# CCRelay 配置文件
# 文档: https://github.com/inflaborg/ccrelay#configuration
configVersion: "0.2.0"

# ==================== 服务器配置 ====================
server:
  port: 7575                    # 代理服务器端口
  host: "127.0.0.1"             # 绑定地址
  autoStart: true               # 扩展加载时自动启动服务器

# ==================== 提供商配置 ====================
providers:
  official:
    name: "Claude Official"
    baseUrl: "https://api.anthropic.com"
    mode: "passthrough"         # passthrough | inject
    providerType: "anthropic"   # anthropic | openai | openai_chat
    enabled: true

  glm:
    name: "Z.AI-GLM-5"
    baseUrl: "https://api.z.ai/api/anthropic"
    mode: "inject"
    apiKey: "${GLM_API_KEY}"    # 支持环境变量
    authHeader: "authorization"
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

# 默认提供商 ID
defaultProvider: "official"

# ==================== 路由配置 ====================
routing:
  # 转发规则：路径 → 提供商映射。首条匹配生效。
  # provider: "auto" = 当前活跃提供商；或指定具体提供商 ID。
  # 未匹配路径返回 404。
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
    - path: "/v1/users/*"
      provider: "official"
    - path: "/v1/organizations/*"
      provider: "official"

  # 拦截规则：返回自定义响应而非转发。
  # 优先于 forward 检查。可选 condition.providers 仅在列出的当前 provider ID 下生效；
  # 可选 condition.providerNot：当前 ID 在列表中时跳过该规则。
  block:
    - path: "/api/event_logging/*"
      response: ""
      code: 200
    - path: "/v1/messages/count_tokens"
      response: '{"input_tokens": 0}'
      code: 200

# ==================== 并发控制 ====================
concurrency:
  enabled: true                 # 启用并发队列
  maxWorkers: 3                 # 最大并发工作数
  maxQueueSize: 100             # 最大队列大小（0=无限制）
  requestTimeout: 60            # 队列中请求超时时间（秒）

  # 按路由配置队列
  routes:
    - pattern: "/v1/messages/count_tokens"
      name: "count_tokens"
      maxWorkers: 30
      maxQueueSize: 1000

# ==================== 日志存储 ====================
logging:
  enabled: true                 # 启用请求日志存储

  database:
    type: "sqlite"              # sqlite | postgres
    path: ""                    # 空 = ~/.ccrelay/logs.db

    # PostgreSQL 配置
    # type: "postgres"
    # host: "localhost"
    # port: 5432
    # name: "ccrelay"
    # user: ""
    # password: "${POSTGRES_PASSWORD}"
    # ssl: false
```

> **注意**: YAML 配置支持 `camelCase` 和 `snake_case` 两种键名格式。

#### 默认合并规则

加载与核对 `config.yaml` 时，CCRelay 会把**内置默认模板**与你的文件合并：**你已写的键始终以你为准**，缺省的标量或嵌套对象用默认补齐。**`routing.forward`**（按 **`path`**）、**`routing.block`**（按路径 + 规范化后的 `condition`）、**`concurrency.routes`**（按正则 **`pattern`**）三节按「身份」合并而非整段替换：**你的条目在前**，若没有与默认重复的键，则在末尾**追加**内置里新增的规则（便于发版扩充默认路由）。若整节**不写**该项，则得到完整内置列表；显式 **`[]`** 表示刻意为空（**不再**追加默认）。在代码中可调用 `@ccrelay/core` 的 **`mergeFileConfigWithDefaults`**，规则相同。

---

## API 端点

代理服务器在 `/ccrelay/` 路径下暴露管理端点：

| 端点 | 方法 | 描述 |
|------|------|------|
| `/ccrelay/api/status` | GET | 获取当前代理状态 |
| `/ccrelay/api/providers` | GET | 列出所有可用提供商 |
| `/ccrelay/api/switch/{id}` | GET | 切换到指定提供商 |
| `/ccrelay/api/switch` | POST | 切换提供商（JSON body） |
| `/ccrelay/api/queue` | GET | 获取队列统计 |
| `/ccrelay/api/logs` | GET | 获取请求日志（启用日志时） |
| `/ccrelay/api/config` | GET、PATCH | **GET**：从 YAML 读取四类设置（`logging`、`concurrency`、`server`、`routing`）及 **`routingDefaults`**（内置 forward/block，供路由「恢复默认」预览）。**PATCH**：JSON `{ "section": "<名称>", "data": {…} }` 合并写入该节；路由/并发即时生效；**`server`** / **`logging`** 可能需要重启代理。 |
| `/ccrelay/ws` | WebSocket | Follower 实时同步 |
| `/ccrelay/` | GET | Web UI 管理界面 |

所有其他请求都将被代理到当前提供商。

---

## 命令

| 命令 | ID | 描述 |
|------|-----|------|
| CCRelay: Show Menu | `ccrelay.showMenu` | 显示主菜单 |
| CCRelay: Switch Provider | `ccrelay.switchProvider` | 打开提供商选择器 |
| CCRelay: Start Server | `ccrelay.startServer` | 手动启动服务器 |
| CCRelay: Stop Server | `ccrelay.stopServer` | 停止服务器 |
| CCRelay: Open Settings | `ccrelay.openSettings` | 打开扩展设置 |
| CCRelay: Show Logs | `ccrelay.showLogs` | 查看输出日志 |
| CCRelay: Clear Logs | `ccrelay.clearLogs` | 清除输出日志 |
| CCRelay: Open Dashboard | `ccrelay.openWebUI` | 打开管理面板 |

---

## 开发

```bash
# 编译 TypeScript
npm run compile

# 监听变化并重新编译
npm run watch

# 运行 ESLint
npm run lint

# 自动修复 lint 问题
npm run lint:fix

# 格式化代码
npm run format

# 运行单元测试
npm run test

# 运行集成测试
npm run test:integration

# 运行所有测试
npm run test:all

# 运行测试并生成覆盖率报告
npm run test:coverage

# 构建 VSIX 包
npm run package

# 桌面托盘应用（与 ~/.ccrelay 配置及 leader 选举共用）
npm run desktop:start

# 桌面安装包（需在对应宿主系统上打包，内部会先执行 desktop:build）
npm run desktop:pack:mac
npm run desktop:pack:win

# 进阶：在完成 `npm run desktop:build` 后，可对当前宿主单独指定 electron-builder 架构
# （cd packages/desktop && npx electron-builder --mac --x64 && npx electron-builder --mac --arm64）

# 开发构建
npm run build:dev

# 生产构建
npm run build:prod
```

### 项目结构

```
ccrelay/
├── packages/
│   ├── core/src/             # 共享运行时（代理、API、配置、转换器等）
│   ├── vscode/
│   │   ├── src/              # VS Code 扩展入口与 webview / 状态栏
│   │   ├── assets/           # 图标与 activity bar SVG
│   │   └── out/              # 构建产物（extension.cjs、web、worker）
│   └── desktop/
│       ├── src/              # Electron 托盘 + 仪表盘 BrowserWindow（主进程）
│       ├── assets/           # 应用/托盘图标；electron-builder buildResources
│       └── out/              # main.js、database-worker.cjs 等 bundle
├── web/                      # Web UI（React + Vite）
├── tests/                    # Vitest 单元测试与集成测试
├── scripts/                  # esbuild、版本号、打包辅助脚本
└── dists/                    # 打好的 .vsix（`npm run package`）
```

---

## 文件位置

| 文件 | 位置 | 说明 |
|------|------|------|
| YAML 配置 | `~/.ccrelay/config.yaml` | 主配置文件（自动创建） |
| 运行时状态 | `~/.ccrelay/state.json` | 当前启用的提供商 id（扩展与桌面端共用） |
| IPC Leader 锁 | `~/.ccrelay/ccrelay-lock.sock`（Unix/macOS）；`\\.\pipe\ccrelay-lock`（Windows） | 跨进程 Leader 选举（扩展与桌面端） |
| 日志数据库 | `~/.ccrelay/logs.db` | 请求/响应日志（启用后；多实例下 **仅 Leader 写入**） |

---

## TODO

- **桌面 macOS 分发**：在 CI 中通过 `electron-builder` 配置 **Apple Developer ID 签名 + 公证（notarization）**（GitHub Secrets：证书导出为 `CSC_LINK` / `CSC_KEY_PASSWORD`，以及 Apple 公证凭据，如 `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`），使从网页下载的版本不再被 Gatekeeper/quarantine 阻拦。签名流程稳定后可选 **恢复 DMG**（此前无签名时 CI 产物为非法 UDIF）。

---

## 贡献

欢迎提交 Issue 和 Pull Request！

---

## 致谢

本项目代码 **100% 由 AI 生成**。特别感谢：

- **[Claude Code](https://claude.ai/code)** - 编写了全部代码的 AI 编程助手
- **[GLM](https://z.ai/model-api)** - GLM 模型（glm-4.7，后切换至 glm-5）作为后端提供商

---

## 许可证

[MIT License](LICENSE)

Copyright (c) 2026 [inflab.org](https://inflab.org)
