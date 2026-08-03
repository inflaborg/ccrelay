import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { api } from "@/api/client";
import type { StatsRange } from "@/types/api";

const UNKNOWN_MODEL = "(unknown)";

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

const modelChartConfig = {
  count: { label: "Requests", color: "hsl(var(--chart-1))" },
} satisfies ChartConfig;

export function ProviderDetailDialog({
  open,
  onOpenChange,
  providerId,
  providerName,
  range,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providerId: string | null;
  providerName: string;
  range: StatsRange;
}) {
  const { t } = useTranslation();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["provider-stats", providerId, range],
    queryFn: () => api.getProviderStats(providerId!, range),
    enabled: open && Boolean(providerId),
  });

  const modelChartData = data?.modelBreakdown?.length
    ? data.modelBreakdown.slice(0, 12).map(row => ({
        model: row.model === UNKNOWN_MODEL ? t("dashboard.providerDetail.unknownModel") : row.model,
        count: row.count,
        tokens: row.totalInputTokens + row.totalOutputTokens + row.totalCacheTokens,
      }))
    : [];

  const dailyChartData = data?.dailyBreakdown?.length
    ? data.dailyBreakdown.map(row => {
        const cache = row.totalCacheTokens;
        const nonCacheInput = Math.max(0, row.totalInputTokens - cache);
        return {
          day: row.day.slice(5),
          fullDay: row.day,
          count: row.count,
          nonCacheInput,
          cache,
          output: row.totalOutputTokens,
        };
      })
    : [];

  const titleName = data?.providerName || providerName || providerId || "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 border-b border-border px-4 py-3">
          <DialogTitle className="text-sm">{t("dashboard.providerDetail.title")}</DialogTitle>
          <DialogDescription className="text-xs">
            <span className="font-medium text-foreground">{titleName}</span>
            {providerId ? (
              <span className="ml-2 font-mono text-[10px] text-muted-foreground">{providerId}</span>
            ) : null}
            <span className="ml-2 text-muted-foreground">
              · {t(`dashboard.timeRange.${range}`)}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("dashboard.providerDetail.loading")}
            </div>
          ) : isError ? (
            <p className="py-8 text-center text-xs text-destructive">
              {(error as Error)?.message || t("dashboard.providerDetail.error")}
            </p>
          ) : !data || data.count === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              {t("dashboard.providerDetail.empty")}
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                <SummaryStat
                  label={t("dashboard.providerBreakdown.requests")}
                  value={data.count.toLocaleString()}
                />
                <SummaryStat
                  label={t("dashboard.totalRequests.success")}
                  value={data.successCount.toLocaleString()}
                />
                <SummaryStat
                  label={t("dashboard.performance.avgResponseTime")}
                  value={formatDuration(data.avgDuration)}
                />
                <SummaryStat
                  label={t("dashboard.tokens.input")}
                  value={formatTokenCount(data.totalInputTokens)}
                />
                <SummaryStat
                  label={t("dashboard.tokens.output")}
                  value={formatTokenCount(data.totalOutputTokens)}
                />
                <SummaryStat
                  label={t("dashboard.tokens.cacheHitRate")}
                  value={`${data.cacheHitRate}%`}
                />
              </div>

              {modelChartData.length > 0 ? (
                <Card className="p-0">
                  <CardHeader className="p-3 pb-1">
                    <CardTitle className="text-xs font-medium">
                      {t("dashboard.providerDetail.modelChart")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-3 pt-0">
                    <ChartContainer
                      config={modelChartConfig}
                      className="aspect-auto h-[220px] w-full"
                      initialDimension={{ width: 640, height: 220 }}
                    >
                      <BarChart
                        data={modelChartData}
                        layout="vertical"
                        margin={{ left: 8, right: 8, top: 4, bottom: 4 }}
                      >
                        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                        <YAxis
                          dataKey="model"
                          type="category"
                          width={110}
                          tickLine={false}
                          axisLine={false}
                          tick={{ fontSize: 10 }}
                        />
                        <XAxis
                          type="number"
                          tickLine={false}
                          axisLine={false}
                          tick={{ fontSize: 10 }}
                        />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Bar dataKey="count" fill="var(--color-count)" radius={2} />
                      </BarChart>
                    </ChartContainer>
                  </CardContent>
                </Card>
              ) : null}

              {dailyChartData.length > 0 ? (
                <>
                  <Card className="p-0">
                    <CardHeader className="p-3 pb-1">
                      <CardTitle className="text-xs font-medium">
                        {t("dashboard.providerDetail.dailyRequestsChart")}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-3 pt-0">
                      <ChartContainer
                        config={{
                          count: {
                            label: t("dashboard.providerBreakdown.requests"),
                            color: "hsl(var(--chart-1))",
                          },
                        }}
                        className="aspect-auto h-[180px] w-full"
                        initialDimension={{ width: 640, height: 180 }}
                      >
                        <LineChart
                          data={dailyChartData}
                          margin={{ left: 4, right: 8, top: 4, bottom: 0 }}
                        >
                          <CartesianGrid vertical={false} strokeDasharray="3 3" />
                          <XAxis
                            dataKey="day"
                            tickLine={false}
                            axisLine={false}
                            tick={{ fontSize: 10 }}
                          />
                          <YAxis
                            tickLine={false}
                            axisLine={false}
                            tick={{ fontSize: 10 }}
                            width={36}
                          />
                          <ChartTooltip
                            content={
                              <ChartTooltipContent
                                labelFormatter={(_, payload) => {
                                  const full = payload?.[0]?.payload?.fullDay;
                                  return typeof full === "string" ? full : String(_);
                                }}
                              />
                            }
                          />
                          <Line
                            type="monotone"
                            dataKey="count"
                            stroke="var(--color-count)"
                            strokeWidth={2}
                            dot={false}
                          />
                        </LineChart>
                      </ChartContainer>
                    </CardContent>
                  </Card>

                  <Card className="p-0">
                    <CardHeader className="p-3 pb-1">
                      <CardTitle className="text-xs font-medium">
                        {t("dashboard.providerDetail.dailyTokensChart")}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-3 pt-0">
                      <ChartContainer
                        config={{
                          nonCacheInput: {
                            label: t("dashboard.providerBreakdown.nonCacheInput"),
                            color: "hsl(var(--chart-1))",
                          },
                          cache: {
                            label: t("dashboard.tokens.cache"),
                            color: "hsl(var(--chart-3))",
                          },
                          output: {
                            label: t("dashboard.tokens.output"),
                            color: "hsl(var(--chart-2))",
                          },
                        }}
                        className="aspect-auto h-[200px] w-full"
                        initialDimension={{ width: 640, height: 200 }}
                      >
                        <LineChart
                          data={dailyChartData}
                          margin={{ left: 4, right: 8, top: 4, bottom: 0 }}
                        >
                          <CartesianGrid vertical={false} strokeDasharray="3 3" />
                          <XAxis
                            dataKey="day"
                            tickLine={false}
                            axisLine={false}
                            tick={{ fontSize: 10 }}
                          />
                          <YAxis
                            tickLine={false}
                            axisLine={false}
                            tick={{ fontSize: 10 }}
                            width={40}
                            tickFormatter={v => formatTokenCount(Number(v))}
                          />
                          <ChartTooltip
                            content={
                              <ChartTooltipContent
                                labelFormatter={(_, payload) => {
                                  const full = payload?.[0]?.payload?.fullDay;
                                  return typeof full === "string" ? full : String(_);
                                }}
                              />
                            }
                          />
                          <Line
                            type="monotone"
                            dataKey="nonCacheInput"
                            stroke="var(--color-nonCacheInput)"
                            strokeWidth={2}
                            dot={false}
                          />
                          <Line
                            type="monotone"
                            dataKey="cache"
                            stroke="var(--color-cache)"
                            strokeWidth={2}
                            dot={false}
                          />
                          <Line
                            type="monotone"
                            dataKey="output"
                            stroke="var(--color-output)"
                            strokeWidth={2}
                            dot={false}
                          />
                        </LineChart>
                      </ChartContainer>
                    </CardContent>
                  </Card>
                </>
              ) : null}

              {data.modelBreakdown.length > 0 ? (
                <Card className="p-0">
                  <CardHeader className="p-3 pb-2">
                    <CardTitle className="text-xs font-medium">
                      {t("dashboard.providerDetail.modelTable")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-3 pt-0">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border">
                            <th className="py-1.5 pr-3 text-left font-medium text-muted-foreground">
                              {t("dashboard.providerDetail.model")}
                            </th>
                            <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">
                              {t("dashboard.providerBreakdown.requests")}
                            </th>
                            <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">
                              {t("dashboard.tokens.input")}
                            </th>
                            <th className="px-2 py-1.5 text-right font-medium text-muted-foreground">
                              {t("dashboard.tokens.output")}
                            </th>
                            <th className="py-1.5 pl-2 text-right font-medium text-muted-foreground">
                              {t("dashboard.tokens.cache")}
                            </th>
                            <th className="py-1.5 pl-2 text-right font-medium text-muted-foreground">
                              {t("dashboard.providerBreakdown.cacheHitRate")}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.modelBreakdown.map(row => (
                            <tr key={row.model} className="border-b border-border last:border-0">
                              <td className="max-w-[200px] truncate py-1.5 pr-3 font-medium">
                                {row.model === UNKNOWN_MODEL
                                  ? t("dashboard.providerDetail.unknownModel")
                                  : row.model}
                              </td>
                              <td className="px-2 py-1.5 text-right font-mono">{row.count}</td>
                              <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">
                                {formatTokenCount(row.totalInputTokens)}
                              </td>
                              <td className="px-2 py-1.5 text-right font-mono">
                                {formatTokenCount(row.totalOutputTokens)}
                              </td>
                              <td className="py-1.5 pl-2 text-right font-mono text-muted-foreground">
                                {formatTokenCount(row.totalCacheTokens)}
                              </td>
                              <td className="py-1.5 pl-2 text-right font-mono">
                                {row.cacheHitRate != null ? `${row.cacheHitRate}%` : "-"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              ) : null}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card/50 px-2.5 py-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-mono text-xs font-medium">{value}</div>
    </div>
  );
}
