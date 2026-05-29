/**
 * Update check API endpoint
 * GET /ccrelay/api/update-check - Returns cached GitHub update check state
 */

import * as http from "http";
import { getUpdateCheckState, requestUpdateCheck } from "../server/updateCheck";
import { sendJson } from "./httpJson";

export function handleUpdateCheck(_req: http.IncomingMessage, res: http.ServerResponse): void {
  sendJson(res, 200, getUpdateCheckState());
}

export async function handleTriggerUpdateCheck(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const state = await requestUpdateCheck();
  sendJson(res, 200, state);
}
