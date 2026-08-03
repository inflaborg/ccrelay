/**
 * System tray UI for CCRelay desktop
 */

import { Tray, Menu, shell, nativeImage, app } from "electron";
import * as path from "path";
import { getLogDir, type ConfigManager, type ProxyServer } from "@ccrelay/core";
import { setOpenAtLogin, getOpenAtLogin } from "./autoLaunch";
import { getUpdateChannel, requestUpdateCheck, setUpdateChannel } from "./autoUpdate";
import { type UpdateChannel } from "./updateChannel";
import { showDashboardWindow, updateDashboardInjectConfig } from "./window";
import { channelLabel, resolveTrayLocale, roleLabel, trayStrings } from "./trayI18n";

/** macOS tray uses template (monochrome); Windows/Linux use the full-color asset. */
function trayIconFile(): string {
  return process.platform === "darwin" ? "tray-icon-template.png" : "tray-icon.png";
}

function trayIconPath(): string {
  const file = trayIconFile();
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "assets", file);
  }
  return path.join(__dirname, "..", "assets", file);
}

export function createTray(server: ProxyServer, config: ConfigManager): Tray {
  const img = nativeImage.createFromPath(trayIconPath());
  if (process.platform === "darwin") {
    img.setTemplateImage(true);
  }
  const tray = new Tray(img.resize({ width: 22, height: 22 }));

  const updateMenu = (): void => {
    const locale = resolveTrayLocale(config.locale);
    const t = trayStrings(locale);
    const role = server.getRole();
    const running = server.running;
    const router = server.getRouter();
    const providerId = router.getCurrentProviderId();
    const provider = config.getProvider(providerId);
    const providers = config.enabledProviders;
    const srEnabled = config.smartRoutingConfig?.enabled === true;

    const providerMenuItems = [
      {
        label: t.smartRouting,
        type: "radio" as const,
        checked: srEnabled,
        click: (): void => {
          if (srEnabled) {
            return;
          }
          config.updateConfigSection("smartRouting", { enabled: true });
          void server
            .getModelCatalog()
            .refreshAll()
            .finally(() => updateMenu());
        },
      },
      { type: "separator" as const },
      ...providers.map(p => ({
        label: p.name,
        type: "radio" as const,
        checked: !srEnabled && p.id === providerId,
        click: (): void => {
          void (async () => {
            if (config.smartRoutingConfig?.enabled) {
              config.updateConfigSection("smartRouting", { enabled: false });
            }
            await router.switchProvider(p.id);
            updateMenu();
          })();
        },
      })),
    ];

    const contextMenu = Menu.buildFromTemplate([
      {
        label: `CCRelay — ${roleLabel(role, running, locale)}`,
        enabled: false,
      },
      {
        label: `${t.providerPrefix}: ${srEnabled ? t.smartRouting : (provider?.name ?? t.na)}`,
        enabled: false,
      },
      { type: "separator" },
      {
        label: t.openDashboard,
        click: (): void => {
          showDashboardWindow(server, config);
        },
      },
      {
        label: t.checkForUpdates,
        enabled: app.isPackaged,
        toolTip: app.isPackaged ? undefined : t.updateUnavailableTooltip,
        click: (): void => {
          void requestUpdateCheck(true);
        },
      },
      {
        label: t.updateChannel,
        enabled: app.isPackaged,
        toolTip: app.isPackaged ? undefined : t.updateChannelUnavailableTooltip,
        submenu: (["prod", "dev"] as UpdateChannel[]).map(channel => ({
          label: channelLabel(channel, locale),
          type: "radio" as const,
          checked: getUpdateChannel() === channel,
          enabled: app.isPackaged,
          click: (): void => {
            if (getUpdateChannel() === channel) {
              return;
            }
            void setUpdateChannel(channel).finally(() => {
              updateDashboardInjectConfig(server, config);
              updateMenu();
            });
          },
        })),
      },
      { type: "separator" },
      {
        label: t.startServer,
        enabled: !running,
        click: (): void => {
          void server.start().then(() => updateMenu());
        },
      },
      {
        label: t.stopServer,
        enabled: running,
        click: (): void => {
          void server.stop().then(() => updateMenu());
        },
      },
      { type: "separator" },
      {
        label: t.switchProvider,
        submenu: providerMenuItems,
      },
      { type: "separator" },
      {
        label: t.openAtLogin,
        type: "checkbox",
        checked: getOpenAtLogin(),
        click: (item): void => {
          setOpenAtLogin(item.checked);
        },
      },
      {
        label: t.openConfigFile,
        click: (): void => {
          void shell.openPath(config.getConfigPath());
        },
      },
      {
        label: t.openLogsFolder,
        click: (): void => {
          void shell.openPath(getLogDir());
        },
      },
      { type: "separator" },
      {
        label: t.quit,
        click: (): void => {
          void server.stop().finally(() => app.quit());
        },
      },
    ]);

    tray.setContextMenu(contextMenu);
    tray.setToolTip(`CCRelay (${running ? role : t.tooltipStopped})`);
  };

  server.onRoleChanged(() => updateMenu());
  server.getRouter().onProviderChanged(() => updateMenu());
  config.onConfigChanged(() => {
    updateDashboardInjectConfig(server, config);
    updateMenu();
  });

  tray.setToolTip("CCRelay");

  tray.on("double-click", () => {
    showDashboardWindow(server, config);
  });

  updateMenu();

  return tray;
}
