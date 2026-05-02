/**
 * System tray UI for CCRelay desktop
 */

import { Tray, Menu, shell, nativeImage, app } from "electron";
import * as path from "path";
import type { ProxyServer, ConfigManager } from "@ccrelay/core";
import { setOpenAtLogin, getOpenAtLogin } from "./autoLaunch";

function dashboardUrl(server: ProxyServer, config: ConfigManager): string {
  const base = server.getLeaderUrl() ?? `http://${config.host}:${config.port}`;
  const normalized = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${normalized}/ccrelay/`;
}

function trayIconPath(): string {
  return path.join(__dirname, "..", "assets", "tray-icon-template.png");
}

function roleLabel(role: string, running: boolean): string {
  if (!running) {
    return "Stopped";
  }
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function createTray(server: ProxyServer, config: ConfigManager): Tray {
  const img = nativeImage.createFromPath(trayIconPath());
  img.setTemplateImage(true);
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
          void shell.openExternal(dashboardUrl(server, config));
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
  updateMenu();

  return tray;
}
