import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Loader2,
  Plus,
  RefreshCw,
  Route,
  ShieldCheck,
  Trash2,
} from "lucide-react";
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
  SmartRoutingModelRule,
  SmartRoutingProviderError,
  SmartRoutingSettings,
} from "@/types/api";
import { matchesSmartRoutingExclude } from "@/utils/glob";

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

type CoreSettingsDraft = Pick<SmartRoutingSettings, "aliasPrefix" | "bareModelFallback">;

function buildCoreSettingsPayload(
  settings: CoreSettingsDraft,
  savedEnabled: boolean
): Record<string, unknown> {
  return {
    enabled: savedEnabled,
    aliasPrefix: settings.aliasPrefix,
    bareModelFallback: settings.bareModelFallback,
  };
}

function modelRulesForPersist(rules: SmartRoutingModelRule[]): SmartRoutingModelRule[] {
  return rules.filter(r => r.pattern.trim() && r.provider.trim() && r.model.trim());
}

function isIncompleteRule(r: SmartRoutingModelRule): boolean {
  return !(r.pattern.trim() && r.provider.trim() && r.model.trim());
}

function emptyModelRule(): SmartRoutingModelRule {
  return { pattern: "", provider: "", model: "", enabled: true };
}

function moveModelRule(
  rules: SmartRoutingModelRule[],
  index: number,
  direction: -1 | 1
): SmartRoutingModelRule[] {
  const next = [...rules];
  const target = index + direction;
  if (target < 0 || target >= next.length) {
    return next;
  }
  const tmp = next[index];
  next[index] = next[target]!;
  next[target] = tmp!;
  return next;
}

/** Shared column template for custom rules header + rows. */
const CUSTOM_RULES_GRID =
  "grid grid-cols-[2.25rem_minmax(0,1.15fr)_minmax(0,1.35fr)_minmax(0,1fr)_2.25rem_2rem] gap-x-2";

export default function SmartRouting() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [settingsDraft, setSettingsDraft] = useState<CoreSettingsDraft | null>(null);
  const [modelRulesOverride, setModelRulesOverride] = useState<SmartRoutingModelRule[] | null>(
    null
  );
  const [excludeOverride, setExcludeOverride] = useState<string[] | null>(null);
  const modelRulesSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [driftOpen, setDriftOpen] = useState(false);
  const [pendingDrifts, setPendingDrifts] = useState<AliasDrift[]>([]);
  const [driftChoices, setDriftChoices] = useState<Record<string, DriftChoice>>({});
  const [pendingCoreSettings, setPendingCoreSettings] = useState<CoreSettingsDraft | null>(null);
  const [validateOk, setValidateOk] = useState(false);
  const validateOkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: ["config"],
    queryFn: () => api.getConfig(),
  });

  const { data: providersData } = useQuery({
    queryKey: ["providers"],
    queryFn: () => api.getProviders(),
  });

  const providerOptions = useMemo(() => {
    const list = providersData?.providers ?? [];
    return list
      .filter(p => p.enabled !== false)
      .map(p => ({ value: p.id, label: p.name !== p.id ? `${p.name} (${p.id})` : p.id }));
  }, [providersData?.providers]);

  const savedEnabled = config?.smartRouting?.enabled === true;
  const savedSmartRouting = config?.smartRouting as SmartRoutingSettings | undefined;
  const savedModelRules = savedSmartRouting?.modelRules ?? [];
  const savedExclude = savedSmartRouting?.exclude ?? [];
  const modelRules = modelRulesOverride ?? savedModelRules;
  const exclude = excludeOverride ?? savedExclude;

  const coreSettings: CoreSettingsDraft = settingsDraft ?? {
    aliasPrefix: savedSmartRouting?.aliasPrefix ?? "claude-",
    bareModelFallback: savedSmartRouting?.bareModelFallback ?? { mode: "first-match" },
  };

  const coreSettingsDirty =
    coreSettings.aliasPrefix !== (savedSmartRouting?.aliasPrefix ?? "claude-") ||
    (coreSettings.bareModelFallback?.mode ?? "first-match") !==
      (savedSmartRouting?.bareModelFallback?.mode ?? "first-match");

  const autoSaveMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api.patchConfig({ section: "smartRouting", data }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["config"] });
      setExcludeOverride(null);
      setModelRulesOverride(prev => (prev && prev.some(isIncompleteRule) ? prev : null));
    },
  });

  const persistModelRules = useCallback(
    (rules: SmartRoutingModelRule[]) => {
      const persisted = modelRulesForPersist(rules);
      autoSaveMutation.mutate({
        modelRules: persisted.length > 0 ? persisted : [],
      });
    },
    [autoSaveMutation]
  );

  const scheduleModelRulesSave = useCallback(
    (rules: SmartRoutingModelRule[]) => {
      if (modelRulesSaveTimer.current) {
        clearTimeout(modelRulesSaveTimer.current);
      }
      modelRulesSaveTimer.current = setTimeout(() => {
        persistModelRules(rules);
      }, 450);
    },
    [persistModelRules]
  );

  useEffect(() => {
    return () => {
      if (modelRulesSaveTimer.current) {
        clearTimeout(modelRulesSaveTimer.current);
      }
      if (validateOkTimer.current) {
        clearTimeout(validateOkTimer.current);
      }
    };
  }, []);

  const applyModelRules = (
    rules: SmartRoutingModelRule[],
    options?: { debounce?: boolean; skipSave?: boolean }
  ) => {
    setModelRulesOverride(rules);
    if (options?.skipSave) {
      return;
    }
    if (options?.debounce) {
      scheduleModelRulesSave(rules);
    } else {
      persistModelRules(rules);
    }
  };

  const updateModelRule = (
    index: number,
    patch: Partial<SmartRoutingModelRule>,
    options?: { debounce?: boolean }
  ) => {
    const next = modelRules.map((r, i) => (i === index ? { ...r, ...patch } : r));
    applyModelRules(next, options);
  };

  const addModelRule = () => {
    const firstProvider = providerOptions[0]?.value ?? "";
    applyModelRules([...modelRules, { ...emptyModelRule(), provider: firstProvider }], {
      skipSave: true,
    });
  };

  const removeModelRule = (index: number) => {
    applyModelRules(modelRules.filter((_, i) => i !== index));
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

  const sortedEntries = useMemo(() => {
    const excludePatterns = exclude;
    const entries = catalog?.entries ?? [];
    return [...entries].sort((a, b) => {
      const aExcluded = matchesSmartRoutingExclude(a.publicId, excludePatterns) ? 1 : 0;
      const bExcluded = matchesSmartRoutingExclude(b.publicId, excludePatterns) ? 1 : 0;
      if (aExcluded !== bExcluded) {
        return aExcluded - bExcluded;
      }
      const providerCmp = a.providerId.localeCompare(b.providerId);
      if (providerCmp !== 0) {
        return providerCmp;
      }
      return a.publicId.localeCompare(b.publicId);
    });
  }, [catalog?.entries, exclude]);

  const totalEntries = catalog?.entries?.length ?? 0;

  const saveCoreSettingsMutation = useMutation({
    mutationFn: async (payload: CoreSettingsDraft) => {
      const drifts = await api.getSmartRoutingAliasDrift();
      if (drifts.drifts.length > 0) {
        setPendingDrifts(drifts.drifts);
        const initial: Record<string, DriftChoice> = {};
        for (const d of drifts.drifts) {
          initial[driftKey(d)] = d.collision ? "update" : "keep";
        }
        setDriftChoices(initial);
        setPendingCoreSettings(payload);
        setDriftOpen(true);
        return { deferred: true as const };
      }
      await api.patchConfig({
        section: "smartRouting",
        data: buildCoreSettingsPayload(payload, savedEnabled),
      });
      return { deferred: false as const };
    },
    onSuccess: async result => {
      if (result.deferred) {
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["config"] });
      await queryClient.invalidateQueries({ queryKey: ["smartRoutingCatalog"] });
      setSettingsDraft(null);
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
      if (pendingCoreSettings) {
        await api.patchConfig({
          section: "smartRouting",
          data: buildCoreSettingsPayload(pendingCoreSettings, savedEnabled),
        });
      }
    },
    onSuccess: async () => {
      setDriftOpen(false);
      setPendingDrifts([]);
      setPendingCoreSettings(null);
      setSettingsDraft(null);
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

  const validateMutation = useMutation({
    mutationFn: () => api.getSmartRoutingAliasDrift(),
    onSuccess: ({ drifts }) => {
      if (drifts.length > 0) {
        setPendingDrifts(drifts);
        const initial: Record<string, DriftChoice> = {};
        for (const d of drifts) {
          initial[driftKey(d)] = d.collision ? "update" : "keep";
        }
        setDriftChoices(initial);
        setPendingCoreSettings(null);
        setDriftOpen(true);
        return;
      }
      setValidateOk(true);
      if (validateOkTimer.current) {
        clearTimeout(validateOkTimer.current);
      }
      validateOkTimer.current = setTimeout(() => {
        setValidateOk(false);
      }, 2500);
    },
  });

  const toggleExclude = (publicId: string, excluded: boolean) => {
    const next = new Set(exclude);
    if (excluded) {
      next.add(publicId);
    } else {
      next.delete(publicId);
    }
    const nextExclude = [...next];
    setExcludeOverride(nextExclude);
    autoSaveMutation.mutate({ exclude: nextExclude });
  };

  const handleSaveCoreSettings = () => {
    saveCoreSettingsMutation.mutate(coreSettings);
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
                value={coreSettings.aliasPrefix ?? "claude-"}
                onChange={e =>
                  setSettingsDraft({
                    ...coreSettings,
                    aliasPrefix: e.target.value,
                  })
                }
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                {t("smartRouting.settings.bareFallback")}
              </Label>
              <SelectField
                value={coreSettings.bareModelFallback?.mode ?? "first-match"}
                onChange={v =>
                  setSettingsDraft({
                    ...coreSettings,
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
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <div className="flex-1 min-w-0 min-h-[1.25rem] flex items-center justify-end text-right text-[10px]">
              {saveCoreSettingsMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              ) : coreSettingsDirty ? (
                <span className="text-amber-600 dark:text-amber-500">
                  {t("smartRouting.settings.unsaved")}
                </span>
              ) : (
                <span className="text-green-600 dark:text-green-500">{t("settings.saved")}</span>
              )}
            </div>
            <Button
              type="button"
              size="sm"
              className="h-7 shrink-0 min-w-[7rem] text-xs"
              disabled={saveCoreSettingsMutation.isPending || !coreSettingsDirty}
              onClick={handleSaveCoreSettings}
            >
              {saveCoreSettingsMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                t("common.save")
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="p-0">
        <CardHeader className="p-3 pb-2 space-y-1">
          <div className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-xs font-medium flex items-center gap-1.5">
              {t("smartRouting.customRules.title")}
              {autoSaveMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              ) : null}
            </CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={addModelRule}
            >
              <Plus className="h-3 w-3" />
              <span className="ml-1">{t("smartRouting.customRules.add")}</span>
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground font-normal">
            {t("smartRouting.customRules.subtitle")}
          </p>
        </CardHeader>
        <CardContent className="p-3 pt-0 space-y-2">
          {modelRules.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2 text-center">
              {t("smartRouting.customRules.empty")}
            </p>
          ) : (
            <div className="overflow-x-auto min-w-[36rem]">
              <div
                className={`${CUSTOM_RULES_GRID} border-b border-border pb-1.5 text-[10px] text-muted-foreground font-medium`}
              >
                <span>{t("smartRouting.customRules.order")}</span>
                <span>{t("smartRouting.customRules.pattern")}</span>
                <span>{t("smartRouting.customRules.targetProvider")}</span>
                <span>{t("smartRouting.customRules.targetModel")}</span>
                <span className="text-center">{t("smartRouting.customRules.enabled")}</span>
                <span className="sr-only">{t("smartRouting.customRules.remove")}</span>
              </div>
              <div className="divide-y divide-border">
                {modelRules.map((rule, index) => (
                  <div key={index} className={`${CUSTOM_RULES_GRID} py-1.5 items-center`}>
                    <div className="flex flex-col gap-0.5 self-center">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        disabled={index === 0}
                        title={t("smartRouting.customRules.moveUp")}
                        onClick={() => applyModelRules(moveModelRule(modelRules, index, -1))}
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        disabled={index === modelRules.length - 1}
                        title={t("smartRouting.customRules.moveDown")}
                        onClick={() => applyModelRules(moveModelRule(modelRules, index, 1))}
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <Input
                      className="h-8 w-full min-w-0 text-xs font-mono"
                      placeholder={t("smartRouting.customRules.patternHelp")}
                      value={rule.pattern}
                      onChange={e =>
                        updateModelRule(index, { pattern: e.target.value }, { debounce: true })
                      }
                    />
                    <div className="min-w-0 w-full">
                      <SelectField
                        value={rule.provider || (providerOptions[0]?.value ?? "")}
                        onChange={v => updateModelRule(index, { provider: v })}
                        options={
                          providerOptions.length > 0
                            ? providerOptions
                            : [{ value: rule.provider, label: rule.provider || "—" }]
                        }
                      />
                    </div>
                    <Input
                      className="h-8 w-full min-w-0 text-xs font-mono"
                      value={rule.model}
                      onChange={e =>
                        updateModelRule(index, { model: e.target.value }, { debounce: true })
                      }
                    />
                    <div className="flex justify-center">
                      <Checkbox
                        checked={rule.enabled !== false}
                        onCheckedChange={v => updateModelRule(index, { enabled: v === true })}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      title={t("smartRouting.customRules.remove")}
                      onClick={() => removeModelRule(index)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="p-0">
        <CardHeader className="p-3 pb-2 flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-xs font-medium flex items-center gap-1.5">
            {t("smartRouting.catalog.title")}
            {autoSaveMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            ) : null}
          </CardTitle>
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
              disabled={validateMutation.isPending}
              onClick={() => validateMutation.mutate()}
            >
              {validateMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ShieldCheck className="h-3 w-3" />
              )}
              <span className="ml-1">{t("smartRouting.catalog.validate")}</span>
            </Button>
            {validateOk ? (
              <span className="text-[10px] text-green-600 dark:text-green-500">
                {t("smartRouting.catalog.allAligned")}
              </span>
            ) : null}
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
                  {sortedEntries.map(row => {
                    const excluded = matchesSmartRoutingExclude(row.publicId, exclude);
                    const displayLabels = catalogDisplayLabels(row);
                    return (
                      <tr key={row.publicId} className="border-b border-border last:border-0">
                        <td className="py-1.5 pr-2 font-mono text-[10px] max-w-[180px] truncate">
                          {row.publicId}
                          <div className="text-muted-foreground">{row.providerId}</div>
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
                  })}
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
