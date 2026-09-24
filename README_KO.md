# CCRelay

[![Latest release](https://img.shields.io/github/v/release/inflaborg/ccrelay)](https://github.com/inflaborg/ccrelay/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/inflaborg/ccrelay/total)](https://github.com/inflaborg/ccrelay/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Claude Code, Claude Desktop, ChatGPT 데스크톱 앱(ChatGPT Work와 Codex)에서 서드파티 모델을 사용합니다.**

**CCRelay**는 macOS와 Windows용 무료 오픈 소스 데스크톱 앱입니다. **Claude Code**, **Claude Desktop**(서드파티 추론과 Cowork), **ChatGPT 데스크톱 앱**(ChatGPT Work와 Codex), **Codex CLI**가 GLM, Kimi, DeepSeek, Gemini, Qwen, MiniMax, Xiaomi MiMo 같은 서드파티 모델이나 OpenAI 또는 Anthropic 호환 API를 쓰게 합니다. 이미 쓰는 클라이언트는 그대로 두고, 한곳에서 모델을 바꿉니다. 로컬 프록시가 Anthropic 형식과 OpenAI 형식을 자동으로 변환합니다. VS Code 확장도 있습니다.

**다운로드**: [최신 릴리스](https://github.com/inflaborg/ccrelay/releases/latest) — macOS `.dmg`(Apple Silicon, Intel) · Windows `.exe`(x64, arm64) · VS Code 확장은 [Marketplace](https://marketplace.visualstudio.com/items?itemName=infLab.ccrelay-vscode)와 [Open VSX](https://open-vsx.org/extension/infLab/ccrelay-vscode)

**웹사이트**: [https://ccrelay.inflab.org](https://ccrelay.inflab.org) · **[English](./README.md)** · **[中文](./README_CN.md)** · **[日本語](./README_JA.md)** · **한국어**

![CCRelay 데스크톱 앱 — 제공자 목록](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-desktop-2.webp)

---

## 목차

- [지원 클라이언트](#지원-클라이언트)
- [3단계로 시작하기](#3단계로-시작하기)
- [핵심 기능](#핵심-기능)
- [자주 묻는 질문](#자주-묻는-질문)
- [개인정보와 로컬 데이터](#개인정보와-로컬-데이터)
- [지원 제공자](#지원-제공자)
- [설치](#설치)
- [수동 구성](#수동-구성)
- [클라이언트 연동](#클라이언트-연동)
- [사용 안내](#사용-안내)
  - [다중 인스턴스 모드](#다중-인스턴스-모드)
  - [제공자 모드](#제공자-모드)
  - [모델 매핑](#모델-매핑)
  - [Claude Desktop / Cowork 모델 ID 제한](#claude-desktop--cowork-모델-id-제한)
  - [OpenAI 형식 변환](#openai-형식-변환)
  - [Web UI 대시보드](#web-ui-대시보드)
- [외부 웹 검색](#외부-웹-검색)
- [구성](#구성)
- [API 엔드포인트](#api-엔드포인트)
- [명령](#명령)
- [개발](#개발)
- [파일 위치](#파일-위치)
- [라이선스](#라이선스)

---

## 지원 클라이언트

| 클라이언트                                         | 연결 방법                                                                                    |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Claude Code**(CLI와 IDE 확장)                    | 클라이언트 구성 → Claude Code → 적용                                                         |
| **Claude Desktop**(서드파티 추론, Cowork)          | 클라이언트 구성 → Claude Desktop → 적용한 뒤 Claude Desktop을 다시 시작합니다                |
| **Codex CLI**                                      | 클라이언트 구성 → Codex → 적용한 뒤 Codex를 다시 시작합니다                                  |
| **ChatGPT 데스크톱 앱**(ChatGPT Work, Codex)       | Codex CLI와 같은 `~/.codex/config.toml`: 적용한 뒤 ChatGPT 데스크톱 앱을 다시 시작합니다     |
| Anthropic 또는 OpenAI 사용자 지정 URL을 받는 도구  | `http://127.0.0.1:7575/anthropic` 또는 `http://127.0.0.1:7575/openai`                        |

클라이언트별 자세한 내용: [클라이언트 연동](#클라이언트-연동).

---

## 3단계로 시작하기

1. **데스크톱 앱을 설치합니다.** [Releases](https://github.com/inflaborg/ccrelay/releases/latest)에서 받아 엽니다. 로컬 프록시는 `http://127.0.0.1:7575`에서 시작됩니다.
2. **제공자를 추가합니다.** **제공자 → 제공자 추가**를 열고, 프리셋(GLM, Xiaomi MiMo, DeepSeek, MiniMax, Gemini, Azure OpenAI, Meituan LongCat, Astraflow)을 고르거나 아무 베이스 URL이나 입력한 다음 API 키를 붙여 넣고, 기본 제공 테스트를 실행한 뒤 만듭니다.
3. **클라이언트를 연결합니다.** **클라이언트 구성**을 열고 Claude Code, Claude Desktop 또는 Codex를 선택한 다음 **적용**을 클릭합니다. 위 표에 다시 시작하라고 되어 있으면 클라이언트를 다시 시작합니다.

나중에 모델을 바꾸려면 다른 제공자 카드를 선택하고 **적용**을 클릭하거나, **스마트 라우팅**을 켜서 모든 제공자의 모델을 한 목록으로 보고 클라이언트 안에서 고릅니다. 클라이언트 구성 페이지의 **복원**은 클라이언트 변경을 되돌립니다.

![클라이언트 구성](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-ccrelay-setup-1.webp)

파일을 직접 편집하려면 [수동 구성](#수동-구성)을 보십시오.

---

## 핵심 기능

**이미 쓰는 클라이언트에서 아무 모델이나 사용**

- 로컬 주소 하나가 Claude Code, Claude Desktop, Codex CLI, ChatGPT 데스크톱 앱을 제공합니다.
- 요청은 Anthropic Messages, OpenAI Chat Completions, OpenAI Responses 사이에서 자동으로 변환됩니다.
- 모델 이름은 와일드카드로 매핑되고, Claude Desktop에는 받아들이는 Claude 형식 별칭이 붙습니다.
- 스마트 라우팅은 모든 제공자의 모델을 하나의 카탈로그에 나열하고, 요청마다 모델로 라우팅합니다.

**파일을 고치지 않고 설정**

- 제공자 마법사에는 인기 벤더 프리셋과 기본 제공 엔드포인트 테스트가 있습니다.
- 클라이언트 구성은 각 클라이언트의 설정을 한 번에 쓰고, 복원은 이를 되돌립니다.
- 구성 변경은 다시 시작하지 않아도 적용됩니다. 수동 편집용 `~/.ccrelay/config.yaml`도 그대로 있습니다.
- 제공자는 JSON으로 내보내고 가져올 수 있습니다.

**무슨 일이 일어나는지 보기**

- 로그 탭은 각 요청의 헤더와 본문을 보여주고, 고른 행을 zip으로 내보냅니다.
- 대시보드는 토큰 사용량, 캐시 적중률, 첫 토큰까지 시간, 출력 속도, 제공자별 차트를 보여 줍니다.
- 채팅 탭은 다른 클라이언트를 열지 않고 아무 제공자나 시험합니다.
- 선택적 로컬 웹 검색(Tavily 또는 Parallel)이 자체 검색이 없는 제공자를 대신합니다.

**일하는 곳에서 실행**

- 데스크톱 앱은 macOS(Apple Silicon, Intel)와 Windows(x64, arm64)에서 동작하고 스스로 업데이트합니다.
- VS Code 확장은 데스크톱 앱과 같은 구성과 프록시를 공유합니다.

---

## 자주 묻는 질문

**Claude Desktop에서 GLM, Kimi, DeepSeek를 어떻게 쓰나요?**
CCRelay에 제공자를 추가한 다음 **클라이언트 구성 → Claude Desktop → 적용**을 클릭하고 Claude Desktop을 다시 시작합니다. CCRelay는 Claude Desktop을 서드파티 추론으로 바꾸고 각 모델에 Claude 형식 별칭을 줍니다. Claude Desktop은 `glm`, `kimi`, `deepseek` 같은 키워드가 들어간 모델 이름을 거부하기 때문입니다.

**ChatGPT 데스크톱 앱(ChatGPT Work 또는 Codex)에서 서드파티 모델을 어떻게 쓰나요?**
**클라이언트 구성 → Codex → 적용**을 클릭합니다. CCRelay는 `~/.codex/config.toml`과 모델 카탈로그를 씁니다. Codex CLI와 ChatGPT 데스크톱 앱이 둘 다 이를 읽습니다. ChatGPT 앱을 다시 시작한 다음 ChatGPT Work 또는 Codex의 목록에서 모델을 고릅니다.

**`settings.json`이나 `config.toml`을 손으로 고치지 않아도 되는 데스크톱 도구가 있나요?**
있습니다. **적용**을 클릭하면 CCRelay 데스크톱 앱이 Claude Code, Claude Desktop, Codex의 설정을 쓰고, **복원**이 되돌립니다.

**제공자에 OpenAI 호환 API만 있습니다. Claude Code가 쓸 수 있나요?**
쓸 수 있습니다. CCRelay는 Claude Code의 Anthropic 요청을 OpenAI Chat Completions 또는 Responses로 바꾸고, 도구 호출을 포함해 응답을 다시 변환합니다.

**제공자를 바꾼 뒤 클라이언트를 다시 시작해야 하나요?**
Claude Code는 다음 요청부터 새 제공자를 사용합니다. Codex CLI와 ChatGPT 데스크톱 앱은 모델 목록을 다시 읽으려면 다시 시작해야 합니다. Claude Desktop은 모델 목록을 새로 고치려면 다시 시작해야 할 수 있습니다.

**대화가 저장되나요?**
저장됩니다. 사용자 컴퓨터에만 저장되며, 끌 수 있습니다. [개인정보와 로컬 데이터](#개인정보와-로컬-데이터)를 보십시오.

**CCRelay는 무료인가요?**
무료입니다. CCRelay는 MIT 라이선스의 오픈 소스입니다.

---

## 개인정보와 로컬 데이터

| 항목             | CCRelay가 하는 일                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 실행 위치        | 사용자 컴퓨터에서 실행됩니다. 프록시는 기본적으로 `127.0.0.1`에서 수신합니다.                                                        |
| 아웃바운드 트래픽 | 요청은 구성한 제공자로 갑니다. Tavily 또는 Parallel에는 웹 검색을 켠 경우에만 접속합니다. 업데이트 확인은 GitHub Releases를 사용합니다. |
| 텔레메트리       | 없습니다.                                                                                                                            |
| 요청 로그        | 요청과 응답 본문은 로그에서 볼 수 있도록 기본적으로 `~/.ccrelay/logs.db`에 저장됩니다.                                               |
| 로그 끄기        | `logging.storeBodies: false`로 설정하거나 설정에서 끕니다. 토큰과 속도 통계는 따로 유지됩니다.                                       |
| 데이터 삭제      | 로그 탭의 **모두 지우기**는 저장된 본문을 지웁니다. 대시보드의 **통계 초기화**는 사용량 숫자를 지웁니다.                             |
| API 키           | `~/.ccrelay/config.yaml`에 저장됩니다. 파일에 키를 넣지 않으려면 `${ENV_VAR}`를 사용합니다. 로그에 남는 헤더에서는 키가 가려집니다.  |

---

## 지원 제공자

제공자 마법사에는 Z.ai GLM, Xiaomi MiMo, DeepSeek, MiniMax, Google Gemini, Azure OpenAI, Meituan LongCat, Astraflow(UCloud) 프리셋이 있습니다. 그 밖의 OpenAI 또는 Anthropic 호환 API(예: Kimi, Qwen, OpenRouter, 자체 호스팅 게이트웨이)도 사용자 지정 베이스 URL로 동작합니다.

### 검증된 업스트림(호스트별)

중계는 **제공자 `baseUrl` 호스트 이름**을 사용합니다. 아래 행은 제공자로 추가했을 때 **검증한 업스트림 엔드포인트**입니다. 벤더는 Anthropic API, OpenAI 호환 API, 또는 둘 다를 제공할 수 있습니다. 다만 **클라이언트 프로토콜**과 **업스트림 프로토콜**은 종종 다릅니다. 다를 때 CCRelay는 먼저 **일반 프로토콜 변환**을 적용하고, 유지하는 호스트에는 이어서 **호스트 이름별 정렬**을 적용합니다. 양쪽 회선 형식이 같아 보여도 **도구 기능은 벤더마다 다릅니다**(예: 웹 검색 서버 도구, 엄격한 Chat 스키마, Responses 전용 도구).

**표에 없는 호스트**는 **일반 변환만** 받습니다(추가 플랫폼 계층 없음). **표에 있는 호스트**는 **일반 변환에 더해** 도구, 메시지, 응답, 요청 URL/본문 특성에 대한 플랫폼 규칙을 받습니다. 마지막 열은 그 벤더에서 **웹 검색 서버 도구**가 어디에 지원되는지를 나타내며, 릴레이에 도달하는 방법과는 무관합니다.

**예 — Azure OpenAI:** 업스트림 **웹 검색 서버 도구**는 **Responses API**에만 있습니다(그래서 웹 검색 서버 도구 열이 “Responses API만”입니다). 클라이언트는 여전히 **OpenAI Chat Completions** 표면으로 CCRelay를 가리킬 수 있습니다. 제공자 `baseUrl`을 **Azure OpenAI**로 설정한 뒤, 웹 검색 서버 도구가 포함된 Chat 형태 호출은 **변환 계층에서** 업스트림 **Responses** 요청으로 다시 쓰이므로 검색이 계속 동작합니다. 클라이언트가 직접 `/v1/responses`를 호출할 필요는 없습니다.

| 제공자(대상 호스트)                                                    | Anthropic `/v1/messages` | OpenAI `/chat/completions` | OpenAI `/v1/responses` | 웹 검색 서버 도구        |
| ---------------------------------------------------------------------- | ------------------------ | -------------------------- | ---------------------- | ------------------------ |
| **Z.ai GLM**(`api.z.ai`, `open.bigmodel.cn`)                           | 지원                     | 지원                       | 지원하지 않음          | Anthropic 엔드포인트만   |
| **Xiaomi MiMo**(`api.xiaomimimo.com`)                                  | 지원                     | 지원                       | 지원하지 않음          | Chat만                   |
| **MiniMax**(`api.minimax.io`, `api.minimaxi.com`)                      | 지원                     | 지원                       | 지원하지 않음          | 지원하지 않음            |
| **Google Gemini**(OpenAI 호환, `generativelanguage.googleapis.com`)    | 지원하지 않음            | 지원                       | 지원하지 않음          | 지원하지 않음            |
| **Azure OpenAI**(`*.cognitiveservices.azure.com`)                      | 지원하지 않음            | 지원                       | 지원                   | Responses API만          |
| _그 밖의 호스트_                                                       | _경우에 따라 다름_       | _경우에 따라 다름_         | _경우에 따라 다름_     | 일반 변환만              |

**스크린샷(CCRelay를 거친 Claude Code)**

![Claude Code — GLM 웹 검색 서버 도구](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-claude-glm-web-search.webp)

![Claude Code — Xiaomi MiMo 웹 검색 서버 도구](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-claude-xiaomi-mimo-web-search.webp)

---

## 설치

### 데스크톱 앱(권장)

- [GitHub Releases](https://github.com/inflaborg/ccrelay/releases/latest)에서 받습니다:
  - **macOS**: `CCRelay-<version>-darwin-arm64.dmg`(Apple Silicon) 또는 `-darwin-x64.dmg`(Intel)
  - **Windows**: `CCRelay-<version>-win32-x64.exe` 또는 `-win32-arm64.exe`
- 앱은 트레이(macOS에서는 메뉴 막대)에 있습니다. 트레이 → **대시보드 열기**가 대시보드를 엽니다. **로그 폴더 열기**는 `~/.ccrelay/logs/` 아래의 런타임 진단을 엽니다.
- 업데이트는 실행 약 15초 뒤에 확인하고, 그다음부터 24시간마다 확인합니다. 트레이 → **업데이트 확인…**은 즉시 확인합니다. 확인하면 업데이트를 받아 앱을 다시 시작합니다.
- 트레이 → **업데이트 채널**은 **Stable**과 **Dev** 빌드를 전환합니다.
- 데스크톱 앱은 VS Code 확장과 `~/.ccrelay/` 구성 및 실행 중인 프록시를 공유합니다.

### VS Code 확장

- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=infLab.ccrelay-vscode) 또는 [Open VSX](https://open-vsx.org/extension/infLab/ccrelay-vscode)에서 **CCRelay**를 설치하거나, [Releases](https://github.com/inflaborg/ccrelay/releases)에서 `.vsix`를 받아 `Extensions: Install from VSIX...`를 실행합니다.
- VS Code 1.80.0 이상이 필요합니다.
- CCRelay 상태 표시줄 항목 또는 `CCRelay: Switch Provider`로 제공자를 바꿉니다. 대시보드는 `CCRelay: Open Dashboard`로 엽니다.

### 소스에서 빌드

```bash
git clone https://github.com/inflaborg/ccrelay.git
cd ccrelay
npm install
npm run build
npm run package        # dists/ccrelay-vscode-*.vsix 를 만듭니다
```

데스크톱 빌드: [개발](#개발)을 보십시오.

### Tauri 빌드(실험적)

더 가벼운 Tauri 데스크톱 변형(`packages/desktop-tauri`)은 같은 코어를 묶인 Node.js 런타임으로 실행합니다. 현재 릴리스에는 Tauri 설치 파일이 포함되어 있지 않습니다. Node.js 22로 소스에서 빌드합니다:

```bash
npm install
npm run tauri:dev         # Web UI와 Node 사이드카를 빌드한 뒤 Tauri 개발 모드를 실행합니다
npm run tauri:pack:mac    # 프로덕션 macOS 설치 파일
npm run tauri:pack:win    # 프로덕션 Windows 설치 파일
```

---

## 수동 구성

대시보드의 모든 내용은 `~/.ccrelay/config.yaml`에 저장됩니다. 파일 편집을 선호하면 다음 단계를 사용합니다.

### 1. 제공자 추가

`~/.ccrelay/config.yaml`을 편집합니다(첫 실행 시 자동 생성):

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

### 2. Claude Code를 CCRelay로 향하게 하기

`~/.claude/settings.json`에 추가합니다:

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

선택적 등급별 모델 이름 — Claude Code 기본값을 덮어쓰려는 경우에만 필요합니다:

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

웹 대시보드의 **클라이언트 구성** 탭에서도 설정할 수 있습니다.

### 3. 제공자 전환

- 데스크톱 앱 또는 대시보드: **제공자**에서 제공자 카드를 고른 다음 **적용**을 클릭합니다
- VS Code: CCRelay 상태 표시줄 항목을 클릭하거나 `CCRelay: Switch Provider`를 실행합니다
- 파일: `config.yaml`의 `defaultProvider`를 바꿉니다(자동으로 반영됩니다)

---

## 클라이언트 연동

CCRelay는 같은 포트(기본 **7575**)에서 **Anthropic**과 **OpenAI** 호환 경로를 모두 제공합니다. URL 접두사로 프로토콜을 고릅니다:

| 클라이언트                             | 프로토콜  | 베이스 URL                        |
| -------------------------------------- | --------- | --------------------------------- |
| **Claude Code**                        | Anthropic | `http://127.0.0.1:7575/anthropic` |
| **Claude Desktop**(서드파티 추론 / Cowork) | Anthropic | `http://127.0.0.1:7575/anthropic` |
| **Codex CLI / ChatGPT 데스크톱 앱**    | OpenAI    | `http://127.0.0.1:7575/openai`    |

`http://127.0.0.1:7575`를 직접 가리키면 기존 `/v1/...` 경로도 계속 동작합니다.

### Claude Code

**클라이언트 구성 → Claude Code → 적용**을 사용하거나, `~/.claude/settings.json` 항목은 [수동 구성](#수동-구성)을 보십시오.

빠른 테스트(현재 셸만):

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:7575/anthropic
claude
```

### Claude Desktop(서드파티 추론과 Cowork)

**클라이언트 구성 → Claude Desktop → 적용**(macOS와 Windows)은 Claude Desktop을 CCRelay를 거친 서드파티 추론으로 바꿉니다. 게이트웨이 URL은 `http://127.0.0.1:7575/anthropic`, 자리 표시자 API 키, `x-ccrelay-model-alias` 헤더입니다. 그 뒤 Claude Desktop을 다시 시작합니다. **복원**은 Claude Desktop을 자사 모드로 되돌립니다.

직접 설정하려면 Claude Desktop에서 **서드파티 추론 구성**을 열고, 위의 게이트웨이 URL을 설정하고, 아무 API 키나 입력한 다음 `x-ccrelay-model-alias` 헤더를 추가합니다. 서드파티 모델 이름에는 Claude 형식 별칭이 필요합니다. [Claude Desktop / Cowork 모델 ID 제한](#claude-desktop--cowork-모델-id-제한)을 보십시오.

### Codex CLI와 ChatGPT 데스크톱 앱

Codex CLI와 ChatGPT 데스크톱 앱(ChatGPT Work와 Codex 모두)은 같은 `~/.codex/config.toml`을 읽습니다. **클라이언트 구성 → Codex → 적용**을 사용하거나, 파일을 직접 만듭니다:

```toml
model = "gpt-5.4-mini"
model_provider = "ccrelay"
model_catalog_json = "ccrelay-model-catalog.json"

[model_providers.ccrelay]
name = "CCRelay"
base_url = "http://localhost:7575/openai"
```

적용은 `~/.codex/ccrelay-model-catalog.json`을 써서 Codex `/model`이 모델을 나열할 수 있게 합니다. 카탈로그는 **활성 제공자**의 사용자 지정 모델(또는 정확한 `modelMap` 항목)에서 옵니다. 스마트 라우팅이 켜져 있으면 모든 제공자의 라우팅된 모델을 나열합니다. 각 항목은 추론 수준 low, medium, high, xhigh를 알리며 기본값은 high입니다. `model`을 그 id 중 하나로 설정합니다. 적용 후 또는 제공자를 바꾼 뒤에는 카탈로그를 다시 읽도록 Codex CLI 또는 ChatGPT 데스크톱 앱을 다시 시작합니다. 수준은 `config.toml`의 `model_reasoning_effort` 또는 `/model`로 덮어씁니다.

---

## 사용 안내

### 다중 인스턴스 모드

VS Code 창이 여러 개 열려 있을 때:

- 한 인스턴스가 **Leader**가 되어 HTTP 서버를 실행하고, 나머지는 **Follower**입니다
- Leader는 WebSocket으로 제공자 변경을 Follower에 알립니다
- Leader가 종료되면 Follower가 자동으로 이어받습니다
- 상태 표시줄에 역할이 나옵니다: `$(broadcast)` = Leader, `$(radio-tower)` = Follower

**로깅**: 요청 로그는 Leader만 저장합니다. Follower는 로그 API 호출을 Leader로 프록시합니다. Leader에 닿지 않으면 그 호출은 503을 반환합니다.

**IPC 잠금**(Unix/macOS에서는 `~/.ccrelay/ccrelay-lock.sock`, Windows에서는 명명된 파이프)이 VS Code와 데스크톱 앱 사이의 Leader 선출을 조율합니다.

### 제공자 모드

| 모드          | 인증 동작                           | 용도                                          |
| ------------- | ----------------------------------- | --------------------------------------------- |
| `passthrough` | 원래 인증 헤더를 유지합니다         | OAuth가 있는 공식 Claude API                  |
| `inject`      | 인증을 제공자 API 키로 바꿉니다     | 서드파티 제공자(GLM, OpenRouter 등)           |

### 모델 매핑

와일드카드를 지원하며 Claude 모델 이름을 제공자별 모델에 대응시킵니다:

```yaml
modelMap:
  - pattern: "claude-opus-*"
    model: "glm-5"
  - pattern: "claude-sonnet-*"
    model: "glm-4.7"
```

**비전 모델 매핑** — 멀티모달 요청용 별도 매핑:

```yaml
vlModelMap:
  - pattern: "claude-*"
    model: "vision-model"
```

`modelMap`은 요청 본문(`model` 필드)에만 적용됩니다. `GET /models` 응답은 다시 쓰지 않습니다.

### Claude Desktop / Cowork 모델 ID 제한

Claude Desktop 1.7196.0부터 클라이언트는 `qwen`, `glm`, `kimi`, `deepseek` 같은 서드파티 키워드가 포함된 모델 ID를 거부합니다. 서드파티 업스트림 모델을 쓰면 Cowork에서만 `claude-` 접두사 별칭으로 매핑합니다.

별칭은 `claude-` 뒤에 **하이픈이 더 없는** 단일 토큰이어야 합니다(예: `claude-a1b2c3d4`, `claude-my-model`은 안 됨). 하이픈이 여러 개인 이름은 Anthropic 모델 버전으로 해석되기 때문입니다.

표준 별칭 id(마법사, Cowork 도우미, 스마트 라우팅)는 `claude-{8 hex}`입니다. `SHA1(providerId:protocol:upstreamModelId)`를 16진 8자리로 자르고 `smartRouting.aliasPrefix`(기본값 `claude-`)를 앞에 붙입니다. 같은 업스트림 모델이라도 제공자나 프로토콜이 다르면 별칭이 다릅니다.

**사용자 지정 모델 목록**(`customModelsList`): 각 줄은 `realModelId;displayName;alias`입니다(표시 이름이 실제 id와 같으면 `realModelId;;alias`). 실제 id는 업스트림이 기대하는 값입니다. `alias`는 Cowork에서 안전한 id입니다.

**Cowork**: Claude Desktop에서 사용자 지정 요청 헤더 `x-ccrelay-model-alias`에 아무 값(예: `1`)을 넣습니다. 이 헤더가 있으면 `GET /models`와 `GET /models/{id}`는 회선상의 `id`로 **별칭**을 반환합니다. 헤더가 없으면 같은 목록은 **실제** 모델 id를 반환합니다(다른 클라이언트용).

**모델 매핑**(`modelMap`): 자동 생성 항목에는 별칭 규칙, 동일성 규칙(`realId` → `realId`), Claude 계열 와일드카드(`claude-haiku-*` / `claude-sonnet-*` / `claude-opus-*`), 기본 `claude-*` / `gpt-*` 포괄 규칙이 들어갑니다. 동일성 규칙은 실제 모델 id를 보내는 클라이언트가 와일드카드로 잘못 라우팅되지 않게 합니다.

**예** -- GLM 모델 두 개. Cowork는 위 헤더로 별칭을 사용합니다:

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

이 구성에서는:

- `x-ccrelay-model-alias` **없음**: `GET /models`는 `glm-5.1`과 `glm-4.7`을 반환합니다(표시 이름이 id와 다르면 표시 이름도 함께).
- `x-ccrelay-model-alias` **있음**: `GET /models`는 표준 별칭 id를 회선상의 `id`로 반환합니다. Cowork가 이를 고르면 CCRelay가 `modelMap`으로 실제 업스트림 id에 매핑합니다.
- `claude-haiku-*` / `claude-sonnet-*` / `claude-opus-*` 계열 와일드카드는 기본적으로 그 Claude 모델을 첫 사용자 지정 모델로 라우팅합니다(빠른 채우기에서는 계열마다 다른 대상을 고를 수 있습니다).
- `claude-*`와 `gpt-*` 와일드카드는 클라이언트가 보낼 수 있는 다른 모델 이름을 받아 첫 모델로 라우팅합니다.

기본 제공 마법사와 Cowork 빠른 채우기 도우미는 위의 표준 해시로 `realId;displayName;claude-{hash}` 줄과 맞는 `modelMap` 항목을 만듭니다. Cowork에서는 Claude Desktop에 `x-ccrelay-model-alias`를 추가하고, 다른 곳에서는 빼 둡니다. 수동 편집 뒤에는 제공자 편집기의 **모델 맵 다시 만들기**로 `customModelsList`에서 `modelMap`을 완전히 다시 만듭니다(해당 모델이 아직 있으면 Claude 계열 와일드카드 대상은 유지됩니다. `gpt-*-mini` 같은 다른 사용자 지정 와일드카드 규칙은 유지되지 않습니다).

#### 사용자 지정 모델 목록 구성 UI

![사용자 지정 모델 목록](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/provider-custom-model-1.webp)

**사용자 지정 모델 빠른 채우기**로 업스트림 모델 ID와 표시 이름을 입력한 다음, 필요하면 `claude-haiku-*` / `claude-sonnet-*` / `claude-opus-*`를 목록의 모델에 매핑합니다(기본값은 첫 모델). 사용자 지정 모델 목록과 모델 맵은 자동으로 만들어집니다.

![사용자 지정 모델 빠른 채우기](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/provider-custom-model-2.webp)

#### Claude Cowork에서 별칭 켜기

Claude Desktop의 **서드파티 추론 구성** 패널에서 **게이트웨이 추가 헤더**에 `x-ccrelay-model-alias`를 추가하면 모델 목록이 실제 ID 대신 별칭을 반환합니다.

![Cowork 게이트웨이 추가 헤더](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/cowork-ccrelay-model-alias.webp)

### OpenAI 형식 변환

CCRelay는 세 가지 인바운드 프로토콜을 받고, 업스트림 제공자가 다른 회선 형식을 쓸 때 변환합니다:

| 인바운드 경로                                      | 클라이언트 프로토콜     |
| -------------------------------------------------- | ----------------------- |
| `/v1/messages`, `/anthropic/v1/messages`           | Anthropic Messages      |
| `/v1/chat/completions`, `/openai/chat/completions` | OpenAI Chat Completions |
| `/v1/responses`                                    | OpenAI Responses API    |
| `/v1/models`, `/openai/models`                     | OpenAI 모델 목록        |
| `/anthropic/v1/models`                             | Anthropic 모델 목록     |

**변환 규칙**:

- 양쪽이 같은 계열(예: Chat + `openai` 제공자) → 통과(모델 매핑과 인증은 그대로 적용됩니다)
- 계열을 넘으면 → Chat Completions 허브를 거쳐 요청/응답 본문을 변환합니다
- `GET /models` → 진입 경로와 `providerType`이 다를 때 목록 형식을 변환합니다. 업스트림 오류는 그대로 전달합니다

**스트리밍 제한**:

- 프로토콜을 넘는 경로는 변환을 위해 `stream: false`를 강제합니다. 클라이언트가 `stream: true`를 보내면 CCRelay는 클라이언트 SDK가 끝낼 수 있도록 최소 SSE 봉투를 합성합니다. 모델 출력은 토큰 단위가 아니라 최종 페이로드에 도착합니다.
- 같은 계열 스트리밍은 보통대로 통과합니다.

**예: OpenAI 호환 제공자(Gemini)**

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

### Web UI 대시보드

기본 제공 웹 대시보드는 명령 팔레트 → `CCRelay: Open Dashboard`(VS Code) 또는 트레이 메뉴 → **대시보드 열기**(데스크톱 앱)로 엽니다.

- **대시보드** — 서버 상태, 현재 제공자, 토큰 사용량, 성능 지표(TTFB, P50/P90 지연, 출력 TPS)와 시간 범위 선택
- **스마트 라우팅** — 모든 제공자의 모델 목록을 모읍니다. 통합 `/v1/models`는 `<providerId>:<modelId>` id를 씁니다. 모델에 따라 각 요청을 맞는 제공자로 라우팅합니다(모델을 바꿀 때 제공자 전환이나 클라이언트 다시 시작이 필요 없습니다)
- **제공자** — 업스트림 연결을 구성합니다. 카드를 클릭해 고른 다음 적용으로 바꿉니다. **선택**으로 내보내거나 삭제합니다
- **기능** — 선택적 웹 검색 백엔드(**Tavily** 및/또는 **Parallel**): API 키, 기본 백엔드, 어떤 제공자가 웹 검색에 로컬로 응답하는지
- **로그** — 토큰 열, TTFB, 출력 TPS, 모델 매핑이 있는 요청/응답 로그 뷰어. 행을 여러 개 골라 id별 폴더(JSON, 헤더, 분석 markdown)의 zip을 내보냅니다. 로깅이 꺼져 있으면 숨깁니다
- **설정** — UI에서 YAML 구성을 관리합니다. 라우팅과 동시성은 저장 시 즉시 다시 로드됩니다. 서버와 로깅 변경은 다시 시작이 필요합니다
- **클라이언트 구성** — UI에서 Claude Code 환경 변수와 Codex 구성을 씁니다. 설치된 Claude Desktop claude-code 번들 버전과 Claude Code CLI 버전을 보여 줍니다(`claude --version`, 페이지에서 끌 수 있습니다)

> **참고**: 브라우저에서 `http://127.0.0.1:7575/ccrelay/`를 직접 열어서는 대시보드에 들어갈 수 없습니다. 접근은 내부 헤더를 포함하는 VS Code 확장 또는 데스크톱 앱에서 온 요청으로 제한됩니다. 확장 명령이나 데스크톱 트레이 메뉴로 대시보드를 여십시오.

**Web UI**

![클라이언트 구성](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-ccrelay-setup-1.webp)

![기본 모델 구성](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-ccrelay-setup-2.webp)

![기능 — Tavily 웹 검색](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-capabilities-websearch-tavily.webp)

![요청 로그](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-ccrelay-1.webp)

![로그 상세](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-ccrelay-3.webp)

**데스크톱 앱**

![데스크톱 — 대시보드](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-desktop-1.webp)

![데스크톱 — 제공자 목록](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-desktop-2.webp)

---

## 구성

CCRelay는 `~/.ccrelay/config.yaml`을 사용합니다(첫 실행 시 자동 생성). 시작 시 묶인 기본값이 파일과 병합됩니다. **적은 값이 항상 우선**하고, 빠진 키는 기본값으로 채웁니다. 목록 절(`routing.forward`, `routing.block`, `concurrency.routes`)은 식별 키로 병합되며, 사용자 행이 먼저이고 새 기본값이 뒤에 붙습니다. 목록을 생략하면 기본값 전체를 물려받습니다. 의도적으로 비우려면 `[]`를 설정합니다.

> YAML 구성은 `camelCase`와 `snake_case` 키를 모두 지원합니다.

### 서버

| 설정               | 기본값      | 설명                                                                 |
| ------------------ | ----------- | -------------------------------------------------------------------- |
| `server.port`      | `7575`      | 프록시 서버 포트                                                     |
| `server.host`      | `127.0.0.1` | 바인드 주소                                                          |
| `server.autoStart` | `true`      | 확장 로드 시 서버 자동 시작                                          |
| `server.locale`    | `""`        | Web UI 언어(`"en"`, `"zh"`, `"ja"`, `"ko"`). 설정되지 않으면 첫 방문 시 선택 화면을 표시합니다. |

### 제공자

| 설정              | 기본값     | 설명                    |
| ----------------- | ---------- | ----------------------- |
| `defaultProvider` | `official` | 기본 제공자 ID          |
| `providers`       | `{...}`    | 제공자 맵(아래 참고)    |

각 제공자가 지원하는 항목:

| 필드           | 기본값            | 설명                                                                                         |
| -------------- | ----------------- | -------------------------------------------------------------------------------------------- |
| `name`         | —                 | 표시 이름                                                                                    |
| `baseUrl`      | —                 | API 베이스 URL                                                                               |
| `mode`         | `"passthrough"`   | `passthrough`(인증 유지) 또는 `inject`(인증 교체)                                            |
| `providerType` | `"anthropic"`     | `"anthropic"`, `"openai"`(완전 통과), 또는 `"openai_chat"`(Chat Completions만)              |
| `openaiCompat` | —                 | 선택. 사용자 지정 도메인에서 Azure Chat 형태를 쓰려면 `azure_openai`를 설정합니다(공식 `*.cognitiveservices.azure.com`은 자동 감지됩니다) |
| `apiKey`       | —                 | inject 모드용 API 키. `${ENV_VAR}`를 지원합니다.                                             |
| `authHeader`   | `"authorization"` | 인증 헤더 이름                                                                               |
| `modelMap`     | —                 | 모델 이름 매핑(`[{pattern, model}]`, 와일드카드 지원)                                        |
| `vlModelMap`   | —                 | 비전 모델 매핑(멀티모달 요청용)                                                              |
| `headers`      | —                 | 사용자 지정 요청 헤더                                                                        |
| `enabled`      | `true`            | 사용/사용 안 함                                                                              |

### 스마트 라우팅

**제공자** 탭(위쪽 카드)에서 **스마트 라우팅**을 켭니다. 사용 설정된 모든 제공자의 모델 목록을 모으고, 모델 id에 따라 각 요청을 맞는 제공자로 라우팅합니다. 스마트 라우팅과 단일 폴백 제공자는 **동시에 쓸 수 없습니다**. 스마트 라우팅이 켜져 있으면 제공자 카드는 사용 중으로 표시되지 않습니다. 제공자 카드를 고르고 적용하면 그 제공자를 쓰고 스마트 라우팅은 꺼집니다.

설정은 **스마트 라우팅** 탭에서 합니다(별칭 접두사, 접두사 없는 모델 id 폴백, 제외 목록, 사용자 지정 라우팅 규칙, 집계 모델 표).

| 설정                                  | 기본값          | 설명                                                                                                      |
| ------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------- |
| `smartRouting.enabled`                | `false`         | 제공자 탭에서 켭니다. 제공자 모델을 모으고 `<providerId>:<modelId>`로 라우팅합니다                        |
| `smartRouting.aliasPrefix`            | `"claude-"`     | 클라이언트가 `x-ccrelay-model-alias`를 보낼 때 표준 별칭 id(`claude-{8 hex}`)의 접두사                    |
| `smartRouting.exclude`                | —               | `/v1/models`에서 빼고 라우팅하지 않을 공개 모델 id의 와일드카드 목록. 제외된 id를 쓰는 요청은 거부됩니다 |
| `smartRouting.include`                | —               | 설정하면 일치하는 공개 id만 노출합니다(exclude와 동시에 쓸 수 없습니다)                                   |
| `smartRouting.modelsCache.ttlSeconds` | `600`           | 사용자 지정이 아닌 제공자의 업스트림 모델 목록 캐시 TTL                                                   |
| `smartRouting.bareModelFallback.mode` | `first-match`   | 클라이언트가 접두사 없는 모델 id를 보내면 YAML 순서의 첫 일치 제공자에 맞추거나 거부합니다                |
| `smartRouting.modelRules`             | —               | 카탈로그보다 먼저 맞추는 사용자 지정 규칙(`pattern`, `provider`, `model`). `/v1/models`에는 나오지 않습니다 |

### 라우팅

| 설정              | 기본값                                 | 설명                                                                                                                       |
| ----------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `configVersion`   | `"0.2.5"`                              | 구성 스키마 버전. 더 오래된 구성은 시작 시 자동으로 올려집니다.                                                            |
| `routing.forward` | `[{path, provider}]`                   | 전달 규칙 — 첫 일치가 우선합니다. `provider: "auto"` = 현재 제공자. 일치하지 않으면 → 404.                                 |
| `routing.block`   | `[{path, response, code, condition?}]` | 차단 규칙 — 사용자 지정 응답을 반환합니다. 선택적 `condition.providers`(허용 목록)와 `condition.providerNot`(제외 목록).   |

### 동시성

| 설정                         | 기본값 | 설명                              |
| ---------------------------- | ------ | --------------------------------- |
| `concurrency.enabled`        | `true` | 요청 대기열 사용                  |
| `concurrency.maxWorkers`     | `3`    | 동시 요청 최대 수                 |
| `concurrency.maxQueueSize`   | `100`  | 대기열 최대 수(0 = 제한 없음)     |
| `concurrency.requestTimeout` | `0`    | 대기열 시간 제한(초, 0 = 제한 없음) |
| `concurrency.routes`         | `[]`   | 경로별 대기열 구성(`pattern` 기준) |

### 로깅

| 설정                     | 기본값     | 설명                                                                                         |
| ------------------------ | ---------- | -------------------------------------------------------------------------------------------- |
| `logging.storeBodies`    | `true`     | 로그 탭에 요청/응답 본문을 저장합니다. 토큰과 성능 지표는 따로 기록됩니다                    |
| `logging.database.type`  | `"sqlite"` | `"sqlite"` 또는 `"postgres"`                                                                 |

`logging.enabled`는 더 이상 쓰이지 않습니다. `storeBodies`가 설정되지 않으면 `enabled`가 폴백으로 사용됩니다.

**SQLite:**

| 설정                                  | 기본값 | 설명                                             |
| ------------------------------------- | ------ | ------------------------------------------------ |
| `logging.database.path`               | `""`   | DB 파일 경로(비어 있으면 `~/.ccrelay/logs.db`)   |
| `logging.database.sqlite3_executable` | `""`   | `sqlite3` 바이너리 경로(비어 있으면 `PATH`에서 찾음) |

`sqlite3`를 찾지 못하면 프록시는 로그를 저장하지 않고 실행됩니다(로그에 경고가 남습니다).

**PostgreSQL:**

| 설정                        | 기본값      | 설명                         |
| --------------------------- | ----------- | ---------------------------- |
| `logging.database.host`     | `localhost` | 서버 호스트                  |
| `logging.database.port`     | `5432`      | 서버 포트                    |
| `logging.database.name`     | `ccrelay`   | 데이터베이스 이름            |
| `logging.database.user`     | `""`        | 사용자 이름                  |
| `logging.database.password` | `""`        | 비밀번호(`${ENV_VAR}` 지원)  |
| `logging.database.ssl`      | `false`     | SSL 사용                     |

### 외부 웹 검색

선택한 제공자에 대한 Anthropic 형식 **웹 검색**(서버 도구) 요청의 선택적 **로컬 처리**입니다. CCRelay는 **[Tavily](https://tavily.com/)** 또는 **[Parallel](https://parallel.ai/)**로 실시간 검색을 실행한 뒤 그 턴의 합성된 어시스턴트 응답을 반환하므로, 업스트림 채팅 모델이 도구를 직접 구현할 필요가 없습니다.

| 설정                             | 설명                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| `webSearch.enabled`              | 마스터 스위치(`true` / `false`). 생략하면 비어 있지 않은 `providers`는 켬을 뜻합니다. |
| `webSearch.providers`            | 웹 검색에 할당할 제공자 ID(`providers:` 아래 키). 꺼도 유지됩니다.                    |
| `webSearch.defaultSearchBackend` | 선택: `tavily` 또는 `parallel`(요청마다 추론되지 않을 때의 기본값).                   |

#### Tavily

| 설정                           | 설명                                       |
| ------------------------------ | ------------------------------------------ |
| `webSearch.tavily.apiKey`      | Tavily API 키. `${ENV_VAR}`를 지원합니다.  |
| `webSearch.tavily.searchDepth` | `basic` 또는 `advanced`(선택).             |
| `webSearch.tavily.maxResults`  | 결과 수, 1–10(선택).                       |

#### Parallel

| 설정                               | 설명                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------- |
| `webSearch.parallel.apiKey`        | Parallel API 키. `${ENV_VAR}`를 지원합니다.                                                   |
| `webSearch.parallel.mode`          | `turbo`, `basic`, 또는 `advanced`(선택, 기본값 `basic`).                                      |
| `webSearch.parallel.maxResults`    | 결과 수, 1–10(선택).                                                                          |
| `webSearch.parallel.publishedAfter` | 신선도 필터용 선택적 RFC 3339 날짜(`YYYY-MM-DD`).                                            |
| `webSearch.parallel.location`      | 지역 대상: 아무 ISO 3166-1 alpha-2 코드(예: `us`, `cn`, `gb`). 생략하면 자동. Parallel이 지원하지 않는 코드는 무시될 수 있습니다. |
| `webSearch.parallel.includeDomains` | 선택적 도메인 허용 목록(YAML 배열).                                                          |
| `webSearch.parallel.excludeDomains` | 선택적 도메인 차단 목록(YAML 배열).                                                          |
| `webSearch.parallel.liveFetch`     | 선택: 캐시가 오래되었을 때 실시간 가져오기를 켭니다(지연이 더 큽니다).                        |
| `webSearch.parallel.maxCharsPerResult` | 선택적, 결과 URL당 발췌 크기 제한.                                                        |

최상위 키는 `webSearch` 대신 `web_search`를 써도 됩니다(중첩 형태는 같습니다).

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

`enabled: false`로 두면 `providers` 프리셋 목록을 지우지 않고 웹 검색을 끕니다.

같은 항목은 대시보드 **기능** 탭에서 편집할 수 있습니다.

### 전체 예

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

## API 엔드포인트

`/ccrelay/`의 관리 엔드포인트:

| 엔드포인트                      | 메서드     | 설명                           |
| ------------------------------- | ---------- | ------------------------------ |
| `/ccrelay/api/status`           | GET        | 프록시 상태                    |
| `/ccrelay/api/providers`        | GET        | 제공자 목록                    |
| `/ccrelay/api/switch/{id}`      | GET        | 제공자로 전환                  |
| `/ccrelay/api/switch`           | POST       | 제공자 전환(JSON 본문)         |
| `/ccrelay/api/providers/export` | POST       | ID로 제공자 내보내기           |
| `/ccrelay/api/providers/import` | POST       | 제공자 가져오기(ID로 병합)     |
| `/ccrelay/api/queue`            | GET        | 대기열 통계                    |
| `/ccrelay/api/logs`             | GET        | 요청 로그                      |
| `/ccrelay/api/config`           | GET, PATCH | 구성 절 읽기/쓰기              |
| `/ccrelay/ws`                   | WebSocket  | Follower 동기화                |
| `/ccrelay/`                     | GET        | Web UI 대시보드                |

그 밖의 요청은 현재 제공자로 프록시됩니다.

---

## 명령

| 명령                     | ID                       | 설명               |
| ------------------------ | ------------------------ | ------------------ |
| CCRelay: Show Menu       | `ccrelay.showMenu`       | 주 메뉴 표시       |
| CCRelay: Switch Provider | `ccrelay.switchProvider` | 제공자 선택        |
| CCRelay: Start Server    | `ccrelay.startServer`    | 서버 시작          |
| CCRelay: Stop Server     | `ccrelay.stopServer`     | 서버 중지          |
| CCRelay: Open Settings   | `ccrelay.openSettings`   | 확장 설정          |
| CCRelay: Show Logs       | `ccrelay.showLogs`       | 출력 로그          |
| CCRelay: Clear Logs      | `ccrelay.clearLogs`      | 출력 로그 지우기   |
| CCRelay: Open Dashboard  | `ccrelay.openWebUI`      | 웹 대시보드        |

---

## 개발

```bash
npm run compile        # 타입 검사
npm run watch          # 감시하며 다시 컴파일
npm run lint           # Lint
npm run format         # 포맷
npm run test           # 단위 테스트
npm run test:integration
npm run test:all
npm run test:coverage
npm run package        # VSIX 빌드
npm run build:dev      # 개발 빌드
npm run build:prod     # 프로덕션 빌드

# Electron 데스크톱 앱
npm run desktop:start
npm run desktop:pack:mac
npm run desktop:pack:win

# Tauri 데스크톱 앱
npm run tauri:dev
npm run tauri:pack:mac
npm run tauri:pack:win
```

### 프로젝트 구조

```
ccrelay/
├── packages/
│   ├── core/              # 공유 런타임(프록시, 구성, 변환기)
│   ├── vscode/            # VS Code 확장
│   ├── desktop/           # Electron 데스크톱 앱
│   └── desktop-tauri/     # Tauri 데스크톱 앱
├── web/                   # Web UI(React + Vite)
├── tests/                 # Vitest 단위 테스트와 통합 테스트
├── scripts/               # 빌드와 패키징 보조
└── dists/                 # 패키징된 .vsix
```

---

## 파일 위치

| 파일     | 위치                                                     | 설명                       |
| -------- | -------------------------------------------------------- | -------------------------- |
| 구성     | `~/.ccrelay/config.yaml`                                 | 주 구성(자동 생성)         |
| 상태     | `~/.ccrelay/state.json`                                  | 활성 제공자 ID             |
| IPC 잠금 | `~/.ccrelay/ccrelay-lock.sock`(Unix) / 명명된 파이프(Win) | Leader 선출                |
| 로그 DB  | `~/.ccrelay/logs.db`                                     | 요청 로그(Leader만)        |

---

## 기여

Issue와 Pull Request를 환영합니다.

---

## 감사의 말

CCRelay는 AI 코딩 도우미([Cursor](https://cursor.com)와
[Claude Code](https://claude.ai/code))로 개발되며, 모델 백엔드로 [GLM](https://z.ai/model-api)과
[Xiaomi MiMo](https://platform.xiaomimimo.com/token-plan)를 사용합니다.
유지 관리자가 모든 릴리스를 설계하고, 검토하고, 테스트합니다.

---

## 라이선스

[MIT 라이선스](LICENSE)

저작권 (c) 2026 [infLab](https://github.com/inflaborg)
