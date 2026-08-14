import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { formatDistanceToNow } from "date-fns";
import {
  ChevronRight,
  ChevronDown,
  Copy,
  Check,
  Download,
  Loader2,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { SelectField } from "@/components/select-field";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { InfiniteTable, type InfiniteTableColumn } from "@/components/ui/infinite-table";
import { MarkdownViewer } from "@/components/ui/markdown-viewer";
import { api, type LogEntry } from "@/api/client";
import {
  effectiveGenMs,
  effectiveTtfb,
  formatMs,
  hasStreamPerfMetrics,
  outputTps,
} from "./streamPerf";
import { formatServiceMetaForDetail, formatServiceMetaSummary } from "./service-log-display";
import {
  formatJson,
  parseRequestMarkdownAnalysis,
  parseToolsMarkdown,
  reconstructResponseStructuredJson,
} from "./log-analysis";
import { logExportFilename, logExportZipEntries, MAX_LOG_EXPORT_IDS } from "./log-export";
import { zipFiles } from "@/lib/zip";

const PAGE_SIZE = 50;

/** Parse a masked-JSON header string into [key, value] entries (arrays joined). */
const parseHeaderEntries = (headersJson: string | undefined): Array<[string, string]> | null => {
  if (!headersJson) return null;
  try {
    const parsed = JSON.parse(headersJson) as Record<string, string | string[]>;
    return Object.entries(parsed).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : v]);
  } catch {
    return null;
  }
};

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function TabButton({ active, onClick, children }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[10px] px-2 py-0.5 rounded-t transition-colors ${
        active
          ? "bg-muted text-foreground font-medium border border-border border-b-0"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function HeaderList({ entries }: { entries: Array<[string, string]> }) {
  return (
    <dl className="space-y-0.5">
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-2 text-[11px] font-mono">
          <dt className="text-muted-foreground shrink-0">{k}:</dt>
          <dd className="break-all">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function Logs() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Record<string, unknown>>({});
  const [selectedLogId, setSelectedLogId] = useState<number | null>(null);
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [requestBodyCollapsed, setRequestBodyCollapsed] = useState(false);
  const [responseBodyCollapsed, setResponseBodyCollapsed] = useState(false);
  const [copiedSection, setCopiedSection] = useState<"request" | "response" | null>(null);
  const [requestTab, setRequestTab] = useState<
    "analysis" | "tools" | "converted" | "original" | "headers"
  >("analysis");
  const [responseTab, setResponseTab] = useState<"analysis" | "converted" | "original" | "headers">(
    "analysis"
  );
  const [refreshing, setRefreshing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Use ref for stable data access in callbacks
  const stateRef = useRef({
    allLogs: [] as LogEntry[],
    totalCount: 0,
    isLoadingMore: false,
    lastLogId: null as number | null,
  });

  const [, forceUpdate] = useState({});

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selectedLogId !== null) {
        setSelectedLogId(null);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedLogId]);

  // Expose state for render
  const allLogs = stateRef.current.allLogs;
  const totalCount = stateRef.current.totalCount;
  const isLoadingMore = stateRef.current.isLoadingMore;

  const setState = (updater: (state: typeof stateRef.current) => typeof stateRef.current) => {
    stateRef.current = updater(stateRef.current);
    forceUpdate({});
  };

  // Reset accumulated logs when filter changes
  const handleFilterChange = (key: string, value: unknown) => {
    console.log("[Logs] Filter changed, resetting data", key, value);
    setState(state => ({
      ...state,
      allLogs: [],
      totalCount: 0,
      lastLogId: null,
    }));
    setSelectedIds(new Set());
    setExportError(null);
    setFilter({ ...filter, [key]: value || undefined });
  };

  const currentOffset = allLogs.length;

  const { data: logsData, isLoading } = useQuery({
    queryKey: ["logs", filter, currentOffset],
    queryFn: () => {
      console.log("[Logs] Fetching logs with offset:", currentOffset);
      return api.getLogs({
        ...filter,
        limit: PAGE_SIZE,
        offset: currentOffset,
      });
    },
    enabled: currentOffset === 0,
    staleTime: 0,
  });

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setSelectedIds(new Set());
    setExportError(null);
    setState(state => ({
      ...state,
      allLogs: [],
      totalCount: 0,
      lastLogId: null,
      isLoadingMore: false,
    }));
    try {
      await queryClient.invalidateQueries({ queryKey: ["logs"] });
      const result = await queryClient.fetchQuery({
        queryKey: ["logs", filter, 0],
        queryFn: () =>
          api.getLogs({
            ...filter,
            limit: PAGE_SIZE,
            offset: 0,
          }),
        staleTime: 0,
      });
      setState(state => ({
        ...state,
        allLogs: result.logs,
        totalCount: result.total,
        lastLogId: result.logs[result.logs.length - 1]?.id ?? null,
        isLoadingMore: false,
      }));
      await queryClient.invalidateQueries({ queryKey: ["stats"] });
    } catch (error) {
      console.error("[Logs] Refresh failed:", error);
    } finally {
      setRefreshing(false);
    }
  }, [filter, queryClient]);

  // Append new logs when data changes
  useEffect(() => {
    if (logsData?.logs) {
      const lastLogId = stateRef.current.lastLogId;
      const isNewData = lastLogId !== logsData.logs[logsData.logs.length - 1]?.id;

      if (currentOffset === 0 || isNewData) {
        console.log("[Logs] Logs data received:", {
          receivedCount: logsData.logs.length,
          total: logsData.total,
          currentAllLogsCount: allLogs.length,
          isNewData,
        });

        if (currentOffset === 0) {
          setState(state => ({
            ...state,
            allLogs: logsData.logs,
            totalCount: logsData.total,
            lastLogId: logsData.logs[logsData.logs.length - 1]?.id ?? null,
            isLoadingMore: false,
          }));
        } else {
          setState(state => ({
            ...state,
            allLogs: [...state.allLogs, ...logsData.logs],
            totalCount: logsData.total,
            lastLogId: logsData.logs[logsData.logs.length - 1]?.id ?? state.lastLogId,
            isLoadingMore: false,
          }));
        }
      }
    }
  }, [logsData, currentOffset]);

  const hasMore = allLogs.length < totalCount;

  // Stable loadMore function using ref
  const loadMore = useCallback(async () => {
    const state = stateRef.current;
    const currentLength = state.allLogs.length;
    const currentTotal = state.totalCount;

    console.log("[Logs] loadMore called", {
      currentLength,
      currentTotal,
      hasMore: currentLength < currentTotal,
      isLoadingMore: state.isLoadingMore,
    });

    if (currentLength < currentTotal && !state.isLoadingMore) {
      setState(s => ({ ...s, isLoadingMore: true }));

      try {
        const result = await queryClient.fetchQuery({
          queryKey: ["logs", filter, currentLength],
          queryFn: () =>
            api.getLogs({
              ...filter,
              limit: PAGE_SIZE,
              offset: currentLength,
            }),
        });

        console.log("[Logs] Next page received:", result.logs.length, "logs");

        setState(s => ({
          ...s,
          allLogs: [...s.allLogs, ...result.logs],
          totalCount: result.total,
          lastLogId: result.logs[result.logs.length - 1]?.id ?? s.lastLogId,
          isLoadingMore: false,
        }));
      } catch (error) {
        console.error("[Logs] Error loading more:", error);
        setState(s => ({ ...s, isLoadingMore: false }));
      }
    }
  }, [filter, queryClient]);

  const clearLogsMutation = useMutation({
    mutationFn: () => api.clearAllLogs(),
    onSuccess: async () => {
      setShowClearDialog(false);

      // Clear local state first
      setState(state => ({
        ...state,
        allLogs: [],
        totalCount: 0,
        lastLogId: null,
      }));
      setSelectedIds(new Set());
      setExportError(null);

      // Remove all cached queries to force fresh fetch
      queryClient.removeQueries({ queryKey: ["logs"] });

      // Invalidate and refetch
      await queryClient.invalidateQueries({ queryKey: ["logs"] });
      await queryClient.refetchQueries({ queryKey: ["stats"] });
    },
  });

  const handleClearLogs = () => {
    setShowClearDialog(true);
  };

  const handleConfirmClear = () => {
    clearLogsMutation.mutate();
  };

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setExportError(null);
  };

  const loadedIds = allLogs.map(log => log.id);
  const allLoadedSelected = loadedIds.length > 0 && loadedIds.every(id => selectedIds.has(id));
  const someLoadedSelected = loadedIds.some(id => selectedIds.has(id));

  const toggleSelectAllLoaded = () => {
    setSelectedIds(prev => {
      if (loadedIds.length === 0) {
        return prev;
      }
      if (loadedIds.every(id => prev.has(id))) {
        const next = new Set(prev);
        for (const id of loadedIds) {
          next.delete(id);
        }
        return next;
      }
      const next = new Set(prev);
      for (const id of loadedIds) {
        next.add(id);
      }
      return next;
    });
    setExportError(null);
  };

  const handleExport = async () => {
    if (selectedIds.size === 0 || exporting) {
      return;
    }
    setExporting(true);
    setExportError(null);
    try {
      const ids = [...selectedIds].slice(0, MAX_LOG_EXPORT_IDS);
      const result = await api.getLogsByIds(ids);
      if (result.logs.length === 0) {
        setExportError(t("logs.exportEmpty"));
        return;
      }
      const zipBytes = await zipFiles(logExportZipEntries(result.logs));
      const blob = new Blob([Uint8Array.from(zipBytes)], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = logExportFilename();
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[Logs] Export failed:", err);
      setExportError(t("logs.exportFailed"));
    } finally {
      setExporting(false);
    }
  };

  const handleCopy = async (content: string, section: "request" | "response") => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedSection(section);
      setTimeout(() => setCopiedSection(null), 2000);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement("textarea");
      textArea.value = content;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setCopiedSection(section);
      setTimeout(() => setCopiedSection(null), 2000);
    }
  };

  const { data: stats } = useQuery({
    queryKey: ["stats"],
    queryFn: () => api.getStats(),
  });

  // Fetch full log details when a log is selected
  const { data: detailData, isLoading: detailLoading } = useQuery({
    queryKey: ["logDetail", selectedLogId],
    queryFn: () => api.getLogById(selectedLogId!),
    enabled: selectedLogId !== null,
  });

  // Reset tab states when log selection changes
  useEffect(() => {
    setRequestTab("analysis");
    setResponseTab("analysis");
  }, [selectedLogId]);

  const selectedLog = detailData?.log || null;

  const parsedRequestAnalysis = useMemo(() => {
    return selectedLog?.requestBody ? parseRequestMarkdownAnalysis(selectedLog.requestBody) : "";
  }, [selectedLog?.requestBody]);

  /** Parsed [key, value] entries for the masked request/response header JSON. */
  const parsedRequestHeaders = useMemo(
    () => parseHeaderEntries(selectedLog?.requestHeaders),
    [selectedLog?.requestHeaders]
  );
  const parsedResponseHeaders = useMemo(
    () => parseHeaderEntries(selectedLog?.responseHeaders),
    [selectedLog?.responseHeaders]
  );

  /** Pretty-printed merged message (SSE) or full JSON body (non-SSE). Empty when not reconstructable. */
  const responseStructuredJson = useMemo(() => {
    if (!selectedLog?.responseBody) {
      return "";
    }
    return reconstructResponseStructuredJson(selectedLog.responseBody);
  }, [selectedLog?.responseBody]);

  const hasStructuredResponseAnalysis = responseStructuredJson.length > 0;

  const parsedToolsMarkdown = useMemo(
    () => parseToolsMarkdown(selectedLog?.requestBody),
    [selectedLog?.requestBody]
  );

  const providers = stats?.byProvider ? Object.keys(stats.byProvider) : [];

  // Define table columns
  const columns: InfiniteTableColumn<LogEntry>[] = [
    {
      id: "select",
      header: (
        <div
          className="flex justify-center"
          onClick={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
        >
          <Checkbox
            checked={allLoadedSelected ? true : someLoadedSelected ? "indeterminate" : false}
            onCheckedChange={() => toggleSelectAllLoaded()}
            aria-label={t("logs.selectAllLoaded")}
            className="size-3.5"
          />
        </div>
      ),
      cell: log => (
        <div
          className="flex justify-center"
          onClick={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
        >
          <Checkbox
            checked={selectedIds.has(log.id)}
            onCheckedChange={() => toggleSelect(log.id)}
            aria-label={t("logs.selectRow", { id: log.id })}
            className="size-3.5"
          />
        </div>
      ),
      className: "text-center",
      headerClassName: "text-center px-1",
      width: 36,
    },
    {
      id: "id",
      header: t("logs.table.header.id"),
      cell: log => <span className="text-[11px] text-muted-foreground text-center">{log.id}</span>,
      className: "text-center",
      headerClassName: "text-center",
      width: 50,
    },
    {
      id: "method",
      header: t("logs.table.header.method"),
      cell: log => (
        <Badge variant="outline" className="font-mono text-[11px] px-1 py-0">
          {log.method}
        </Badge>
      ),
      width: 70,
    },
    {
      id: "routeType",
      header: t("logs.table.header.type"),
      cell: log => {
        if (!log.routeType) return <span className="text-[11px] text-muted-foreground">-</span>;
        // Legacy DB rows used `web-search`; treat as `service` for display.
        const raw = log.routeType as string;
        const rt = raw === "web-search" ? "service" : raw;
        const serviceBadge = (
          <span
            className="text-[11px] px-1.5 py-0 rounded bg-violet-500/10 text-violet-600 dark:text-violet-400"
            title={t("logs.table.routeType.serviceHint")}
          >
            {t("logs.table.routeType.service")}
          </span>
        );
        const typeMap: Record<string, React.ReactNode> = {
          block: (
            <span className="text-[11px] px-1.5 py-0 rounded bg-orange-500/10 text-orange-600">
              {t("logs.table.routeType.block")}
            </span>
          ),
          passthrough: (
            <span className="text-[11px] px-1.5 py-0 rounded bg-muted text-muted-foreground">
              {t("logs.table.routeType.pass")}
            </span>
          ),
          router: (
            <span className="text-[11px] px-1.5 py-0 rounded bg-sky-500/10 text-sky-600">
              {t("logs.table.routeType.route")}
            </span>
          ),
          service: serviceBadge,
        };
        return typeMap[rt] || <span className="text-[11px]">{log.routeType}</span>;
      },
      width: 70,
    },
    {
      id: "model",
      header: t("logs.table.header.model"),
      cell: log => {
        const hasMapping = log.mappedModel && log.mappedModel !== log.model;
        const title = hasMapping ? `${log.model} → ${log.mappedModel}` : log.model || "";
        return (
          <span className="font-mono text-[11px] block truncate" title={title}>
            {hasMapping ? (
              <>
                <span>{log.model}</span>
                <span className="text-muted-foreground"> → </span>
                <span>{log.mappedModel}</span>
              </>
            ) : (
              log.model || "-"
            )}
          </span>
        );
      },
      className: "hidden sm:table-cell",
      headerClassName: "hidden sm:table-cell",
      width: 260,
    },
    {
      id: "path",
      header: t("logs.table.header.path"),
      cell: log => (
        <span className="font-mono text-[11px] block truncate" title={log.path}>
          {log.path}
        </span>
      ),
      className: "hidden sm:table-cell",
      headerClassName: "hidden sm:table-cell",
      width: 200,
    },
    {
      id: "provider",
      header: t("logs.table.header.provider"),
      cell: log => <span className="text-[11px]">{log.providerName}</span>,
      width: 100,
    },
    {
      id: "status",
      header: t("logs.table.header.status"),
      cell: log => {
        const isPending = log.status === "pending";
        if (isPending) {
          return (
            <Badge variant="secondary" className="text-[11px] px-1.5 py-0 animate-pulse">
              {t("logs.table.status.pending")}
            </Badge>
          );
        }
        // Completed or failed
        const code = log.statusCode;
        if (code && code >= 400) {
          return (
            <Badge variant="destructive" className="text-[11px] px-1.5 py-0">
              {code}
            </Badge>
          );
        }
        if (code && code >= 200 && code < 300) {
          return (
            <Badge variant="success" className="text-[11px] px-1.5 py-0">
              {code}
            </Badge>
          );
        }
        // No status code
        return (
          <Badge variant={log.success ? "success" : "outline"} className="text-[11px] px-1.5 py-0">
            {log.success ? t("logs.table.status.ok") : t("logs.table.status.err")}
          </Badge>
        );
      },
      width: 70,
    },
    {
      id: "duration",
      header: t("logs.table.header.duration"),
      cell: log => <span className="text-[11px]">{log.duration}ms</span>,
      className: "hidden sm:table-cell",
      headerClassName: "hidden sm:table-cell",
      width: 70,
    },
    {
      id: "tokens",
      header: t("logs.table.header.tokens"),
      cell: log => {
        if (log.inputTokens == null && log.outputTokens == null)
          return <span className="text-[11px]">-</span>;
        const parts: string[] = [];
        if (log.inputTokens != null) parts.push(`${log.inputTokens}`);
        if (log.outputTokens != null) parts.push(`${log.outputTokens}`);
        if (log.cacheTokens != null && log.cacheTokens > 0) {
          const v =
            log.cacheTokens >= 1000
              ? `${(log.cacheTokens / 1000).toFixed(1)}K`
              : `${log.cacheTokens}`;
          parts.push(v);
        }
        return (
          <span
            className="font-mono text-[11px]"
            title={`In: ${log.inputTokens ?? 0} / Out: ${log.outputTokens ?? 0} / Cache: ${log.cacheTokens ?? 0}`}
          >
            {parts.join("/")}
          </span>
        );
      },
      className: "hidden md:table-cell",
      headerClassName: "hidden md:table-cell",
      width: 110,
    },
    {
      id: "ttfb",
      header: t("logs.table.header.ttfb"),
      headerTitle: t("logs.table.ttfbTooltip"),
      cell: log => {
        const ttfb = effectiveTtfb(log);
        if (ttfb == null) return <span className="text-[11px]">-</span>;
        return <span className="text-[11px]">{formatMs(ttfb)}</span>;
      },
      className: "hidden md:table-cell",
      headerClassName: "hidden md:table-cell",
      width: 70,
    },
    {
      id: "tps",
      header: t("logs.table.header.tps"),
      headerTitle: t("logs.table.tpsTooltip"),
      cell: log => {
        const tps = outputTps(log);
        if (tps == null) return <span className="text-[11px]">-</span>;
        const genTime = effectiveGenMs(log)!;
        return (
          <span
            className="font-mono text-[11px]"
            title={`${log.outputTokens} tokens / ${genTime}ms`}
          >
            {tps.toFixed(1)}
          </span>
        );
      },
      className: "hidden md:table-cell",
      headerClassName: "hidden md:table-cell",
      width: 55,
    },
    {
      id: "time",
      header: t("logs.table.header.time"),
      cell: log => (
        <span className="text-[11px] text-muted-foreground">
          {formatDistanceToNow(new Date(log.timestamp), { addSuffix: true })}
        </span>
      ),
      width: 120,
    },
    {
      id: "expand",
      header: "",
      cell: () => <ChevronRight className="h-3 w-3 text-muted-foreground" />,
      width: 30,
    },
  ];

  return (
    <div className="flex flex-col h-full gap-2 overflow-hidden">
      {/* Header Section - Fixed */}
      <div className="flex-shrink-0 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold tracking-tight">
              {selectedIds.size > 0
                ? t("logs.selectedCount", { count: selectedIds.size })
                : t("logs.title")}
            </h2>
            <p className="text-xs text-muted-foreground">
              {selectedIds.size > 0 ? t("logs.exportHint") : t("logs.subtitle")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => void handleExport()}
              disabled={selectedIds.size === 0 || exporting}
            >
              {exporting ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <Download className="h-3 w-3 mr-1" />
              )}
              {exporting ? t("logs.exporting") : `${t("logs.export")} (${selectedIds.size})`}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs text-destructive hover:text-destructive"
              onClick={handleClearLogs}
              disabled={clearLogsMutation.isPending}
            >
              <Trash2 className="h-3 w-3 mr-1" />
              {t("logs.clearAll")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => void handleRefresh()}
              disabled={refreshing}
            >
              {refreshing ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3 mr-1" />
              )}
              {t("common.refresh")}
            </Button>
          </div>
        </div>
        {exportError && <p className="text-xs text-destructive">{exportError}</p>}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <SelectField
            value={(filter.providerId as string) || ""}
            options={[
              { value: "", label: t("logs.filter.allProviders") },
              ...providers.map(p => ({ value: p, label: p })),
            ]}
            onChange={value => handleFilterChange("providerId", value || undefined)}
            className="h-7 w-auto min-w-[100px]"
          />
          <SelectField
            value={(filter.method as string) || ""}
            options={[
              { value: "", label: t("logs.filter.allMethods") },
              { value: "GET", label: "GET" },
              { value: "POST", label: "POST" },
              { value: "PUT", label: "PUT" },
              { value: "DELETE", label: "DELETE" },
            ]}
            onChange={value => handleFilterChange("method", value || undefined)}
            className="h-7 w-auto min-w-[80px]"
          />
          <Input
            placeholder={t("logs.filter.pathPlaceholder")}
            value={(filter.pathPattern as string) || ""}
            onChange={e => handleFilterChange("pathPattern", e.target.value || undefined)}
            className="h-7 w-auto max-w-[140px]"
          />
          <div className="flex items-center gap-1.5">
            <Checkbox
              id="logs-errors-only"
              checked={(filter.hasError as boolean) || false}
              onCheckedChange={checked =>
                handleFilterChange("hasError", checked === true ? true : undefined)
              }
              className="size-3.5"
            />
            <Label htmlFor="logs-errors-only" className="cursor-pointer text-xs font-normal">
              {t("logs.filter.errorsOnly")}
            </Label>
          </div>
          <span className="ml-auto text-muted-foreground">{`${totalCount} ${t("logs.filter.logCount")}`}</span>
        </div>
      </div>

      {/* Infinite Scroll Table - Takes remaining space */}
      <div className="flex-1 min-h-0">
        <InfiniteTable
          data={allLogs}
          columns={columns}
          isLoading={isLoading && allLogs.length === 0}
          isLoadingMore={isLoadingMore}
          hasMore={hasMore}
          onLoadMore={loadMore}
          keyExtractor={log => log.id}
          onRowClick={log => setSelectedLogId(log.id)}
          rowClassName={log => (selectedIds.has(log.id) ? "bg-muted/40" : "")}
          emptyMessage={t("logs.emptyMessage")}
          height="100%"
        />
      </div>

      {/* Log Detail Panel - Compact modal */}
      {selectedLogId && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-4">
          <Card className="w-full max-h-[90vh] flex flex-col max-w-[600px] sm:max-w-[800px] lg:max-w-[1000px]">
            <CardHeader className="border-b p-3 flex-shrink-0">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">{t("logs.detail.title")}</h3>
                  <p className="text-xs text-muted-foreground">
                    {t("logs.detail.id")} {selectedLogId}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => setSelectedLogId(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-4 space-y-4 flex-1 overflow-auto">
              {detailLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : selectedLog ? (
                <>
                  {/* Metadata - Compact single row */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs border-b pb-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">{t("logs.detail.method")}</span>
                      <Badge variant="outline" className="font-mono text-[11px] px-1.5 py-0">
                        {selectedLog.method}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">{t("logs.detail.status")}</span>
                      <Badge
                        variant={
                          selectedLog.status === "pending"
                            ? "outline"
                            : selectedLog.success
                              ? "success"
                              : "destructive"
                        }
                        className="text-[11px] px-1.5 py-0"
                      >
                        {selectedLog.status === "pending"
                          ? t("logs.detail.statusPending")
                          : selectedLog.statusCode ||
                            (selectedLog.success
                              ? t("logs.detail.statusOk")
                              : t("logs.detail.statusErr"))}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">{t("logs.detail.provider")}</span>
                      <span className="font-medium">{selectedLog.providerName}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">{t("logs.detail.duration")}</span>
                      <span className="font-medium font-mono">
                        {(selectedLog.totalMs ?? selectedLog.duration).toLocaleString()}ms
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 min-w-[120px]">
                      <span className="text-muted-foreground">{t("logs.detail.time")}</span>
                      <span className="font-medium text-[11px] text-muted-foreground">
                        {new Date(selectedLog.timestamp).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {/* Path - Full width */}
                  <div className="text-xs">
                    <span className="text-muted-foreground">{t("logs.detail.path")}</span>
                    <p className="font-mono text-[11px] break-all mt-0.5">{selectedLog.path}</p>
                  </div>

                  {selectedLog.routeType === "service" && selectedLog.serviceHandler ? (
                    <div className="text-xs">
                      <span className="text-muted-foreground">
                        {t("logs.detail.serviceHandler")}
                      </span>
                      <p className="font-mono text-[11px] mt-0.5">{selectedLog.serviceHandler}</p>
                      {formatServiceMetaSummary(
                        selectedLog.serviceHandler,
                        selectedLog.serviceMeta
                      ).map(line => (
                        <p
                          key={line}
                          className="font-mono text-[11px] mt-0.5 text-muted-foreground"
                        >
                          {line}
                        </p>
                      ))}
                    </div>
                  ) : null}

                  {selectedLog.routeType === "service" && selectedLog.serviceMeta ? (
                    <div className="text-xs">
                      <span className="text-muted-foreground">{t("logs.detail.serviceMeta")}</span>
                      <pre className="font-mono text-[11px] mt-0.5 whitespace-pre-wrap break-all bg-muted/40 rounded p-2">
                        {formatServiceMetaForDetail(selectedLog.serviceMeta)}
                      </pre>
                    </div>
                  ) : null}

                  {selectedLog.targetUrl && (
                    <div className="text-xs">
                      <span className="text-muted-foreground">{t("logs.detail.targetUrl")}</span>
                      <p className="font-mono text-[11px] break-all mt-0.5">
                        {selectedLog.targetUrl}
                      </p>
                    </div>
                  )}

                  {/* Model mapping */}
                  {selectedLog.model && (
                    <div className="text-xs">
                      <span className="text-muted-foreground">{t("logs.detail.model")}</span>
                      <p className="font-mono text-[11px] mt-0.5">
                        {selectedLog.mappedModel &&
                        selectedLog.mappedModel !== selectedLog.model ? (
                          <>
                            <span>{selectedLog.model}</span>
                            <span className="text-muted-foreground"> → </span>
                            <span>{selectedLog.mappedModel}</span>
                          </>
                        ) : (
                          selectedLog.model
                        )}
                      </p>
                    </div>
                  )}

                  {(selectedLog.inputTokens != null ||
                    selectedLog.outputTokens != null ||
                    selectedLog.cacheTokens != null) && (
                    <div className="text-xs">
                      <span className="text-muted-foreground">{t("logs.detail.tokens")}</span>
                      <p className="font-mono text-[11px] mt-0.5 flex gap-3">
                        {selectedLog.inputTokens != null && (
                          <span>
                            {t("logs.detail.tokenIn")}: {selectedLog.inputTokens.toLocaleString()}
                          </span>
                        )}
                        {selectedLog.outputTokens != null && (
                          <span>
                            {t("logs.detail.tokenOut")}: {selectedLog.outputTokens.toLocaleString()}
                          </span>
                        )}
                        {selectedLog.cacheTokens != null && selectedLog.cacheTokens > 0 && (
                          <span>
                            {t("logs.detail.tokenCache")}:{" "}
                            {selectedLog.cacheTokens.toLocaleString()}
                          </span>
                        )}
                      </p>
                    </div>
                  )}

                  {(selectedLog.queueWaitMs != null ||
                    selectedLog.upstreamTtfbMs != null ||
                    selectedLog.genMs != null ||
                    selectedLog.totalMs != null) && (
                    <div className="text-xs space-y-1">
                      <span className="text-muted-foreground">{t("logs.detail.timingPhases")}</span>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px] mt-0.5">
                        {selectedLog.queueWaitMs != null && (
                          <span>
                            {t("logs.detail.queueWait")}: {formatMs(selectedLog.queueWaitMs)}
                          </span>
                        )}
                        {selectedLog.upstreamTtfbMs != null && (
                          <span>
                            {t("logs.detail.upstreamTtfb")}: {formatMs(selectedLog.upstreamTtfbMs)}
                          </span>
                        )}
                        {selectedLog.genMs != null && (
                          <span>
                            {t("logs.detail.generation")}: {formatMs(selectedLog.genMs)}
                          </span>
                        )}
                        {selectedLog.totalMs != null && (
                          <span>
                            {t("logs.detail.totalTime")}: {formatMs(selectedLog.totalMs)}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {hasStreamPerfMetrics(selectedLog) && (
                    <div className="text-xs">
                      <span className="text-muted-foreground">{t("logs.detail.ttfb")}</span>
                      <p className="font-mono text-[11px] mt-0.5">
                        {formatMs(effectiveTtfb(selectedLog)!)}
                      </p>
                    </div>
                  )}

                  {(() => {
                    const tps = outputTps(selectedLog);
                    if (tps == null) return null;
                    const genTime = effectiveGenMs(selectedLog)!;
                    return (
                      <div className="text-xs">
                        <span className="text-muted-foreground">{t("logs.detail.outputTps")}</span>
                        <p className="font-mono text-[11px] mt-0.5">
                          {tps.toFixed(1)} t/s
                          <span className="text-muted-foreground ml-2">
                            ({selectedLog.outputTokens} tokens / {genTime}ms)
                          </span>
                        </p>
                      </div>
                    );
                  })()}

                  {selectedLog.errorMessage && (
                    <div className="text-xs">
                      <span className="text-muted-foreground">{t("logs.detail.error")}</span>
                      <p className="font-medium text-destructive text-[11px] mt-0.5">
                        {selectedLog.errorMessage}
                      </p>
                    </div>
                  )}

                  {selectedLog.requestBody && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <h4
                            className="text-xs font-medium flex items-center gap-1.5 cursor-pointer hover:text-foreground transition-colors"
                            onClick={() => setRequestBodyCollapsed(!requestBodyCollapsed)}
                          >
                            {requestBodyCollapsed ? (
                              <ChevronRight className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronDown className="h-3.5 w-3.5" />
                            )}
                            {t("logs.detail.requestBody")}
                          </h4>
                          {selectedLog.originalRequestBody && !requestBodyCollapsed && (
                            <div className="flex items-center -mb-2 ml-2">
                              <TabButton
                                active={requestTab === "analysis"}
                                onClick={() => setRequestTab("analysis")}
                              >
                                {t("logs.detail.tab.analysis")}
                              </TabButton>
                              {parsedToolsMarkdown && (
                                <TabButton
                                  active={requestTab === "tools"}
                                  onClick={() => setRequestTab("tools")}
                                >
                                  {t("logs.detail.tab.tools")}
                                </TabButton>
                              )}
                              <TabButton
                                active={requestTab === "converted"}
                                onClick={() => setRequestTab("converted")}
                              >
                                {t("logs.detail.tab.converted")}
                              </TabButton>
                              <TabButton
                                active={requestTab === "original"}
                                onClick={() => setRequestTab("original")}
                              >
                                {t("logs.detail.tab.original")}
                              </TabButton>
                              {parsedRequestHeaders && (
                                <TabButton
                                  active={requestTab === "headers"}
                                  onClick={() => setRequestTab("headers")}
                                >
                                  {t("logs.detail.requestHeaders")}
                                </TabButton>
                              )}
                            </div>
                          )}
                          {!selectedLog.originalRequestBody && !requestBodyCollapsed && (
                            <div className="flex items-center -mb-2 ml-2">
                              <TabButton
                                active={requestTab === "analysis"}
                                onClick={() => setRequestTab("analysis")}
                              >
                                {t("logs.detail.tab.analysis")}
                              </TabButton>
                              {parsedToolsMarkdown && (
                                <TabButton
                                  active={requestTab === "tools"}
                                  onClick={() => setRequestTab("tools")}
                                >
                                  {t("logs.detail.tab.tools")}
                                </TabButton>
                              )}
                              <TabButton
                                active={requestTab === "converted"}
                                onClick={() => setRequestTab("converted")}
                              >
                                {t("logs.detail.tab.raw")}
                              </TabButton>
                              {parsedRequestHeaders && (
                                <TabButton
                                  active={requestTab === "headers"}
                                  onClick={() => setRequestTab("headers")}
                                >
                                  {t("logs.detail.requestHeaders")}
                                </TabButton>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {requestTab !== "headers" && (
                            <span className="text-[10px] text-muted-foreground font-normal">
                              {
                                (requestTab === "original" && selectedLog.originalRequestBody
                                  ? selectedLog.originalRequestBody
                                  : selectedLog.requestBody
                                ).length
                              }{" "}
                              {t("logs.detail.chars")}
                            </span>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[10px]"
                            onClick={() => {
                              if (requestTab === "headers") {
                                handleCopy(
                                  JSON.stringify(
                                    parsedRequestHeaders
                                      ? Object.fromEntries(parsedRequestHeaders)
                                      : {},
                                    null,
                                    2
                                  ),
                                  "request"
                                );
                              } else if (requestTab === "analysis") {
                                handleCopy(parsedRequestAnalysis, "request");
                              } else if (requestTab === "tools" && parsedToolsMarkdown) {
                                handleCopy(parsedToolsMarkdown, "request");
                              } else {
                                handleCopy(
                                  formatJson(
                                    requestTab === "original" && selectedLog.originalRequestBody
                                      ? selectedLog.originalRequestBody
                                      : selectedLog.requestBody || ""
                                  ),
                                  "request"
                                );
                              }
                            }}
                          >
                            {copiedSection === "request" ? (
                              <>
                                <Check className="h-3 w-3 mr-1" />
                                {t("logs.detail.copied")}
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3 mr-1" />
                                {t("logs.detail.copy")}
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                      {!requestBodyCollapsed && (
                        <div className="bg-card border p-3 rounded overflow-auto max-h-[500px]">
                          {requestTab === "headers" ? (
                            <HeaderList entries={parsedRequestHeaders ?? []} />
                          ) : requestTab === "analysis" ? (
                            <MarkdownViewer content={parsedRequestAnalysis} />
                          ) : requestTab === "tools" && parsedToolsMarkdown ? (
                            <MarkdownViewer content={parsedToolsMarkdown} />
                          ) : (
                            <pre className="text-[11px] font-mono m-0 whitespace-pre text-muted-foreground">
                              {formatJson(
                                requestTab === "original" && selectedLog.originalRequestBody
                                  ? selectedLog.originalRequestBody
                                  : selectedLog.requestBody || ""
                              )}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {selectedLog.responseBody && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <h4
                            className="text-xs font-medium flex items-center gap-1.5 cursor-pointer hover:text-foreground transition-colors"
                            onClick={() => setResponseBodyCollapsed(!responseBodyCollapsed)}
                          >
                            {responseBodyCollapsed ? (
                              <ChevronRight className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronDown className="h-3.5 w-3.5" />
                            )}
                            {t("logs.detail.responseBody")}
                          </h4>
                          {selectedLog.originalResponseBody && !responseBodyCollapsed && (
                            <div className="flex items-center -mb-2 ml-2">
                              <TabButton
                                active={responseTab === "analysis"}
                                onClick={() => setResponseTab("analysis")}
                              >
                                {t("logs.detail.tab.analysis")}
                              </TabButton>
                              <TabButton
                                active={responseTab === "converted"}
                                onClick={() => setResponseTab("converted")}
                              >
                                {t("logs.detail.tab.converted")}
                              </TabButton>
                              <TabButton
                                active={responseTab === "original"}
                                onClick={() => setResponseTab("original")}
                              >
                                {t("logs.detail.tab.original")}
                              </TabButton>
                              {parsedResponseHeaders && (
                                <TabButton
                                  active={responseTab === "headers"}
                                  onClick={() => setResponseTab("headers")}
                                >
                                  {t("logs.detail.responseHeaders")}
                                </TabButton>
                              )}
                            </div>
                          )}
                          {!selectedLog.originalResponseBody && !responseBodyCollapsed && (
                            <div className="flex items-center -mb-2 ml-2">
                              <TabButton
                                active={responseTab === "analysis"}
                                onClick={() => setResponseTab("analysis")}
                              >
                                {t("logs.detail.tab.analysis")}
                              </TabButton>
                              <TabButton
                                active={responseTab === "converted"}
                                onClick={() => setResponseTab("converted")}
                              >
                                {t("logs.detail.tab.raw")}
                              </TabButton>
                              {parsedResponseHeaders && (
                                <TabButton
                                  active={responseTab === "headers"}
                                  onClick={() => setResponseTab("headers")}
                                >
                                  {t("logs.detail.responseHeaders")}
                                </TabButton>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {responseTab !== "headers" && (
                            <span className="text-[10px] text-muted-foreground font-normal">
                              {
                                (responseTab === "original" && selectedLog.originalResponseBody
                                  ? selectedLog.originalResponseBody
                                  : selectedLog.responseBody
                                ).length
                              }{" "}
                              {t("logs.detail.chars")}
                            </span>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[10px]"
                            onClick={() => {
                              if (responseTab === "headers") {
                                handleCopy(
                                  JSON.stringify(
                                    parsedResponseHeaders
                                      ? Object.fromEntries(parsedResponseHeaders)
                                      : {},
                                    null,
                                    2
                                  ),
                                  "response"
                                );
                              } else if (
                                responseTab === "analysis" &&
                                hasStructuredResponseAnalysis
                              ) {
                                handleCopy(responseStructuredJson, "response");
                              } else {
                                handleCopy(
                                  formatJson(
                                    responseTab === "original" && selectedLog.originalResponseBody
                                      ? selectedLog.originalResponseBody
                                      : selectedLog.responseBody || ""
                                  ),
                                  "response"
                                );
                              }
                            }}
                          >
                            {copiedSection === "response" ? (
                              <>
                                <Check className="h-3 w-3 mr-1" />
                                {t("logs.detail.copied")}
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3 mr-1" />
                                {t("logs.detail.copy")}
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                      {!responseBodyCollapsed && (
                        <div className="bg-card border p-3 rounded overflow-auto max-h-[500px]">
                          {responseTab === "headers" ? (
                            <HeaderList entries={parsedResponseHeaders ?? []} />
                          ) : responseTab === "analysis" && hasStructuredResponseAnalysis ? (
                            <pre className="text-[11px] font-mono m-0 whitespace-pre text-muted-foreground">
                              {responseStructuredJson}
                            </pre>
                          ) : (
                            <pre className="text-[11px] font-mono m-0 whitespace-pre text-muted-foreground">
                              {formatJson(
                                responseTab === "original" && selectedLog.originalResponseBody
                                  ? selectedLog.originalResponseBody
                                  : selectedLog.responseBody || ""
                              )}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-8 text-xs text-muted-foreground">
                  {t("logs.detail.loadError")}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Clear Logs Confirmation Dialog */}
      <AlertDialog open={showClearDialog} onOpenChange={setShowClearDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("logs.clearDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("logs.clearDialog.description")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearLogsMutation.isPending}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmClear} disabled={clearLogsMutation.isPending}>
              {clearLogsMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t("logs.clearDialog.clearing")}
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  {t("logs.clearDialog.action")}
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
