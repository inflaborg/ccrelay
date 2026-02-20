import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  ChevronRight,
  ChevronDown,
  Copy,
  Check,
  Loader2,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
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

const PAGE_SIZE = 50;

const formatJson = (str: string): string => {
  if (!str) return str;

  const trimmed = str.trim();

  // Check if it's SSE (Server-Sent Events) format - not JSON
  if (trimmed.startsWith("event:") || trimmed.startsWith("data:")) {
    return str;
  }

  // Try to parse and format JSON
  try {
    const parsed = JSON.parse(trimmed);
    return JSON.stringify(parsed, null, 2);
  } catch {
    // Return original if parse fails
    return str;
  }
};

const parseMarkdownAnalysis = (str: string, type: "request" | "response"): string => {
  if (!str) return "";

  const trimmed = str.trim();
  let markdown = "";

  try {
    if (type === "request") {
      const parsed = JSON.parse(trimmed);

      if (parsed.system) {
        markdown += `### System\n\n`;
        if (typeof parsed.system === "string") {
          markdown += `> ${parsed.system.replace(/\n/g, "\n> ")}\n\n`;
        } else if (Array.isArray(parsed.system)) {
          parsed.system.forEach((sys: Record<string, unknown>) => {
            if (sys.type === "text" && typeof sys.text === "string") {
              markdown += `> ${sys.text.replace(/\n/g, "\n> ")}\n\n`;
            }
          });
        }
      }

      if (Array.isArray(parsed.messages)) {
        parsed.messages.forEach((msg: Record<string, unknown>) => {
          markdown += `### ${msg.role === "user" ? "User" : "Assistant"}\n\n`;
          if (typeof msg.content === "string") {
            markdown += `${msg.content}\n\n`;
          } else if (Array.isArray(msg.content)) {
            msg.content.forEach((contentPart: Record<string, unknown>) => {
              if (contentPart.type === "text" && typeof contentPart.text === "string") {
                markdown += `${contentPart.text}\n\n`;
              } else if (contentPart.type === "image_url" || contentPart.type === "image") {
                markdown += `*[Image Attached]*\n\n`;
              } else if (contentPart.type === "tool_use") {
                markdown += `### Tool Use: \`${contentPart.name}\`\n\n`;
                markdown += `\`\`\`json\n`;
                const inputStr = JSON.stringify(contentPart.input, null, 2) || "{}";
                markdown += `${inputStr}\n`;
                markdown += `\`\`\`\n\n`;
              } else if (contentPart.type === "tool_result") {
                markdown += `### Tool Result\n\n`;
                let resultContent = "";
                if (typeof contentPart.content === "string") {
                  resultContent = contentPart.content;
                } else if (Array.isArray(contentPart.content)) {
                  // Some models return tool_result content as an array of text/image
                  resultContent = contentPart.content
                    .map((c: Record<string, unknown>) =>
                      typeof c.text === "string" ? c.text : JSON.stringify(c)
                    )
                    .join("\n");
                }
                if (resultContent) {
                  markdown += `\`\`\`text\n`;
                  markdown += `${resultContent}\n`;
                  markdown += `\`\`\`\n\n`;
                }
              }
            });
          }
        });
      }
    } else if (type === "response") {
      if (trimmed.startsWith("event:") || trimmed.startsWith("data:")) {
        // SSE parsing
        const lines = trimmed.split("\n");
        // State for aggregating tool uses across SSE chunks
        let currentToolName = "";
        let currentToolInput = "";

        lines.forEach(line => {
          if (line.startsWith("data: ")) {
            const dataStr = line.substring(6).trim();
            if (dataStr && dataStr !== "[DONE]") {
              try {
                const data = JSON.parse(dataStr);
                if (data.type === "content_block_start") {
                  if (data.content_block?.type === "text" && data.content_block?.text) {
                    markdown += data.content_block.text;
                  } else if (data.content_block?.type === "tool_use") {
                    currentToolName = data.content_block.name || "unknown_tool";
                    currentToolInput = "";
                  }
                } else if (data.type === "content_block_delta") {
                  if (data.delta?.type === "text_delta" && data.delta?.text) {
                    markdown += data.delta.text;
                  } else if (data.delta?.type === "input_json_delta" && data.delta?.partial_json) {
                    currentToolInput += data.delta.partial_json;
                  }
                } else if (data.type === "content_block_stop") {
                  if (currentToolName) {
                    markdown += `\n\n### Tool Use: \`${currentToolName}\`\n\n`;
                    markdown += `\`\`\`json\n`;
                    try {
                      // Attempt to pretty print the aggregated JSON
                      const parsedJson = JSON.parse(currentToolInput);
                      markdown += JSON.stringify(parsedJson, null, 2) + "\n";
                    } catch {
                      // Fallback to raw string if incomplete or malformed
                      markdown += currentToolInput + "\n";
                    }
                    markdown += `\`\`\`\n\n`;
                    currentToolName = "";
                    currentToolInput = "";
                  }
                }
              } catch {
                // Ignore parsing errors for individual SSE lines
              }
            }
          }
        });
      } else {
        // JSON parsing
        const parsed = JSON.parse(trimmed);
        if (parsed.content && Array.isArray(parsed.content)) {
          parsed.content.forEach((c: Record<string, unknown>) => {
            if (c.type === "text" && typeof c.text === "string") {
              markdown += c.text;
            } else if (c.type === "tool_use") {
              markdown += `\n\n### Tool Use: \`${c.name}\`\n\n`;
              markdown += `\`\`\`json\n`;
              const inputStr = JSON.stringify(c.input, null, 2) || "{}";
              markdown += `${inputStr}\n`;
              markdown += `\`\`\`\n\n`;
            } else if (c.type === "tool_result") {
              markdown += `\n\n### Tool Result\n\n`;
              let resultContent = "";
              if (typeof c.content === "string") {
                resultContent = c.content;
              } else if (Array.isArray(c.content)) {
                resultContent = c.content
                  .map((item: Record<string, unknown>) =>
                    typeof item.text === "string" ? item.text : JSON.stringify(item)
                  )
                  .join("\n");
              }
              if (resultContent) {
                markdown += `\`\`\`text\n`;
                markdown += `${resultContent}\n`;
                markdown += `\`\`\`\n\n`;
              }
            }
          });
        } else if (typeof parsed.content === "string") {
          markdown += parsed.content;
        }
      }
    }

    return markdown.trim() || "*No parseable content found.*";
  } catch {
    return "*Failed to parse content into markdown.*";
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

export default function Logs() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Record<string, unknown>>({});
  const [selectedLogId, setSelectedLogId] = useState<number | null>(null);
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [requestBodyCollapsed, setRequestBodyCollapsed] = useState(false);
  const [responseBodyCollapsed, setResponseBodyCollapsed] = useState(false);
  const [copiedSection, setCopiedSection] = useState<"request" | "response" | null>(null);
  const [requestTab, setRequestTab] = useState<"analysis" | "converted" | "original">("analysis");
  const [responseTab, setResponseTab] = useState<"analysis" | "converted" | "original">("analysis");

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
  });

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
    return selectedLog?.requestBody
      ? parseMarkdownAnalysis(selectedLog.requestBody, "request")
      : "";
  }, [selectedLog?.requestBody]);

  const parsedResponseAnalysis = useMemo(() => {
    return selectedLog?.responseBody
      ? parseMarkdownAnalysis(selectedLog.responseBody, "response")
      : "";
  }, [selectedLog?.responseBody]);

  const hasValidResponseAnalysis = useMemo(() => {
    return (
      parsedResponseAnalysis &&
      !parsedResponseAnalysis.includes("*No parseable content found.*") &&
      !parsedResponseAnalysis.includes("*Failed to parse content into markdown.*")
    );
  }, [parsedResponseAnalysis]);

  const providers = stats?.byProvider ? Object.keys(stats.byProvider) : [];

  // Define table columns
  const columns: InfiniteTableColumn<LogEntry>[] = [
    {
      id: "id",
      header: "ID",
      cell: log => <span className="text-[11px] text-muted-foreground text-center">{log.id}</span>,
      className: "text-center",
      headerClassName: "text-center",
      width: 50,
    },
    {
      id: "method",
      header: "Method",
      cell: log => (
        <Badge variant="outline" className="font-mono text-[11px] px-1 py-0">
          {log.method}
        </Badge>
      ),
      width: 70,
    },
    {
      id: "routeType",
      header: "Type",
      cell: log => {
        if (!log.routeType) return <span className="text-[11px] text-muted-foreground">-</span>;
        const typeMap = {
          block: (
            <span className="text-[11px] px-1.5 py-0 rounded bg-orange-500/10 text-orange-600">
              Block
            </span>
          ),
          passthrough: (
            <span className="text-[11px] px-1.5 py-0 rounded bg-muted text-muted-foreground">
              Pass
            </span>
          ),
          router: (
            <span className="text-[11px] px-1.5 py-0 rounded bg-sky-500/10 text-sky-600">
              Route
            </span>
          ),
        };
        return typeMap[log.routeType] || <span className="text-[11px]">{log.routeType}</span>;
      },
      width: 70,
    },
    {
      id: "model",
      header: "Model",
      cell: log => (
        <span className="font-mono text-[11px] block truncate" title={log.model}>
          {log.model || "-"}
        </span>
      ),
      className: "hidden sm:table-cell",
      headerClassName: "hidden sm:table-cell",
      width: 120,
    },
    {
      id: "path",
      header: "Path",
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
      header: "Provider",
      cell: log => <span className="text-[11px]">{log.providerName}</span>,
      width: 100,
    },
    {
      id: "status",
      header: "Status",
      cell: log => {
        const isPending = log.status === "pending";
        if (isPending) {
          return (
            <Badge variant="secondary" className="text-[11px] px-1.5 py-0 animate-pulse">
              Pending
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
            {log.success ? "OK" : "Err"}
          </Badge>
        );
      },
      width: 70,
    },
    {
      id: "duration",
      header: "Duration",
      cell: log => <span className="text-[11px]">{log.duration}ms</span>,
      className: "hidden sm:table-cell",
      headerClassName: "hidden sm:table-cell",
      width: 70,
    },
    {
      id: "time",
      header: "Time",
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
            <h2 className="text-base font-semibold tracking-tight">Request Logs</h2>
            <p className="text-xs text-muted-foreground">View and analyze API request logs</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs text-destructive hover:text-destructive"
              onClick={handleClearLogs}
              disabled={clearLogsMutation.isPending}
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Clear All
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                setState(state => ({ ...state, allLogs: [], totalCount: 0, lastLogId: null }));
                queryClient.refetchQueries({ queryKey: ["logs"] });
                queryClient.refetchQueries({ queryKey: ["stats"] });
              }}
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Select
            value={(filter.providerId as string) || ""}
            options={[
              { value: "", label: "All Providers" },
              ...providers.map(p => ({ value: p, label: p })),
            ]}
            onChange={value => handleFilterChange("providerId", value || undefined)}
            className="h-7 w-auto min-w-[100px]"
          />
          <Select
            value={(filter.method as string) || ""}
            options={[
              { value: "", label: "All Methods" },
              { value: "GET", label: "GET" },
              { value: "POST", label: "POST" },
              { value: "PUT", label: "PUT" },
              { value: "DELETE", label: "DELETE" },
            ]}
            onChange={value => handleFilterChange("method", value || undefined)}
            className="h-7 w-auto min-w-[80px]"
          />
          <Input
            placeholder="Filter path..."
            value={(filter.pathPattern as string) || ""}
            onChange={e => handleFilterChange("pathPattern", e.target.value || undefined)}
            className="h-7 w-auto max-w-[140px]"
          />
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={(filter.hasError as boolean) || false}
              onChange={e => handleFilterChange("hasError", e.target.checked ? true : undefined)}
              className="rounded h-3 w-3"
            />
            Errors only
          </label>
          <span className="ml-auto text-muted-foreground">{totalCount} logs</span>
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
          emptyMessage="No logs found. Make sure log storage is enabled."
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
                  <h3 className="text-sm font-semibold">Log Details</h3>
                  <p className="text-xs text-muted-foreground">ID: {selectedLogId}</p>
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
                      <span className="text-muted-foreground">Method</span>
                      <Badge variant="outline" className="font-mono text-[11px] px-1.5 py-0">
                        {selectedLog.method}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">Status</span>
                      <Badge
                        variant={selectedLog.success ? "success" : "destructive"}
                        className="text-[11px] px-1.5 py-0"
                      >
                        {selectedLog.statusCode || (selectedLog.success ? "OK" : "Err")}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">Provider</span>
                      <span className="font-medium">{selectedLog.providerName}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">Duration</span>
                      <span className="font-medium font-mono">{selectedLog.duration}ms</span>
                    </div>
                    <div className="flex items-center gap-1.5 min-w-[120px]">
                      <span className="text-muted-foreground">Time</span>
                      <span className="font-medium text-[11px] text-muted-foreground">
                        {new Date(selectedLog.timestamp).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {/* Path - Full width */}
                  <div className="text-xs">
                    <span className="text-muted-foreground">Path</span>
                    <p className="font-medium font-mono text-[11px] break-all mt-0.5">
                      {selectedLog.path}
                    </p>
                  </div>

                  {selectedLog.targetUrl && (
                    <div className="text-xs">
                      <span className="text-muted-foreground">Target URL</span>
                      <p className="font-medium font-mono text-[11px] break-all mt-0.5">
                        {selectedLog.targetUrl}
                      </p>
                    </div>
                  )}

                  {selectedLog.errorMessage && (
                    <div className="text-xs">
                      <span className="text-muted-foreground">Error</span>
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
                            Request Body
                          </h4>
                          {selectedLog.originalRequestBody && !requestBodyCollapsed && (
                            <div className="flex items-center -mb-2 ml-2">
                              <TabButton
                                active={requestTab === "analysis"}
                                onClick={() => setRequestTab("analysis")}
                              >
                                Analysis
                              </TabButton>
                              <TabButton
                                active={requestTab === "converted"}
                                onClick={() => setRequestTab("converted")}
                              >
                                Converted
                              </TabButton>
                              <TabButton
                                active={requestTab === "original"}
                                onClick={() => setRequestTab("original")}
                              >
                                Original
                              </TabButton>
                            </div>
                          )}
                          {!selectedLog.originalRequestBody && !requestBodyCollapsed && (
                            <div className="flex items-center -mb-2 ml-2">
                              <TabButton
                                active={requestTab === "analysis"}
                                onClick={() => setRequestTab("analysis")}
                              >
                                Analysis
                              </TabButton>
                              <TabButton
                                active={requestTab === "converted"}
                                onClick={() => setRequestTab("converted")}
                              >
                                Raw
                              </TabButton>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground font-normal">
                            {
                              (requestTab === "original" && selectedLog.originalRequestBody
                                ? selectedLog.originalRequestBody
                                : selectedLog.requestBody
                              ).length
                            }{" "}
                            chars
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[10px]"
                            onClick={() => {
                              if (requestTab === "analysis") {
                                handleCopy(parsedRequestAnalysis, "request");
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
                                Copied
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3 mr-1" />
                                Copy
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                      {!requestBodyCollapsed && (
                        <div className="bg-card border p-3 rounded overflow-auto max-h-[500px]">
                          {requestTab === "analysis" ? (
                            <MarkdownViewer content={parsedRequestAnalysis} />
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
                            Response Body
                          </h4>
                          {selectedLog.originalResponseBody &&
                            !responseBodyCollapsed &&
                            hasValidResponseAnalysis && (
                              <div className="flex items-center -mb-2 ml-2">
                                <TabButton
                                  active={responseTab === "analysis"}
                                  onClick={() => setResponseTab("analysis")}
                                >
                                  Analysis
                                </TabButton>
                                <TabButton
                                  active={responseTab === "converted"}
                                  onClick={() => setResponseTab("converted")}
                                >
                                  Converted
                                </TabButton>
                                <TabButton
                                  active={responseTab === "original"}
                                  onClick={() => setResponseTab("original")}
                                >
                                  Original
                                </TabButton>
                              </div>
                            )}
                          {!selectedLog.originalResponseBody &&
                            !responseBodyCollapsed &&
                            hasValidResponseAnalysis && (
                              <div className="flex items-center -mb-2 ml-2">
                                <TabButton
                                  active={responseTab === "analysis"}
                                  onClick={() => setResponseTab("analysis")}
                                >
                                  Analysis
                                </TabButton>
                                <TabButton
                                  active={responseTab === "converted"}
                                  onClick={() => setResponseTab("converted")}
                                >
                                  Raw
                                </TabButton>
                              </div>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground font-normal">
                            {
                              (responseTab === "original" && selectedLog.originalResponseBody
                                ? selectedLog.originalResponseBody
                                : selectedLog.responseBody
                              ).length
                            }{" "}
                            chars
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-[10px]"
                            onClick={() => {
                              if (hasValidResponseAnalysis && responseTab === "analysis") {
                                handleCopy(parsedResponseAnalysis, "response");
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
                                Copied
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3 mr-1" />
                                Copy
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                      {!responseBodyCollapsed && (
                        <div className="bg-card border p-3 rounded overflow-auto max-h-[500px]">
                          {hasValidResponseAnalysis && responseTab === "analysis" ? (
                            <MarkdownViewer content={parsedResponseAnalysis} />
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
                  Failed to load log details
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
            <AlertDialogTitle>Clear All Logs</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to clear all logs? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearLogsMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmClear} disabled={clearLogsMutation.isPending}>
              {clearLogsMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Clearing...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Clear All
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
