/**
 * WebSocket Follower Client
 * Connects to Leader's WebSocket server to receive real-time state updates
 */

import { WebSocket } from "ws";
import { ScopedLogger } from "../../utils/logger";
import {
  WsMessage,
  WsProviderChangedMessage,
  WsSwitchResultMessage,
  WsConnectionState,
  ProviderChangeCallback,
  ServerStoppingCallback,
  ConnectionStateCallback,
} from "./types";

// Reconnection settings
const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;
const RECONNECT_BACKOFF_FACTOR = 2;

// Ping interval for keepalive
const PING_INTERVAL_MS = 30000;

export class WsFollowerClient {
  private ws: WebSocket | null = null;
  private leaderUrl: string;
  private log = new ScopedLogger("WsClient");

  // Reconnection state
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private isIntentionalClose = false;

  // Ping/pong for keepalive
  private pingTimer: NodeJS.Timeout | null = null;

  // Callbacks
  private onProviderChange: ProviderChangeCallback | null = null;
  private onServerStopping: ServerStoppingCallback | null = null;
  private onConnectionStateChange: ConnectionStateCallback | null = null;

  constructor(leaderUrl: string) {
    this.leaderUrl = leaderUrl;
  }

  /**
   * Set callbacks for events
   */
  setCallbacks(callbacks: {
    onProviderChange?: ProviderChangeCallback;
    onServerStopping?: ServerStoppingCallback;
    onConnectionStateChange?: ConnectionStateCallback;
  }): void {
    if (callbacks.onProviderChange) {
      this.onProviderChange = callbacks.onProviderChange;
    }
    if (callbacks.onServerStopping) {
      this.onServerStopping = callbacks.onServerStopping;
    }
    if (callbacks.onConnectionStateChange) {
      this.onConnectionStateChange = callbacks.onConnectionStateChange;
    }
  }

  /**
   * Connect to Leader's WebSocket server
   */
  connect(): void {
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
      this.log.warn(`[WsClient] Already connected or connecting`);
      return;
    }

    this.isIntentionalClose = false;
    const wsUrl = this.buildWsUrl(this.leaderUrl);

    this.log.info(`[WsClient] Connecting to ${wsUrl}`);
    this.notifyStateChange("connecting");

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.on("open", () => {
        this.log.info(`[WsClient] Connected to Leader`);
        this.reconnectAttempts = 0;
        this.notifyStateChange("connected");
        this.startPingTimer();
      });

      this.ws.on("message", (data: Buffer | string) => {
        this.handleMessage(data);
      });

      this.ws.on("close", (code, reason) => {
        const reasonStr = reason.toString("utf-8");
        this.log.info(`[WsClient] Connection closed: code=${code}, reason=${reasonStr}`);
        this.stopPingTimer();
        this.notifyStateChange("disconnected");

        if (!this.isIntentionalClose) {
          this.scheduleReconnect();
        }
      });

      this.ws.on("error", error => {
        this.log.error(`[WsClient] Connection error:`, error);
        this.notifyStateChange("error");
      });
    } catch (error) {
      this.log.error(`[WsClient] Failed to create WebSocket:`, error);
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect from Leader
   */
  disconnect(): void {
    this.isIntentionalClose = true;
    this.clearReconnectTimer();
    this.stopPingTimer();

    if (this.ws) {
      this.ws.close(1000, "Client shutting down");
      this.ws = null;
    }

    this.log.info(`[WsClient] Disconnected`);
  }

  /**
   * Get current connection state
   */
  getState(): WsConnectionState {
    if (!this.ws) {
      return "disconnected";
    }

    switch (this.ws.readyState) {
      case WebSocket.CONNECTING:
        return "connecting";
      case WebSocket.OPEN:
        return "connected";
      case WebSocket.CLOSING:
      case WebSocket.CLOSED:
      default:
        return "disconnected";
    }
  }

  /**
   * Send switch provider request to Leader
   * Returns true if successful, false otherwise
   */
  async switchProvider(providerId: string): Promise<{ success: boolean; error?: string }> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return { success: false, error: "Not connected to Leader" };
    }

    return new Promise(resolve => {
      let handled = false;

      const cleanup = () => {
        handled = true;
        this.ws?.removeListener("message", messageHandler);
      };

      const messageHandler = (data: Buffer | string) => {
        if (handled) {
          return;
        }

        try {
          const dataStr = typeof data === "string" ? data : data.toString("utf-8");
          const message = JSON.parse(dataStr) as WsMessage;

          if (message.type === "switch_result") {
            const result = (message as WsSwitchResultMessage).payload;
            cleanup();
            resolve({
              success: result.success,
              error: result.error,
            });
          }
        } catch {
          // Ignore parse errors
        }
      };

      // Set timeout for response
      setTimeout(() => {
        if (!handled) {
          cleanup();
          resolve({ success: false, error: "Switch request timeout" });
        }
      }, 5000);

      // Listen for response
      this.ws!.on("message", messageHandler);

      // Send switch request
      this.ws!.send(
        JSON.stringify({
          type: "switch_provider",
          payload: { providerId },
          timestamp: Date.now(),
        })
      );

      this.log.info(`[WsClient] Sent switch_provider request: ${providerId}`);
    });
  }

  /**
   * Build WebSocket URL from HTTP URL
   */
  private buildWsUrl(httpUrl: string): string {
    return httpUrl.replace(/^http/, "ws") + "/ccrelay/ws";
  }

  /**
   * Handle incoming message from Leader
   */
  private handleMessage(data: Buffer | string): void {
    try {
      const dataStr = typeof data === "string" ? data : data.toString("utf-8");
      const message = JSON.parse(dataStr) as WsMessage;

      switch (message.type) {
        case "connected":
          this.log.info(`[WsClient] Received welcome from Leader`);
          break;

        case "provider_changed": {
          const payload = (message as WsProviderChangedMessage).payload;
          this.log.info(
            `[WsClient] Received provider change: ${payload.providerId} (${payload.providerName})`
          );
          this.onProviderChange?.(payload.providerId, payload.providerName);
          break;
        }

        case "server_stopping":
          this.log.info(`[WsClient] Leader is stopping`);
          this.onServerStopping?.();
          this.disconnect();
          break;

        case "pong":
          // Keepalive response, no action needed
          break;

        default:
          this.log.debug(`[WsClient] Received unknown message type: ${message.type}`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.log.warn(`[WsClient] Failed to parse message: ${errorMsg}`);
    }
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.log.warn(
        `[WsClient] Max reconnect attempts (${this.maxReconnectAttempts}) reached, giving up`
      );
      return;
    }

    this.clearReconnectTimer();

    const delay = Math.min(
      INITIAL_RECONNECT_DELAY_MS * Math.pow(RECONNECT_BACKOFF_FACTOR, this.reconnectAttempts),
      MAX_RECONNECT_DELAY_MS
    );
    this.reconnectAttempts++;

    this.log.info(
      `[WsClient] Scheduling reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`
    );

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  /**
   * Clear reconnect timer
   */
  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Start ping timer for keepalive
   */
  private startPingTimer(): void {
    this.stopPingTimer();

    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "ping", timestamp: Date.now() }));
      }
    }, PING_INTERVAL_MS);
  }

  /**
   * Stop ping timer
   */
  private stopPingTimer(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /**
   * Notify connection state change
   */
  private notifyStateChange(state: WsConnectionState): void {
    this.onConnectionStateChange?.(state);
  }
}
