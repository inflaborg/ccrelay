import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Loader2, RotateCw, Server, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/api/client";
import ClientConfigStatus from "./ClientConfigStatus";

export default function Dashboard() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ["status"],
    queryFn: () => api.getStatus(),
    refetchInterval: 5000,
  });

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["stats"],
    queryFn: () => api.getStats(),
    refetchInterval: 10000,
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["status"] }),
        queryClient.refetchQueries({ queryKey: ["stats"] }),
        queryClient.refetchQueries({ queryKey: ["clientConfig"] }),
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

      {/* Status Cards - Compact grid */}
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
                  <span className="text-[10px] text-red-500">{`${stats?.errorCount || 0} ${t("dashboard.totalRequests.errors")}`}</span>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Performance Stats - Compact */}
      <Card className="p-0">
        <CardHeader className="p-3 pb-2">
          <CardTitle className="text-xs font-medium">{t("dashboard.performance.title")}</CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0">
          {statsLoading ? (
            <div className="h-12 animate-pulse bg-muted rounded" />
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {t("dashboard.performance.avgResponseTime")}
                </span>
                <span className="text-xs font-medium">{stats?.avgDuration || 0}ms</span>
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
                <span className="text-xs text-muted-foreground">
                  {t("dashboard.performance.providersUsed")}
                </span>
                <span className="text-xs font-medium">
                  {Object.keys(stats?.byProvider || {}).length}
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <ClientConfigStatus />
    </div>
  );
}
