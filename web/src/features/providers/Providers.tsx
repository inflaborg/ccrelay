import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useCallback } from "react";
import { Check, Loader2, Plus, RotateCw, X } from "lucide-react";
import * as yaml from "js-yaml";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ContextMenuWrapper } from "@/components/ui/context-menu";
import { Select } from "@/components/ui/select";
import { api } from "@/api/client";
import type { AddProviderRequest, Provider, ModelMapEntry } from "@/types/api";

const DEFAULT_FORM: AddProviderRequest = {
  id: "",
  name: "",
  baseUrl: "",
  providerType: "anthropic",
  mode: "passthrough",
  apiKey: "",
  enabled: true,
  authHeader: undefined,
  modelMap: undefined,
  vlModelMap: undefined,
  headers: undefined,
};

export default function Providers() {
  const queryClient = useQueryClient();
  const [showAddModal, setShowAddModal] = useState(false);
  const [formData, setFormData] = useState<AddProviderRequest>(DEFAULT_FORM);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  // Raw text states for YAML fields (allow editing invalid YAML temporarily)
  const [modelMapText, setModelMapText] = useState("");
  const [modelMapError, setModelMapError] = useState<string | null>(null);

  // Debounce timer for YAML validation
  const modelMapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced YAML validation helper for model map array
  const validateYamlField = useCallback(
    (
      text: string,
      setError: (err: string | null) => void,
      updateFormField: (value: ModelMapEntry[] | null) => void,
      timerRef: { current: ReturnType<typeof setTimeout> | null }
    ) => {
      // Clear previous timer
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      // Set new timer for validation after 500ms
      timerRef.current = setTimeout(() => {
        if (!text.trim()) {
          setError(null);
          updateFormField(null);
          return;
        }
        try {
          const parsed = yaml.load(text);
          // Must be an array of { pattern, model } objects
          if (!Array.isArray(parsed)) {
            setError("Must be a YAML array");
            return;
          }
          for (const entry of parsed) {
            if (typeof entry !== "object" || !entry.pattern || !entry.model) {
              setError("Each entry must have 'pattern' and 'model' fields");
              return;
            }
          }
          setError(null);
          updateFormField(parsed as ModelMapEntry[]);
        } catch {
          setError("Invalid YAML format");
        }
      }, 500);
    },
    []
  );

  const { data: providersData, isLoading } = useQuery({
    queryKey: ["providers"],
    queryFn: () => api.getProviders(),
  });

  const switchMutation = useMutation({
    mutationFn: (providerId: string) => api.switchProvider(providerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["status"] });
      queryClient.invalidateQueries({ queryKey: ["providers"] });
    },
  });

  const addMutation = useMutation({
    mutationFn: (data: AddProviderRequest) => api.addProvider(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["providers"] });
      closeModal();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteProvider(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["providers"] });
      queryClient.invalidateQueries({ queryKey: ["status"] });
    },
  });

  const reloadMutation = useMutation({
    mutationFn: () => api.reloadConfig(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["providers"] });
      queryClient.invalidateQueries({ queryKey: ["status"] });
    },
  });

  const handleSwitch = (providerId: string) => {
    switchMutation.mutate(providerId);
  };

  const openAddModal = () => {
    setEditingProvider(null);
    setFormData(DEFAULT_FORM);
    setModelMapText("");
    setModelMapError(null);
    setShowAddModal(true);
  };

  const openEditModal = (provider: Provider) => {
    setEditingProvider(provider);
    const modelMap = provider.modelMap;
    setFormData({
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl || "",
      providerType: provider.providerType,
      mode: provider.mode,
      apiKey: provider.apiKey || "",
      enabled: provider.enabled,
      modelMap,
      vlModelMap: undefined,
      headers: undefined,
    });
    setModelMapText(modelMap ? yaml.dump(modelMap, { indent: 2, lineWidth: -1 }) : "");
    setModelMapError(null);
    setShowAddModal(true);
  };

  const closeModal = () => {
    setShowAddModal(false);
    setEditingProvider(null);
    setFormData(DEFAULT_FORM);
    setModelMapText("");
    setModelMapError(null);
  };

  const handleAddSubmit = () => {
    if (!formData.id || !formData.name || !formData.baseUrl) {
      return;
    }
    // When editing, exclude apiKey from the request (it cannot be modified)
    const dataToSubmit = editingProvider ? { ...formData, apiKey: undefined } : formData;
    addMutation.mutate(dataToSubmit);
  };

  const handleDelete = (id: string) => {
    deleteMutation.mutate(id);
  };

  const handleReload = () => {
    reloadMutation.mutate();
  };

  const updateForm = (
    key: keyof AddProviderRequest,
    value: string | boolean | Record<string, string> | ModelMapEntry[]
  ) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const providers = (providersData?.providers || []).sort((a, b) => {
    // Disabled providers go to the end
    if (a.enabled !== b.enabled) {
      return a.enabled ? -1 : 1;
    }
    return 0;
  });

  return (
    <div className="space-y-3">
      {/* Header with actions */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Providers</h2>
          <p className="text-xs text-muted-foreground">
            Manage and switch between AI API providers
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            onClick={handleReload}
            disabled={reloadMutation.isPending}
            title="Reload config"
          >
            <RotateCw className={`h-3.5 w-3.5 ${reloadMutation.isPending ? "animate-spin" : ""}`} />
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={openAddModal}>
            <Plus className="h-3 w-3" />
            Add
          </Button>
        </div>
      </div>

      {/* Providers List - Compact grid */}
      <div className="grid gap-2 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {isLoading ? (
          <>
            <Card className="p-0">
              <CardContent className="p-3">
                <div className="h-16 animate-pulse bg-muted rounded" />
              </CardContent>
            </Card>
            <Card className="p-0">
              <CardContent className="p-3">
                <div className="h-16 animate-pulse bg-muted rounded" />
              </CardContent>
            </Card>
          </>
        ) : (
          providers.map(provider => (
            <ContextMenuWrapper
              key={provider.id}
              menuItems={[
                {
                  label: "Use",
                  onClick: () => handleSwitch(provider.id),
                  show: !provider.active && provider.enabled,
                },
                {
                  label: "Edit",
                  onClick: () => openEditModal(provider),
                },
                {
                  label: "Delete",
                  onClick: () => handleDelete(provider.id),
                  destructive: true,
                  show: provider.id !== "official",
                },
              ]}
            >
              <Card
                className={`p-0 ${provider.active ? "border-primary" : ""} ${!provider.enabled ? "opacity-50" : ""}`}
              >
                <CardHeader className="p-3 pb-1">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm truncate mr-1">{provider.name}</CardTitle>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {!provider.enabled && (
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1 py-0 text-muted-foreground"
                        >
                          Disabled
                        </Badge>
                      )}
                      {provider.active && (
                        <Badge variant="success" className="gap-0.5 text-[10px] px-1 py-0">
                          <Check className="h-2.5 w-2.5" />
                          Active
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-3 pt-0 space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">ID</span>
                    <span className="font-mono text-[10px]">{provider.id}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Mode</span>
                    <Badge variant="outline" className="text-[10px] px-1 py-0">
                      {provider.mode}
                    </Badge>
                  </div>
                  {provider.baseUrl && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Base URL</span>
                      <span className="font-mono text-[10px] truncate max-w-[140px]">
                        {provider.baseUrl}
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>
            </ContextMenuWrapper>
          ))
        )}
      </div>

      {/* Error messages */}
      {switchMutation.error && (
        <p className="text-xs text-destructive text-center">
          {(switchMutation.error as Error).message}
        </p>
      )}
      {addMutation.error && (
        <p className="text-xs text-destructive text-center">
          {(addMutation.error as Error).message}
        </p>
      )}
      {deleteMutation.error && (
        <p className="text-xs text-destructive text-center">
          {(deleteMutation.error as Error).message}
        </p>
      )}

      {providers.length === 0 && !isLoading && (
        <Card className="p-0">
          <CardContent className="p-6 text-center text-xs text-muted-foreground">
            No providers configured. Click "Add" to create one.
          </CardContent>
        </Card>
      )}

      {/* Add/Edit Provider Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-[500px] max-h-[90vh] flex flex-col">
            {/* Modal Header */}
            <CardHeader className="border-b p-3 flex-shrink-0">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">
                  {editingProvider ? "Edit Provider" : "Add Provider"}
                </CardTitle>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={closeModal}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>

            {/* Modal Content - Scrollable */}
            <CardContent className="p-4 space-y-3 flex-1 overflow-auto">
              {/* ID and Enabled row */}
              <div className="grid grid-cols-[1fr_auto] gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium">
                    Provider ID <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    className="w-full h-8 px-2 text-xs border rounded-md bg-background disabled:opacity-50"
                    placeholder="e.g., my_provider"
                    value={formData.id}
                    onChange={e => updateForm("id", e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))}
                    disabled={!!editingProvider}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Unique identifier (alphanumeric, underscore, hyphen)
                  </p>
                </div>
                <div className="pt-[26px]">
                  <div className="flex items-center gap-2 h-8">
                    <input
                      type="checkbox"
                      id="enabled"
                      className="h-4 w-4"
                      checked={formData.enabled ?? true}
                      onChange={e => updateForm("enabled", e.target.checked)}
                    />
                    <label htmlFor="enabled" className="text-xs whitespace-nowrap">
                      Enabled
                    </label>
                  </div>
                </div>
              </div>

              {/* Name */}
              <div className="space-y-1">
                <label className="text-xs font-medium">
                  Name <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  className="w-full h-8 px-2 text-xs border rounded-md bg-background"
                  placeholder="e.g., My Custom Provider"
                  value={formData.name}
                  onChange={e => updateForm("name", e.target.value)}
                />
              </div>

              {/* Base URL */}
              <div className="space-y-1">
                <label className="text-xs font-medium">
                  API Base URL <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  className="w-full h-8 px-2 text-xs border rounded-md bg-background"
                  placeholder="e.g., https://api.example.com"
                  value={formData.baseUrl}
                  onChange={e => updateForm("baseUrl", e.target.value)}
                />
              </div>

              {/* Type and Mode row */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium">Type</label>
                  <Select
                    value={formData.providerType}
                    options={[
                      { value: "anthropic", label: "Anthropic" },
                      { value: "openai", label: "OpenAI" },
                    ]}
                    onChange={v => updateForm("providerType", v as "anthropic" | "openai")}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Mode</label>
                  <Select
                    value={formData.mode}
                    options={[
                      { value: "passthrough", label: "Passthrough" },
                      { value: "inject", label: "Inject" },
                    ]}
                    onChange={v => updateForm("mode", v as "passthrough" | "inject")}
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              {/* API Key */}
              <div className="space-y-1">
                <label className="text-xs font-medium">API Key</label>
                {editingProvider ? (
                  <>
                    <input
                      type="text"
                      className="w-full h-8 px-2 text-xs border rounded-md bg-muted cursor-not-allowed"
                      value={
                        formData.apiKey
                          ? `${formData.apiKey.slice(0, 4)}************${formData.apiKey.slice(-4)}`
                          : "(not set)"
                      }
                      disabled
                    />
                    <p className="text-[10px] text-muted-foreground">
                      API Key cannot be modified. To change, delete and recreate the provider.
                    </p>
                  </>
                ) : (
                  <>
                    <input
                      type="password"
                      className="w-full h-8 px-2 text-xs border rounded-md bg-background"
                      placeholder="e.g., ${API_KEY} or sk-..."
                      value={formData.apiKey || ""}
                      onChange={e => updateForm("apiKey", e.target.value)}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Supports ${"{"}ENV_VAR{"}"} syntax. Cannot be modified after creation.
                    </p>
                  </>
                )}
              </div>

              {/* Model Map */}
              <div className="space-y-1">
                <label className="text-xs font-medium">
                  Model Map (YAML) <span className="text-destructive">*</span>
                </label>
                <textarea
                  className={`w-full px-2 py-1 text-xs border rounded-md bg-background font-mono ${modelMapError ? "border-destructive" : ""}`}
                  placeholder={`- pattern: "claude-*"\n  model: "custom-model"`}
                  rows={6}
                  value={modelMapText}
                  onChange={e => {
                    const text = e.target.value;
                    setModelMapText(text);
                    validateYamlField(
                      text,
                      setModelMapError,
                      (v: ModelMapEntry[] | null) =>
                        setFormData(prev => ({ ...prev, modelMap: v ?? undefined })),
                      modelMapTimerRef
                    );
                  }}
                />
                {modelMapError && <p className="text-[10px] text-destructive">{modelMapError}</p>}
              </div>
            </CardContent>

            {/* Modal Footer */}
            <div className="border-t p-3 flex-shrink-0 flex justify-end gap-2">
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={closeModal}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={handleAddSubmit}
                disabled={
                  addMutation.isPending ||
                  !formData.id ||
                  !formData.name ||
                  !formData.baseUrl ||
                  !!modelMapError
                }
              >
                {addMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : editingProvider ? (
                  "Save"
                ) : (
                  "Add Provider"
                )}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
