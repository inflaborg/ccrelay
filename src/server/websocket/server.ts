/**
 * WebSocket Broadcaster - Server side
 * Runs on Leader instance to broadcast state changes to connected Followers
 */

import * as http from "http";
import { WebSocket, WebSocketServer } from "ws";
import { ScopedLogger } from "../../utils/logger";
import {
  WsMessage,
  WsProviderChangedMessage,
  WsServerStoppingMessage,
  WsConnectedMessage,
  WsPongMessage,
  WsSwitchProviderMessage,
  WsSwitchResultMessage,
} from "./types";

// Callback type for handling switch provider requests
export type SwitchProviderCallback = (providerId: string) => Promise<{
  success: boolean;
  providerId?: string;
  providerName?: string;
  error?: string;
}>;

export class WsBroadcaster {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();
  private log = new ScopedLogger("WsServer");
  private instanceId: string;
  private onSwitchProvider: SwitchProviderCallback | null = null;

  constructor(instanceId: string) {
    this.instanceId = instanceId;
  }

  /**
   * Set callback for handling switch provider requests from clients
   */
  setSwitchProviderCallback(callback: SwitchProviderCallback): void {
    this.onSwitchProvider = callback;
  }

  /**
   * Attach WebSocket server to existing HTTP server
   */
  attach(httpServer: http.Server): void {
    this.wss = new WebSocketServer({
      server: httpServer,
      path: "/ccrelay/ws",
    });

    this.wss.on("connection", (ws, req) => {
      const clientIp = req.socket.remoteAddress || "unknown";
      this.log.info(`[WsServer] Client connected from ${clientIp}`);

      this.clients.add(ws);

      // Send welcome message
      this.sendToClient(ws, {
        type: "connected",
        payload: { instanceId: this.instanceId },
        timestamp: Date.now(),
      } as WsConnectedMessage);

      ws.on("close", (code, reason) => {
        const reasonStr = reason.toString("utf-8");
        this.log.info(`[WsServer] Client disconnected: code=${code}, reason=${reasonStr}`);
        this.clients.delete(ws);
      });

      ws.on("error", error => {
        this.log.error(`[WsServer] Client error:`, error);
        this.clients.delete(ws);
      });

      ws.on("message", (data: Buffer | string) => {
        this.handleMessage(ws, data);
      });
    });

    this.wss.on("error", error => {
      this.log.error(`[WsServer] Server error:`, error);
    });

    this.log.info(`[WsServer] WebSocket server attached to HTTP server`);
  }

  /**
   * Broadcast provider change to all connected clients
   */
  broadcastProviderChange(providerId: string, providerName: string): void {
    const message: WsProviderChangedMessage = {
      type: "provider_changed",
      payload: { providerId, providerName },
      timestamp: Date.now(),
    };

    this.log.info(
      `[WsServer] Broadcasting provider change: ${providerId} (${providerName}) to ${this.clients.size} clients`
    );
    this.broadcast(message);
  }

  /**
   * Broadcast server stopping to all connected clients
   */
  broadcastServerStopping(): void {
    const message: WsServerStoppingMessage = {
      type: "server_stopping",
      timestamp: Date.now(),
    };

    this.log.info(`[WsServer] Broadcasting server stopping to ${this.clients.size} clients`);
    this.broadcast(message);
  }

  /**
   * Get number of connected clients
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Close WebSocket server
   */
  close(): void {
    if (this.wss) {
      // Notify all clients before closing
      this.broadcastServerStopping();

      // Close all client connections
      for (const client of this.clients) {
        client.close(1001, "Server shutting down");
      }
      this.clients.clear();

      // Close server
      this.wss.close(error => {
        if (error) {
          this.log.error(`[WsServer] Error closing server:`, error);
        } else {
          this.log.info(`[WsServer] WebSocket server closed`);
        }
      });
      this.wss = null;
    }
  }

  /**
   * Handle incoming message from client
   */
  private handleMessage(ws: WebSocket, data: Buffer | string): void {
    try {
      const dataStr = typeof data === "string" ? data : data.toString("utf-8");
      const message = JSON.parse(dataStr) as WsMessage;

      switch (message.type) {
        case "ping":
          // Respond with pong
          this.sendToClient(ws, {
            type: "pong",
            timestamp: Date.now(),
          } as WsPongMessage);
          break;

        case "switch_provider":
          // Handle switch provider request
          void this.handleSwitchProvider(ws, message as WsSwitchProviderMessage);
          break;

        default:
          this.log.debug(`[WsServer] Received unknown message type: ${message.type}`);
      }
    } catch {
      const dataStr = typeof data === "string" ? data : data.toString("utf-8");
      this.log.warn(`[WsServer] Failed to parse message: ${dataStr}`);
    }
  }

  /**
   * Handle switch provider request from client
   */
  private async handleSwitchProvider(
    ws: WebSocket,
    message: WsSwitchProviderMessage
  ): Promise<void> {
    const providerId = message.payload?.providerId;

    if (!providerId) {
      this.sendToClient(ws, {
        type: "switch_result",
        payload: { success: false, error: "Missing providerId" },
        timestamp: Date.now(),
      } as WsSwitchResultMessage);
      return;
    }

    if (!this.onSwitchProvider) {
      this.sendToClient(ws, {
        type: "switch_result",
        payload: { success: false, error: "No switch handler configured" },
        timestamp: Date.now(),
      } as WsSwitchResultMessage);
      return;
    }

    try {
      const result = await this.onSwitchProvider(providerId);
      this.sendToClient(ws, {
        type: "switch_result",
        payload: result,
        timestamp: Date.now(),
      } as WsSwitchResultMessage);
    } catch (error) {
      this.sendToClient(ws, {
        type: "switch_result",
        payload: { success: false, error: String(error) },
        timestamp: Date.now(),
      } as WsSwitchResultMessage);
    }
  }

  /**
   * Send message to a specific client
   */
  private sendToClient(ws: WebSocket, message: WsMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Broadcast message to all connected clients
   */
  private broadcast(message: WsMessage): void {
    const data = JSON.stringify(message);
    let sent = 0;

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
        sent++;
      }
    }

    this.log.debug(`[WsServer] Message sent to ${sent} clients`);
  }
}
