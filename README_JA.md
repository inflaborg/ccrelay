# CCRelay

[![Latest release](https://img.shields.io/github/v/release/inflaborg/ccrelay)](https://github.com/inflaborg/ccrelay/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/inflaborg/ccrelay/total)](https://github.com/inflaborg/ccrelay/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Claude Code、Claude Desktop、および ChatGPT デスクトップアプリ（ChatGPT Work と Codex）でサードパーティのモデルを使います。**

**CCRelay** は、macOS と Windows 向けの無料オープンソースのデスクトップアプリです。**Claude Code**、**Claude Desktop**（サードパーティ推論と Cowork）、**ChatGPT デスクトップアプリ**（ChatGPT Work と Codex）、**Codex CLI** から、GLM、Kimi、DeepSeek、Gemini、Qwen、MiniMax、Xiaomi MiMo などのサードパーティモデル、または任意の OpenAI / Anthropic 互換 API を使えます。今使っているクライアントはそのままに、モデルの切り替えを一か所で行います。ローカルプロキシが Anthropic 形式と OpenAI 形式を自動で変換します。VS Code 拡張機能もあります。

**ダウンロード**: [最新リリース](https://github.com/inflaborg/ccrelay/releases/latest) — macOS `.dmg`（Apple Silicon、Intel）· Windows `.exe`（x64、arm64）· VS Code 拡張機能は [Marketplace](https://marketplace.visualstudio.com/items?itemName=infLab.ccrelay-vscode) と [Open VSX](https://open-vsx.org/extension/infLab/ccrelay-vscode)

**ウェブサイト**: [https://ccrelay.inflab.org](https://ccrelay.inflab.org) · **[English](./README.md)** · **[中文](./README_CN.md)** · **日本語** · **[한국어](./README_KO.md)**

![CCRelay デスクトップアプリ — プロバイダー一覧](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-desktop-2.webp)

---

## 目次

- [対応クライアント](#対応クライアント)
- [3 ステップではじめる](#3-ステップではじめる)
- [主な機能](#主な機能)
- [よくある質問](#よくある質問)
- [プライバシーとローカルデータ](#プライバシーとローカルデータ)
- [対応プロバイダー](#対応プロバイダー)
- [インストール](#インストール)
- [手動設定](#手動設定)
- [クライアント連携](#クライアント連携)
- [使い方](#使い方)
  - [マルチインスタンスモード](#マルチインスタンスモード)
  - [プロバイダーモード](#プロバイダーモード)
  - [モデルマッピング](#モデルマッピング)
  - [Claude Desktop / Cowork のモデル ID 制限](#claude-desktop--cowork-のモデル-id-制限)
  - [OpenAI 形式の変換](#openai-形式の変換)
  - [Web UI ダッシュボード](#web-ui-ダッシュボード)
- [外部ウェブ検索](#外部ウェブ検索)
- [設定](#設定)
- [API エンドポイント](#api-エンドポイント)
- [コマンド](#コマンド)
- [開発](#開発)
- [ファイルの場所](#ファイルの場所)
- [ライセンス](#ライセンス)

---

## 対応クライアント

| クライアント                                           | 接続方法                                                                                  |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| **Claude Code**（CLI と IDE 拡張機能）                 | クライアント設定 → Claude Code → 適用                                                     |
| **Claude Desktop**（サードパーティ推論、Cowork）       | クライアント設定 → Claude Desktop → 適用し、その後 Claude Desktop を再起動する            |
| **Codex CLI**                                          | クライアント設定 → Codex → 適用し、その後 Codex を再起動する                              |
| **ChatGPT デスクトップアプリ**（ChatGPT Work、Codex）  | Codex CLI と同じ `~/.codex/config.toml`: 適用し、その後 ChatGPT デスクトップアプリを再起動する |
| Anthropic または OpenAI のカスタム URL を受け付けるツール | `http://127.0.0.1:7575/anthropic` または `http://127.0.0.1:7575/openai`                   |

各クライアントの詳細: [クライアント連携](#クライアント連携)。

---

## 3 ステップではじめる

1. **デスクトップアプリをインストールします。** [Releases](https://github.com/inflaborg/ccrelay/releases/latest) からダウンロードして開きます。ローカルプロキシは `http://127.0.0.1:7575` で起動します。
2. **プロバイダーを追加します。** **プロバイダー → プロバイダーを追加** を開き、プリセット（GLM、Xiaomi MiMo、DeepSeek、MiniMax、Gemini、Azure OpenAI、Meituan LongCat、Astraflow）を選ぶか任意のベース URL を入力し、API キーを貼り付け、組み込みテストを実行して作成します。
3. **クライアントを接続します。** **クライアント設定** を開き、Claude Code、Claude Desktop、または Codex を選び、**適用** をクリックします。上の表に再起動とある場合は、クライアントを再起動します。

あとからモデルを切り替えるには、別のプロバイダーカードを選んで **適用** をクリックするか、**スマートルーティング** をオンにして全プロバイダーのモデルを一度に一覧し、クライアント内で選びます。クライアント設定ページの **復元** は、クライアントへの変更を元に戻します。

![クライアント設定](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-ccrelay-setup-1.webp)

ファイルを直接編集する場合は、[手動設定](#手動設定) を参照してください。

---

## 主な機能

**今使っているクライアントで任意のモデルを使う**

- 1 つのローカルアドレスが Claude Code、Claude Desktop、Codex CLI、ChatGPT デスクトップアプリに対応します。
- リクエストは Anthropic Messages、OpenAI Chat Completions、OpenAI Responses の間で自動変換されます。
- モデル名はワイルドカードでマッピングされ、Claude Desktop には受け付ける Claude 形式のエイリアスが付きます。
- スマートルーティングは全プロバイダーのモデルを 1 つのカタログに一覧し、リクエストごとにモデルで振り分けます。

**ファイルを編集せずにセットアップする**

- プロバイダーウィザードには人気ベンダーのプリセットと、組み込みのエンドポイントテストがあります。
- クライアント設定は各クライアントの設定をワンクリックで書き込み、復元で元に戻せます。
- 設定の変更は再起動なしで反映されます。手動編集用に `~/.ccrelay/config.yaml` も使えます。
- プロバイダーは JSON としてエクスポートおよびインポートできます。

**何が起きているかを見る**

- ログタブは各リクエストのヘッダーとボディを表示し、選択した行を zip としてエクスポートします。
- ダッシュボードはトークン使用量、キャッシュヒット率、最初のトークンまでの時間、出力速度、プロバイダー別のグラフを表示します。
- チャットタブは、別のクライアントを開かずに任意のプロバイダーを試せます。
- 任意のローカルウェブ検索（Tavily または Parallel）が、独自の検索を持たないプロバイダーを補います。

**作業している場所で動く**

- デスクトップアプリは macOS（Apple Silicon、Intel）と Windows（x64、arm64）で動作し、自身を更新します。
- VS Code 拡張機能は、デスクトップアプリと同じ設定とプロキシを共有します。

---

## よくある質問

**Claude Desktop で GLM、Kimi、DeepSeek を使うには？**
CCRelay にプロバイダーを追加し、**クライアント設定 → Claude Desktop → 適用** をクリックして Claude Desktop を再起動します。CCRelay は Claude Desktop をサードパーティ推論に切り替え、各モデルに Claude 形式のエイリアスを付けます。Claude Desktop は `glm`、`kimi`、`deepseek` などのキーワードを含むモデル名を拒否するためです。

**ChatGPT デスクトップアプリ（ChatGPT Work または Codex）でサードパーティモデルを使うには？**
**クライアント設定 → Codex → 適用** をクリックします。CCRelay は `~/.codex/config.toml` とモデルカタログを書き込みます。Codex CLI と ChatGPT デスクトップアプリの両方がこれらを読みます。ChatGPT アプリを再起動し、ChatGPT Work または Codex の一覧からモデルを選びます。

**`settings.json` や `config.toml` を手で編集しなくて済むデスクトップツールはありますか？**
あります。CCRelay デスクトップアプリは、**適用** をクリックすると Claude Code、Claude Desktop、Codex の設定を書き込み、**復元** で元に戻します。

**プロバイダーが OpenAI 互換 API しかない場合、Claude Code で使えますか？**
使えます。CCRelay は Claude Code の Anthropic リクエストを OpenAI Chat Completions または Responses に変換し、ツール呼び出しを含めて応答を戻します。

**プロバイダーを切り替えたあと、クライアントの再起動は必要ですか？**
Claude Code は次のリクエストから新しいプロバイダーを使います。Codex CLI と ChatGPT デスクトップアプリは、モデル一覧を再読み込みするために再起動が必要です。Claude Desktop は、モデル一覧を更新するために再起動が必要な場合があります。

**会話は保存されますか？**
保存されます。お使いのコンピュータ上のみで、オフにもできます。[プライバシーとローカルデータ](#プライバシーとローカルデータ) を参照してください。

**CCRelay は無料ですか？**
無料です。CCRelay は MIT ライセンスのオープンソースです。

---

## プライバシーとローカルデータ

| 項目                 | CCRelay の動作                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 実行場所             | お使いのコンピュータ上。プロキシはデフォルトで `127.0.0.1` を待ち受けます。                                                          |
| 外向きの通信         | リクエストは設定したプロバイダーへ送られます。Tavily または Parallel へは、ウェブ検索を有効にした場合のみ接続します。更新確認は GitHub Releases を使います。 |
| テレメトリ           | ありません。                                                                                                                         |
| リクエストログ       | リクエストとレスポンスのボディは、ログで確認できるようデフォルトで `~/.ccrelay/logs.db` に保存されます。                             |
| ログをオフにする     | `logging.storeBodies: false` を設定するか、設定でオフにします。トークンと速度の統計は別途保持されます。                              |
| データを削除する     | ログタブの **すべて消去** は保存されたボディを削除します。ダッシュボードの **統計をリセット** は使用量の数値を削除します。            |
| API キー             | `~/.ccrelay/config.yaml` に保存されます。ファイルにキーを書かないようにするには `${ENV_VAR}` を使います。ログに出るヘッダーではキーはマスクされます。 |

---

## 対応プロバイダー

プロバイダーウィザードには、Z.ai GLM、Xiaomi MiMo、DeepSeek、MiniMax、Google Gemini、Azure OpenAI、Meituan LongCat、Astraflow（UCloud）のプリセットがあります。その他の OpenAI / Anthropic 互換 API（たとえば Kimi、Qwen、OpenRouter、またはセルフホストのゲートウェイ）も、カスタムのベース URL で動作します。

### 検証済みアップストリーム（ホスト別）

中継は **プロバイダーの `baseUrl` ホスト名** を使います。下表の行は、プロバイダーとして追加したときに **検証済みのアップストリームエンドポイント** です。ベンダーは Anthropic API、OpenAI 互換 API、またはその両方を提供することがあります。ただし **クライアントのプロトコル** と **アップストリームのプロトコル** はしばしば一致しません。異なる場合、CCRelay はまず **汎用プロトコル変換** を適用し、維持しているホストでは続けて **ホスト名固有の整合** を行います。回線上の形式が両側で同じに見えても、**ツール機能はベンダーごとに異なります**（例: ウェブ検索サーバーツール、厳密な Chat スキーマ、Responses 専用ツール）。

**表にないホスト** は **汎用変換のみ** です（追加のプラットフォーム層はありません）。**表にあるホスト** は **汎用変換に加えて**、ツール、メッセージ、レスポンス、リクエスト URL／ボディの癖に対するプラットフォームルールが適用されます。最後の列は、そのベンダーで **ウェブ検索サーバーツール** がどこでサポートされるかを示します。リレーへの到達方法には依存しません。

**例 — Azure OpenAI:** アップストリームの **ウェブ検索サーバーツール** は **Responses API** にのみ存在します（そのためウェブ検索サーバーツール列は「Responses API のみ」です）。クライアントは引き続き **OpenAI Chat Completions** の面で CCRelay を指定できます。プロバイダーの `baseUrl` に **Azure OpenAI** を設定したあと、ウェブ検索サーバーツールを含む Chat 形式の呼び出しは、**変換レイヤーで** アップストリームの **Responses** リクエストへ書き換えられるため、検索は動作し続けます。クライアント自身が `/v1/responses` を呼ぶ必要はありません。

| プロバイダー（対象ホスト）                                             | Anthropic `/v1/messages` | OpenAI `/chat/completions` | OpenAI `/v1/responses` | ウェブ検索サーバーツール |
| ---------------------------------------------------------------------- | ------------------------ | -------------------------- | ---------------------- | ------------------------ |
| **Z.ai GLM**（`api.z.ai`、`open.bigmodel.cn`）                         | 対応                     | 対応                       | 非対応                 | Anthropic エンドポイントのみ |
| **Xiaomi MiMo**（`api.xiaomimimo.com`）                                | 対応                     | 対応                       | 非対応                 | Chat のみ                |
| **MiniMax**（`api.minimax.io`、`api.minimaxi.com`）                    | 対応                     | 対応                       | 非対応                 | 非対応                   |
| **Google Gemini**（OpenAI 互換、`generativelanguage.googleapis.com`）  | 非対応                   | 対応                       | 非対応                 | 非対応                   |
| **Azure OpenAI**（`*.cognitiveservices.azure.com`）                    | 非対応                   | 対応                       | 対応                   | Responses API のみ       |
| _その他のホスト_                                                       | _場合による_             | _場合による_               | _場合による_           | 汎用変換のみ             |

**スクリーンショット（CCRelay 経由の Claude Code）**

![Claude Code — GLM のウェブ検索サーバーツール](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-claude-glm-web-search.webp)

![Claude Code — Xiaomi MiMo のウェブ検索サーバーツール](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-claude-xiaomi-mimo-web-search.webp)

---

## インストール

### デスクトップアプリ（推奨）

- [GitHub Releases](https://github.com/inflaborg/ccrelay/releases/latest) からダウンロードします:
  - **macOS**: `CCRelay-<version>-darwin-arm64.dmg`（Apple Silicon）または `-darwin-x64.dmg`（Intel）
  - **Windows**: `CCRelay-<version>-win32-x64.exe` または `-win32-arm64.exe`
- アプリはトレイ（macOS ではメニューバー）に常駐します。トレイ → **ダッシュボードを開く** でダッシュボードを開きます。**ログフォルダを開く** で `~/.ccrelay/logs/` 配下の実行時診断を開きます。
- 更新は起動の約 15 秒後に確認され、その後 24 時間ごとに確認されます。トレイ → **アップデートを確認…** はすぐに確認します。確認すると更新をダウンロードしてアプリを再起動します。
- トレイ → **アップデートチャンネル** で **Stable** と **Dev** のビルドを切り替えます。
- デスクトップアプリは、VS Code 拡張機能と `~/.ccrelay/` の設定および実行中のプロキシを共有します。

### VS Code 拡張機能

- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=infLab.ccrelay-vscode) または [Open VSX](https://open-vsx.org/extension/infLab/ccrelay-vscode) から **CCRelay** をインストールするか、[Releases](https://github.com/inflaborg/ccrelay/releases) から `.vsix` をダウンロードして `Extensions: Install from VSIX...` を実行します。
- VS Code 1.80.0 以降が必要です。
- CCRelay のステータスバー項目または `CCRelay: Switch Provider` でプロバイダーを切り替えます。ダッシュボードは `CCRelay: Open Dashboard` で開きます。

### ソースからビルド

```bash
git clone https://github.com/inflaborg/ccrelay.git
cd ccrelay
npm install
npm run build
npm run package        # dists/ccrelay-vscode-*.vsix を生成します
```

デスクトップのビルド: [開発](#開発) を参照してください。

### Tauri ビルド（実験的）

より軽量な Tauri デスクトップ版（`packages/desktop-tauri`）は、同梱の Node.js ランタイムで同じコアを実行します。現在のリリースには Tauri インストーラーは含まれていません。Node.js 22 でソースからビルドします:

```bash
npm install
npm run tauri:dev         # Web UI と Node サイドカーをビルドしてから Tauri の開発モードを実行します
npm run tauri:pack:mac    # 本番用 macOS インストーラー
npm run tauri:pack:win    # 本番用 Windows インストーラー
```

---

## 手動設定

ダッシュボードの内容はすべて `~/.ccrelay/config.yaml` に保存されます。ファイル編集を好む場合は次の手順を使います。

### 1. プロバイダーを追加する

`~/.ccrelay/config.yaml` を編集します（初回起動時に自動作成されます）:

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

### 2. Claude Code を CCRelay に向ける

`~/.claude/settings.json` に追加します:

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

任意のティア別モデル名 — Claude Code のデフォルトを上書きしたい場合のみ必要です:

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

Web ダッシュボードの **クライアント設定** タブからも設定できます。

### 3. プロバイダーを切り替える

- デスクトップアプリまたはダッシュボード: **プロバイダー** でプロバイダーカードを選び、**適用** をクリックします
- VS Code: CCRelay のステータスバー項目をクリックするか、`CCRelay: Switch Provider` を実行します
- ファイル: `config.yaml` の `defaultProvider` を変更します（自動で読み込まれます）

---

## クライアント連携

CCRelay は同じポート（デフォルト **7575**）で **Anthropic** と **OpenAI** の両方に互換なルートを公開します。URL プレフィックスでプロトコルを選びます:

| クライアント                             | プロトコル | ベース URL                        |
| ---------------------------------------- | ---------- | --------------------------------- |
| **Claude Code**                          | Anthropic  | `http://127.0.0.1:7575/anthropic` |
| **Claude Desktop**（サードパーティ推論 / Cowork） | Anthropic  | `http://127.0.0.1:7575/anthropic` |
| **Codex CLI / ChatGPT デスクトップアプリ** | OpenAI     | `http://127.0.0.1:7575/openai`    |

`http://127.0.0.1:7575` を直接指定した場合、従来の `/v1/...` パスも引き続き動作します。

### Claude Code

**クライアント設定 → Claude Code → 適用** を使うか、`~/.claude/settings.json` の項目については [手動設定](#手動設定) を参照してください。

クイックテスト（現在のシェルのみ）:

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:7575/anthropic
claude
```

### Claude Desktop（サードパーティ推論と Cowork）

**クライアント設定 → Claude Desktop → 適用**（macOS と Windows）は、Claude Desktop を CCRelay 経由のサードパーティ推論に切り替えます。ゲートウェイ URL は `http://127.0.0.1:7575/anthropic`、プレースホルダーの API キー、および `x-ccrelay-model-alias` ヘッダーです。その後 Claude Desktop を再起動します。**復元** は Claude Desktop をファーストパーティモードに戻します。

手で設定するには、Claude Desktop で **サードパーティ推論を設定** を開き、上記のゲートウェイ URL を設定し、任意の API キーを入力して `x-ccrelay-model-alias` ヘッダーを追加します。サードパーティのモデル名には Claude 形式のエイリアスが必要です。[Claude Desktop / Cowork のモデル ID 制限](#claude-desktop--cowork-のモデル-id-制限) を参照してください。

### Codex CLI と ChatGPT デスクトップアプリ

Codex CLI と ChatGPT デスクトップアプリ（ChatGPT Work と Codex の両方）は、同じ `~/.codex/config.toml` を読みます。**クライアント設定 → Codex → 適用** を使うか、自分でファイルを作成します:

```toml
model = "gpt-5.4-mini"
model_provider = "ccrelay"
model_catalog_json = "ccrelay-model-catalog.json"

[model_providers.ccrelay]
name = "CCRelay"
base_url = "http://localhost:7575/openai"
```

適用は `~/.codex/ccrelay-model-catalog.json` を書き込み、Codex の `/model` がモデルを一覧できるようにします。カタログは **アクティブなプロバイダー** のカスタムモデル（または完全一致の `modelMap` エントリ）から作られます。スマートルーティングがオンのときは、全プロバイダーのルーティング対象モデルを一覧します。各エントリは推論レベル low、medium、high、xhigh を通知し、デフォルトは high です。`model` をそれらの id のいずれかに設定します。適用後またはプロバイダー切り替え後は、カタログを再読み込みするため Codex CLI または ChatGPT デスクトップアプリを再起動します。レベルは `config.toml` の `model_reasoning_effort` または `/model` で上書きします。

---

## 使い方

### マルチインスタンスモード

複数の VS Code ウィンドウが開いている場合:

- 1 つのインスタンスが **Leader** になり HTTP サーバーを実行します。ほかは **Follower** です
- Leader は WebSocket 経由でプロバイダーの変更を Follower に配信します
- Leader が終了すると、Follower が自動的に引き継ぎます
- ステータスバーに役割が表示されます: `$(broadcast)` = Leader、`$(radio-tower)` = Follower

**ログ**: リクエストログを永続化するのは Leader だけです。Follower はログ API 呼び出しを Leader にプロキシします。Leader に到達できない場合、それらの呼び出しは 503 を返します。

**IPC ロック**（Unix / macOS では `~/.ccrelay/ccrelay-lock.sock`、Windows では名前付きパイプ）が、VS Code とデスクトップアプリの間で Leader の選出を調整します。

### プロバイダーモード

| モード        | 認証の動作                          | 用途                                          |
| ------------- | ----------------------------------- | --------------------------------------------- |
| `passthrough` | 元の認証ヘッダーを保持する          | OAuth 付きの公式 Claude API                   |
| `inject`      | 認証をプロバイダーの API キーに置き換える | サードパーティのプロバイダー（GLM、OpenRouter など） |

### モデルマッピング

ワイルドカード対応で、Claude のモデル名をプロバイダー固有のモデルに対応付けます:

```yaml
modelMap:
  - pattern: "claude-opus-*"
    model: "glm-5"
  - pattern: "claude-sonnet-*"
    model: "glm-4.7"
```

**ビジョンモデルのマッピング** — マルチモーダルリクエスト用の別マッピング:

```yaml
vlModelMap:
  - pattern: "claude-*"
    model: "vision-model"
```

`modelMap` はリクエストボディ（`model` フィールド）にのみ適用されます。`GET /models` のレスポンスは書き換えられません。

### Claude Desktop / Cowork のモデル ID 制限

Claude Desktop 1.7196.0 以降、クライアントは `qwen`、`glm`、`kimi`、`deepseek` などのサードパーティキーワードを含むモデル ID を拒否します。サードパーティのアップストリームモデルを使う場合は、Cowork のみ `claude-` プレフィックスのエイリアスに対応付けます。

エイリアスは `claude-` のあとに **追加のハイフンを含まない** 単一トークンが続く必要があります（例: `claude-a1b2c3d4`。`claude-my-model` は不可）。複数ハイフンの名前は Anthropic のモデルバージョンとして解釈されるためです。

正規エイリアス id（ウィザード、Cowork ヘルパー、スマートルーティング）は `claude-{8 hex}` です。`SHA1(providerId:protocol:upstreamModelId)` を 8 桁の 16 進に切り詰め、`smartRouting.aliasPrefix`（デフォルト `claude-`）を前置します。同じアップストリームモデルでも、プロバイダーまたはプロトコルが異なればエイリアスは異なります。

**カスタムモデル一覧**（`customModelsList`）: 各行は `realModelId;displayName;alias` です（表示名が実 id と同じときは `realModelId;;alias`）。実 id はアップストリームが期待する値です。`alias` は Cowork で安全な id です。

**Cowork**: Claude Desktop で、カスタムリクエストヘッダー `x-ccrelay-model-alias` に任意の値（たとえば `1`）を追加します。このヘッダーがあると、`GET /models` と `GET /models/{id}` は通信上の `id` として **エイリアス** を返します。ヘッダーがないと同じ一覧は **実** モデル id を返します（ほかのクライアント用）。

**モデルマッピング**（`modelMap`）: 自動生成されるエントリには、エイリアスルール、同一性ルール（`realId` → `realId`）、Claude ファミリーのワイルドカード（`claude-haiku-*` / `claude-sonnet-*` / `claude-opus-*`）、およびデフォルトの `claude-*` / `gpt-*` キャッチオールが含まれます。同一性ルールにより、実モデル id を送るクライアントがワイルドカードで誤って振り分けられることを防ぎます。

**例** -- GLM モデルが 2 つ。Cowork は上記ヘッダー経由でエイリアスを使います:

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

この設定では:

- `x-ccrelay-model-alias` **なし**: `GET /models` は `glm-5.1` と `glm-4.7` を返します（表示名が id と異なる場合は表示名付き）。
- `x-ccrelay-model-alias` **あり**: `GET /models` は正規エイリアス id を通信上の `id` として返します。Cowork はそれらを選択し、CCRelay は `modelMap` で実アップストリーム id に対応付けます。
- `claude-haiku-*` / `claude-sonnet-*` / `claude-opus-*` のファミリーワイルドカードは、デフォルトでそれらの Claude モデルを最初のカスタムモデルへ振り分けます（クイック入力ではファミリーごとに別の対象を選べます）。
- `claude-*` と `gpt-*` のワイルドカードは、クライアントが送る可能性のあるほかのモデル名を受け、最初のモデルへ振り分けます。

組み込みウィザードと Cowork のクイック入力ヘルパーは、上記の正規ハッシュを使って `realId;displayName;claude-{hash}` 行と対応する `modelMap` エントリを生成します。Cowork では Claude Desktop に `x-ccrelay-model-alias` を追加し、ほかでは付けません。手動編集のあと、プロバイダーエディターの **モデルマップを再構築** で `customModelsList` から `modelMap` を完全に再構築します（それらのモデルがまだ存在するとき、Claude ファミリーのワイルドカード対象は保持されます。`gpt-*-mini` のようなほかのカスタムワイルドカードルールは保持されません）。

#### カスタムモデル一覧の設定 UI

![カスタムモデル一覧](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/provider-custom-model-1.webp)

**カスタムモデルをクイック入力** でアップストリームのモデル ID と表示名を入力し、必要なら `claude-haiku-*` / `claude-sonnet-*` / `claude-opus-*` を一覧内のモデルに対応付けます（デフォルトは最初のモデル）。カスタムモデル一覧とモデルマップは自動生成されます。

![カスタムモデルのクイック入力](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/provider-custom-model-2.webp)

#### Claude Cowork でエイリアスを有効にする

Claude Desktop の **サードパーティ推論を設定** パネルで、**ゲートウェイの追加ヘッダー** に `x-ccrelay-model-alias` を追加すると、モデル一覧は実 ID ではなくエイリアスを返します。

![Cowork のゲートウェイ追加ヘッダー](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/cowork-ccrelay-model-alias.webp)

### OpenAI 形式の変換

CCRelay は 3 つの受信プロトコルを受け付け、アップストリームのプロバイダーが別の通信形式を話すときに変換します:

| 受信パス                                           | クライアントのプロトコル |
| -------------------------------------------------- | ------------------------ |
| `/v1/messages`、`/anthropic/v1/messages`           | Anthropic Messages       |
| `/v1/chat/completions`、`/openai/chat/completions` | OpenAI Chat Completions  |
| `/v1/responses`                                    | OpenAI Responses API     |
| `/v1/models`、`/openai/models`                     | OpenAI モデル一覧        |
| `/anthropic/v1/models`                             | Anthropic モデル一覧     |

**変換ルール**:

- 両側が同じ系統（例: Chat + `openai` プロバイダー）→ パススルー（モデルマッピングと認証は引き続き適用されます）
- 系統をまたぐ → Chat Completions ハブ経由でリクエスト／レスポンスボディを変換します
- `GET /models` → 入口パスと `providerType` が一致しないときに一覧形式を変換します。アップストリームのエラーはそのまま転送します

**ストリーミングの制限**:

- プロトコルをまたぐパスは、変換のため `stream: false` を強制します。クライアントが `stream: true` を送った場合、CCRelay はクライアント SDK が完了できる最小の SSE エンベロープを合成します。モデル出力はトークン単位ではなく、最終ペイロードに届きます。
- 同じ系統のストリーミングは通常どおり通過します。

**例: OpenAI 互換プロバイダー（Gemini）**

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

### Web UI ダッシュボード

組み込みの Web ダッシュボードは、コマンドパレット → `CCRelay: Open Dashboard`（VS Code）、またはトレイメニュー → **ダッシュボードを開く**（デスクトップアプリ）から開けます。

- **ダッシュボード** — サーバー状態、現在のプロバイダー、トークン使用量、性能指標（TTFB、P50/P90 レイテンシ、出力 TPS）と時間範囲の選択
- **スマートルーティング** — 全プロバイダーのモデル一覧を集約します。統一された `/v1/models` は `<providerId>:<modelId>` 形式の id です。モデルに応じて各リクエストを一致するプロバイダーへ振り分けます（モデルを変えるときにプロバイダー切り替えやクライアント再起動は不要です）
- **プロバイダー** — アップストリーム接続を設定します。カードをクリックして選択し、適用で切り替えます。**選択** でエクスポートまたは削除します
- **機能** — 任意のウェブ検索バックエンド（**Tavily** および／または **Parallel**）: API キー、デフォルトのバックエンド、どのプロバイダーがウェブ検索にローカルで応答するか
- **ログ** — トークン列、TTFB、出力 TPS、モデルマッピング付きのリクエスト／レスポンスログビューア。行を複数選択して、id ごとのフォルダ（JSON、ヘッダー、分析 markdown）の zip をエクスポートします。ログが無効のときは非表示です
- **設定** — UI で YAML 設定を管理します。ルーティングと同時実行は保存時にホットリロードされます。サーバーとログの変更は再起動が必要です
- **クライアント設定** — UI から Claude Code の環境変数と Codex の設定を書き込みます。インストール済みの Claude Desktop claude-code バンドルのバージョンと Claude Code CLI のバージョンを表示します（`claude --version`。ページ上で無効にできます）

> **注意**: ブラウザで `http://127.0.0.1:7575/ccrelay/` を直接開いてもダッシュボードにはアクセスできません。アクセスは、内部ヘッダーを付ける VS Code 拡張機能またはデスクトップアプリからのリクエストに限られます。拡張機能のコマンドまたはデスクトップのトレイメニューからダッシュボードを開いてください。

**Web UI**

![クライアント設定](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-ccrelay-setup-1.webp)

![デフォルトモデルの設定](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-ccrelay-setup-2.webp)

![機能 — Tavily ウェブ検索](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-capabilities-websearch-tavily.webp)

![リクエストログ](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-ccrelay-1.webp)

![ログの詳細](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-ccrelay-3.webp)

**デスクトップアプリ**

![デスクトップ — ダッシュボード](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-desktop-1.webp)

![デスクトップ — プロバイダー一覧](https://raw.githubusercontent.com/inflaborg/ccrelay/main/docs/screenshot-desktop-2.webp)

---

## 設定

CCRelay は `~/.ccrelay/config.yaml` を使います（初回起動時に自動作成されます）。起動時に同梱のデフォルトがファイルとマージされます。**書いた値が常に優先** され、欠けているキーはデフォルトで埋められます。リストの節（`routing.forward`、`routing.block`、`concurrency.routes`）は識別キーでマージされ、あなたの行が先、新しいデフォルトが後に追加されます。リストを省略するとデフォルト全体を継承します。意図的に空にするには `[]` を設定します。

> YAML 設定は `camelCase` と `snake_case` の両方のキーに対応します。

### サーバー

| 設定               | デフォルト  | 説明                                                                 |
| ------------------ | ----------- | -------------------------------------------------------------------- |
| `server.port`      | `7575`      | プロキシサーバーのポート                                             |
| `server.host`      | `127.0.0.1` | バインドアドレス                                                     |
| `server.autoStart` | `true`      | 拡張機能の読み込み時にサーバーを自動起動する                         |
| `server.locale`    | `""`        | Web UI の言語（`"en"`、`"zh"`、`"ja"`、`"ko"`）。未設定の場合、初回アクセス時に選択画面を表示します。 |

### プロバイダー

| 設定              | デフォルト | 説明                         |
| ----------------- | ---------- | ---------------------------- |
| `defaultProvider` | `official` | デフォルトのプロバイダー ID  |
| `providers`       | `{...}`    | プロバイダーのマップ（下記） |

各プロバイダーがサポートする項目:

| フィールド     | デフォルト        | 説明                                                                                         |
| -------------- | ----------------- | -------------------------------------------------------------------------------------------- |
| `name`         | —                 | 表示名                                                                                       |
| `baseUrl`      | —                 | API のベース URL                                                                             |
| `mode`         | `"passthrough"`   | `passthrough`（認証を保持）または `inject`（認証を置き換え）                                 |
| `providerType` | `"anthropic"`     | `"anthropic"`、`"openai"`（完全パススルー）、または `"openai_chat"`（Chat Completions のみ） |
| `openaiCompat` | —                 | 任意。カスタムドメインで Azure Chat の整形をするには `azure_openai` を設定します（公式の `*.cognitiveservices.azure.com` は自動検出されます） |
| `apiKey`       | —                 | inject モード用の API キー。`${ENV_VAR}` に対応します。                                      |
| `authHeader`   | `"authorization"` | 認証ヘッダー名                                                                               |
| `modelMap`     | —                 | モデル名のマッピング（`[{pattern, model}]`、ワイルドカード対応）                             |
| `vlModelMap`   | —                 | ビジョンモデルのマッピング（マルチモーダルリクエスト用）                                     |
| `headers`      | —                 | カスタムリクエストヘッダー                                                                   |
| `enabled`      | `true`            | 有効／無効                                                                                   |

### スマートルーティング

**プロバイダー** タブ（上部のカード）で **スマートルーティング** を有効にします。有効な全プロバイダーのモデル一覧を集約し、モデル id に応じて各リクエストを一致するプロバイダーへ振り分けます。スマートルーティングと単一のフォールバックプロバイダーは **同時には使えません**。スマートルーティングが有効なとき、プロバイダーカードは使用中と表示されません。プロバイダーカードを選んで適用すると、そのプロバイダーを使い、スマートルーティングは無効になります。

設定は **スマートルーティング** タブで行います（エイリアスプレフィックス、プレフィックスなしモデル id のフォールバック、除外リスト、カスタムルーティングルール、集約モデル表）。

| 設定                                  | デフォルト      | 説明                                                                                                      |
| ------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------- |
| `smartRouting.enabled`                | `false`         | プロバイダータブで有効にします。プロバイダーのモデルを集約し、`<providerId>:<modelId>` で振り分けます     |
| `smartRouting.aliasPrefix`            | `"claude-"`     | クライアントが `x-ccrelay-model-alias` を送るときの正規エイリアス id（`claude-{8 hex}`）のプレフィックス   |
| `smartRouting.exclude`                | —               | `/v1/models` から外し、振り分けない公開モデル id のワイルドカード一覧。除外 id を使うリクエストは拒否されます |
| `smartRouting.include`                | —               | 設定すると、一致する公開 id だけを公開します（exclude とは同時に使えません）                              |
| `smartRouting.modelsCache.ttlSeconds` | `600`           | カスタム以外のプロバイダー向け、アップストリームのモデル一覧キャッシュ TTL                                |
| `smartRouting.bareModelFallback.mode` | `first-match`   | クライアントがプレフィックスなしのモデル id を送ったとき、YAML 順で最初に一致したプロバイダーに合わせるか拒否します |
| `smartRouting.modelRules`             | —               | カタログより前に照合するカスタムルール（`pattern`、`provider`、`model`）。`/v1/models` には出ません       |

### ルーティング

| 設定              | デフォルト                             | 説明                                                                                                                       |
| ----------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `configVersion`   | `"0.2.5"`                              | 設定スキーマのバージョン。古い設定は起動時に自動アップグレードされます。                                                   |
| `routing.forward` | `[{path, provider}]`                   | 転送ルール — 最初の一致が優先されます。`provider: "auto"` = 現在のプロバイダー。未一致 → 404。                             |
| `routing.block`   | `[{path, response, code, condition?}]` | ブロックルール — カスタムレスポンスを返します。任意の `condition.providers`（許可リスト）と `condition.providerNot`（除外リスト）。 |

### 同時実行

| 設定                         | デフォルト | 説明                                 |
| ---------------------------- | ---------- | ------------------------------------ |
| `concurrency.enabled`        | `true`     | リクエストキューを有効にする         |
| `concurrency.maxWorkers`     | `3`        | 同時リクエストの最大数               |
| `concurrency.maxQueueSize`   | `100`      | キューに入れられる最大数（0 = 無制限） |
| `concurrency.requestTimeout` | `0`        | キューのタイムアウト（秒。0 = 無制限） |
| `concurrency.routes`         | `[]`       | ルートごとのキュー設定（`pattern` 単位） |

### ログ

| 設定                     | デフォルト | 説明                                                                                             |
| ------------------------ | ---------- | ------------------------------------------------------------------------------------------------ |
| `logging.storeBodies`    | `true`     | ログタブにリクエスト／レスポンスのボディを保存します。トークンと性能指標は別に記録されます       |
| `logging.database.type`  | `"sqlite"` | `"sqlite"` または `"postgres"`                                                                   |

`logging.enabled` は非推奨です。`storeBodies` が未設定の場合、フォールバックとして `enabled` が使われます。

**SQLite:**

| 設定                                  | デフォルト | 説明                                               |
| ------------------------------------- | ---------- | -------------------------------------------------- |
| `logging.database.path`               | `""`       | DB ファイルのパス（空 = `~/.ccrelay/logs.db`）     |
| `logging.database.sqlite3_executable` | `""`       | `sqlite3` バイナリのパス（空 = `PATH` から解決）   |

`sqlite3` を解決できない場合、プロキシはログを永続化せずに動作します（ログに警告が出ます）。

**PostgreSQL:**

| 設定                        | デフォルト  | 説明                         |
| --------------------------- | ----------- | ---------------------------- |
| `logging.database.host`     | `localhost` | サーバーホスト               |
| `logging.database.port`     | `5432`      | サーバーポート               |
| `logging.database.name`     | `ccrelay`   | データベース名               |
| `logging.database.user`     | `""`        | ユーザー名                   |
| `logging.database.password` | `""`        | パスワード（`${ENV_VAR}` 対応） |
| `logging.database.ssl`      | `false`     | SSL を有効にする             |

### 外部ウェブ検索

選択したプロバイダーに対する、Anthropic 形式の **ウェブ検索**（サーバーツール）リクエストの任意の **ローカル処理** です。CCRelay は **[Tavily](https://tavily.com/)** または **[Parallel](https://parallel.ai/)** でライブ検索を実行し、そのターンの合成されたアシスタント応答を返すため、アップストリームのチャットモデル自身がツールを実装する必要はありません。

| 設定                             | 説明                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| `webSearch.enabled`              | マスタースイッチ（`true` / `false`）。省略したとき、空でない `providers` はオンを意味します。 |
| `webSearch.providers`            | ウェブ検索に割り当てるプロバイダー ID（`providers:` 配下のキー）。無効時も保持されます。 |
| `webSearch.defaultSearchBackend` | 任意: `tavily` または `parallel`（リクエストごとに推定されないときのデフォルト）。    |

#### Tavily

| 設定                           | 説明                                          |
| ------------------------------ | --------------------------------------------- |
| `webSearch.tavily.apiKey`      | Tavily の API キー。`${ENV_VAR}` に対応します。 |
| `webSearch.tavily.searchDepth` | `basic` または `advanced`（任意）。           |
| `webSearch.tavily.maxResults`  | 結果数、1–10（任意）。                        |

#### Parallel

| 設定                               | 説明                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------- |
| `webSearch.parallel.apiKey`        | Parallel の API キー。`${ENV_VAR}` に対応します。                                             |
| `webSearch.parallel.mode`          | `turbo`、`basic`、または `advanced`（任意。デフォルトは `basic`）。                           |
| `webSearch.parallel.maxResults`    | 結果数、1–10（任意）。                                                                        |
| `webSearch.parallel.publishedAfter` | 新しさフィルター用の任意の RFC 3339 日付（`YYYY-MM-DD`）。                                   |
| `webSearch.parallel.location`      | 地域ターゲット: 任意の ISO 3166-1 alpha-2 コード（例: `us`、`cn`、`gb`）。省略すると自動。Parallel が未対応のコードは無視されることがあります。 |
| `webSearch.parallel.includeDomains` | 任意のドメイン許可リスト（YAML 配列）。                                                      |
| `webSearch.parallel.excludeDomains` | 任意のドメイン拒否リスト（YAML 配列）。                                                      |
| `webSearch.parallel.liveFetch`     | 任意: キャッシュが古いときにライブ取得を有効にします（レイテンシは高くなります）。            |
| `webSearch.parallel.maxCharsPerResult` | 任意の、結果 URL ごとの抜粋サイズ上限。                                                   |

トップレベルのキーは `webSearch` の代わりに `web_search` も使えます（ネストの形は同じです）。

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

`enabled: false` にすると、`providers` のプリセット一覧を消さずにウェブ検索をオフにできます。

同じ項目はダッシュボードの **機能** タブから編集できます。

### 完全な例

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

## API エンドポイント

`/ccrelay/` の管理エンドポイント:

| エンドポイント                  | メソッド   | 説明                           |
| ------------------------------- | ---------- | ------------------------------ |
| `/ccrelay/api/status`           | GET        | プロキシの状態                 |
| `/ccrelay/api/providers`        | GET        | プロバイダーの一覧             |
| `/ccrelay/api/switch/{id}`      | GET        | プロバイダーへ切り替え         |
| `/ccrelay/api/switch`           | POST       | プロバイダーを切り替え（JSON ボディ） |
| `/ccrelay/api/providers/export` | POST       | ID でプロバイダーをエクスポート |
| `/ccrelay/api/providers/import` | POST       | プロバイダーをインポート（ID でマージ） |
| `/ccrelay/api/queue`            | GET        | キューの統計                   |
| `/ccrelay/api/logs`             | GET        | リクエストログ                 |
| `/ccrelay/api/config`           | GET, PATCH | 設定の節を読み書き             |
| `/ccrelay/ws`                   | WebSocket  | Follower の同期                |
| `/ccrelay/`                     | GET        | Web UI ダッシュボード          |

それ以外のリクエストは、現在のプロバイダーへプロキシされます。

---

## コマンド

| コマンド                 | ID                       | 説明               |
| ------------------------ | ------------------------ | ------------------ |
| CCRelay: Show Menu       | `ccrelay.showMenu`       | メインメニューを表示 |
| CCRelay: Switch Provider | `ccrelay.switchProvider` | プロバイダー選択   |
| CCRelay: Start Server    | `ccrelay.startServer`    | サーバーを起動     |
| CCRelay: Stop Server     | `ccrelay.stopServer`     | サーバーを停止     |
| CCRelay: Open Settings   | `ccrelay.openSettings`   | 拡張機能の設定     |
| CCRelay: Show Logs       | `ccrelay.showLogs`       | 出力ログ           |
| CCRelay: Clear Logs      | `ccrelay.clearLogs`      | 出力ログを消去     |
| CCRelay: Open Dashboard  | `ccrelay.openWebUI`      | Web ダッシュボード |

---

## 開発

```bash
npm run compile        # 型チェック
npm run watch          # 監視して再コンパイル
npm run lint           # Lint
npm run format         # フォーマット
npm run test           # ユニットテスト
npm run test:integration
npm run test:all
npm run test:coverage
npm run package        # VSIX をビルド
npm run build:dev      # 開発ビルド
npm run build:prod     # 本番ビルド

# Electron デスクトップアプリ
npm run desktop:start
npm run desktop:pack:mac
npm run desktop:pack:win

# Tauri デスクトップアプリ
npm run tauri:dev
npm run tauri:pack:mac
npm run tauri:pack:win
```

### プロジェクト構成

```
ccrelay/
├── packages/
│   ├── core/              # 共有ランタイム（プロキシ、設定、コンバーター）
│   ├── vscode/            # VS Code 拡張機能
│   ├── desktop/           # Electron デスクトップアプリ
│   └── desktop-tauri/     # Tauri デスクトップアプリ
├── web/                   # Web UI（React + Vite）
├── tests/                 # Vitest のユニットテストと統合テスト
├── scripts/               # ビルドとパッケージの補助
└── dists/                 # パッケージされた .vsix
```

---

## ファイルの場所

| ファイル | 場所                                                     | 説明                       |
| -------- | -------------------------------------------------------- | -------------------------- |
| 設定     | `~/.ccrelay/config.yaml`                                 | メイン設定（自動作成）     |
| 状態     | `~/.ccrelay/state.json`                                  | アクティブなプロバイダー ID |
| IPC ロック | `~/.ccrelay/ccrelay-lock.sock`（Unix）/ 名前付きパイプ（Win） | Leader の選出          |
| ログ DB  | `~/.ccrelay/logs.db`                                     | リクエストログ（Leader のみ） |

---

## 貢献

Issue と Pull Request を歓迎します。

---

## 謝辞

CCRelay は AI コーディングアシスタント（[Cursor](https://cursor.com) と
[Claude Code](https://claude.ai/code)）を使って開発され、モデルバックエンドとして [GLM](https://z.ai/model-api) と
[Xiaomi MiMo](https://platform.xiaomimimo.com/token-plan) を使っています。
メンテナーがすべてのリリースを設計し、レビューし、テストします。

---

## ライセンス

[MIT ライセンス](LICENSE)

著作権 (c) 2026 [infLab](https://github.com/inflaborg)
