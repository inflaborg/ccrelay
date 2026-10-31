/**
 * Localized strings for the Electron tray / context menu.
 * Kept separate from the web i18n bundle (main process cannot import it).
 */

export type TrayLocale = "en" | "zh" | "ja" | "ko";

export function resolveTrayLocale(value: string | undefined): TrayLocale {
  if (value === "zh" || value === "ja" || value === "ko") {
    return value;
  }
  return "en";
}

type TrayStrings = {
  stopped: string;
  providerPrefix: string;
  smartRouting: string;
  na: string;
  openDashboard: string;
  checkForUpdates: string;
  updateUnavailableTooltip: string;
  updateChannel: string;
  updateChannelUnavailableTooltip: string;
  channelStable: string;
  channelDev: string;
  startServer: string;
  stopServer: string;
  switchProvider: string;
  openAtLogin: string;
  openConfigFile: string;
  openLogsFolder: string;
  quit: string;
  tooltipStopped: string;
  portConflictTitle: string;
  /** `{port}` and `{pid}` are substituted; `{pid}` becomes " (PID n)" or "". */
  portConflictBody: string;
};

const STRINGS: Record<TrayLocale, TrayStrings> = {
  en: {
    stopped: "Stopped",
    providerPrefix: "Provider",
    smartRouting: "Smart Routing",
    na: "N/A",
    openDashboard: "Open Dashboard",
    checkForUpdates: "Check for Updates…",
    updateUnavailableTooltip: "Auto-update is only available in packaged builds",
    updateChannel: "Update Channel",
    updateChannelUnavailableTooltip: "Update channel is only available in packaged builds",
    channelStable: "Stable",
    channelDev: "Dev",
    startServer: "Start Server",
    stopServer: "Stop Server",
    switchProvider: "Switch Provider",
    openAtLogin: "Open at Login",
    openConfigFile: "Open Config File",
    openLogsFolder: "Open Logs Folder",
    quit: "Quit",
    tooltipStopped: "stopped",
    portConflictTitle: "CCRelay cannot start",
    portConflictBody:
      "Port {port} is held by a process{pid} that does not answer HTTP. Free the port and restart CCRelay.",
  },
  zh: {
    stopped: "已停止",
    providerPrefix: "提供商",
    smartRouting: "智能路由",
    na: "无",
    openDashboard: "打开仪表盘",
    checkForUpdates: "检查更新…",
    updateUnavailableTooltip: "自动更新仅在打包后的应用中可用",
    updateChannel: "更新通道",
    updateChannelUnavailableTooltip: "更新通道仅在打包后的应用中可用",
    channelStable: "Stable",
    channelDev: "Dev",
    startServer: "启动服务器",
    stopServer: "停止服务器",
    switchProvider: "切换提供商",
    openAtLogin: "开机时启动",
    openConfigFile: "打开配置文件",
    openLogsFolder: "打开日志文件夹",
    quit: "退出",
    tooltipStopped: "已停止",
    portConflictTitle: "CCRelay 无法启动",
    portConflictBody: "端口 {port} 被一个无响应的进程{pid}占用。请释放端口后重启 CCRelay。",
  },
  ja: {
    stopped: "停止",
    providerPrefix: "プロバイダー",
    smartRouting: "スマートルーティング",
    na: "なし",
    openDashboard: "ダッシュボードを開く",
    checkForUpdates: "アップデートを確認…",
    updateUnavailableTooltip: "自動アップデートはパッケージ版でのみ利用できます",
    updateChannel: "アップデートチャンネル",
    updateChannelUnavailableTooltip: "アップデートチャンネルはパッケージ版でのみ利用できます",
    channelStable: "Stable",
    channelDev: "Dev",
    startServer: "サーバーを起動",
    stopServer: "サーバーを停止",
    switchProvider: "プロバイダーを切り替え",
    openAtLogin: "ログイン時に開く",
    openConfigFile: "設定ファイルを開く",
    openLogsFolder: "ログフォルダを開く",
    quit: "終了",
    tooltipStopped: "停止中",
    portConflictTitle: "CCRelay を起動できません",
    portConflictBody:
      "ポート {port} は HTTP に応答しないプロセス{pid}に占有されています。ポートを解放して CCRelay を再起動してください。",
  },
  ko: {
    stopped: "중지됨",
    providerPrefix: "제공자",
    smartRouting: "스마트 라우팅",
    na: "없음",
    openDashboard: "대시보드 열기",
    checkForUpdates: "업데이트 확인…",
    updateUnavailableTooltip: "자동 업데이트는 패키지된 빌드에서만 사용할 수 있습니다",
    updateChannel: "업데이트 채널",
    updateChannelUnavailableTooltip: "업데이트 채널은 패키지된 빌드에서만 사용할 수 있습니다",
    channelStable: "Stable",
    channelDev: "Dev",
    startServer: "서버 시작",
    stopServer: "서버 중지",
    switchProvider: "제공자 전환",
    openAtLogin: "로그인 시 열기",
    openConfigFile: "설정 파일 열기",
    openLogsFolder: "로그 폴더 열기",
    quit: "종료",
    tooltipStopped: "중지됨",
    portConflictTitle: "CCRelay를 시작할 수 없음",
    portConflictBody:
      "포트 {port}가 HTTP에 응답하지 않는 프로세스{pid}에 의해 사용 중입니다. 포트를 해제한 뒤 CCRelay를 다시 시작하세요.",
  },
};

export function trayStrings(locale: TrayLocale): TrayStrings {
  return STRINGS[locale];
}

export function roleLabel(role: string, running: boolean, locale: TrayLocale): string {
  if (!running) {
    return STRINGS[locale].stopped;
  }
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function channelLabel(channel: "prod" | "dev", locale: TrayLocale): string {
  const t = STRINGS[locale];
  return channel === "prod" ? t.channelStable : t.channelDev;
}
