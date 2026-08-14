import type { LogEntry } from "../../types/api";
import type { ZipEntry } from "../../lib/zip";
import {
  formatHeadersJson,
  formatJson,
  parseRequestMarkdownAnalysis,
  parseToolsMarkdown,
  renderResponseAnalysisMarkdown,
} from "./log-analysis";

export const MAX_LOG_EXPORT_IDS = 100;

export interface LogExportFile {
  path: string;
  content: string;
}

function writeBody(path: string, body: string | undefined, files: LogExportFile[]): void {
  files.push({ path, content: body ? formatJson(body) : "" });
}

function logMetaJson(log: LogEntry): string {
  return JSON.stringify(
    {
      id: log.id,
      timestamp: log.timestamp,
      isoTime: new Date(log.timestamp).toISOString(),
      method: log.method,
      path: log.path,
      targetUrl: log.targetUrl ?? null,
      providerId: log.providerId,
      providerName: log.providerName,
      statusCode: log.statusCode,
      duration: log.duration,
      success: log.success,
      errorMessage: log.errorMessage ?? null,
      model: log.model ?? null,
      mappedModel: log.mappedModel ?? null,
      routeType: log.routeType ?? null,
      status: log.status ?? null,
    },
    null,
    2
  );
}

/** Build `{id}/…` files for one log (converted/original JSON, headers, analysis markdown). */
export function buildLogExportFilesForEntry(log: LogEntry): LogExportFile[] {
  const dir = String(log.id);
  const files: LogExportFile[] = [{ path: `${dir}/meta.json`, content: logMetaJson(log) }];

  writeBody(`${dir}/request-converted.json`, log.requestBody, files);
  writeBody(`${dir}/request-original.json`, log.originalRequestBody, files);
  files.push({
    path: `${dir}/request-headers.json`,
    content: formatHeadersJson(log.requestHeaders),
  });
  files.push({
    path: `${dir}/request-analysis.md`,
    content: log.requestBody
      ? parseRequestMarkdownAnalysis(log.requestBody)
      : "*No parseable content found.*",
  });

  const tools = parseToolsMarkdown(log.requestBody);
  if (tools) {
    files.push({ path: `${dir}/request-tools.md`, content: tools });
  }

  writeBody(`${dir}/response-converted.json`, log.responseBody, files);
  writeBody(`${dir}/response-original.json`, log.originalResponseBody, files);
  files.push({
    path: `${dir}/response-headers.json`,
    content: formatHeadersJson(log.responseHeaders),
  });
  files.push({
    path: `${dir}/response-analysis.md`,
    content: renderResponseAnalysisMarkdown(log.responseBody),
  });

  return files;
}

export function buildLogExportFiles(logs: LogEntry[]): LogExportFile[] {
  const files: LogExportFile[] = [];
  for (const log of logs) {
    files.push(...buildLogExportFilesForEntry(log));
  }
  return files;
}

export function logExportZipEntries(logs: LogEntry[]): ZipEntry[] {
  return buildLogExportFiles(logs);
}

export function logExportFilename(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `ccrelay-logs-${stamp}.zip`;
}
