# CCRelay

[![VSCode Extension](https://img.shields.io/badge/VSCode-Extension-blue)](https://code.visualstudio.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**CCRelay** 是一套 VS Code 扩展，并提供可选的 **Electron 桌面托盘应用**；内置 HTTP 代理，可在不同 AI 提供商（Anthropic、OpenAI、Gemini 等）之间平滑切换且不丢失会话上下文。支持 **Claude Code**、**Claude Cowork** 与 **OpenAI Codex**。

**项目官网**: [https://ccrelay.inflab.org](https://ccrelay.inflab.org)

**[English Documentation](./README.md)**

---

## 目录

- [核心特性](#核心特性)
- [系统要求](#系统要求)
- [安装](#安装)
- [桌面应用（Electron）](#桌面应用electron)
- [快速开始](#快速开始)
- [客户端对接](#客户端对接)
- [使用指南](#使用指南)
  - [多实例模式](#多实例模式)
  - [Provider 模式](#provider-模式)
  - [模型映射](#模型映射)
  - [OpenAI 格式转换](#openai-格式转换)
  - [Web UI 管理界面](#web-ui-管理界面)
- [配置](#配置)
- [API 端点](#api-端点)
- [命令](#命令)
- [开发](#开发)
- [文件位置](#文件位置)
- [TODO](#todo)
- [许可证](#许可证)

---

## 核心特性

**代理与路由**

- 内置 HTTP 代理（默认 `http://127.0.0.1:7575`），支持基于路径的路由——转发到提供商、拦截返回自定义响应、或返回 404
- 多协议：同一端口同时接受 **Anthropic**、**OpenAI Chat Completions** 和 **OpenAI Responses**（`/v1/responses`）
- 客户端与上游协议不一致时自动进行跨协议转换
- URL 前缀 `/openai/...` 和 `/anthropic/v1/...` 让不同客户端精确指定协议

**客户端对接**

- 原生支持 **Claude Code**（`ANTHROPIC_BASE_URL`）、**Claude Cowork** 和 **OpenAI Codex**（`~/.codex/config.toml`）
- Web 面板 **Client configuration** 标签页可一键写入所需环境变量

**运维**

- 多实例协调（Leader/Follower），跨 VS Code 窗口与桌面应用
- 配置热重载——编辑 `config.yaml` 后自动生效
- 可选请求/响应日志（SQLite 或 PostgreSQL），内置日志查看器
- 并发控制，支持按路由设置队列限制

**桌面与 UI**

- 可选 Electron 托盘应用——无需打开 VS Code 即可运行 CCRelay
- Web 管理面板：提供商管理、设置、i18n（中英文）
- Provider 导入/导出为 JSON 文件

---

## 系统要求

- VS Code 1.80.0 或更高版本
- Node.js（开发时需要）

---

## 安装

### 从 VSIX 安装

1. 从 [Releases](https://github.com/inflaborg/ccrelay/releases) 下载最新的 `.vsix` 文件
2. 在 VS Code 中按 `Cmd+Shift+P`（macOS）或 `Ctrl+Shift+P`（Windows/Linux）
3. 输入 `Extensions: Install from VSIX...`
4. 选择下载的文件

### 从源码构建

```bash
git clone https://github.com/inflaborg/ccrelay.git
cd ccrelay
npm install
npm run build
npm run package        # 产出 dists/ccrelay-vscode-*.vsix
```

### 开发模式

```bash
npm install
npm run compile        # 或 npm run watch
# 在 VS Code 中按 F5 打开扩展开发宿主窗口
```

---

## 桌面应用（Electron）

可选的 Electron 托盘应用（`packages/desktop`），与 VS Code 扩展共享同一核心：

- 共用 `~/.ccrelay/` 配置、状态和 Leader 选举
- 托盘菜单 → **打开控制台** 在应用窗口内加载 Web UI
- 从 [GitHub Releases](https://github.com/inflaborg/ccrelay/releases) 下载：
  - **macOS**: `CCRelay-<版本>-darwin-arm64.zip` 或 `-darwin-x64.zip`
  - **Windows**: `CCRelay-<版本>-win32-x64.exe` 或 `-win32-arm64.exe`

### macOS：首次打开

发布版本未经 Apple 公证。如果 Gatekeeper 阻止打开：

```bash
xattr -cr /path/to/CCRelay.app
```

或 **按住 Control 点击** 应用 → **打开**。

---

## 快速开始

### 1. 添加提供商

编辑 `~/.ccrelay/config.yaml`（首次启动时自动创建）：

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

### 2. 将 Claude Code 指向 CCRelay

在 `~/.claude/settings.json` 中添加：

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

可选——按档位设置默认模型名（仅在需要覆盖 Claude Code 默认值时配置）：

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

也可以在 Web 面板 **Client configuration** 标签页中设置。

### 3. 切换提供商

- 点击 VS Code 底部状态栏的 CCRelay 图标
- 或使用命令面板：`CCRelay: Switch Provider`

---

## 客户端对接

CCRelay 在同一端口（默认 **7575**）上提供 **Anthropic** 和 **OpenAI** 兼容路由。通过 URL 前缀选择协议：

| 客户端 | 协议 | Base URL |
|--------|------|----------|
| **Claude Code** | Anthropic | `http://127.0.0.1:7575/anthropic` |
| **Claude Cowork** | Anthropic | `http://127.0.0.1:7575/anthropic` |
| **Codex** | OpenAI | `http://127.0.0.1:7575/openai` |

直接使用 `http://127.0.0.1:7575` 时，legacy `/v1/...` 路径仍然有效。

### Claude Code

推荐的 `~/.claude/settings.json` 配置见[快速开始](#快速开始)。

快速测试（仅当前终端）：

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:7575/anthropic
claude
```

### Claude Cowork

将应用中的 **Anthropic Base URL** 设为 `http://127.0.0.1:7575/anthropic`。通过 CCRelay 扩展或 `config.yaml` 切换提供商。

### Codex

创建或编辑 `~/.codex/config.toml`：

```toml
model = "gpt-5.4-mini"
model_provider = "ccrelay"

[model_providers.ccrelay]
name = "CCRelay"
base_url = "http://localhost:7575/openai"
```

请将 `model` 改为你的 CCRelay 提供商能路由到的模型名（通过 `modelMap`）。

---

## 使用指南

### 多实例模式

打开多个 VS Code 窗口时：

- 一个实例成为 **Leader** 并运行 HTTP 服务器，其余为 **Follower**
- Leader 通过 WebSocket 向 Follower 广播提供商变更
- Leader 退出时 Follower 自动接管
- 状态栏显示角色：`$(broadcast)` = Leader，`$(radio-tower)` = Follower

**日志**：请求日志仅由 Leader 持久化。Follower 的日志 API 调用代理到 Leader；若 Leader 不可达则返回 503。

**IPC 锁**（macOS: `~/.ccrelay/ccrelay-lock.sock`，Windows: 命名管道）协调 VS Code 和桌面应用之间的 Leader 选举。

### Provider 模式

| 模式 | 认证行为 | 适用场景 |
|------|----------|----------|
| `passthrough` | 保留原始认证头 | 官方 Claude API（OAuth） |
| `inject` | 用提供商 API Key 替换认证 | 第三方提供商（GLM、OpenRouter 等） |

### 模型映射

用通配符将 Claude 模型名映射为提供商模型：

```yaml
modelMap:
  - pattern: "claude-opus-*"
    model: "glm-5"
  - pattern: "claude-sonnet-*"
    model: "glm-4.7"
```

**视觉模型映射**——为多模态请求单独配置：

```yaml
vlModelMap:
  - pattern: "claude-*"
    model: "vision-model"
```

`modelMap` 仅作用于请求体中的 `model` 字段。`GET /models` 响应不会被改写。

### OpenAI 格式转换

CCRelay 接受三种入站协议，当上游提供商使用不同协议时自动转换：

| 入站路径 | 客户端协议 |
|----------|------------|
| `/v1/messages`、`/anthropic/v1/messages` | Anthropic Messages |
| `/v1/chat/completions`、`/openai/chat/completions` | OpenAI Chat Completions |
| `/v1/responses` | OpenAI Responses API |
| `/v1/models`、`/openai/models` | OpenAI 模型列表 |
| `/anthropic/v1/models` | Anthropic 模型列表 |

**转换规则**：

- 两侧同族（如 Chat + `openai` 提供商）→ 透传（模型映射和鉴权仍生效）
- 跨族 → 通过 Chat Completions 枢纽转换请求/响应体
- `GET /models` → 入站路径与 `providerType` 不一致时转换列表格式；上游错误原样转发

**流式限制**：

- 跨协议路径强制 `stream: false` 进行转换。若客户端发送 `stream: true`，CCRelay 会合成最小 SSE 封装让客户端 SDK 正常结束；模型输出在最终载荷中一次性返回，非逐 token 流式。
- 同族流式正常透传。

**示例：OpenAI 兼容提供商（Gemini）**

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

### Web UI 管理界面

内置 Web 面板，通过命令面板 → `CCRelay: Open Dashboard`（VS Code）或托盘菜单 → **打开控制台**（桌面应用）访问。

- **Dashboard** — 服务器状态、当前提供商、请求统计
- **Providers** — 查看、切换、复制、导入/导出提供商
- **Logs** — 请求/响应日志查看器（未启用日志时自动隐藏）
- **Settings** — 在 UI 中管理 YAML 配置；路由和并发保存后即时生效，服务器和日志需重启
- **Client configuration** — 从 UI 写入 Claude Code 环境变量和 Codex 配置

> **注意**：直接在浏览器中打开 `http://127.0.0.1:7575/ccrelay/` 无法访问面板。面板仅允许来自 VS Code 扩展或桌面应用内部的请求（通过内部请求头验证）。请通过扩展命令或桌面托盘菜单打开面板。

**Web UI**

![Client configuration](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-ccrelay-setup-1.png)

![Configure default models](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-ccrelay-setup-2.png)

![请求日志](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-ccrelay-1.png)

![日志详情](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-ccrelay-3.png)

**桌面应用**

![桌面 — 控制台](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-desktop-1.png)

![桌面 — Provider 列表](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-desktop-2.png)

---

## 配置

CCRelay 使用 `~/.ccrelay/config.yaml`（首次启动时自动创建）。启动时内置默认模板与你的文件合并——**你已写的值始终以你为准**，缺省的键用默认值补齐。列表类型（`routing.forward`、`routing.block`、`concurrency.routes`）按身份键合并，你的条目在前，新增的默认条目追加在末尾。整节不写则继承完整默认列表；显式设 `[]` 表示刻意为空。

> YAML 配置同时支持 `camelCase` 和 `snake_case` 键名。

### VS Code 设置

| 设置 | 默认值 | 描述 |
|------|--------|------|
| `ccrelay.configPath` | `~/.ccrelay/config.yaml` | 配置文件路径 |

### 服务器

| 设置 | 默认值 | 描述 |
|------|--------|------|
| `server.port` | `7575` | 代理服务器端口 |
| `server.host` | `127.0.0.1` | 绑定地址 |
| `server.autoStart` | `true` | 扩展加载时自动启动服务器 |
| `server.locale` | `""` | Web UI 语言（`"en"` 或 `"zh"`）。未设置时首次访问弹出选择器。 |

### 提供商

| 设置 | 默认值 | 描述 |
|------|--------|------|
| `defaultProvider` | `official` | 默认提供商 ID |
| `providers` | `{...}` | 提供商配置（见下方） |

每个提供商支持：

| 字段 | 默认值 | 描述 |
|------|--------|------|
| `name` | — | 显示名称 |
| `baseUrl` | — | API 基础 URL |
| `mode` | `"passthrough"` | `passthrough`（保留认证）或 `inject`（替换认证） |
| `providerType` | `"anthropic"` | `"anthropic"`、`"openai"`（完全透传）或 `"openai_chat"`（仅 Chat Completions） |
| `apiKey` | — | inject 模式的 API Key。支持 `${ENV_VAR}`。 |
| `authHeader` | `"authorization"` | 认证头名称 |
| `modelMap` | — | 模型名映射（`[{pattern, model}]`，支持通配符） |
| `vlModelMap` | — | 视觉模型映射（用于多模态请求） |
| `headers` | — | 自定义请求头 |
| `enabled` | `true` | 是否启用 |

### 路由

| 设置 | 默认值 | 描述 |
|------|--------|------|
| `configVersion` | `"0.2.0"` | 配置架构版本。旧版配置自动迁移。 |
| `routing.forward` | `[{path, provider}]` | 转发规则——首条匹配生效。`provider: "auto"` = 当前提供商。未匹配 → 404。 |
| `routing.block` | `[{path, response, code, condition?}]` | 拦截规则——返回自定义响应。可选 `condition.providers`（白名单）和 `condition.providerNot`（排除列表）。 |

### 并发控制

| 设置 | 默认值 | 描述 |
|------|--------|------|
| `concurrency.enabled` | `true` | 启用请求队列 |
| `concurrency.maxWorkers` | `3` | 最大并发数 |
| `concurrency.maxQueueSize` | `100` | 最大队列大小（0 = 无限制） |
| `concurrency.requestTimeout` | `60` | 队列超时秒数（0 = 无限制） |
| `concurrency.routes` | `[]` | 按路由的队列配置（按 `pattern`） |

### 日志

| 设置 | 默认值 | 描述 |
|------|--------|------|
| `logging.enabled` | `false` | 启用请求日志 |
| `logging.database.type` | `"sqlite"` | `"sqlite"` 或 `"postgres"` |

**SQLite：**

| 设置 | 默认值 | 描述 |
|------|--------|------|
| `logging.database.path` | `""` | 数据库文件路径（空 = `~/.ccrelay/logs.db`） |
| `logging.database.sqlite3_executable` | `""` | `sqlite3` 二进制路径（空 = 从 `PATH` 解析） |

若无法解析 `sqlite3`，代理仍可运行但不持久化日志（日志中会给出警告）。

**PostgreSQL：**

| 设置 | 默认值 | 描述 |
|------|--------|------|
| `logging.database.host` | `localhost` | 服务器主机 |
| `logging.database.port` | `5432` | 服务器端口 |
| `logging.database.name` | `ccrelay` | 数据库名 |
| `logging.database.user` | `""` | 用户名 |
| `logging.database.password` | `""` | 密码（支持 `${ENV_VAR}`） |
| `logging.database.ssl` | `false` | 启用 SSL |

### 完整配置示例

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

## API 端点

管理端点在 `/ccrelay/` 下：

| 端点 | 方法 | 描述 |
|------|------|------|
| `/ccrelay/api/status` | GET | 代理状态 |
| `/ccrelay/api/providers` | GET | 列出提供商 |
| `/ccrelay/api/switch/{id}` | GET | 切换到指定提供商 |
| `/ccrelay/api/switch` | POST | 切换提供商（JSON body） |
| `/ccrelay/api/providers/export` | POST | 按 ID 导出提供商 |
| `/ccrelay/api/providers/import` | POST | 导入提供商（按 ID 合并） |
| `/ccrelay/api/queue` | GET | 队列统计 |
| `/ccrelay/api/logs` | GET | 请求日志 |
| `/ccrelay/api/config` | GET、PATCH | 读写配置节 |
| `/ccrelay/ws` | WebSocket | Follower 同步 |
| `/ccrelay/` | GET | Web UI 管理界面 |

所有其他请求将被代理到当前提供商。

---

## 命令

| 命令 | ID | 描述 |
|------|-----|------|
| CCRelay: Show Menu | `ccrelay.showMenu` | 显示主菜单 |
| CCRelay: Switch Provider | `ccrelay.switchProvider` | 打开提供商选择器 |
| CCRelay: Start Server | `ccrelay.startServer` | 启动服务器 |
| CCRelay: Stop Server | `ccrelay.stopServer` | 停止服务器 |
| CCRelay: Open Settings | `ccrelay.openSettings` | 打开扩展设置 |
| CCRelay: Show Logs | `ccrelay.showLogs` | 查看输出日志 |
| CCRelay: Clear Logs | `ccrelay.clearLogs` | 清除输出日志 |
| CCRelay: Open Dashboard | `ccrelay.openWebUI` | 打开管理面板 |

---

## 开发

```bash
npm run compile        # 类型检查
npm run watch          # 监听并重新编译
npm run lint           # Lint
npm run format         # 格式化
npm run test           # 单元测试
npm run test:integration
npm run test:all
npm run test:coverage
npm run package        # 构建 VSIX
npm run build:dev      # 开发构建
npm run build:prod     # 生产构建

# 桌面应用
npm run desktop:start
npm run desktop:pack:mac
npm run desktop:pack:win
```

### 项目结构

```
ccrelay/
├── packages/
│   ├── core/         # 共享运行时（代理、配置、转换器）
│   ├── vscode/       # VS Code 扩展
│   └── desktop/      # Electron 托盘应用
├── web/              # Web UI（React + Vite）
├── tests/            # Vitest 单元测试与集成测试
├── scripts/          # 构建和打包辅助脚本
└── dists/            # 打包的 .vsix
```

---

## 文件位置

| 文件 | 位置 | 说明 |
|------|------|------|
| 配置 | `~/.ccrelay/config.yaml` | 主配置文件（自动创建） |
| 状态 | `~/.ccrelay/state.json` | 当前激活的提供商 ID |
| IPC 锁 | `~/.ccrelay/ccrelay-lock.sock`（Unix）/ 命名管道（Win） | Leader 选举 |
| 日志数据库 | `~/.ccrelay/logs.db` | 请求日志（仅 Leader 写入） |

---

## TODO

- macOS：在 CI 中配置 Apple Developer ID 签名 + 公证，移除 Gatekeeper 提示
- 签名完成后恢复 DMG 打包

---

## 贡献

欢迎提交 Issue 和 Pull Request！

---

## 致谢

本项目代码 **100% 由 AI 生成**。特别感谢：

- **[Claude Code](https://claude.ai/code)** — AI 编程助手
- **[GLM](https://z.ai/model-api)** — GLM 模型作为后端提供商

---

## 许可证

[MIT License](LICENSE)

Copyright (c) 2026 [inflab.org](https://inflab.org)
