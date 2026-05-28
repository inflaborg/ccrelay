import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Loader2, RotateCw, Server, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/api/client";
import type { StatsRange } from "@/types/api";
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

      {/* Status Cards */}
      <div className="grid gap-2 grid-cols-1 sm:grid-cols-3">
        <Card className="p-0">
          <CardHeader className="flex flex-row items-center justify-between p-3 pb-1">
            <CardTitle className="text-xs font-medium">
              {t("dashboard.serverStatus.title")}
            </CardTitle>
            <Server className="h-3.5 w-3.5 text-muted-foreground" />
          </CardHeader>
          <CardContent className="p-3 pt-0">
            {statusLoading ? (
              <div className="h-6 animate-pulse bg-muted rounded" />
            ) : (
              <>
                <div className="text-lg font-bold">
                  {status?.status === "running"
                    ? t("dashboard.serverStatus.running")
                    : t("dashboard.serverStatus.stopped")}
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  <Badge
                    variant={status?.status === "running" ? "success" : "destructive"}
                    className="text-[10px] px-1.5 py-0"
                  >
                    {status?.port || t("common.na")}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">
                    {status?.host || t("common.na")}
                  </span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="p-0">
          <CardHeader className="flex flex-row items-center justify-between p-3 pb-1">
            <CardTitle className="text-xs font-medium">
              {t("dashboard.currentProvider.title")}
            </CardTitle>
            <Activity className="h-3.5 w-3.5 text-muted-foreground" />
          </CardHeader>
          <CardContent className="p-3 pt-0">
            {statusLoading ? (
              <div className="h-6 animate-pulse bg-muted rounded" />
            ) : (
              <>
                <div className="text-lg font-bold truncate">
                  {status?.providerName || t("dashboard.currentProvider.none")}
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    {status?.providerMode || t("common.na")}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground truncate">
                    {status?.currentProvider || t("common.na")}
                  </span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="p-0">
          <CardHeader className="flex flex-row items-center justify-between p-3 pb-1">
            <CardTitle className="text-xs font-medium">
              {t("dashboard.totalRequests.title")}
            </CardTitle>
            <Zap className="h-3.5 w-3.5 text-muted-foreground" />
          </CardHeader>
          <CardContent className="p-3 pt-0">
            {statsLoading ? (
              <div className="h-6 animate-pulse bg-muted rounded" />
            ) : (
              <>
                <div className="text-lg font-bold">{stats?.totalLogs || 0}</div>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-[10px] text-green-500">
                    {`${stats?.successCount || 0} ${t("dashboard.totalRequests.success")}`}
                  </span>
                  <span className="text-[10px] text-red-500">
                    {`${stats?.errorCount || 0} ${t("dashboard.totalRequests.errors")}`}
                  </span>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Performance + Token Usage */}
      <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
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
                  <span className="text-xs text-muted-foreground">
                    {t("dashboard.performance.avgTtfb")}
                  </span>
                  <span className="text-xs font-medium">{formatDuration(stats?.avgTtfb || 0)}</span>
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

      {/* Provider Breakdown */}
      {stats?.providerBreakdown && stats.providerBreakdown.length > 0 && (
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
