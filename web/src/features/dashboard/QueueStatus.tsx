import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Layers, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api } from "@/api/client";
import type { QueueDetailStats } from "@/types/api";

function formatDuration(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${ms}ms`;
}

function shortenTaskId(id: string): string {
  if (id.length <= 20) return id;
  return `${id.slice(0, 12)}…${id.slice(-6)}`;
}

function QueueSection({
  name,
  stats,
  t,
}: {
  name: string;
  stats: QueueDetailStats;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const hasTasks = stats.processingTasks.length > 0 || stats.queuedTasks.length > 0;
  const utilization =
    stats.maxWorkers > 0 ? Math.round((stats.activeWorkers / stats.maxWorkers) * 100) : 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-medium truncate">{name}</span>
          {stats.activeWorkers >= stats.maxWorkers && stats.queueLength > 0 && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
              {t("dashboard.queue.saturated")}
            </Badge>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground shrink-0">
          {t("dashboard.queue.workers", {
            active: stats.activeWorkers,
            max: stats.maxWorkers,
          })}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="rounded border border-border px-2 py-1.5">
          <div className="text-[10px] text-muted-foreground">{t("dashboard.queue.processing")}</div>
          <div className="text-xs font-medium font-mono">
            {stats.activeWorkers}/{stats.maxWorkers}
            <span className="text-[10px] text-muted-foreground font-sans ml-1">
              ({utilization}%)
            </span>
          </div>
        </div>
        <div className="rounded border border-border px-2 py-1.5">
          <div className="text-[10px] text-muted-foreground">{t("dashboard.queue.waiting")}</div>
          <div className="text-xs font-medium font-mono">
            {stats.queueLength}/{stats.maxQueueSize}
          </div>
        </div>
        <div className="rounded border border-border px-2 py-1.5">
          <div className="text-[10px] text-muted-foreground">{t("dashboard.queue.avgWait")}</div>
          <div className="text-xs font-medium">{formatDuration(stats.avgWaitTime)}</div>
        </div>
        <div className="rounded border border-border px-2 py-1.5">
          <div className="text-[10px] text-muted-foreground">{t("dashboard.queue.avgProcess")}</div>
          <div className="text-xs font-medium">{formatDuration(stats.avgProcessTime)}</div>
        </div>
      </div>

      {hasTasks ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-1 pr-2 text-muted-foreground font-medium">
                  {t("dashboard.queue.taskId")}
                </th>
                <th className="text-left py-1 px-2 text-muted-foreground font-medium">
                  {t("dashboard.queue.taskState")}
                </th>
                <th className="text-right py-1 pl-2 text-muted-foreground font-medium">
                  {t("dashboard.queue.elapsed")}
                </th>
              </tr>
            </thead>
            <tbody>
              {stats.processingTasks.map(task => (
                <tr key={`p-${task.id}`} className="border-b border-border last:border-0">
                  <td className="py-1 pr-2 font-mono text-[10px]" title={task.id}>
                    {shortenTaskId(task.id)}
                  </td>
                  <td className="py-1 px-2">
                    <Badge variant="success" className="text-[10px] px-1.5 py-0">
                      {t("dashboard.queue.stateProcessing")}
                    </Badge>
                  </td>
                  <td className="py-1 pl-2 text-right font-mono">{formatDuration(task.elapsed)}</td>
                </tr>
              ))}
              {stats.queuedTasks.map(task => (
                <tr key={`q-${task.id}`} className="border-b border-border last:border-0">
                  <td className="py-1 pr-2 font-mono text-[10px]" title={task.id}>
                    {shortenTaskId(task.id)}
                  </td>
                  <td className="py-1 px-2">
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      {t("dashboard.queue.stateQueued")}
                    </Badge>
                  </td>
                  <td className="py-1 pl-2 text-right font-mono">{formatDuration(task.elapsed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-[10px] text-muted-foreground">{t("dashboard.queue.noActiveTasks")}</p>
      )}
    </div>
  );
}

export default function QueueStatus() {
  const { t } = useTranslation();

  const { data, isLoading } = useQuery({
    queryKey: ["queue"],
    queryFn: () => api.getQueueStats(),
    refetchInterval: 3000,
  });

  const sections: Array<{ name: string; stats: QueueDetailStats }> = [];
  if (data?.default) {
    sections.push({ name: t("dashboard.queue.defaultQueue"), stats: data.default });
  }
  if (data?.routes) {
    for (const [name, stats] of Object.entries(data.routes)) {
      sections.push({ name, stats });
    }
  }

  return (
    <Card className="p-0">
      <CardHeader className="flex flex-row items-center justify-between p-3 pb-2">
        <CardTitle className="text-xs font-medium">{t("dashboard.queue.title")}</CardTitle>
        <Layers className="h-3.5 w-3.5 text-muted-foreground" />
      </CardHeader>
      <CardContent className="p-3 pt-0 space-y-3">
        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t("dashboard.queue.loading")}
          </div>
        ) : !data?.enabled ? (
          <p className="text-xs text-muted-foreground">
            {data?.message ?? t("dashboard.queue.disabled")}
          </p>
        ) : sections.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("dashboard.queue.noQueues")}</p>
        ) : (
          sections.map((section, index) => (
            <div key={section.name}>
              {index > 0 && <div className="border-t border-border mb-3" />}
              <QueueSection name={section.name} stats={section.stats} t={t} />
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
