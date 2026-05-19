import { useState, useEffect, useMemo, useRef, useId } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { SelectField } from "@/components/select-field";
import { api } from "@/api/client";
import type { WebSearchSettings } from "@/types/api";

/** Legacy YAML without `enabled` treats a non-empty providers list as on. */
function resolveWebSearchEnabled(ws: WebSearchSettings | undefined): boolean {
  if (!ws) {
    return false;
  }
  if (typeof ws.enabled === "boolean") {
    return ws.enabled;
  }
  return (ws.providers?.length ?? 0) > 0;
}

function EnableRow({
  checked,
  onCheckedChange,
  label,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2 h-8">
      <Checkbox id={id} checked={checked} onCheckedChange={v => onCheckedChange(v === true)} />
      <Label htmlFor={id} className="cursor-pointer text-xs font-normal">
        {label}
      </Label>
    </div>
  );
}

export default function WebSearchGroup() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const configQuery = useQuery({
    queryKey: ["config"],
    queryFn: () => api.getConfig(),
  });

  const providersQuery = useQuery({
    queryKey: ["providers"],
    queryFn: () => api.getProviders(),
  });

  const providers = providersQuery.data?.providers ?? [];

  // Local form state
  const [enabled, setEnabled] = useState(false);
  const [searchBackend, setSearchBackend] = useState<string>("tavily");
  const [apiKey, setApiKey] = useState("");
  const [maxResults, setMaxResults] = useState(5);
  const [searchDepth, setSearchDepth] = useState<"basic" | "advanced">("basic");
  const [glmApiKey, setGlmApiKey] = useState("");
  const [glmProtocol, setGlmProtocol] = useState<"anthropic" | "openai">("openai");
  const [glmRegion, setGlmRegion] = useState<"intl" | "cn">("intl");
  const [glmCoding, setGlmCoding] = useState(true);
  const [glmModel, setGlmModel] = useState("");
  const [selectedProviders, setSelectedProviders] = useState<Set<string>>(new Set());
  const [apiKeyDirty, setApiKeyDirty] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [glmApiKeyDirty, setGlmApiKeyDirty] = useState(false);
  const [showGlmApiKey, setShowGlmApiKey] = useState(false);
  const providersInitDone = useRef(false);

  // Sync form state from server data
  useEffect(() => {
    if (!configQuery.data || !configQuery.data.webSearch) return;
    const ws = configQuery.data.webSearch;
    setEnabled(resolveWebSearchEnabled(ws));
    setSearchBackend(ws.defaultSearchBackend ?? "tavily");
    if (ws.tavily) {
      if (!apiKeyDirty) {
        setApiKey(ws.tavily.apiKey ?? "");
      }
      setMaxResults(ws.tavily.maxResults ?? 5);
      setSearchDepth(ws.tavily.searchDepth ?? "basic");
    }
    if (ws.glm) {
      if (!glmApiKeyDirty) {
        setGlmApiKey(ws.glm.apiKey ?? "");
      }
      setGlmProtocol(ws.glm.protocol ?? "openai");
      setGlmRegion(ws.glm.region ?? "intl");
      setGlmCoding(ws.glm.coding ?? true);
      setGlmModel(ws.glm.model ?? "");
    }
    if (ws.providers) {
      setSelectedProviders(new Set(ws.providers));
    }
  }, [configQuery.data, apiKeyDirty, glmApiKeyDirty]);

  function maskKey(key: string): string {
    if (!key) return "";
    if (key.length <= 8) return "*".repeat(key.length);
    const head = key.slice(0, 4);
    const tail = key.slice(-4);
    const maskedLen = key.length - head.length - tail.length;
    return head + "*".repeat(maskedLen) + tail;
  }

  // Initialize selectedProviders from provider webSearchEnabled flags on first load only.
  // Uses a ref guard so that a stale cached providersQuery (before refetch after save)
  // cannot re-enable providers that the user just disabled.
  useEffect(() => {
    if (!providersQuery.data || providersInitDone.current) return;
    providersInitDone.current = true;
    const enabledIds = providersQuery.data.providers.filter(p => p.webSearchEnabled).map(p => p.id);
    if (enabledIds.length > 0 && selectedProviders.size === 0) {
      setSelectedProviders(new Set(enabledIds));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providersQuery.data]);

  const hasUnsavedChanges = useMemo(() => {
    const origWs = configQuery.data?.webSearch;
    const origProviders = origWs?.providers ?? [];
    const origTavily = origWs?.tavily;
    const origGlm = origWs?.glm;
    const origBackend = origWs?.defaultSearchBackend ?? "tavily";

    if (enabled !== resolveWebSearchEnabled(origWs)) return true;
    if (Array.from(selectedProviders).sort().join(",") !== [...origProviders].sort().join(","))
      return true;
    if (searchBackend !== origBackend) return true;
    if (maxResults !== (origTavily?.maxResults ?? 5)) return true;
    if (searchDepth !== (origTavily?.searchDepth ?? "basic")) return true;
    if (apiKeyDirty) return true;
    if (glmProtocol !== (origGlm?.protocol ?? "openai")) return true;
    if (glmRegion !== (origGlm?.region ?? "intl")) return true;
    if (glmCoding !== (origGlm?.coding ?? true)) return true;
    if (glmModel !== (origGlm?.model ?? "")) return true;
    if (glmApiKeyDirty) return true;
    return false;
  }, [
    enabled,
    selectedProviders,
    searchBackend,
    maxResults,
    searchDepth,
    apiKeyDirty,
    glmProtocol,
    glmRegion,
    glmCoding,
    glmModel,
    glmApiKeyDirty,
    configQuery.data,
  ]);

  const mutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.patchConfig({ section: "webSearch", data }),
    onSuccess: () => {
      setApiKeyDirty(false);
      setGlmApiKeyDirty(false);
      api.reloadConfig().then(() => {
        queryClient.invalidateQueries({ queryKey: ["config"] });
        queryClient.invalidateQueries({ queryKey: ["providers"] });
      });
    },
  });

  function handleSave() {
    const tavilyData: Record<string, unknown> = {
      maxResults,
      searchDepth,
    };
    if (apiKeyDirty) {
      tavilyData.apiKey = apiKey;
    }
    const glmData: Record<string, unknown> = {
      protocol: glmProtocol,
      region: glmRegion,
      coding: glmCoding,
      model: glmModel,
    };
    if (glmApiKeyDirty) {
      glmData.apiKey = glmApiKey;
    }
    const data: Record<string, unknown> = {
      enabled,
      defaultSearchBackend: searchBackend,
      tavily: tavilyData,
      glm: glmData,
      providers: Array.from(selectedProviders),
    };
    mutation.mutate(data);
  }

  function toggleProvider(id: string) {
    setSelectedProviders(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function selectAllProviders() {
    setSelectedProviders(new Set(providers.map(p => p.id)));
  }

  function invertProviderSelection() {
    setSelectedProviders(prev => {
      const next = new Set<string>();
      for (const p of providers) {
        if (!prev.has(p.id)) {
          next.add(p.id);
        }
      }
      return next;
    });
  }

  const isLoading = configQuery.isLoading || providersQuery.isLoading;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mx-auto mb-2" />
          {t("common.refresh")}...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">{t("capabilities.webSearch.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Global enable toggle */}
        <EnableRow
          checked={enabled}
          onCheckedChange={setEnabled}
          label={t("capabilities.webSearch.enable")}
        />
        {!enabled ? (
          <p className="text-[10px] text-muted-foreground">
            {t("capabilities.webSearch.disabledHint")}
          </p>
        ) : null}

        {/* Search provider settings */}
        <div className="space-y-3 border-t pt-3">
          <div className="space-y-1">
            <Label className="text-xs font-medium">
              {t("capabilities.webSearch.searchBackend")}
            </Label>
            <SelectField
              value={searchBackend}
              onChange={setSearchBackend}
              options={[
                { value: "tavily", label: "Tavily" },
                { value: "glm", label: "GLM (Zhipu)" },
              ]}
            />
          </div>

          {searchBackend === "tavily" && (
            <>
              <div className="space-y-1">
                <Label className="text-xs font-medium">{t("capabilities.webSearch.apiKey")}</Label>
                <div className="relative">
                  {showApiKey ? (
                    <Input
                      type="text"
                      className="h-8 pr-8 text-xs font-mono"
                      value={apiKey}
                      placeholder={t("capabilities.webSearch.apiKeyPlaceholder")}
                      onChange={e => {
                        setApiKey(e.target.value);
                        setApiKeyDirty(true);
                      }}
                    />
                  ) : (
                    <div
                      className="w-full h-8 px-2 pr-8 text-xs border rounded-md bg-background font-mono flex items-center cursor-pointer"
                      onClick={() => setShowApiKey(true)}
                    >
                      {apiKey ? (
                        <span className="text-muted-foreground">{maskKey(apiKey)}</span>
                      ) : (
                        <span className="text-muted-foreground/50">
                          {t("capabilities.webSearch.apiKeyPlaceholder")}
                        </span>
                      )}
                    </div>
                  )}
                  <button
                    type="button"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowApiKey(v => !v)}
                  >
                    {showApiKey ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs font-medium">
                    {t("capabilities.webSearch.maxResults")}
                  </Label>
                  <Input
                    type="number"
                    className="h-8 text-xs font-mono"
                    value={maxResults}
                    min={1}
                    max={10}
                    onChange={e => setMaxResults(Number(e.target.value))}
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-medium">
                    {t("capabilities.webSearch.searchDepth")}
                  </Label>
                  <SelectField
                    value={searchDepth}
                    onChange={v => setSearchDepth(v as "basic" | "advanced")}
                    options={[
                      { value: "basic", label: t("capabilities.webSearch.depthBasic") },
                      { value: "advanced", label: t("capabilities.webSearch.depthAdvanced") },
                    ]}
                  />
                </div>
              </div>
            </>
          )}

          {searchBackend === "glm" && (
            <>
              <div className="space-y-1">
                <Label className="text-xs font-medium">
                  {t("capabilities.webSearch.glmApiKey")}
                </Label>
                <div className="relative">
                  {showGlmApiKey ? (
                    <Input
                      type="text"
                      className="h-8 pr-8 text-xs font-mono"
                      value={glmApiKey}
                      placeholder={t("capabilities.webSearch.glmApiKeyPlaceholder")}
                      onChange={e => {
                        setGlmApiKey(e.target.value);
                        setGlmApiKeyDirty(true);
                      }}
                    />
                  ) : (
                    <div
                      className="w-full h-8 px-2 pr-8 text-xs border rounded-md bg-background font-mono flex items-center cursor-pointer"
                      onClick={() => setShowGlmApiKey(true)}
                    >
                      {glmApiKey ? (
                        <span className="text-muted-foreground">{maskKey(glmApiKey)}</span>
                      ) : (
                        <span className="text-muted-foreground/50">
                          {t("capabilities.webSearch.glmApiKeyPlaceholder")}
                        </span>
                      )}
                    </div>
                  )}
                  <button
                    type="button"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowGlmApiKey(v => !v)}
                  >
                    {showGlmApiKey ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs font-medium">
                    {t("capabilities.webSearch.glmProtocol")}
                  </Label>
                  <SelectField
                    value={glmProtocol}
                    onChange={v => setGlmProtocol(v as "anthropic" | "openai")}
                    options={[
                      { value: "openai", label: "OpenAI Chat" },
                      { value: "anthropic", label: "Anthropic" },
                    ]}
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-medium">
                    {t("capabilities.webSearch.glmRegion")}
                  </Label>
                  <SelectField
                    value={glmRegion}
                    onChange={v => setGlmRegion(v as "intl" | "cn")}
                    options={[
                      { value: "intl", label: t("capabilities.webSearch.glmRegionIntl") },
                      { value: "cn", label: t("capabilities.webSearch.glmRegionCn") },
                    ]}
                  />
                </div>
              </div>

              <EnableRow
                checked={glmCoding}
                onCheckedChange={setGlmCoding}
                label={t("capabilities.webSearch.glmCoding")}
              />

              <div className="space-y-1">
                <Label className="text-xs font-medium">
                  {t("capabilities.webSearch.glmModel")}
                </Label>
                <Input
                  type="text"
                  className="h-8 text-xs font-mono"
                  value={glmModel}
                  placeholder={t("capabilities.webSearch.glmModelPlaceholder")}
                  onChange={e => setGlmModel(e.target.value)}
                />
              </div>
            </>
          )}
        </div>

        {/* Provider assignment */}
        <div className="border-t pt-3 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <Label className="text-xs font-medium">
                {t("capabilities.webSearch.providerAssignment")}
              </Label>
              <p className="text-[10px] text-muted-foreground">
                {t("capabilities.webSearch.providerAssignmentHint")}
              </p>
            </div>
            {providers.length > 0 ? (
              <div className="flex shrink-0 gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={selectAllProviders}
                >
                  {t("capabilities.webSearch.selectAll")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={invertProviderSelection}
                >
                  {t("capabilities.webSearch.invertSelection")}
                </Button>
              </div>
            ) : null}
          </div>

          {providers.length === 0 ? (
            <p className="text-[10px] text-muted-foreground py-2">
              {t("capabilities.webSearch.noProviders")}
            </p>
          ) : (
            <div className="border rounded-md divide-y">
              {providers.map(p => {
                const providerRowId = `ws-provider-${p.id}`;
                return (
                  <div key={p.id} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/30">
                    <Checkbox
                      id={providerRowId}
                      checked={selectedProviders.has(p.id)}
                      onCheckedChange={() => toggleProvider(p.id)}
                    />
                    <Label
                      htmlFor={providerRowId}
                      className="flex flex-1 cursor-pointer items-center gap-2 text-xs font-normal"
                    >
                      <span>{p.name}</span>
                      <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                        {p.id}
                      </span>
                    </Label>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Save bar */}
        <div className="border-t pt-3 space-y-2">
          <div className="flex items-center justify-end gap-2">
            <div className="flex-1 min-w-0 min-h-[1.25rem] flex items-center justify-end text-right">
              {mutation.isSuccess && !hasUnsavedChanges && (
                <span className="text-[10px] text-green-600 dark:text-green-500">
                  {t("capabilities.webSearch.savedAndReloaded")}
                </span>
              )}
            </div>
            <Button
              size="sm"
              className="h-7 shrink-0 text-xs"
              disabled={!hasUnsavedChanges || mutation.isPending}
              onClick={handleSave}
            >
              {mutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : t("common.save")}
            </Button>
          </div>
          {mutation.isError && (
            <p className="text-[10px] text-destructive">{(mutation.error as Error).message}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
