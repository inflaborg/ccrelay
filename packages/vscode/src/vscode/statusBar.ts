/**
 * Status bar management for CCRelay
 */

import * as vscode from "vscode";
import type { ConfigManager, ProxyServer } from "@ccrelay/core";
import {
  resolveEffectiveRoutingStatus,
  isSmartRoutingEnabled,
  SMART_ROUTING_PROVIDER_ID,
} from "@ccrelay/core";
import type { InstanceRole, RoleChangeInfo, ElectionState } from "@ccrelay/core";

export class StatusBarManager implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private config: ConfigManager;
  private server: ProxyServer;
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext, config: ConfigManager, server: ProxyServer) {
    this.context = context;
    this.config = config;
    this.server = server;
    this.statusBarItem = this.createStatusBarItem();
    this.update();

    // Subscribe to role changes from server
    this.server.onRoleChanged(this.handleRoleChange);

    // Subscribe to provider changes from Router (single source of truth)
    // Router is updated by WebSocket client for all instances (Leader + Followers)
    const router = this.server.getRouter();
    router.onProviderChanged(this.handleProviderChange);

    // Subscribe to config changes (provider list, settings, etc.)
    this.config.onConfigChanged(this.handleConfigChange);
  }

  /**
   * Handle role change events from server
   */
  private handleRoleChange = (_info: RoleChangeInfo): void => {
    this.update();
  };

  /**
   * Handle provider change events from Router
   */
  private handleProviderChange = (_providerId: string): void => {
    this.update();
  };

  /**
   * Handle config changes (provider list, settings, etc.)
   */
  private handleConfigChange = (): void => {
    this.update();
  };

  private getRoutingDisplay() {
    return resolveEffectiveRoutingStatus(this.config, this.server.getRouter());
  }

  private getDisplayProviderName(): string | undefined {
    return this.getRoutingDisplay().providerName;
  }

  private createStatusBarItem(): vscode.StatusBarItem {
    const priority = 100;

    const item = vscode.window.createStatusBarItem(
      "ccrelay-status",
      vscode.StatusBarAlignment.Right,
      priority
    );
    item.name = "CCRelay";
    item.command = "ccrelay.showMenu";
    item.show();
    return item;
  }

  /**
   * Update the status bar display
   */
  update(): void {
    const isRunning = this.server.running;
    const role = this.server.getRole();
    const electionState = this.server.getElectionState();
    const leaderUrl = this.server.getLeaderUrl();

    // Build status text based on role and election state
    let statusIcon = "$(server)";
    let statusSuffix = "";
    let backgroundColor: vscode.ThemeColor | undefined = undefined;

    if (role === "leader") {
      if (electionState === "leader_active") {
        statusIcon = "$(broadcast)"; // Leader active icon
        statusSuffix = " [Leader]";
      } else if (electionState === "leader") {
        statusIcon = "$(loading~spin)"; // Leader starting
        statusSuffix = " [Leader Starting...]";
        backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
      }
    } else if (role === "follower") {
      if (electionState === "waiting") {
        statusIcon = "$(sync~spin)"; // Waiting for new leader
        statusSuffix = " [Waiting]";
        backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
      } else {
        statusIcon = "$(radio-tower)"; // Follower icon
        statusSuffix = " [Follower]";
      }
    }

    // Handle stopped state for leader
    if (!isRunning && role === "leader") {
      this.statusBarItem.text = `$(debug-stop) CCRelay [Stopped]`;
      this.statusBarItem.tooltip = "CCRelay: Server stopped - Click to start";
      this.statusBarItem.backgroundColor = undefined;
      return;
    }

    const router = this.server.getRouter();
    const routing = this.getRoutingDisplay();
    const displayName = routing.providerName;
    const provider = router.getCurrentProvider();
    const isSmartRouting = routing.currentProvider === SMART_ROUTING_PROVIDER_ID;

    if (displayName) {
      this.statusBarItem.text = `${statusIcon} ${displayName}${statusSuffix}`;
      this.statusBarItem.tooltip = this.buildTooltip(
        isSmartRouting
          ? { id: SMART_ROUTING_PROVIDER_ID, name: displayName }
          : {
              id: provider?.id ?? routing.currentProvider,
              name: displayName,
              mode: provider?.mode,
              baseUrl: provider?.baseUrl,
            },
        role,
        electionState,
        leaderUrl,
        isSmartRouting
      );
      this.statusBarItem.backgroundColor = backgroundColor;
    } else {
      this.statusBarItem.text = `$(warning) CCRelay${statusSuffix}`;
      this.statusBarItem.tooltip = "CCRelay: Click for options";
      this.statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    }
  }

  private buildTooltip(
    display: { name: string; id: string; mode?: string; baseUrl?: string },
    role: InstanceRole,
    electionState: ElectionState,
    leaderUrl: string | null,
    isSmartRouting: boolean
  ): string {
    const lines = ["CCRelay", "", `Current: ${display.name}`, `ID: ${display.id}`];

    if (!isSmartRouting) {
      if (display.mode) {
        lines.push(`Mode: ${display.mode}`);
      }
      if (display.baseUrl) {
        lines.push(`Base URL: ${display.baseUrl}`);
      }
    }

    lines.push(
      `Port: ${this.config.port}`,
      "",
      `Role: ${this.getRoleDisplayName(role)}`,
      `State: ${this.getStateDisplayName(electionState)}`
    );

    // Add leader URL for follower
    if (role === "follower" && leaderUrl) {
      lines.push(`Connected to: ${leaderUrl}`);
    }

    lines.push("", "Click for options");

    return lines.join("\n");
  }

  /**
   * Get human-readable role name
   */
  private getRoleDisplayName(role: InstanceRole): string {
    switch (role) {
      case "leader":
        return "Leader";
      case "follower":
        return "Follower";
      default:
        return role;
    }
  }

  /**
   * Get human-readable election state name
   */
  private getStateDisplayName(state: ElectionState): string {
    switch (state) {
      case "idle":
        return "Idle";
      case "electing":
        return "Electing...";
      case "leader":
        return "Leader (server starting)";
      case "leader_active":
        return "Active";
      case "follower":
        return "Following leader";
      case "waiting":
        return "Waiting for new leader";
      default:
        return state;
    }
  }

  /**
   * Show the main menu
   */
  async showMenu(): Promise<void> {
    const isRunning = this.server.running;
    const displayName = this.getDisplayProviderName();
    const role = this.server.getRole();

    const menuItems: vscode.QuickPickItem[] = [
      {
        label: "$(arrow-swap) Switch Provider",
        description: "Change the active AI provider",
      },
      {
        label: "$(dashboard) Dashboard",
        description: "Open CCRelay dashboard",
      },
      {
        label: "$(output) Show Output Logs",
        description: "View extension output logs",
      },
      {
        label: "$(clear-all) Clear Output Logs",
        description: "Clear output logs",
      },
      {
        label: "$(settings-gear) Open Settings",
        description: "Configure CCRelay",
      },
      {
        label: "",
        kind: vscode.QuickPickItemKind.Separator,
      },
      isRunning
        ? {
            label: "$(circle-slash) Stop Server",
            description: `Stop the proxy server (${role})`,
          }
        : {
            label: "$(play) Start Server",
            description: "Start the proxy server",
          },
    ];

    const roleLabel =
      role === "leader" ? "Leader" : role === "follower" ? "Follower" : "Standalone";
    const selected = await vscode.window.showQuickPick(menuItems, {
      placeHolder: `CCRelay [${roleLabel}]${isRunning ? ` (${displayName || "Unknown"})` : "(Stopped)"}`,
      title: "CCRelay",
    });

    if (!selected) {
      return;
    }

    switch (selected.label) {
      case "$(arrow-swap) Switch Provider":
        await this.showProviderPicker();
        break;
      case "$(dashboard) Dashboard":
        await vscode.commands.executeCommand("ccrelay.openWebUI");
        break;
      case "$(output) Show Output Logs":
        await vscode.commands.executeCommand("ccrelay.showLogs");
        break;
      case "$(clear-all) Clear Output Logs":
        await vscode.commands.executeCommand("ccrelay.clearLogs");
        break;
      case "$(settings-gear) Open Settings":
        await vscode.commands.executeCommand("ccrelay.openSettings");
        break;
      case "$(play) Start Server":
        await vscode.commands.executeCommand("ccrelay.startServer");
        break;
      case "$(circle-slash) Stop Server":
        await vscode.commands.executeCommand("ccrelay.stopServer");
        break;
    }
  }

  /**
   * Show a quick pick for selecting a provider
   */
  async showProviderPicker(): Promise<void> {
    // Ensure server is running (or leader is running)
    const role = this.server.getRole();
    const isRunning = this.server.running || role === "follower";

    if (!isRunning) {
      const start = await vscode.window.showWarningMessage(
        "CCRelay server is not running. Start it now?",
        "Yes",
        "No"
      );
      if (start === "Yes") {
        await vscode.commands.executeCommand("ccrelay.startServer");
      }
      return;
    }

    const providers = this.config.enabledProviders;
    const router = this.server.getRouter();
    const currentId = router.getCurrentProviderId();
    const srEnabled = isSmartRoutingEnabled(this.config);
    const displayName = this.getDisplayProviderName();

    if (providers.length === 0 && !srEnabled) {
      vscode.window.showWarningMessage("No enabled providers found.");
      return;
    }

    const items: vscode.QuickPickItem[] = [
      {
        label: "Smart Routing",
        description: SMART_ROUTING_PROVIDER_ID,
        detail: "Route requests by model alias across providers",
        picked: srEnabled,
      },
      { label: "", kind: vscode.QuickPickItemKind.Separator },
      ...providers.map(provider => ({
        label: provider.name,
        description: provider.id,
        detail: `Mode: ${provider.mode} | URL: ${provider.baseUrl}`,
        picked: !srEnabled && provider.id === currentId,
      })),
    ];

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: `Select routing (current: ${displayName || "Unknown"})`,
      title: "CCRelay - Switch Provider",
    });

    if (!selected?.description) {
      return;
    }

    if (selected.description === SMART_ROUTING_PROVIDER_ID) {
      if (srEnabled) {
        return;
      }
      const result = this.config.updateConfigSection("smartRouting", { enabled: true });
      if (!result.ok) {
        vscode.window.showErrorMessage(
          `Failed to enable Smart Routing: ${result.error || "Unknown error"}`
        );
        return;
      }
      void this.server.getModelCatalog().refreshAll();
      this.update();
      vscode.window.showInformationMessage("Smart Routing enabled");
      return;
    }

    const provider = providers.find(p => p.id === selected.description);
    if (!provider) {
      return;
    }

    if (srEnabled) {
      const disableResult = this.config.updateConfigSection("smartRouting", { enabled: false });
      if (!disableResult.ok) {
        vscode.window.showErrorMessage(
          `Failed to disable Smart Routing: ${disableResult.error || "Unknown error"}`
        );
        return;
      }
    }

    const switchResult = await this.server.switchProvider(provider.id);
    if (switchResult.success) {
      this.update();
      vscode.window.showInformationMessage(`Switched to ${provider.name}`);
    } else {
      vscode.window.showErrorMessage(
        `Failed to switch to ${provider.name}: ${switchResult.error || "Unknown error"}`
      );
    }
  }

  dispose(): void {
    // Unsubscribe from events
    this.server.offRoleChanged(this.handleRoleChange);
    const router = this.server.getRouter();
    router.offProviderChanged(this.handleProviderChange);
    this.config.offConfigChanged(this.handleConfigChange);
    this.statusBarItem.dispose();
  }
}
