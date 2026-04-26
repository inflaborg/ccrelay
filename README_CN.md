# CCRelay

[![VSCode Extension](https://img.shields.io/badge/VSCode-Extension-blue)](https://code.visualstudio.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**CCRelay** 是一个 VSCode 扩展，内置 API 代理服务器，让你能够在不同的 AI 提供商之间无缝切换，而不会丢失对话上下文。完全兼容 Claude Code 和其他 Anthropic API 客户端。

**项目官网**: [https://ccrelay.inflab.org](https://ccrelay.inflab.org)

**[English Documentation](./README.md)**

---

## 目录

- [核心特性](#核心特性)
- [系统要求](#系统要求)
- [安装](#安装)
- [快速开始](#快速开始)
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
- **请求日志**: 可选的 SQLite/PostgreSQL 请求/响应日志存储，带 Web UI 查看器
- **并发控制**: 内置请求队列和并发限制，防止 API 过载
- **自动启动**: VSCode 启动时自动启动代理服务器

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

## 快速开始

### 1. 配置 Claude Code 使用代理

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:7575
claude
```

### 2. 配置提供商

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

### 3. 切换提供商

- 点击 VSCode 底部状态栏的 CCRelay 图标
- 或使用命令面板：`CCRelay: Switch Provider`

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

`config.yaml` 中 `routing.proxy` 应包含你实际使用的路径（默认已包含上表路径）。

**转换规则**

- 入站 **Anthropic** + 提供商 `openai`：请求 A→O、响应 O→A（与此前行为一致）
- 入站 **OpenAI（chat）** + 提供商 `anthropic`：请求 O→A、响应 A→O
- 入站 **OpenAI Responses**：先转为 Chat Completions，再按需转 Anthropic；响应再转回 Responses 形状。`web_search` / `mcp` 等仅 OpenAI 托管的 tool 在 v1 会剥离
- 两侧**协议族相同**时（如 chat + `openai` provider）：无格式互转，仅做模型名等映射

**OpenAI Chat Completions 路径**（`openaiChatCompletionsPath`，可选）

在转换为 OpenAI Chat Completions（A→O，或 Responses→Chat 作为枢纽）时，CCRelay 会把路径拼在 `baseUrl` 后。默认是 `/chat/completions`（路径中不会多出 `/v1`）。若 `baseUrl` 已以版本段结尾（例如 `https://api.z.ai/api/coding/paas/v4`），而上游要的是 `.../v4/chat/completions` 而不是 `.../v4/v1/chat/completions`，保持默认或显式写 `openaiChatCompletionsPath: "/chat/completions"` 即可。若网关只认完整 OpenAI 风格路径且 `baseUrl` 是主机根，可设 `openaiChatCompletionsPath: "/v1/chat/completions"`。

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

`GET /v1/models` 会透传到当前提供商；若上游返回错误，会尽量用该 provider 的 `modelMap` 生成最简模型列表作为后备。

### Web UI 管理界面

CCRelay 内置 Web UI 管理界面，提供：

- **Dashboard**: 服务器状态、当前提供商、请求统计
- **Providers**: 查看和切换提供商
- **Logs**: 请求/响应日志查看器（需启用日志存储）

![请求日志](docs/screenshot-ccrelay-1.png)

![日志详情](docs/screenshot-ccrelay-3.png)

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
- `openaiChatCompletionsPath`（可选）- 转换到该 API 时使用的路径（默认：`/chat/completions`；若 base 未含版本前缀而需要完整 OpenAI 风格则可用 `/v1/chat/completions`）
- `mode` - `passthrough` 或 `inject`
- `providerType` - `anthropic`（默认）或 `openai`
- `apiKey` - API Key（inject 模式，支持 `${ENV_VAR}` 环境变量）
- `authHeader` - 认证头名称（默认：`authorization`）
- `modelMap` - 模型名称映射（数组格式 `{pattern, model}`，支持通配符）
- `vlModelMap` - 视觉模型映射（用于多模态请求）
- `headers` - 自定义请求头
- `enabled` - 是否启用（默认：`true`）

#### 路由配置

| 设置 | 默认值 | 描述 |
|------|--------|------|
| `routing.proxy` | `["/v1/messages", "/messages", "/v1/chat/completions", "/v1/models", "/v1/responses"]` | 路由到当前提供商的路径 |
| `routing.passthrough` | `["/v1/users/*", "/v1/organizations/*"]` | 始终发送到官方 API 的路径 |
| `routing.block` | `[{path: "/api/event_logging/*", ...}]` | inject 模式下返回自定义响应的路径 |
| `routing.openaiBlock` | `[{path: "/v1/messages/count_tokens", ...}]` | OpenAI 提供商的阻塞路径 |

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
    providerType: "anthropic"   # anthropic | openai
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
  # 代理路由：转发到当前提供商
  proxy:
    - "/v1/messages"
    - "/messages"

  # 直通路由：始终发送到官方 API
  passthrough:
    - "/v1/users/*"
    - "/v1/organizations/*"

  # 阻塞路由（inject 模式）：返回自定义响应
  block:
    - path: "/api/event_logging/*"
      response: ""
      code: 200

  # OpenAI 格式阻塞路由
  openaiBlock:
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

# 开发构建
npm run build:dev

# 生产构建
npm run build:prod
```

### 项目结构

```
ccrelay/
├── src/
│   ├── extension.ts          # 扩展入口
│   ├── api/                  # API 端点处理
│   ├── config/               # 配置管理
│   ├── converter/            # Anthropic ↔ OpenAI 格式转换
│   ├── database/             # 数据库驱动（SQLite/PostgreSQL）
│   ├── queue/                # 并发控制和请求队列
│   ├── server/               # HTTP 服务器和路由
│   ├── types/                # TypeScript 类型定义
│   ├── utils/                # 工具函数
│   └── vscode/               # VSCode 集成（状态栏、日志查看器）
├── web/                      # Web UI（React + Vite）
├── tests/                    # 测试文件
└── assets/                   # 扩展资源
```

---

## 文件位置

| 文件 | 位置 | 说明 |
|------|------|------|
| YAML 配置 | `~/.ccrelay/config.yaml` | 主配置文件（自动创建） |
| 日志数据库 | `~/.ccrelay/logs.db` | 请求/响应日志（启用后） |

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
