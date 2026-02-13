/**
 * Status bar management for CCRelay
 */

import * as vscode from "vscode";
import { ConfigManager } from "../config";
import { ProxyServer } from "../server/handler";
import { Provider, InstanceRole, RoleChangeInfo, ElectionState } from "../types";

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
  }

  /**
   * Handle role change events from server
   */
  private handleRoleChange = (_info: RoleChangeInfo): void => {
    this.update();
  };

  private createStatusBarItem(): vscode.StatusBarItem {
    const vscodeConfig = vscode.workspace.getConfiguration("ccrelay");
    const position = vscodeConfig.get<string>("ui.statusBarPosition", "right");
    const priority = vscodeConfig.get<number>("ui.statusBarPriority", 100);

    const item = vscode.window.createStatusBarItem(
      "ccrelay-status",
      position === "left" ? vscode.StatusBarAlignment.Left : vscode.StatusBarAlignment.Right,
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
    } else if (role === "standalone") {
      if (!isRunning) {
        statusIcon = "$(debug-stop)";
        statusSuffix = " [Stopped]";
      } else {
        statusIcon = "$(server)";
        statusSuffix = ""; // Standalone running
      }
    }

    // Handle stopped state explicitly
    if (!isRunning && role !== "follower") {
      this.statusBarItem.text = `$(debug-stop) CCRelay [Stopped]`;
      this.statusBarItem.tooltip = "CCRelay: Server stopped - Click to start";
      this.statusBarItem.backgroundColor = undefined;
      return;
    }

    const router = this.server.getRouter();
    const currentProviderId = router.getCurrentProviderId();
    const provider = this.config.getProvider(currentProviderId);

    if (provider) {
      this.statusBarItem.text = `${statusIcon} ${provider.name}${statusSuffix}`;
      this.statusBarItem.tooltip = this.buildTooltip(provider, role, electionState, leaderUrl);
      this.statusBarItem.backgroundColor = backgroundColor;
    } else {
      this.statusBarItem.text = `$(warning) CCRelay${statusSuffix}`;
      this.statusBarItem.tooltip = "CCRelay: Click for options";
      this.statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    }
  }

  private buildTooltip(
    provider: Provider,
    role: InstanceRole,
    electionState: ElectionState,
    leaderUrl: string | null
  ): string {
    const lines = [
      "CCRelay",
      "",
      `Current: ${provider.name}`,
      `ID: ${provider.id}`,
      `Mode: ${provider.mode}`,
      `Base URL: ${provider.baseUrl}`,
      `Port: ${this.config.port}`,
      "",
      `Role: ${this.getRoleDisplayName(role)}`,
      `State: ${this.getStateDisplayName(electionState)}`,
    ];

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
      case "standalone":
        return "Standalone";
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
    const router = this.server.getRouter();
    const currentProviderId = router.getCurrentProviderId();
    const currentProvider = this.config.getProvider(currentProviderId);
    const role = this.server.getRole();

    const menuItems: vscode.QuickPickItem[] = [
      {
        label: "$(arrow-swap) Switch Provider",
        description: "Change the active AI provider",
      },
      {
        label: "$(database) Request Log Viewer",
        description: "View stored request/response logs",
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
      placeHolder: `CCRelay [${roleLabel}]${isRunning ? ` (${currentProvider?.name || "Unknown"})` : "(Stopped)"}`,
      title: "CCRelay",
    });

    if (!selected) {
      return;
    }

    switch (selected.label) {
      case "$(arrow-swap) Switch Provider":
        await this.showProviderPicker();
        break;
      case "$(database) Request Log Viewer":
        await vscode.commands.executeCommand("ccrelay.showLogViewer");
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

    if (providers.length === 0) {
      vscode.window.showWarningMessage("No enabled providers found.");
      return;
    }

    const items: vscode.QuickPickItem[] = providers.map(provider => ({
      label: provider.name,
      description: provider.id,
      detail: `Mode: ${provider.mode} | URL: ${provider.baseUrl}`,
      picked: provider.id === currentId,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: `Select a provider (current: ${this.config.getProvider(currentId)?.name || "Unknown"})`,
      title: "CCRelay - Switch Provider",
    });

    if (selected) {
      const provider = providers.find(p => p.id === selected.description);
      if (provider) {
        const success = await router.switchProvider(provider.id);
        if (success) {
          vscode.window.showInformationMessage(`Switched to ${provider.name}`);
          this.update();
        } else {
          vscode.window.showErrorMessage(`Failed to switch to ${provider.name}`);
        }
      }
    }
  }

  dispose(): void {
    // Unsubscribe from role changes
    this.server.offRoleChanged(this.handleRoleChange);
    this.statusBarItem.dispose();
  }
}
