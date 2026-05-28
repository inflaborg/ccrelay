import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, RefreshCw, Route } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/select-field";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { api } from "@/api/client";
import type {
  AliasDrift,
  SmartRoutingCatalogEntry,
  SmartRoutingProviderError,
  SmartRoutingSettings,
} from "@/types/api";

type DriftChoice = "update" | "keep";

function driftKey(d: AliasDrift): string {
  return `${d.providerId}:${d.lineIndex}`;
}

function catalogDisplayLabels(row: SmartRoutingCatalogEntry): string[] {
  const providerLabel =
    row.providerDisplayName && row.providerDisplayName !== row.providerId
      ? row.providerDisplayName
      : row.providerId;
  const modelLabel =
    row.displayName && row.displayName !== row.upstreamModelId
      ? row.displayName
      : row.upstreamModelId;
  return [`${providerLabel} · ${modelLabel}`];
}

function buildSettingsPayload(
  settings: SmartRoutingSettings,
  savedEnabled: boolean
): Record<string, unknown> {
  return {
    enabled: savedEnabled,
    aliasPrefix: settings.aliasPrefix,
    bareModelFallback: settings.bareModelFallback,
    exclude: settings.exclude,
    modelsCache: settings.modelsCache,
    include: settings.include,
  };
}

export default function SmartRouting() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<SmartRoutingSettings | null>(null);
  const [driftOpen, setDriftOpen] = useState(false);
  const [pendingDrifts, setPendingDrifts] = useState<AliasDrift[]>([]);
  const [driftChoices, setDriftChoices] = useState<Record<string, DriftChoice>>({});

  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: ["config"],
    queryFn: () => api.getConfig(),
  });

  const savedEnabled = config?.smartRouting?.enabled === true;

  const smartRouting = draft ??
    (config?.smartRouting as SmartRoutingSettings | undefined) ?? {
      enabled: false,
      aliasPrefix: "claude-",
      modelsCache: { ttlSeconds: 600, refreshOnStart: true, onUpstreamFail: "stale" },
      bareModelFallback: { mode: "first-match" },
      exclude: [],
    };

  const {
    data: catalog,
    isLoading: catalogLoading,
    isFetching: catalogFetching,
    refetch: refetchCatalog,
  } = useQuery({
    queryKey: ["smartRoutingCatalog"],
    queryFn: () => api.getSmartRoutingCatalog(),
    refetchInterval: 30_000,
  });

  const stats = catalog?.stats;
  const providerErrors = catalog?.providerErrors ?? [];

  const grouped = useMemo(() => {
    const map = new Map<string, SmartRoutingCatalogEntry[]>();
    for (const e of catalog?.entries ?? []) {
      const list = map.get(e.providerId) ?? [];
      list.push(e);
      map.set(e.providerId, list);
    }
    return map;
  }, [catalog?.entries]);

  const totalEntries = catalog?.entries?.length ?? 0;

  const saveMutation = useMutation({
    mutationFn: async (payload: SmartRoutingSettings) => {
      const drifts = await api.getSmartRoutingAliasDrift();
      if (drifts.drifts.length > 0) {
        setPendingDrifts(drifts.drifts);
        const initial: Record<string, DriftChoice> = {};
        for (const d of drifts.drifts) {
          initial[driftKey(d)] = d.collision ? "update" : "keep";
        }
        setDriftChoices(initial);
        setDraft(payload);
        setDriftOpen(true);
        return { deferred: true as const };
      }
      await api.patchConfig({
        section: "smartRouting",
        data: buildSettingsPayload(payload, savedEnabled),
      });
      return { deferred: false as const };
    },
    onSuccess: async result => {
      if (result.deferred) {
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["config"] });
      await queryClient.invalidateQueries({ queryKey: ["smartRoutingCatalog"] });
      setDraft(null);
    },
  });

  const applyDriftMutation = useMutation({
    mutationFn: async () => {
      const updates = pendingDrifts
        .filter(d => driftChoices[driftKey(d)] === "update")
        .map(d => ({ providerId: d.providerId, lineIndex: d.lineIndex }));
      if (updates.length > 0) {
        await api.applySmartRoutingAliasDrift({ updates });
      }
      if (draft) {
        await api.patchConfig({
          section: "smartRouting",
          data: buildSettingsPayload(draft, savedEnabled),
        });
      }
    },
    onSuccess: async () => {
      setDriftOpen(false);
      setPendingDrifts([]);
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: ["config"] });
      await queryClient.invalidateQueries({ queryKey: ["smartRoutingCatalog"] });
      await queryClient.invalidateQueries({ queryKey: ["providers"] });
    },
  });

  const refreshMutation = useMutation({
    mutationFn: () => api.refreshSmartRoutingCatalog(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["smartRoutingCatalog"] });
    },
  });

  const toggleExclude = (publicId: string, excluded: boolean) => {
    const exclude = new Set(smartRouting.exclude ?? []);
    if (excluded) {
      exclude.add(publicId);
    } else {
      exclude.delete(publicId);
    }
    setDraft({ ...smartRouting, exclude: [...exclude] });
  };

  const handleSave = () => {
    saveMutation.mutate(smartRouting);
  };

  const goToProviders = () => {
    window.location.hash = "providers";
  };

  const errorLabel = (err: SmartRoutingProviderError) =>
    t(`smartRouting.providerErrors.${err.errorCode}`, { providerId: err.providerId });

  if (configLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-xs">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        {t("common.refresh")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold tracking-tight flex items-center gap-1.5">
            <Route className="h-4 w-4" />
            {t("smartRouting.title")}
          </h2>
          <p className="text-xs text-muted-foreground">{t("smartRouting.subtitle")}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={refreshMutation.isPending}
            onClick={() => refreshMutation.mutate()}
          >
            {refreshMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            <span className="ml-1 hidden sm:inline">{t("smartRouting.refreshAll")}</span>
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-7 text-xs"
            disabled={saveMutation.isPending}
            onClick={handleSave}
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              t("common.save")
            )}
          </Button>
        </div>
      </div>

      <Card className="p-0">
        <CardHeader className="p-3 pb-2">
          <CardTitle className="text-xs font-medium">{t("smartRouting.settings.title")}</CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0 space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                {t("smartRouting.settings.aliasPrefix")}
              </Label>
              <Input
                className="h-8 text-xs"
                value={smartRouting.aliasPrefix ?? "claude-"}
                onChange={e => setDraft({ ...smartRouting, aliasPrefix: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                {t("smartRouting.settings.bareFallback")}
              </Label>
              <SelectField
                value={smartRouting.bareModelFallback?.mode ?? "first-match"}
                onChange={v =>
                  setDraft({
                    ...smartRouting,
                    bareModelFallback: { mode: v as "first-match" | "reject" },
                  })
                }
                options={[
                  { value: "first-match", label: t("smartRouting.settings.firstMatch") },
                  { value: "reject", label: t("smartRouting.settings.reject") },
                ]}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="p-0">
        <CardHeader className="p-3 pb-2 flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-xs font-medium">{t("smartRouting.catalog.title")}</CardTitle>
          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            {stats ? (
              <Badge variant="secondary" className="text-[10px]">
                {t("smartRouting.catalog.statsBadge", {
                  providers: stats.providerCount,
                  models: stats.modelCount,
                })}
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px]">
                {totalEntries} {t("smartRouting.catalog.models")}
              </Badge>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px]"
              disabled={catalogFetching}
              onClick={() => void refetchCatalog()}
            >
              {catalogFetching ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              <span className="ml-1">{t("smartRouting.catalog.reload")}</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-3 pt-0 space-y-2">
          {providerErrors.length > 0 ? (
            <div className="rounded border border-destructive/40 bg-destructive/5 p-2 space-y-1">
              <p className="text-xs font-medium flex items-center gap-1 text-destructive">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {t("smartRouting.providerErrors.title")}
              </p>
              <ul className="text-[10px] text-muted-foreground space-y-0.5">
                {providerErrors.map(err => (
                  <li key={err.providerId}>
                    {errorLabel(err)}
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto p-0 ml-1 text-[10px]"
                      onClick={goToProviders}
                    >
                      {t("smartRouting.providerErrors.editProvider")}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {!savedEnabled ? (
            <p className="text-[10px] text-muted-foreground">
              {t("smartRouting.catalog.previewHint")}
            </p>
          ) : null}

          {catalogLoading ? (
            <div className="h-24 animate-pulse bg-muted rounded" />
          ) : totalEntries === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">
              {providerErrors.length > 0
                ? t("smartRouting.catalog.emptyWithErrors")
                : t("smartRouting.catalog.empty")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-1.5 pr-2 text-muted-foreground font-medium">
                      {t("smartRouting.catalog.publicId")}
                    </th>
                    <th className="text-left py-1.5 px-2 text-muted-foreground font-medium">
                      {t("smartRouting.catalog.aliasHash")}
                    </th>
                    <th className="text-left py-1.5 px-2 text-muted-foreground font-medium">
                      {t("smartRouting.catalog.protocol")}
                    </th>
                    <th className="text-left py-1.5 px-2 text-muted-foreground font-medium">
                      {t("smartRouting.catalog.source")}
                    </th>
                    <th className="text-center py-1.5 pl-2 text-muted-foreground font-medium">
                      {t("smartRouting.catalog.excluded")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...grouped.entries()].map(([providerId, rows]) =>
                    rows.map(row => {
                      const excluded = (smartRouting.exclude ?? []).includes(row.publicId);
                      const displayLabels = catalogDisplayLabels(row);
                      return (
                        <tr key={row.publicId} className="border-b border-border last:border-0">
                          <td className="py-1.5 pr-2 font-mono text-[10px] max-w-[180px] truncate">
                            {row.publicId}
                            <div className="text-muted-foreground">{providerId}</div>
                          </td>
                          <td className="py-1.5 px-2 font-mono text-[10px]">
                            <div>{row.aliasHash}</div>
                            {displayLabels.length > 0 ? (
                              <div className="font-sans text-muted-foreground mt-0.5">
                                {displayLabels.join(" · ")}
                              </div>
                            ) : null}
                          </td>
                          <td className="py-1.5 px-2">{row.protocol}</td>
                          <td className="py-1.5 px-2">
                            <Badge variant="outline" className="text-[10px]">
                              {row.source}
                            </Badge>
                          </td>
                          <td className="py-1.5 pl-2 text-center">
                            <Checkbox
                              checked={excluded}
                              onCheckedChange={v => toggleExclude(row.publicId, v === true)}
                            />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={driftOpen} onOpenChange={setDriftOpen}>
        <AlertDialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("smartRouting.aliasDrift.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("smartRouting.aliasDrift.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 py-2">
            {pendingDrifts.map(d => (
              <div key={driftKey(d)} className="rounded border border-border p-2 text-xs space-y-1">
                <div className="font-medium flex items-center gap-1">
                  {d.collision && (
                    <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
                  )}
                  {d.providerId} / {d.upstreamModelId}
                </div>
                <div className="text-muted-foreground">
                  old: <span className="font-mono">{d.oldAlias}</span>
                </div>
                <div className="text-muted-foreground">
                  new: <span className="font-mono">{d.newAlias}</span>
                </div>
                {d.collision && d.collisionPeers && d.collisionPeers.length > 0 && (
                  <p className="text-destructive text-[10px]">
                    {t("smartRouting.aliasDrift.collisionWarning", {
                      peers: d.collisionPeers
                        .map(p => `${p.providerId}/${p.upstreamModelId}`)
                        .join(", "),
                    })}
                  </p>
                )}
                <div className="flex gap-3 pt-1">
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      name={`drift-${driftKey(d)}`}
                      checked={driftChoices[driftKey(d)] === "keep"}
                      onChange={() => setDriftChoices(prev => ({ ...prev, [driftKey(d)]: "keep" }))}
                    />
                    {t("smartRouting.aliasDrift.keep")}
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      name={`drift-${driftKey(d)}`}
                      checked={driftChoices[driftKey(d)] === "update"}
                      onChange={() =>
                        setDriftChoices(prev => ({ ...prev, [driftKey(d)]: "update" }))
                      }
                    />
                    {t("smartRouting.aliasDrift.update")}
                  </label>
                </div>
              </div>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const next: Record<string, DriftChoice> = {};
                for (const d of pendingDrifts) {
                  next[driftKey(d)] = d.collision ? "update" : "keep";
                }
                setDriftChoices(next);
              }}
            >
              {t("smartRouting.aliasDrift.keepAllNonCollision")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const next: Record<string, DriftChoice> = {};
                for (const d of pendingDrifts) {
                  next[driftKey(d)] = "update";
                }
                setDriftChoices(next);
              }}
            >
              {t("smartRouting.aliasDrift.updateAll")}
            </Button>
            <AlertDialogAction
              onClick={e => {
                e.preventDefault();
                applyDriftMutation.mutate();
              }}
              disabled={applyDriftMutation.isPending}
            >
              {applyDriftMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                t("common.apply")
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
