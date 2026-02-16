/**
 * WebSocket message types for real-time communication between Leader and Followers
 */

// WebSocket message types
export type WsMessageType =
  | "connected" // Server -> Client: Connection established
  | "provider_changed" // Server -> Client: Provider changed
  | "server_stopping" // Server -> Client: Leader is stopping
  | "switch_provider" // Client -> Server: Request to switch provider
  | "switch_result" // Server -> Client: Result of switch request
  | "ping" // Client -> Server: Keepalive ping
  | "pong"; // Server -> Client: Keepalive response

// Base message structure
export interface WsMessage<T extends WsMessageType = WsMessageType> {
  type: T;
  payload?: unknown;
  timestamp: number;
}

// Server -> Client messages
export interface WsConnectedMessage extends WsMessage<"connected"> {
  payload: {
    instanceId: string;
  };
}

export interface WsProviderChangedMessage extends WsMessage<"provider_changed"> {
  payload: {
    providerId: string;
    providerName: string;
  };
}

export type WsServerStoppingMessage = WsMessage<"server_stopping">;

export type WsPongMessage = WsMessage<"pong">;

// Client -> Server messages
export type WsPingMessage = WsMessage<"ping">;

export interface WsSwitchProviderMessage extends WsMessage<"switch_provider"> {
  payload: {
    providerId: string;
  };
}

// Server -> Client: Result of switch request
export interface WsSwitchResultMessage extends WsMessage<"switch_result"> {
  payload: {
    success: boolean;
    providerId?: string;
    providerName?: string;
    error?: string;
  };
}

// Connection state for client
export type WsConnectionState = "connecting" | "connected" | "disconnected" | "error";

// Callback types
export type ProviderChangeCallback = (providerId: string, providerName: string) => void;
export type ServerStoppingCallback = () => void;
export type ConnectionStateCallback = (state: WsConnectionState) => void;

/**
 * WebSocket ready states (mirrors ws library's WebSocket.readyState)
 */
export const WS_READY_STATE = {
  connecting: 0,
  open: 1,
  closing: 2,
  closed: 3,
} as const;

export type WsReadyState = (typeof WS_READY_STATE)[keyof typeof WS_READY_STATE];
