/**
 * System tray UI for CCRelay desktop
 */

import { Tray, Menu, shell, nativeImage, app } from "electron";
import * as path from "path";
import type { ProxyServer, ConfigManager } from "@ccrelay/core";
import { setOpenAtLogin, getOpenAtLogin } from "./autoLaunch";
import { dashboardWebUrl, showDashboardWindow } from "./window";

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

function roleLabel(role: string, running: boolean): string {
  if (!running) {
    return "Stopped";
  }
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function createTray(server: ProxyServer, config: ConfigManager): Tray {
  const img = nativeImage.createFromPath(trayIconPath());
  if (process.platform === "darwin") {
    img.setTemplateImage(true);
  }
  const tray = new Tray(img.resize({ width: 22, height: 22 }));

  const updateMenu = (): void => {
    const role = server.getRole();
    const running = server.running;
    const router = server.getRouter();
    const providerId = router.getCurrentProviderId();
    const provider = config.getProvider(providerId);
    const providers = config.enabledProviders;

    const providerMenuItems = providers.map(p => ({
      label: p.name,
      type: "radio" as const,
      checked: p.id === providerId,
      click: (): void => {
        void router.switchProvider(p.id).then(() => updateMenu());
      },
    }));

    const contextMenu = Menu.buildFromTemplate([
      {
        label: `CCRelay — ${roleLabel(role, running)}`,
        enabled: false,
      },
      {
        label: `Provider: ${provider?.name ?? "N/A"}`,
        enabled: false,
      },
      { type: "separator" },
      {
        label: "Open Dashboard",
        click: (): void => {
          showDashboardWindow(dashboardWebUrl(server, config));
        },
      },
      { type: "separator" },
      {
        label: "Start Server",
        enabled: !running,
        click: (): void => {
          void server.start().then(() => updateMenu());
        },
      },
      {
        label: "Stop Server",
        enabled: running,
        click: (): void => {
          void server.stop().then(() => updateMenu());
        },
      },
      { type: "separator" },
      {
        label: "Switch Provider",
        submenu: providerMenuItems,
      },
      { type: "separator" },
      {
        label: "Open at Login",
        type: "checkbox",
        checked: getOpenAtLogin(),
        click: (item): void => {
          setOpenAtLogin(item.checked);
        },
      },
      {
        label: "Open Config File",
        click: (): void => {
          void shell.openPath(config.getConfigPath());
        },
      },
      { type: "separator" },
      {
        label: "Quit",
        click: (): void => {
          void server.stop().finally(() => app.quit());
        },
      },
    ]);

    tray.setContextMenu(contextMenu);
    tray.setToolTip(`CCRelay (${running ? role : "stopped"})`);
  };

  server.onRoleChanged(() => updateMenu());
  server.getRouter().onProviderChanged(() => updateMenu());
  config.onConfigChanged(() => updateMenu());

  tray.setToolTip("CCRelay");

  tray.on("double-click", () => {
    showDashboardWindow(dashboardWebUrl(server, config));
  });

  updateMenu();

  return tray;
}
