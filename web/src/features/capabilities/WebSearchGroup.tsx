import { useState, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api } from "@/api/client";

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
    setEnabled((ws.providers?.length ?? 0) > 0);
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
      setEnabled(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providersQuery.data]);

  const hasUnsavedChanges = useMemo(() => {
    const origWs = configQuery.data?.webSearch;
    const origProviders = origWs?.providers ?? [];
    const origTavily = origWs?.tavily;
    const origGlm = origWs?.glm;
    const origBackend = origWs?.defaultSearchBackend ?? "tavily";

    if (enabled !== origProviders.length > 0) return true;
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
      defaultSearchBackend: searchBackend,
      tavily: tavilyData,
      glm: glmData,
      providers: enabled ? Array.from(selectedProviders) : [],
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
        <label className="flex items-center gap-2 h-8 cursor-pointer select-none">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={enabled}
            onChange={e => setEnabled(e.target.checked)}
          />
          <span className="text-xs">{t("capabilities.webSearch.enable")}</span>
        </label>

        {enabled && (
          <>
            {/* Search provider settings */}
            <div className="space-y-3 border-t pt-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">
                  {t("capabilities.webSearch.searchBackend")}
                </label>
                <select
                  className="w-full h-8 px-2 text-xs border rounded-md bg-background"
                  value={searchBackend}
                  onChange={e => setSearchBackend(e.target.value)}
                >
                  <option value="tavily">Tavily</option>
                  <option value="glm">GLM (Zhipu)</option>
                </select>
              </div>

              {searchBackend === "tavily" && (
                <>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">
                      {t("capabilities.webSearch.apiKey")}
                    </label>
                    <div className="relative">
                      {showApiKey ? (
                        <input
                          type="text"
                          className="w-full h-8 px-2 pr-8 text-xs border rounded-md bg-background font-mono"
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
                      <label className="text-xs font-medium">
                        {t("capabilities.webSearch.maxResults")}
                      </label>
                      <input
                        type="number"
                        className="w-full h-8 px-2 text-xs border rounded-md bg-background font-mono"
                        value={maxResults}
                        min={1}
                        max={10}
                        onChange={e => setMaxResults(Number(e.target.value))}
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-medium">
                        {t("capabilities.webSearch.searchDepth")}
                      </label>
                      <select
                        className="w-full h-8 px-2 text-xs border rounded-md bg-background"
                        value={searchDepth}
                        onChange={e => setSearchDepth(e.target.value as "basic" | "advanced")}
                      >
                        <option value="basic">{t("capabilities.webSearch.depthBasic")}</option>
                        <option value="advanced">
                          {t("capabilities.webSearch.depthAdvanced")}
                        </option>
                      </select>
                    </div>
                  </div>
                </>
              )}

              {searchBackend === "glm" && (
                <>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">
                      {t("capabilities.webSearch.glmApiKey")}
                    </label>
                    <div className="relative">
                      {showGlmApiKey ? (
                        <input
                          type="text"
                          className="w-full h-8 px-2 pr-8 text-xs border rounded-md bg-background font-mono"
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
                      <label className="text-xs font-medium">
                        {t("capabilities.webSearch.glmProtocol")}
                      </label>
                      <select
                        className="w-full h-8 px-2 text-xs border rounded-md bg-background"
                        value={glmProtocol}
                        onChange={e => setGlmProtocol(e.target.value as "anthropic" | "openai")}
                      >
                        <option value="openai">OpenAI Chat</option>
                        <option value="anthropic">Anthropic</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-medium">
                        {t("capabilities.webSearch.glmRegion")}
                      </label>
                      <select
                        className="w-full h-8 px-2 text-xs border rounded-md bg-background"
                        value={glmRegion}
                        onChange={e => setGlmRegion(e.target.value as "intl" | "cn")}
                      >
                        <option value="intl">{t("capabilities.webSearch.glmRegionIntl")}</option>
                        <option value="cn">{t("capabilities.webSearch.glmRegionCn")}</option>
                      </select>
                    </div>
                  </div>

                  <label className="flex items-center gap-2 h-8 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={glmCoding}
                      onChange={e => setGlmCoding(e.target.checked)}
                    />
                    <span className="text-xs">{t("capabilities.webSearch.glmCoding")}</span>
                  </label>

                  <div className="space-y-1">
                    <label className="text-xs font-medium">
                      {t("capabilities.webSearch.glmModel")}
                    </label>
                    <input
                      type="text"
                      className="w-full h-8 px-2 text-xs border rounded-md bg-background font-mono"
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
              <div>
                <label className="text-xs font-medium">
                  {t("capabilities.webSearch.providerAssignment")}
                </label>
                <p className="text-[10px] text-muted-foreground">
                  {t("capabilities.webSearch.providerAssignmentHint")}
                </p>
              </div>

              {providers.length === 0 ? (
                <p className="text-[10px] text-muted-foreground py-2">
                  {t("capabilities.webSearch.noProviders")}
                </p>
              ) : (
                <div className="border rounded-md divide-y">
                  {providers.map(p => (
                    <label
                      key={p.id}
                      className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/30"
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={selectedProviders.has(p.id)}
                        onChange={() => toggleProvider(p.id)}
                      />
                      <span className="text-xs">{p.name}</span>
                      <span className="text-[10px] text-muted-foreground ml-auto font-mono">
                        {p.id}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* Save bar */}
        <div className="border-t pt-3 space-y-2">
          <div className="flex items-center justify-end gap-2">
            <Button
              size="sm"
              className="h-7 text-xs"
              disabled={!hasUnsavedChanges || mutation.isPending}
              onClick={handleSave}
            >
              {mutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : t("common.save")}
            </Button>
            {mutation.isSuccess && !hasUnsavedChanges && (
              <span className="text-[10px] text-green-600 dark:text-green-500">
                {t("capabilities.webSearch.savedAndReloaded")}
              </span>
            )}
          </div>
          {mutation.isError && (
            <p className="text-[10px] text-destructive">{(mutation.error as Error).message}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
