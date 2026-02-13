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
- **状态栏指示器**: 显示当前提供商、角色（Leader/Follower/Standalone）和服务器状态
- **快速切换提供商**: 点击状态栏或使用命令切换提供商
- **Provider 模式**:
  - `passthrough` - 保留原始认证头，用于官方 API
  - `inject` - 注入提供商特定的 API Key
- **模型映射**: 自动将 Claude 模型名称转换为提供商特定模型，支持通配符（如 `claude-*` → `glm-4.7`）
- **视觉模型映射**: 单独配置视觉/多模态请求的模型映射（`vlModelMap`）
- **OpenAI 格式转换**: 自动将 Anthropic API 格式转换为 OpenAI 格式，支持 Gemini、OpenRouter 等 OpenAI 兼容 API
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
git clone https://github.com/inflab/ccrelay.git
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

在 VSCode 设置中添加提供商配置：

```json
{
  "ccrelay.provider.list": {
    "official": {
      "name": "Claude Official",
      "baseUrl": "https://api.anthropic.com",
      "mode": "passthrough"
    },
    "glm": {
      "name": "Z.AI-GLM-5",
      "baseUrl": "https://api.z.ai/api/anthropic",
      "mode": "inject",
      "apiKey": "<YOUR-API-KEY>",
      "modelMap": {
        "claude-opus-*": "glm-5",
        "claude-sonnet-*": "glm-5",
        "claude-haiku-*": "glm-4.7"
      }
    }
  }
}
```

### 3. 切换提供商

- 点击 VSCode 底部状态栏的 CCRelay 图标
- 或使用命令面板：`CCRelay: Switch Provider`

---

## 使用指南

### 基础设置

1. 安装并启用扩展
2. 在 VSCode 设置中配置提供商
3. 服务器将自动启动（可通过 `ccrelay.server.autoStart` 配置）
4. 点击状态栏切换提供商或访问菜单

### 多实例模式

当打开多个 VSCode 窗口时：

- 一个实例成为 **Leader** 并运行 HTTP 服务器
- 其他实例成为 **Follower** 并连接到 Leader
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

支持通配符模式映射模型名称：

```json
{
  "modelMap": {
    "claude-opus-*": "glm-5",
    "claude-sonnet-*": "glm-4.7",
    "claude-haiku-*": "glm-4.5"
  }
}
```

**视觉模型映射**：对于包含图像的请求，可以单独配置 `vlModelMap`：

```json
{
  "modelMap": {
    "claude-*": "text-model"
  },
  "vlModelMap": {
    "claude-*": "vision-model"
  }
}
```

### OpenAI 格式转换

CCRelay 支持 OpenAI 兼容的提供商（如 Gemini）：

```json
{
  "gemini": {
    "name": "Gemini",
    "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai",
    "providerType": "openai",
    "mode": "inject",
    "apiKey": "<YOUR-API-KEY>",
    "modelMap": {
      "claude-*": "gemini-3-pro-preview"
    }
  }
}
```

转换过程：
- **请求**: Anthropic Messages API 格式 → OpenAI Chat Completions 格式
- **响应**: OpenAI 格式 → Anthropic 格式

> ⚠️ **注意**: Anthropic 转 OpenAI 的逻辑并没有经过良好的测试，可能存在问题，欢迎提出问题或 PR！

### Web UI 管理界面

CCRelay 内置 Web UI 管理界面，提供：

- **Dashboard**: 服务器状态、当前提供商、请求统计
- **Providers**: 查看和切换提供商
- **Logs**: 请求/响应日志查看器（需启用日志存储）

访问方式：
- 命令面板：`CCRelay: Open Web UI`
- 浏览器访问：`http://127.0.0.1:7575/ccrelay/`

---

## 配置

### VSCode 设置

#### 服务器设置

| 设置 | 默认值 | 描述 |
|------|--------|------|
| `ccrelay.server.port` | `7575` | 代理服务器端口 |
| `ccrelay.server.host` | `127.0.0.1` | 代理服务器主机 |
| `ccrelay.server.autoStart` | `true` | VSCode 启动时自动启动服务器 |

#### 配置文件设置

| 设置 | 默认值 | 描述 |
|------|--------|------|
| `ccrelay.config.useFile` | `false` | 从 `~/.ccrelay/config.yaml` 读取配置 |

#### 提供商设置

| 设置 | 默认值 | 描述 |
|------|--------|------|
| `ccrelay.provider.default` | `official` | 默认提供商 ID |
| `ccrelay.provider.list` | `{...}` | 提供商配置 |

每个提供商支持：
- `name` - 显示名称
- `baseUrl` - API 基础 URL
- `mode` - `passthrough` 或 `inject`
- `providerType` - `anthropic`（默认）或 `openai`
- `apiKey` - API Key（inject 模式，支持 `${ENV_VAR}` 环境变量）
- `authHeader` - 认证头名称（默认：`authorization`）
- `modelMap` - 模型名称映射（支持通配符）
- `vlModelMap` - 视觉模型映射（用于多模态请求）
- `headers` - 自定义请求头
- `enabled` - 是否启用（默认：`true`）

#### 路由设置

| 设置 | 默认值 | 描述 |
|------|--------|------|
| `ccrelay.route.patterns` | `["/v1/messages", "/messages"]` | 路由到当前提供商的路径 |
| `ccrelay.route.passthroughPatterns` | `["/v1/users/*", "/v1/organizations/*"]` | 始终发送到官方 API 的路径 |
| `ccrelay.route.blockPatterns` | `[{path: "/api/event_logging/*", response: "..."}]` | inject 模式下返回自定义响应的路径 |
| `ccrelay.route.openaiBlockPatterns` | `[]` | OpenAI 提供商的阻塞路径 |

#### 并发控制设置

| 设置 | 默认值 | 描述 |
|------|--------|------|
| `ccrelay.concurrency.enabled` | `false` | 启用并发控制 |
| `ccrelay.concurrency.maxConcurrency` | `5` | 最大并发请求数 |
| `ccrelay.concurrency.maxQueueSize` | - | 最大排队请求数（0 或未设置 = 无限制） |
| `ccrelay.concurrency.timeout` | - | 请求超时时间（毫秒） |

#### 日志设置

| 设置 | 默认值 | 描述 |
|------|--------|------|
| `ccrelay.log.enableStorage` | `false` | 启用请求/响应日志存储到数据库 |

#### 数据库设置

| 设置 | 默认值 | 描述 |
|------|--------|------|
| `ccrelay.database.type` | `sqlite` | 数据库类型（`sqlite` 或 `postgres`） |
| `ccrelay.database.sqlitePath` | `""` | SQLite 数据库文件路径（默认：`~/.ccrelay/logs.db`） |
| `ccrelay.database.postgresHost` | `localhost` | PostgreSQL 服务器主机 |
| `ccrelay.database.postgresPort` | `5432` | PostgreSQL 服务器端口 |
| `ccrelay.database.postgresDatabase` | `ccrelay` | PostgreSQL 数据库名 |
| `ccrelay.database.postgresUser` | `""` | PostgreSQL 用户名 |
| `ccrelay.database.postgresPassword` | `""` | PostgreSQL 密码（支持 `${ENV_VAR}`） |
| `ccrelay.database.postgresSsl` | `false` | 启用 SSL 连接 |

#### UI 设置

| 设置 | 默认值 | 描述 |
|------|--------|------|
| `ccrelay.ui.statusBarPosition` | `right` | 状态栏位置（`left` 或 `right`） |
| `ccrelay.ui.statusBarPriority` | `100` | 状态栏优先级 |

### 完整配置示例

#### VSCode settings.json

```json
{
  "ccrelay.server.port": 7575,
  "ccrelay.server.autoStart": true,

  "ccrelay.route.blockPatterns": [
    {
      "path": "/api/event_logging/*",
      "response": "",
      "responseCode": 200
    }
  ],
  "ccrelay.route.passthroughPatterns": [
    "/v1/users/*",
    "/v1/organizations/*"
  ],
  "ccrelay.route.patterns": [
    "/v1/messages",
    "/messages"
  ],
  "ccrelay.route.openaiBlockPatterns": [
    {
      "path": "/v1/messages/count_tokens",
      "response": "{\"input_tokens\": 0}",
      "responseCode": 200
    }
  ],

  "ccrelay.concurrency.enabled": true,
  "ccrelay.concurrency.maxConcurrency": 3,

  "ccrelay.log.enableStorage": true,
  "ccrelay.database.type": "sqlite",

  "ccrelay.provider.list": {
    "official": {
      "name": "Claude Official",
      "baseUrl": "https://api.anthropic.com",
      "mode": "passthrough"
    },
    "glm": {
      "name": "Z.AI-GLM-5",
      "baseUrl": "https://api.z.ai/api/anthropic",
      "mode": "inject",
      "authHeader": "authorization",
      "apiKey": "<YOUR-API-KEY>",
      "modelMap": {
        "claude-opus-*": "glm-5",
        "claude-sonnet-*": "glm-5",
        "claude-haiku-*": "glm-4.7"
      }
    },
    "gemini": {
      "name": "Gemini",
      "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai",
      "providerType": "openai",
      "mode": "inject",
      "authHeader": "authorization",
      "apiKey": "<YOUR-API-KEY>",
      "modelMap": {
        "claude-*": "gemini-3-pro-preview"
      }
    }
  }
}
```

#### YAML 配置文件（`~/.ccrelay/config.yaml`）

启用方式：设置 `ccrelay.config.useFile: true`

```yaml
server:
  port: 7575
  host: 127.0.0.1

defaultProvider: official

providers:
  official:
    name: Claude Official
    baseUrl: https://api.anthropic.com
    mode: passthrough

  glm:
    name: Z.AI-GLM-5
    base_url: https://api.z.ai/api/anthropic
    mode: inject
    api_key: ${GLM_API_KEY}
    auth_header: authorization
    model_map:
      "claude-opus-*": "glm-5"
      "claude-haiku-*": "glm-4.7"

  gemini:
    name: Gemini
    base_url: https://generativelanguage.googleapis.com/v1beta/openai
    provider_type: openai
    mode: inject
    api_key: ${GEMINI_API_KEY}
    model_map:
      "claude-*": "gemini-3-pro-preview"

routePatterns:
  - /v1/messages
  - /messages

passthroughPatterns:
  - /v1/users/*
  - /v1/organizations/*

blockPatterns:
  - path: /api/event_logging/*
    response: '{"ok": true}'
    responseCode: 200

concurrency:
  enabled: true
  maxConcurrency: 3

enableLogStorage: true
```

> **注意**: YAML 配置支持 `camelCase` 和 `snake_case` 两种键名格式。

---

## API 端点

代理服务器在 `/ccrelay/` 路径下暴露管理端点：

| 端点 | 方法 | 描述 |
|------|------|------|
| `/ccrelay/status` | GET | 获取当前代理状态 |
| `/ccrelay/providers` | GET | 列出所有可用提供商 |
| `/ccrelay/switch/{id}` | GET | 切换到指定提供商 |
| `/ccrelay/switch` | POST | 切换提供商（JSON body） |
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
| CCRelay: Open Web UI | `ccrelay.openWebUI` | 打开 Web 管理界面 |

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
npm run test:unit

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
| VSCode 设置 | VSCode `settings.json` | 主要配置方式（默认） |
| YAML 配置 | `~/.ccrelay/config.yaml` | 可选配置（需设置 `ccrelay.config.useFile: true`） |
| 日志数据库 | `~/.ccrelay/logs.db` | 请求/响应日志（启用后） |

---

## 贡献

欢迎提交 Issue 和 Pull Request！

> ⚠️ **注意**: Anthropic 转 OpenAI 的逻辑并没有经过良好的测试，可能存在问题，欢迎提出问题或 PR 来改进这个功能！

---

## 致谢

本项目代码 **100% 由 AI 生成**。特别感谢：

- **[Claude Code](https://claude.ai/code)** - 编写了全部代码的 AI 编程助手
- **[GLM](https://www.z.ai/)** - GLM 模型（glm-4.7，后切换至 glm-5）作为后端提供商

---

## 许可证

[MIT License](LICENSE)

Copyright (c) 2026 [inflab.org](https://inflab.org)
