/**
 * Database Worker - Runs SQLite operations in a separate thread
 *
 * This worker isolates database operations (especially JSON parsing)
 * from the main thread, preventing event loop blocking.
 *
 * Communication:
 * - Main thread -> Worker: { id, type, payload }
 * - Worker -> Main thread: { id, success, data?, error? }
 */

import { parentPort } from "worker_threads";
import { SqliteCliDriver } from "./drivers/sqlite-cli";
import type { RequestLog, LogFilter, RequestStatus, SqliteDriverConfig } from "./types";

// Message types
type WorkerMessageType =
  | "init"
  | "close"
  | "insertLog"
  | "insertLogPending"
  | "updateLogCompleted"
  | "updateLogStatus"
  | "writeBatch"
  | "queryLogs"
  | "getLogById"
  | "deleteLogs"
  | "clearAllLogs"
  | "getStats"
  | "cleanOldLogs"
  | "forceFlush";

interface WorkerMessage {
  id: string;
  type: WorkerMessageType;
  payload?: unknown;
}

interface WorkerResponse {
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

// Driver instance
let driver: SqliteCliDriver | null = null;

/**
 * Handle incoming message from main thread
 */
async function handleMessage(message: WorkerMessage): Promise<WorkerResponse> {
  const { id, type, payload } = message;

  try {
    switch (type) {
      case "init": {
        const config = payload as SqliteDriverConfig;
        driver = new SqliteCliDriver(config);
        await driver.initialize();
        return { id, success: true };
      }

      case "close": {
        if (driver) {
          await driver.close();
          driver = null;
        }
        return { id, success: true };
      }

      case "insertLog": {
        driver?.insertLog(payload as RequestLog);
        return { id, success: true };
      }

      case "insertLogPending": {
        driver?.insertLogPending(payload as RequestLog);
        return { id, success: true };
      }

      case "updateLogCompleted": {
        const p = payload as {
          clientId: string;
          statusCode: number;
          responseBody: string | undefined;
          duration: number;
          success: boolean;
          errorMessage: string | undefined;
          originalResponseBody?: string;
        };
        driver?.updateLogCompleted(
          p.clientId,
          p.statusCode,
          p.responseBody,
          p.duration,
          p.success,
          p.errorMessage,
          p.originalResponseBody
        );
        return { id, success: true };
      }

      case "updateLogStatus": {
        const p = payload as {
          clientId: string;
          status: RequestStatus;
          statusCode: number;
          duration: number;
          errorMessage: string | undefined;
        };
        driver?.updateLogStatus(p.clientId, p.status, p.statusCode, p.duration, p.errorMessage);
        return { id, success: true };
      }

      case "writeBatch": {
        await driver?.writeBatch(payload as RequestLog[]);
        return { id, success: true };
      }

      case "queryLogs": {
        const result = await driver?.queryLogs((payload as { filter: LogFilter }).filter);
        return { id, success: true, data: result ?? { logs: [], total: 0 } };
      }

      case "getLogById": {
        const result = await driver?.getLogById((payload as { id: number }).id);
        return { id, success: true, data: result };
      }

      case "deleteLogs": {
        await driver?.deleteLogs((payload as { ids: number[] }).ids);
        return { id, success: true };
      }

      case "clearAllLogs": {
        await driver?.clearAllLogs();
        return { id, success: true };
      }

      case "getStats": {
        const result = await driver?.getStats();
        return { id, success: true, data: result };
      }

      case "cleanOldLogs": {
        await driver?.cleanOldLogs();
        return { id, success: true };
      }

      case "forceFlush": {
        driver?.forceFlush();
        return { id, success: true };
      }

      default:
        return { id, success: false, error: `Unknown message type: ${String(type)}` };
    }
  } catch (err) {
    return {
      id,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// Listen for messages from main thread
parentPort?.on("message", (message: WorkerMessage) => {
  void handleMessage(message).then(response => {
    parentPort?.postMessage(response);
  });
});
