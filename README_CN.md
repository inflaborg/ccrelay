# CCRelay

[![Latest release](https://img.shields.io/github/v/release/inflaborg/ccrelay)](https://github.com/inflaborg/ccrelay/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/inflaborg/ccrelay/total)](https://github.com/inflaborg/ccrelay/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**在 Claude Code、Claude Desktop 和 ChatGPT 桌面应用（ChatGPT Work 与 Codex）中使用第三方模型。**

**CCRelay** 是免费开源的 macOS / Windows 桌面应用。它让 **Claude Code**、**Claude Desktop**（第三方推理与 Cowork）、**ChatGPT 桌面应用**（ChatGPT Work 与 Codex）以及 **Codex CLI** 使用 GLM、Kimi、DeepSeek、Gemini、Qwen、MiniMax、小米 MiMo 等第三方模型，或任意 OpenAI / Anthropic 兼容接口。继续用你熟悉的客户端，在一个地方切换模型。本地代理自动在 Anthropic 与 OpenAI 格式之间转换。另提供 VS Code 扩展。

**下载**：[最新版本](https://github.com/inflaborg/ccrelay/releases/latest) —— macOS `.dmg`（Apple 芯片、Intel）· Windows `.exe`（x64、arm64）· VS Code 扩展见 [Marketplace](https://marketplace.visualstudio.com/items?itemName=infLab.ccrelay-vscode) 与 [Open VSX](https://open-vsx.org/extension/infLab/ccrelay-vscode)

**项目官网**：[https://ccrelay.inflab.org](https://ccrelay.inflab.org) · **[English Documentation](./README.md)** · **[日本語](./README_JA.md)** · **[한국어](./README_KO.md)**

![CCRelay 桌面应用 —— 提供商列表](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-desktop-2.webp)

---

## 目录

- [支持的客户端](#支持的客户端)
- [三步上手](#三步上手)
- [核心特性](#核心特性)
- [常见问题](#常见问题)
- [隐私与本机数据](#隐私与本机数据)
- [支持的提供商](#支持的提供商)
- [安装](#安装)
- [手动配置](#手动配置)
- [客户端对接](#客户端对接)
- [使用指南](#使用指南)
  - [多实例模式](#多实例模式)
  - [Provider 模式](#provider-模式)
  - [模型映射](#模型映射)
  - [Claude Desktop / Cowork 模型 ID 限制](#claude-desktop--cowork-模型-id-限制)
  - [OpenAI 格式转换](#openai-格式转换)
  - [Web UI 管理界面](#web-ui-管理界面)
- [外部联网搜索](#外部联网搜索)
- [配置](#配置)
- [API 端点](#api-端点)
- [命令](#命令)
- [开发](#开发)
- [文件位置](#文件位置)
- [许可证](#许可证)

---

## 支持的客户端

| 客户端                                             | 接入方式                                                             |
| -------------------------------------------------- | -------------------------------------------------------------------- |
| **Claude Code**（CLI 与 IDE 扩展）                 | 客户端配置 → Claude Code → 应用                                      |
| **Claude Desktop**（第三方推理、Cowork）           | 客户端配置 → Claude Desktop → 应用，然后重启 Claude Desktop          |
| **Codex CLI**                                      | 客户端配置 → Codex → 应用，然后重启 Codex                            |
| **ChatGPT 桌面应用**（ChatGPT Work、Codex）        | 与 Codex CLI 共用 `~/.codex/config.toml`：点应用，然后重启 ChatGPT 桌面应用 |
| 任何可自定义 Anthropic 或 OpenAI 地址的工具        | `http://127.0.0.1:7575/anthropic` 或 `http://127.0.0.1:7575/openai`  |

各客户端的详细说明见[客户端对接](#客户端对接)。

---

## 三步上手

1. **安装桌面应用。** 从 [Releases](https://github.com/inflaborg/ccrelay/releases/latest) 下载并打开，本地代理会在 `http://127.0.0.1:7575` 启动。
2. **添加提供商。** 打开 **提供商 → 添加提供商**，选择预设（GLM、小米 MiMo、DeepSeek、MiniMax、Gemini、Azure OpenAI、美团 LongCat、Astraflow）或填写任意 Base URL，粘贴 API Key，运行内置测试后创建。
3. **连接客户端。** 打开 **客户端配置**，选择 Claude Code、Claude Desktop 或 Codex，点击 **应用**。若上表注明需要重启，请重启该客户端。

之后要切换模型，选中另一张提供商卡片并点击 **应用**；或开启 **智能路由**，一次列出所有提供商的模型，直接在客户端里选择。客户端配置页的 **还原** 可撤销对客户端的修改。

![客户端配置](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-ccrelay-setup-1.webp)

习惯编辑配置文件？见[手动配置](#手动配置)。

---

## 核心特性

**在现有客户端里用任意模型**

- 一个本地地址同时服务 Claude Code、Claude Desktop、Codex CLI 和 ChatGPT 桌面应用。
- 请求在 Anthropic Messages、OpenAI Chat Completions 与 OpenAI Responses 之间自动转换。
- 模型名支持通配符映射，并为 Claude Desktop 生成它能接受的 Claude 风格别名。
- 智能路由把所有提供商的模型汇总到一个列表，按模型把每个请求路由到对应提供商。

**不用手改配置文件**

- 提供商向导内置常用厂商预设和接口测试。
- 客户端配置一键写入各客户端的设置，「还原」可撤销。
- 配置修改无需重启即可生效；仍可手动编辑 `~/.ccrelay/config.yaml`。
- 提供商可导出、导入为 JSON。

**看清每一次请求**

- 日志页显示每个请求的请求头和正文，可多选导出为 zip。
- 仪表盘显示 Token 用量、缓存命中率、首字延迟、输出速度和按提供商的图表。
- Chat 页可直接测试任意提供商，无需打开其他客户端。
- 可选本地联网搜索（Tavily 或 Parallel），为没有自带搜索的提供商补上。

**在你工作的地方运行**

- 桌面应用支持 macOS（Apple 芯片、Intel）和 Windows（x64、arm64），并自动更新。
- VS Code 扩展与桌面应用共用同一份配置和同一个代理。

---

## 常见问题

**如何在 Claude Desktop 中使用 GLM、Kimi 或 DeepSeek？**
在 CCRelay 中添加该提供商，然后点击 **客户端配置 → Claude Desktop → 应用**，并重启 Claude Desktop。CCRelay 会把 Claude Desktop 切换为第三方推理，并为每个模型生成 Claude 风格的别名，因为 Claude Desktop 会拒绝包含 `glm`、`kimi`、`deepseek` 等关键词的模型名。

**如何让 ChatGPT 桌面应用（ChatGPT Work 或 Codex）使用第三方模型？**
点击 **客户端配置 → Codex → 应用**。CCRelay 会写入 `~/.codex/config.toml` 和模型目录，Codex CLI 与 ChatGPT 桌面应用都读取这两个文件。重启 ChatGPT 应用后，在 ChatGPT Work 或 Codex 中从列表选择模型。

**有没有桌面工具，不用手动编辑 `settings.json` 或 `config.toml`？**
有。点击 **应用** 时，CCRelay 桌面应用会为 Claude Code、Claude Desktop 和 Codex 写好设置，**还原** 可撤销。

**我的提供商只有 OpenAI 兼容接口，Claude Code 能用吗？**
能。CCRelay 会把 Claude Code 的 Anthropic 请求转换为 OpenAI Chat Completions 或 Responses，再把回复转换回来，工具调用也包括在内。

**切换提供商后需要重启客户端吗？**
Claude Code 在下一次请求时就会使用新的提供商。Codex CLI 和 ChatGPT 桌面应用需要重启才能重新加载模型列表。Claude Desktop 可能需要重启才能刷新模型列表。

**对话内容会被保存吗？**
会，只保存在你的电脑上，并且可以关闭。见[隐私与本机数据](#隐私与本机数据)。

**CCRelay 免费吗？**
免费。CCRelay 基于 MIT 许可证开源。

---

## 隐私与本机数据

| 项目         | CCRelay 的做法                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------------- |
| 运行位置     | 在你的电脑上运行，代理默认只监听 `127.0.0.1`。                                                     |
| 对外连接     | 请求只发往你配置的提供商。仅在开启联网搜索时才会访问 Tavily 或 Parallel。检查更新时访问 GitHub Releases。 |
| 遥测         | 无。                                                                                               |
| 请求日志     | 默认把请求与响应正文保存在 `~/.ccrelay/logs.db`，便于在日志页查看。                                |
| 关闭日志     | 设置 `logging.storeBodies: false`，或在设置页关闭。Token 与速度统计单独保存，不受影响。            |
| 删除数据     | 日志页的 **清空全部** 删除已保存的正文；仪表盘的 **复位统计** 删除用量数据。                       |
| API Key      | 保存在 `~/.ccrelay/config.yaml`。可用 `${ENV_VAR}` 引用环境变量，避免明文写入文件。日志中的请求头会隐藏 Key。 |

---

## 支持的提供商

提供商向导内置 Z.ai GLM、小米 MiMo、DeepSeek、MiniMax、Google Gemini、Azure OpenAI、美团 LongCat、Astraflow（UCloud）预设。其他任意 OpenAI / Anthropic 兼容接口（如 Kimi、Qwen、OpenRouter 或自建网关）填写自定义 Base URL 即可使用。

### 已验证上游（按主机）

中继按 **provider 的 `baseUrl` 主机名** 选规则。下表中的行是我们在配置为 provider 时**已验证过**的上游端点。各厂商可能同时提供 Anthropic 协议、OpenAI 兼容接口等，但**客户端协议**与**上游协议**常常不一致；不一致时需要**协议转换**，一致时也可能在**工具能力**上不同（例如服务端联网搜索工具、仅 Chat 接受的字段、或仅 Responses 支持的托管工具）。

**未出现在表中的主机**只走**通用协议转换**（无额外平台层）。**表中列出的主机**在通用转换之上，还会按主机名叠加**平台对齐**（工具、消息、响应形态及 URL/请求体等）。最后一列表示该厂商**服务端联网搜索工具**在上游侧的接入位置；与如何访问本地中继无关。

**示例——Azure OpenAI：** 上游侧 **服务端联网搜索工具** 仅存在于 **Responses API**（因此表中「服务端联网搜索工具」列为「仅 Responses API」）。你仍可以让客户端用 **OpenAI Chat Completions** 对接 CCRelay。将 **Azure OpenAI** 配成 provider 的 `baseUrl` 后，含服务端联网搜索工具的 **Chat 形态**请求会在**转换层**被改写为对上游的 **Responses** 调用，从而继续支持搜索——不必要求客户端直接调用 `/v1/responses`。

| 提供商（目标主机）                                                    | Anthropic `/v1/messages` | OpenAI `/chat/completions` | OpenAI `/v1/responses` | 服务端联网搜索工具 |
| --------------------------------------------------------------------- | ------------------------ | -------------------------- | ---------------------- | ------------------ |
| **Z.ai GLM**（`api.z.ai`、`open.bigmodel.cn`）                        | 支持                     | 支持                       | 不支持                 | 仅 Anthropic 端点  |
| **小米 MiMo**（`api.xiaomimimo.com`）                                 | 支持                     | 支持                       | 不支持                 | 仅 Chat            |
| **MiniMax**（`api.minimax.io`、`api.minimaxi.com`）                   | 支持                     | 支持                       | 不支持                 | 不支持             |
| **Google Gemini**（`generativelanguage.googleapis.com`，OpenAI 兼容） | 不支持                   | 支持                       | 不支持                 | 不支持             |
| **Azure OpenAI**（`*.cognitiveservices.azure.com`）                   | 不支持                   | 支持                       | 支持                   | 仅 Responses API   |
| _其他主机_                                                            | _视情况_                 | _视情况_                   | _视情况_               | 仅通用转换         |

**截图示例（Claude Code 经 CCRelay）**

![Claude Code — 使用 GLM 服务端联网搜索工具](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-claude-glm-web-search.webp)

![Claude Code — 使用小米 MiMo 服务端联网搜索工具](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-claude-xiaomi-mimo-web-search.webp)

---

## 安装

### 桌面应用（推荐）

- 从 [GitHub Releases](https://github.com/inflaborg/ccrelay/releases/latest) 下载：
  - **macOS**：`CCRelay-<版本>-darwin-arm64.dmg`（Apple 芯片）或 `-darwin-x64.dmg`（Intel）
  - **Windows**：`CCRelay-<版本>-win32-x64.exe` 或 `-win32-arm64.exe`
- 应用常驻托盘（macOS 为菜单栏）。托盘 → **打开控制台** 打开管理界面；**打开日志目录** 打开 `~/.ccrelay/logs/` 下的运行诊断日志。
- 启动约 15 秒后检查一次更新，之后每 24 小时检查一次。托盘 → **Check for Updates…** 可立即检查；确认后下载并重启应用完成更新。
- 托盘 → **Update Channel** 可在 **Stable** 与 **Dev** 版本之间切换。
- 桌面应用与 VS Code 扩展共用 `~/.ccrelay/` 配置和正在运行的代理。

### VS Code 扩展

- 在 [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=infLab.ccrelay-vscode) 或 [Open VSX](https://open-vsx.org/extension/infLab/ccrelay-vscode) 安装 **CCRelay**，或从 [Releases](https://github.com/inflaborg/ccrelay/releases) 下载 `.vsix` 后运行 `Extensions: Install from VSIX...`。
- 需要 VS Code 1.80.0 或更高版本。
- 通过 CCRelay 状态栏项或 `CCRelay: Switch Provider` 切换提供商；用 `CCRelay: Open Dashboard` 打开控制台。

### 从源码构建

```bash
git clone https://github.com/inflaborg/ccrelay.git
cd ccrelay
npm install
npm run build
npm run package        # 产出 dists/ccrelay-vscode-*.vsix
```

桌面版构建见[开发](#开发)。

### Tauri 构建（实验性）

更轻量的 Tauri 桌面版本（`packages/desktop-tauri`）使用同一核心，并自带 Node.js 运行时。当前 Release 不包含 Tauri 安装包，请使用 Node.js 22 从源码构建：

```bash
npm install
npm run tauri:dev         # 构建 Web UI 与 Node sidecar 后进入 Tauri 开发模式
npm run tauri:pack:mac    # 构建 macOS 安装包
npm run tauri:pack:win    # 构建 Windows 安装包
```

---

## 手动配置

控制台中的所有设置都保存在 `~/.ccrelay/config.yaml`。如果你习惯编辑文件，可按以下步骤操作。

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

- 桌面应用或控制台：在 **提供商** 页选中提供商卡片，点击 **应用**
- VS Code：点击 CCRelay 状态栏项，或运行 `CCRelay: Switch Provider`
- 配置文件：修改 `config.yaml` 中的 `defaultProvider`（自动生效）

---

## 客户端对接

CCRelay 在同一端口（默认 **7575**）上提供 **Anthropic** 和 **OpenAI** 兼容路由。通过 URL 前缀选择协议：

| 客户端                                   | 协议      | Base URL                          |
| ---------------------------------------- | --------- | --------------------------------- |
| **Claude Code**                          | Anthropic | `http://127.0.0.1:7575/anthropic` |
| **Claude Desktop**（第三方推理 / Cowork）| Anthropic | `http://127.0.0.1:7575/anthropic` |
| **Codex CLI / ChatGPT 桌面应用**         | OpenAI    | `http://127.0.0.1:7575/openai`    |

直接使用 `http://127.0.0.1:7575` 时，legacy `/v1/...` 路径仍然有效。

### Claude Code

使用 **客户端配置 → Claude Code → 应用**，或参考[手动配置](#手动配置)中的 `~/.claude/settings.json` 配置项。

快速测试（仅当前终端）：

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:7575/anthropic
claude
```

### Claude Desktop（第三方推理与 Cowork）

**客户端配置 → Claude Desktop → 应用**（macOS 与 Windows）会把 Claude Desktop 切换为经 CCRelay 的第三方推理：网关地址 `http://127.0.0.1:7575/anthropic`、占位 API Key，以及 `x-ccrelay-model-alias` 请求头。完成后请重启 Claude Desktop。**还原** 会把 Claude Desktop 切回官方模式。

如需手动设置，在 Claude Desktop 中打开 **Configure third-party inference**，填入上述网关地址和任意 API Key，并添加 `x-ccrelay-model-alias` 请求头。第三方模型名需要 Claude 风格的别名，见 [Claude Desktop / Cowork 模型 ID 限制](#claude-desktop--cowork-模型-id-限制)。

### Codex CLI 与 ChatGPT 桌面应用

Codex CLI 与 ChatGPT 桌面应用（ChatGPT Work 与 Codex）读取同一份 `~/.codex/config.toml`。使用 **客户端配置 → Codex → 应用**，或自行创建该文件：

```toml
model = "gpt-5.4-mini"
model_provider = "ccrelay"
model_catalog_json = "ccrelay-model-catalog.json"

[model_providers.ccrelay]
name = "CCRelay"
base_url = "http://localhost:7575/openai"
```

应用配置时会生成 `~/.codex/ccrelay-model-catalog.json`，供 Codex `/model` 列出可选模型。目录来自**当前激活供应商**的自定义模型列表（或精确的 `modelMap` 条目）；开启智能路由时，列出所有提供商中已路由的模型。每个条目会声明推理档位 low、medium、high、xhigh，默认 high。将 `model` 设为其中某个 id。Apply 或切换供应商后请重启 Codex CLI 或 ChatGPT 桌面应用以重新加载目录。可在 `config.toml` 用 `model_reasoning_effort` 或在 `/model` 里覆盖档位。

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

| 模式          | 认证行为                  | 适用场景                           |
| ------------- | ------------------------- | ---------------------------------- |
| `passthrough` | 保留原始认证头            | 官方 Claude API（OAuth）           |
| `inject`      | 用提供商 API Key 替换认证 | 第三方提供商（GLM、OpenRouter 等） |

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

### Claude Desktop / Cowork 模型 ID 限制

Claude Desktop 1.7196.0 版本起，客户端会屏蔽包含第三方关键词（如 `qwen`、`glm`、`kimi`、`deepseek` 等）的模型 ID。若使用第三方上游模型，仅在 Cowork 场景下需将其映射为 `claude-` 前缀的别名。

别名必须是 `claude-` 加上一段**不含额外连字符**的字符串（如 `claude-a1b2c3d4`，而非 `claude-my-model`），因为多连字符名称会被解析为 Anthropic 模型版本号。

规范 alias id（向导、Cowork 快捷填写、Smart Routing）为 `claude-{8 位 hex}`：对 `providerId:protocol:upstreamModelId` 做 SHA1 后取前 8 位 hex，前缀为 `smartRouting.aliasPrefix`（默认 `claude-`）。同一上游模型在不同 provider 或 protocol 下 alias 不同。

**自定义模型列表**（`customModelsList`）：每行为 `真实模型id;展示名;别名`（展示名与真实 id 相同时可写 `真实id;;别名`）。真实 id 为上游实际模型名；`别名` 为 Cowork 可用的对外 id。

**Cowork**：在 Claude Desktop 中为请求添加自定义头 `x-ccrelay-model-alias`，值任意即可（例如 `1`）。带上该头时，`GET /models` 与 `GET /models/{id}` 的 wire `id` 为**别名**；不带该头时，同一列表返回**真实**模型 id（供其他客户端使用）。

**模型映射**（`modelMap`）：自动生成的映射包含 alias 规则、identity 规则（`真实id` → `真实id`）、Claude 系列通配（`claude-haiku-*` / `claude-sonnet-*` / `claude-opus-*`）以及默认的 `claude-*` / `gpt-*` 通配兜底。identity 规则确保客户端直接发送真实模型 id 时不会被通配规则误路由。

**示例** -- 两个 GLM 模型；Cowork 通过上述请求头启用别名：

```yaml
glm:
  name: "GLM"
  baseUrl: "https://api.z.ai/api/paas/v4"
  providerType: "openai_chat"
  mode: "inject"
  apiKey: "${GLM_API_KEY}"
  useCustomModelsList: true
  customModelsList:
    - "glm-5.1;GLM 5.1;claude-363a702b"
    - "glm-4.7;GLM 4.7;claude-02a1bc84"
  modelMap:
    - { pattern: "claude-363a702b", model: "glm-5.1" }
    - { pattern: "glm-5.1", model: "glm-5.1" }
    - { pattern: "claude-02a1bc84", model: "glm-4.7" }
    - { pattern: "glm-4.7", model: "glm-4.7" }
    - { pattern: "claude-haiku-*", model: "glm-5.1" }
    - { pattern: "claude-sonnet-*", model: "glm-5.1" }
    - { pattern: "claude-opus-*", model: "glm-5.1" }
    - { pattern: "claude-*", model: "glm-5.1" }
    - { pattern: "gpt-*", model: "glm-5.1" }
```

配置效果：

- **未带** `x-ccrelay-model-alias`：`GET /models` 返回 `glm-5.1`、`glm-4.7`（展示名与 id 不同时附带展示名）。
- **带上** `x-ccrelay-model-alias`：`GET /models` 的 id 为规范 alias；Cowork 选择后由 CCRelay 经 `modelMap` 映射到真实上游 ID。
- `claude-haiku-*` / `claude-sonnet-*` / `claude-opus-*` 系列通配默认路由到第一个自定义模型（快捷填写中可为每个系列另选目标）。
- `claude-*` 与 `gpt-*` 通配规则兜底，将客户端可能发送的其他模型名路由到第一个模型。

内置向导与 Cowork 快捷填写会按上述规范 hash 生成 `真实id;展示名;claude-{hash}` 行及对应 `modelMap`。Cowork 请在 Claude Desktop 中配置该请求头；其他环境可不配置。手动编辑 `customModelsList` 后，可在 Provider 编辑器中使用 **重建 modelMap** 从列表全量重建映射表（Claude 系列通配目标在对应模型仍存在时会保留；其他自定义通配规则如 `gpt-*-mini` 需在重建后再次手动添加）。

#### 自定义模型列表配置界面

![自定义模型列表](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/provider-custom-model-1.webp)

使用**自定义模型快捷填写**，以结构化表单输入上游模型 ID 与展示名，并可选择将 `claude-haiku-*` / `claude-sonnet-*` / `claude-opus-*` 映射到列表中的某个模型（默认第一个）。自动生成自定义模型列表和模型映射。

![自定义模型快捷填写](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/provider-custom-model-2.webp)

#### 在 Claude Cowork 中启用别名

在 Claude Desktop 的 **Configure third-party inference** 面板中，将 `x-ccrelay-model-alias` 添加到 **Gateway extra headers**，使模型列表返回别名而非真实 ID。

![Cowork gateway extra headers](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/cowork-ccrelay-model-alias.webp)

### OpenAI 格式转换

CCRelay 接受三种入站协议，当上游提供商使用不同协议时自动转换：

| 入站路径                                           | 客户端协议              |
| -------------------------------------------------- | ----------------------- |
| `/v1/messages`、`/anthropic/v1/messages`           | Anthropic Messages      |
| `/v1/chat/completions`、`/openai/chat/completions` | OpenAI Chat Completions |
| `/v1/responses`                                    | OpenAI Responses API    |
| `/v1/models`、`/openai/models`                     | OpenAI 模型列表         |
| `/anthropic/v1/models`                             | Anthropic 模型列表      |

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

- **Dashboard** — 服务器状态、当前提供商、Token 用量、性能指标（TTFB、P50/P90 延迟、输出 TPS），支持时间范围筛选
- **Smart Routing（智能路由）** — 聚合所有提供商模型列表；统一 `/v1/models` 返回 `<providerId>:<modelId>`；按 model 自动路由到对应提供商（切换模型无需切换 provider / 重启客户端）
- **Providers** — 配置上游连接；点击卡片选中后点应用切换；用 **选择** 导出或删除
- **Capabilities** — 可选联网搜索后端（**Tavily** 与/或 **Parallel**）：API Key、默认后端，以及启用本地代答的提供商列表
- **Logs** — 请求/响应日志查看器，支持 Token 列、TTFB、输出 TPS 和模型映射；可多选行并导出压缩包（每个 ID 一个目录，含 JSON、请求/响应头和分析 Markdown）。未启用日志时自动隐藏。
- **Settings** — 在 UI 中管理 YAML 配置；路由和并发保存后即时生效，服务器和日志需重启
- **Client configuration** — 从 UI 写入 Claude Code 环境变量和 Codex 配置；同时显示 Claude Desktop 已安装的 claude-code bundle 版本与 Claude Code CLI 版本（后台执行 `claude --version`，可在页面上关闭）

> **注意**：直接在浏览器中打开 `http://127.0.0.1:7575/ccrelay/` 无法访问面板。面板仅允许来自 VS Code 扩展或桌面应用内部的请求（通过内部请求头验证）。请通过扩展命令或桌面托盘菜单打开面板。

**Web UI**

![Client configuration](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-ccrelay-setup-1.webp)

![Configure default models](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-ccrelay-setup-2.webp)

![Capabilities — Tavily 联网搜索配置](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-capabilities-websearch-tavily.webp)

![请求日志](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-ccrelay-1.webp)

![日志详情](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-ccrelay-3.webp)

**桌面应用**

![桌面 — 控制台](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-desktop-1.webp)

![桌面 — Provider 列表](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-desktop-2.webp)

---

## 配置

CCRelay 使用 `~/.ccrelay/config.yaml`（首次启动时自动创建）。启动时内置默认模板与你的文件合并——**你已写的值始终以你为准**，缺省的键用默认值补齐。列表类型（`routing.forward`、`routing.block`、`concurrency.routes`）按身份键合并，你的条目在前，新增的默认条目追加在末尾。整节不写则继承完整默认列表；显式设 `[]` 表示刻意为空。

> YAML 配置同时支持 `camelCase` 和 `snake_case` 键名。

### 服务器

| 设置               | 默认值      | 描述                                                          |
| ------------------ | ----------- | ------------------------------------------------------------- |
| `server.port`      | `7575`      | 代理服务器端口                                                |
| `server.host`      | `127.0.0.1` | 绑定地址                                                      |
| `server.autoStart` | `true`      | 扩展加载时自动启动服务器                                      |
| `server.locale`    | `""`        | Web UI 语言（`"en"`、`"zh"`、`"ja"` 或 `"ko"`）。未设置时首次访问弹出选择器。 |

### 提供商

| 设置              | 默认值     | 描述                 |
| ----------------- | ---------- | -------------------- |
| `defaultProvider` | `official` | 默认提供商 ID        |
| `providers`       | `{...}`    | 提供商配置（见下方） |

每个提供商支持：

| 字段           | 默认值            | 描述                                                                           |
| -------------- | ----------------- | ------------------------------------------------------------------------------ |
| `name`         | —                 | 显示名称                                                                       |
| `baseUrl`      | —                 | API 基础 URL                                                                   |
| `mode`         | `"passthrough"`   | `passthrough`（保留认证）或 `inject`（替换认证）                               |
| `providerType` | `"anthropic"`     | `"anthropic"`、`"openai"`（完全透传）或 `"openai_chat"`（仅 Chat Completions） |
| `openaiCompat` | —                 | 可选。自定义域名上的 Azure Chat 整形设为 `azure_openai`（官方 `*.cognitiveservices.azure.com` 会自动识别） |
| `apiKey`       | —                 | inject 模式的 API Key。支持 `${ENV_VAR}`。                                     |
| `authHeader`   | `"authorization"` | 认证头名称                                                                     |
| `modelMap`     | —                 | 模型名映射（`[{pattern, model}]`，支持通配符）                                 |
| `vlModelMap`   | —                 | 视觉模型映射（用于多模态请求）                                                 |
| `headers`      | —                 | 自定义请求头                                                                   |
| `enabled`      | `true`            | 是否启用                                                                       |

### 智能路由

在 **供应商** 页面顶部的智能路由卡片中启用。它会聚合所有已启用 provider 的模型列表，并按 model id 将请求路由到对应 provider。智能路由与单个兜底 provider **互斥**：启用智能路由后，供应商卡片不再显示为使用中；选中供应商卡片并点应用会使用该供应商并关闭智能路由。

**智能路由** Tab 用于设置（别名前缀、裸 model id 兜底、排除列表、自定义路由规则、聚合模型表）。

| 设置                                  | 默认值          | 描述                                                                                 |
| ------------------------------------- | --------------- | ------------------------------------------------------------------------------------ |
| `smartRouting.enabled`                | `false`         | 在供应商页面启用。聚合各 provider 模型，按 `<providerId>:<modelId>` 路由             |
| `smartRouting.aliasPrefix`            | `"claude-"`     | canonical alias id 前缀（客户端带 `x-ccrelay-model-alias` 时返回 `claude-{8 hex}`）     |
| `smartRouting.exclude`                | —               | 从 `/v1/models` 隐藏、且不参与路由的 public id 通配符列表。命中被排除的 id 时请求会被拒绝 |
| `smartRouting.include`                | —               | 白名单（与 exclude 互斥）                                                            |
| `smartRouting.modelsCache.ttlSeconds` | `600`           | 非自定义 models list 的上游缓存 TTL（秒）                                            |
| `smartRouting.bareModelFallback.mode` | `first-match`   | 裸 model id（无前缀）时按 provider 排序首个匹配，或 reject                           |
| `smartRouting.modelRules`             | —               | 自定义规则（`pattern`、`provider`、`model`），优先于目录匹配；不出现在 `/v1/models`  |

### 路由

| 设置              | 默认值                                 | 描述                                                                                                   |
| ----------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `configVersion`   | `"0.2.5"`                              | 配置架构版本。低于该版本的配置在启动时自动升级。                                                         |
| `routing.forward` | `[{path, provider}]`                   | 转发规则——首条匹配生效。`provider: "auto"` = 当前提供商。未匹配 → 404。                                |
| `routing.block`   | `[{path, response, code, condition?}]` | 拦截规则——返回自定义响应。可选 `condition.providers`（白名单）和 `condition.providerNot`（排除列表）。 |

### 并发控制

| 设置                         | 默认值 | 描述                             |
| ---------------------------- | ------ | -------------------------------- |
| `concurrency.enabled`        | `true` | 启用请求队列                     |
| `concurrency.maxWorkers`     | `3`    | 最大并发数                       |
| `concurrency.maxQueueSize`   | `100`  | 最大队列大小（0 = 无限制）       |
| `concurrency.requestTimeout` | `0`    | 队列超时秒数（0 = 无限制）       |
| `concurrency.routes`         | `[]`   | 按路由的队列配置（按 `pattern`） |

### 日志

| 设置                     | 默认值     | 描述                                                                 |
| ------------------------ | ---------- | -------------------------------------------------------------------- |
| `logging.storeBodies`    | `true`     | 在 Logs 页保存请求/响应正文。Token 与性能指标另行记录，不受此开关影响 |
| `logging.database.type`  | `"sqlite"` | `"sqlite"` 或 `"postgres"`                                           |

`logging.enabled` 已弃用。未设置 `storeBodies` 时回退到 `enabled`。

**SQLite：**

| 设置                                  | 默认值 | 描述                                        |
| ------------------------------------- | ------ | ------------------------------------------- |
| `logging.database.path`               | `""`   | 数据库文件路径（空 = `~/.ccrelay/logs.db`） |
| `logging.database.sqlite3_executable` | `""`   | `sqlite3` 二进制路径（空 = 从 `PATH` 解析） |

若无法解析 `sqlite3`，代理仍可运行但不持久化日志（日志中会给出警告）。

**PostgreSQL：**

| 设置                        | 默认值      | 描述                      |
| --------------------------- | ----------- | ------------------------- |
| `logging.database.host`     | `localhost` | 服务器主机                |
| `logging.database.port`     | `5432`      | 服务器端口                |
| `logging.database.name`     | `ccrelay`   | 数据库名                  |
| `logging.database.user`     | `""`        | 用户名                    |
| `logging.database.password` | `""`        | 密码（支持 `${ENV_VAR}`） |
| `logging.database.ssl`      | `false`     | 启用 SSL                  |

### 外部联网搜索

可选为指定提供商**在本地处理** Anthropic 形态的 **web search**（服务端工具）请求。CCRelay 可通过 **[Tavily](https://tavily.com/)** 或 **[Parallel](https://parallel.ai/)** 搜索 API 执行检索，并为该轮对话合成助手回复，上游对话模型自身无需实现该工具。

| 设置                             | 说明                                                         |
| -------------------------------- | ------------------------------------------------------------ |
| `webSearch.enabled`              | 总开关（`true` / `false`）。省略时，非空 `providers` 视为启用。 |
| `webSearch.providers`            | 分配网络搜索的 **提供商 ID**（关闭时仍保留预设列表）。       |
| `webSearch.defaultSearchBackend` | 可选：`tavily` 或 `parallel`（未按请求推断时使用的默认后端）。 |

#### Tavily

| 设置                           | 说明                                                       |
| ------------------------------ | ---------------------------------------------------------- |
| `webSearch.tavily.apiKey`      | Tavily API Key。支持 `${ENV_VAR}`。                        |
| `webSearch.tavily.searchDepth` | `basic` 或 `advanced`（可选）。                            |
| `webSearch.tavily.maxResults`  | 返回条数，1–10（可选）。                                   |

#### Parallel

| 设置                              | 说明                                                         |
| --------------------------------- | ------------------------------------------------------------ |
| `webSearch.parallel.apiKey`       | Parallel API Key。支持 `${ENV_VAR}`。                        |
| `webSearch.parallel.mode`         | `turbo`、`basic` 或 `advanced`（可选；默认 `basic`）。     |
| `webSearch.parallel.maxResults`   | 返回条数，1–10（可选）。                                     |
| `webSearch.parallel.publishedAfter` | 可选，RFC 3339 日期（`YYYY-MM-DD`）用于过滤发布时间。      |
| `webSearch.parallel.location`     | 地区：任意 ISO 3166-1 alpha-2 代码（如 `us`、`cn`、`gb`）；省略为自动。Parallel 不支持的代码可能被忽略。 |
| `webSearch.parallel.includeDomains` | 可选，仅包含这些域名（YAML 数组）。                        |
| `webSearch.parallel.excludeDomains` | 可选，排除这些域名（YAML 数组）。                          |
| `webSearch.parallel.liveFetch`    | 可选，缓存过期时实时抓取（延迟更高）。                       |
| `webSearch.parallel.maxCharsPerResult` | 可选，单条结果摘要字符上限。                            |

顶层键也可写为 `web_search`（嵌套字段形状相同）。

```yaml
webSearch:
  tavily:
    apiKey: "${TAVILY_API_KEY}"
    searchDepth: basic
    maxResults: 5
  defaultSearchBackend: tavily
  enabled: true
  providers:
    - my-provider
```

设置 `enabled: false` 可关闭网络搜索，且不会清空 `providers` 预设列表。

控制台 **Capabilities** 标签页可编辑上述字段，无需手改文件。

### 完整配置示例

```yaml
configVersion: "0.2.5"

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
  requestTimeout: 0

logging:
  storeBodies: true
  database:
    type: "sqlite"
    path: ""
```

---

## API 端点

管理端点在 `/ccrelay/` 下：

| 端点                            | 方法       | 描述                     |
| ------------------------------- | ---------- | ------------------------ |
| `/ccrelay/api/status`           | GET        | 代理状态                 |
| `/ccrelay/api/providers`        | GET        | 列出提供商               |
| `/ccrelay/api/switch/{id}`      | GET        | 切换到指定提供商         |
| `/ccrelay/api/switch`           | POST       | 切换提供商（JSON body）  |
| `/ccrelay/api/providers/export` | POST       | 按 ID 导出提供商         |
| `/ccrelay/api/providers/import` | POST       | 导入提供商（按 ID 合并） |
| `/ccrelay/api/queue`            | GET        | 队列统计                 |
| `/ccrelay/api/logs`             | GET        | 请求日志                 |
| `/ccrelay/api/config`           | GET、PATCH | 读写配置节               |
| `/ccrelay/ws`                   | WebSocket  | Follower 同步            |
| `/ccrelay/`                     | GET        | Web UI 管理界面          |

所有其他请求将被代理到当前提供商。

---

## 命令

| 命令                     | ID                       | 描述             |
| ------------------------ | ------------------------ | ---------------- |
| CCRelay: Show Menu       | `ccrelay.showMenu`       | 显示主菜单       |
| CCRelay: Switch Provider | `ccrelay.switchProvider` | 打开提供商选择器 |
| CCRelay: Start Server    | `ccrelay.startServer`    | 启动服务器       |
| CCRelay: Stop Server     | `ccrelay.stopServer`     | 停止服务器       |
| CCRelay: Open Settings   | `ccrelay.openSettings`   | 打开扩展设置     |
| CCRelay: Show Logs       | `ccrelay.showLogs`       | 查看输出日志     |
| CCRelay: Clear Logs      | `ccrelay.clearLogs`      | 清除输出日志     |
| CCRelay: Open Dashboard  | `ccrelay.openWebUI`      | 打开管理面板     |

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

# Electron 桌面应用
npm run desktop:start
npm run desktop:pack:mac
npm run desktop:pack:win

# Tauri 桌面应用
npm run tauri:dev
npm run tauri:pack:mac
npm run tauri:pack:win
```

### 项目结构

```
ccrelay/
├── packages/
│   ├── core/              # 共享运行时（代理、配置、转换器）
│   ├── vscode/            # VS Code 扩展
│   ├── desktop/           # Electron 桌面应用
│   └── desktop-tauri/     # Tauri 桌面应用
├── web/                   # Web UI（React + Vite）
├── tests/                 # Vitest 单元测试与集成测试
├── scripts/               # 构建和打包辅助脚本
└── dists/                 # 打包的 .vsix
```

---

## 文件位置

| 文件       | 位置                                                    | 说明                       |
| ---------- | ------------------------------------------------------- | -------------------------- |
| 配置       | `~/.ccrelay/config.yaml`                                | 主配置文件（自动创建）     |
| 状态       | `~/.ccrelay/state.json`                                 | 当前激活的提供商 ID        |
| IPC 锁     | `~/.ccrelay/ccrelay-lock.sock`（Unix）/ 命名管道（Win） | Leader 选举                |
| 日志数据库 | `~/.ccrelay/logs.db`                                    | 请求日志（仅 Leader 写入） |

---

## 贡献

欢迎提交 Issue 和 Pull Request！

---

## 致谢

CCRelay 借助 AI 编程助手（[Cursor](https://cursor.com) 与 [Claude Code](https://claude.ai/code)）开发，
模型后端使用 [GLM](https://z.ai/model-api) 与 [小米 MiMo](https://platform.xiaomimimo.com/token-plan)。
每个版本都由维护者设计、审查并测试。

---

## 许可证

[MIT License](LICENSE)

Copyright (c) 2026 [infLab](https://github.com/inflaborg)
