import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RotateCw, Database } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api } from "@/api/client";
import type { StatsRange, ServerStatus } from "@/types/api";
import { cn } from "@/lib/utils";
import QueueStatus from "./QueueStatus";

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatDuration(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${ms}ms`;
}

function formatListenAddress(host: string | undefined, port: number | undefined): string {
  if (!port) return "";
  const normalizedHost = host?.trim() || "127.0.0.1";
  return `${normalizedHost}:${port}`;
}

function getProviderDisplay(
  status: ServerStatus | undefined,
  t: (key: string) => string
): { label: string; hint: string | null } {
  if (!status) {
    return { label: t("common.na"), hint: null };
  }
  if (status.currentProvider === "smart-routing") {
    return { label: t("nav.smartRouting"), hint: null };
  }

  const label =
    status.providerName || status.currentProvider || t("dashboard.currentProvider.none");
  const hints: string[] = [];
  if (status.providerMode) hints.push(status.providerMode);
  if (
    status.currentProvider &&
    status.providerName &&
    status.currentProvider !== status.providerName
  ) {
    hints.push(status.currentProvider);
  }

  return { label, hint: hints.length > 0 ? hints.join(" · ") : null };
}

const RANGES: StatsRange[] = ["1d", "7d", "30d", "all"];

export default function Dashboard() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [range, setRange] = useState<StatsRange>("7d");

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ["status"],
    queryFn: () => api.getStatus(),
    refetchInterval: 5000,
  });

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["stats", range],
    queryFn: () => api.getStats(range),
    refetchInterval: 10000,
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["status"] }),
        queryClient.refetchQueries({ queryKey: ["stats", range] }),
        queryClient.refetchQueries({ queryKey: ["queue"] }),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  const provider = getProviderDisplay(status, t);
  const dbUnavailable = !statsLoading && stats?.dbAvailable === false;
  const totalLogs = stats?.totalLogs ?? 0;
  const successCount = stats?.successCount ?? 0;
  const errorCount = stats?.errorCount ?? 0;
  const successRate = totalLogs > 0 ? Math.round((successCount / totalLogs) * 100) : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold tracking-tight">{t("dashboard.title")}</h2>
          <p className="text-xs text-muted-foreground">{t("dashboard.subtitle")}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex rounded-md border border-border overflow-hidden">
            {RANGES.map(r => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`px-2 py-1 text-[11px] transition-colors ${
                  range === r
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-accent"
                }`}
              >
                {t(`dashboard.timeRange.${r}`)}
              </button>
            ))}
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1 shrink-0"
            onClick={handleRefresh}
            disabled={refreshing}
            title={t("common.refresh")}
          >
            {refreshing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RotateCw className="h-3 w-3" />
            )}
            <span className="hidden sm:inline">{t("common.refresh")}</span>
          </Button>
        </div>
      </div>

      {/* Overview + Performance / Token */}
      <div className="grid gap-2 grid-cols-1 lg:grid-cols-2">
        <Card className="p-0">
          <CardContent className="p-3 space-y-3">
            {statusLoading || statsLoading ? (
              <div className="h-[4.5rem] animate-pulse bg-muted rounded" />
            ) : (
              <>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        status?.status === "running" ? "bg-green-500" : "bg-muted-foreground"
                      )}
                      aria-hidden
                    />
                    <span className="text-sm font-semibold">
                      {status?.status === "running"
                        ? t("dashboard.serverStatus.running")
                        : t("dashboard.serverStatus.stopped")}
                    </span>
                  </div>
                  {status?.status === "running" && status.port ? (
                    <code className="text-[10px] text-muted-foreground font-mono shrink-0">
                      {formatListenAddress(status.host, status.port)}
                    </code>
                  ) : null}
                </div>

                <div className="border-t border-border pt-3 grid grid-cols-2 gap-4">
                  <div className="min-w-0">
                    <p className="text-[10px] text-muted-foreground mb-1">
                      {t("dashboard.currentProvider.title")}
                    </p>
                    <p className="text-base font-semibold truncate">{provider.label}</p>
                    {provider.hint ? (
                      <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                        {provider.hint}
                      </p>
                    ) : null}
                  </div>

                  <div>
                    <p className="text-[10px] text-muted-foreground mb-1">
                      {t("dashboard.totalRequests.title")}
                    </p>
                    {dbUnavailable ? (
                      <p className="text-base font-semibold text-muted-foreground">
                        {t("common.na")}
                      </p>
                    ) : (
                      <>
                        <p className="text-base font-semibold">{totalLogs}</p>
                        {totalLogs > 0 ? (
                          <>
                            <p className="text-[10px] mt-0.5">
                              <span className="text-green-600 dark:text-green-500">
                                {successCount} {t("dashboard.totalRequests.success")}
                              </span>
                              {errorCount > 0 ? (
                                <>
                                  <span className="text-muted-foreground mx-1">·</span>
                                  <span className="text-destructive">
                                    {errorCount} {t("dashboard.totalRequests.errors")}
                                  </span>
                                </>
                              ) : null}
                            </p>
                            <div
                              className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden"
                              role="presentation"
                            >
                              <div
                                className="h-full bg-green-500 transition-[width]"
                                style={{ width: `${successRate}%` }}
                              />
                            </div>
                          </>
                        ) : null}
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {dbUnavailable ? (
          <Card className="p-0 lg:col-span-1">
            <CardContent className="p-6 flex flex-col items-center justify-center text-center gap-2 min-h-[12rem]">
              <Database className="h-8 w-8 text-muted-foreground" aria-hidden />
              <p className="text-sm font-semibold">{t("dashboard.dbUnavailable.title")}</p>
              <p className="text-xs text-muted-foreground max-w-sm">
                {t("dashboard.dbUnavailable.description")}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:col-span-1">
            <Card className="p-0">
              <CardHeader className="p-3 pb-2">
                <CardTitle className="text-xs font-medium">
                  {t("dashboard.performance.title")}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                {statsLoading ? (
                  <div className="h-20 animate-pulse bg-muted rounded" />
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        {t("dashboard.performance.avgResponseTime")}
                      </span>
                      <span className="text-xs font-medium">
                        {formatDuration(stats?.avgDuration || 0)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        {t("dashboard.performance.p50Latency")}
                      </span>
                      <span className="text-xs font-medium">
                        {formatDuration(stats?.p50Duration || 0)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        {t("dashboard.performance.p90Latency")}
                      </span>
                      <span className="text-xs font-medium">
                        {formatDuration(stats?.p90Duration || 0)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span
                        className="text-xs text-muted-foreground"
                        title={t("dashboard.performance.avgTtfbTooltip")}
                      >
                        {t("dashboard.performance.avgTtfb")}
                      </span>
                      <span className="text-xs font-medium">
                        {stats?.avgTtfb ? formatDuration(stats.avgTtfb) : "-"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        {t("dashboard.performance.successRate")}
                      </span>
                      <span className="text-xs font-medium">
                        {stats?.totalLogs
                          ? `${Math.round((stats.successCount / stats.totalLogs) * 100)}%`
                          : t("common.na")}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span
                        className="text-xs text-muted-foreground"
                        title={t("dashboard.performance.outputTpsTooltip")}
                      >
                        {t("dashboard.performance.outputTps")}
                      </span>
                      <span className="text-xs font-medium">
                        {stats?.outputTps ? `${stats.outputTps.toFixed(1)} t/s` : "-"}
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="p-0">
              <CardHeader className="p-3 pb-2">
                <CardTitle className="text-xs font-medium">{t("dashboard.tokens.title")}</CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                {statsLoading ? (
                  <div className="h-20 animate-pulse bg-muted rounded" />
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        {t("dashboard.tokens.input")}
                      </span>
                      <span className="text-xs font-medium">
                        {formatTokenCount(stats?.totalInputTokens || 0)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        {t("dashboard.tokens.output")}
                      </span>
                      <span className="text-xs font-medium">
                        {formatTokenCount(stats?.totalOutputTokens || 0)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        {t("dashboard.tokens.cache")}
                      </span>
                      <span className="text-xs font-medium">
                        {formatTokenCount(stats?.totalCacheTokens || 0)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        {t("dashboard.tokens.cacheHitRate")}
                      </span>
                      <span className="text-xs font-medium">
                        {stats?.cacheHitRate != null ? `${stats.cacheHitRate}%` : "-"}
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Provider Breakdown */}
      {!dbUnavailable && stats?.providerBreakdown && stats.providerBreakdown.length > 0 && (
        <Card className="p-0">
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-xs font-medium">
              {t("dashboard.providerBreakdown.title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-1.5 pr-3 text-muted-foreground font-medium">
                      {t("dashboard.providerBreakdown.provider")}
                    </th>
                    <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">
                      {t("dashboard.providerBreakdown.requests")}
                    </th>
                    <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">
                      {t("dashboard.tokens.input")}
                    </th>
                    <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">
                      {t("dashboard.tokens.output")}
                    </th>
                    <th className="text-right py-1.5 pl-2 text-muted-foreground font-medium">
                      {t("dashboard.tokens.cache")}
                    </th>
                    <th className="text-right py-1.5 pl-2 text-muted-foreground font-medium">
                      {t("dashboard.providerBreakdown.cacheHitRate")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {stats.providerBreakdown.map(p => (
                    <tr key={p.providerId} className="border-b border-border last:border-0">
                      <td className="py-1.5 pr-3">
                        <div className="font-medium truncate max-w-[160px]">{p.providerName}</div>
                        <div className="text-[10px] text-muted-foreground">{p.providerId}</div>
                      </td>
                      <td className="text-right py-1.5 px-2 font-mono">{p.count}</td>
                      <td className="text-right py-1.5 px-2 font-mono text-muted-foreground">
                        {formatTokenCount(p.totalInputTokens)}
                      </td>
                      <td className="text-right py-1.5 px-2 font-mono">
                        {formatTokenCount(p.totalOutputTokens)}
                      </td>
                      <td className="text-right py-1.5 pl-2 font-mono text-muted-foreground">
                        {formatTokenCount(p.totalCacheTokens)}
                      </td>
                      <td className="text-right py-1.5 pl-2 font-mono">
                        {p.cacheHitRate != null ? `${p.cacheHitRate}%` : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <QueueStatus />
    </div>
  );
}
