import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  Copy,
  Loader2,
  Plus,
  RotateCw,
  X,
  Upload,
  Download,
  CheckSquare,
  MinusSquare,
} from "lucide-react";
import * as yaml from "js-yaml";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { SelectField } from "@/components/select-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/api/client";
import type { AddProviderRequest, Provider, ModelMapEntry } from "@/types/api";
import { WizardDialog } from "./wizard/WizardDialog";
import { CoworkAliasHelper } from "./CoworkAliasHelper";

const PROVIDER_PROTOCOL_LABEL: Record<string, { label: string; className: string }> = {
  anthropic: { label: "providers.protocol.anthropic", className: "bg-indigo-500 text-white" },
  openai: { label: "providers.protocol.openai", className: "bg-emerald-600 text-white" },
  openai_chat: { label: "providers.protocol.openaiChat", className: "bg-teal-500 text-white" },
};

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
  modelMappingEnabled: true,
  useCustomModelsList: false,
  customModelsList: undefined,
};

export default function Providers() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [showWizard, setShowWizard] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [coworkHelperOpen, setCoworkHelperOpen] = useState(false);
  const [coworkHelperKey, setCoworkHelperKey] = useState(0);
  const [formData, setFormData] = useState<AddProviderRequest>(DEFAULT_FORM);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [duplicateSource, setDuplicateSource] = useState<Provider | null>(null);
  const [dupName, setDupName] = useState("");
  const [dupNewId, setDupNewId] = useState("");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [pendingDeleteProvider, setPendingDeleteProvider] = useState<Provider | null>(null);
  // Raw text states for YAML fields (allow editing invalid YAML temporarily)
  const [modelMapText, setModelMapText] = useState("");
  const [modelMapError, setModelMapError] = useState<string | null>(null);
  const [customModelsText, setCustomModelsText] = useState("");
  // Multi-select state for export
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

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
            setError(t("providers.validation.mustBeYamlArray"));
            return;
          }
          for (const entry of parsed) {
            if (typeof entry !== "object" || !entry.pattern || !entry.model) {
              setError(t("providers.validation.patternModelRequired"));
              return;
            }
          }
          setError(null);
          updateFormField(parsed as ModelMapEntry[]);
        } catch {
          setError(t("providers.validation.invalidYaml"));
        }
      }, 500);
    },
    [t]
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

  const duplicateMutation = useMutation({
    mutationFn: (data: { sourceId: string; newId: string; name: string }) =>
      api.duplicateProvider(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["providers"] });
      queryClient.invalidateQueries({ queryKey: ["status"] });
      closeDuplicateModal();
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
    setShowWizard(true);
  };

  const openLegacyAddModal = () => {
    setEditingProvider(null);
    setFormData(DEFAULT_FORM);
    setModelMapText("");
    setModelMapError(null);
    setCustomModelsText("");
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
      enabled: provider.id === "official" ? true : provider.enabled,
      modelMap,
      vlModelMap: undefined,
      headers: undefined,
      modelMappingEnabled: provider.modelMappingEnabled !== false,
      useCustomModelsList: Boolean(provider.useCustomModelsList),
      customModelsList: provider.customModelsList,
    });
    setModelMapText(modelMap ? yaml.dump(modelMap, { indent: 2, lineWidth: -1 }) : "");
    setModelMapError(null);
    setCustomModelsText(
      provider.useCustomModelsList && provider.customModelsList?.length
        ? provider.customModelsList.join("\n")
        : ""
    );
    setShowAddModal(true);
  };

  const closeModal = () => {
    setShowAddModal(false);
    setEditingProvider(null);
    setFormData(DEFAULT_FORM);
    setModelMapText("");
    setModelMapError(null);
    setCustomModelsText("");
  };

  const openDuplicateModal = (provider: Provider) => {
    setDuplicateSource(provider);
    setDupName(`${provider.name} (copy)`);
    setDupNewId(`${provider.id}_copy`);
    setShowDuplicateModal(true);
  };

  const closeDuplicateModal = () => {
    setShowDuplicateModal(false);
    setDuplicateSource(null);
    setDupName("");
    setDupNewId("");
  };

  const handleDuplicateSubmit = () => {
    if (!duplicateSource) {
      return;
    }
    const name = dupName.trim();
    const newId = dupNewId.trim();
    if (!name || !newId || !/^[a-zA-Z0-9_-]+$/.test(newId)) {
      return;
    }
    duplicateMutation.mutate({
      sourceId: duplicateSource.id,
      newId,
      name,
    });
  };

  const handleAddSubmit = () => {
    if (!formData.id || !formData.name || !formData.baseUrl) {
      return;
    }
    // When editing, use the provider we opened (ids stay in sync) and never send apiKey.
    const isOfficial = editingProvider?.id === "official" || formData.id === "official";
    const customLines = customModelsText
      .split("\n")
      .map(l => l.trim())
      .filter(l => l.length > 0);

    const payload = editingProvider
      ? {
          ...formData,
          id: editingProvider.id,
          apiKey: undefined,
          enabled: isOfficial ? true : formData.enabled,
        }
      : {
          ...formData,
          enabled: isOfficial ? true : formData.enabled,
        };

    const dataToSubmit: AddProviderRequest = {
      ...payload,
      useCustomModelsList: formData.useCustomModelsList === true,
      customModelsList: formData.useCustomModelsList === true ? customLines : undefined,
    };
    addMutation.mutate(dataToSubmit);
  };

  const requestDelete = (provider: Provider) => {
    setPendingDeleteProvider(provider);
    setDeleteConfirmOpen(true);
  };

  const confirmDelete = () => {
    if (pendingDeleteProvider) {
      deleteMutation.mutate(pendingDeleteProvider.id);
      setDeleteConfirmOpen(false);
      setPendingDeleteProvider(null);
    }
  };

  const handleReload = () => {
    reloadMutation.mutate();
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const cancelSelection = () => {
    setSelectedIds(new Set());
  };

  const handleExport = async () => {
    if (selectedIds.size === 0) return;
    try {
      const result = await api.exportProviders([...selectedIds]);
      const blob = new Blob(
        [
          JSON.stringify(
            { version: 1, exportedAt: new Date().toISOString(), providers: result.providers },
            null,
            2
          ),
        ],
        { type: "application/json" }
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "ccrelay-providers.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // export failed silently
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const providersToImport = Array.isArray(data.providers)
        ? data.providers
        : Array.isArray(data)
          ? data
          : [];
      if (providersToImport.length === 0) return;
      await api.importProviders(providersToImport);
      queryClient.invalidateQueries({ queryKey: ["providers"] });
    } catch {
      // import failed silently
    }
    // Reset file input so the same file can be selected again
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const updateForm = (
    key: keyof AddProviderRequest,
    value: string | boolean | Record<string, string> | ModelMapEntry[] | undefined
  ) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const handleCoworkHelperApply = useCallback(
    (result: { customModelsList: string[]; modelMap: ModelMapEntry[] }) => {
      if (modelMapTimerRef.current) {
        clearTimeout(modelMapTimerRef.current);
        modelMapTimerRef.current = null;
      }
      setCustomModelsText(result.customModelsList.join("\n"));
      setModelMapText(yaml.dump(result.modelMap, { indent: 2, lineWidth: -1 }));
      setModelMapError(null);
      setFormData(prev => ({
        ...prev,
        useCustomModelsList: true,
        modelMappingEnabled: true,
        modelMap: result.modelMap,
      }));
    },
    []
  );

  const providers = (providersData?.providers || []).sort((a, b) => {
    const sortGroup = (p: Provider) => {
      if (p.id === "official") {
        return 0;
      }
      return p.enabled ? 1 : 2;
    };
    const ga = sortGroup(a);
    const gb = sortGroup(b);
    if (ga !== gb) {
      return ga - gb;
    }
    const byName = a.name.localeCompare(b.name, "en", { sensitivity: "base", numeric: true });
    if (byName !== 0) {
      return byName;
    }
    return a.id.localeCompare(b.id, "en", { sensitivity: "base", numeric: true });
  });

  const selectableProviders = providers.filter(p => p.id !== "official");
  const isSelectMode = selectedIds.size > 0;
  const isAllSelected =
    selectedIds.size === selectableProviders.length && selectableProviders.length > 0;

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectableProviders.map(p => p.id)));
    }
  };

  return (
    <div className="space-y-3">
      {/* Header with actions */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold tracking-tight">
            {isSelectMode
              ? t("providers.selectedCount", { count: selectedIds.size })
              : t("providers.title")}
          </h2>
          <p className="text-xs text-muted-foreground">{t("providers.subtitle")}</p>
        </div>
        <div className="flex items-center gap-1">
          {isSelectMode ? (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1"
                onClick={() => void handleExport()}
              >
                <Download className="h-3 w-3" />
                {t("providers.export")} ({selectedIds.size})
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs gap-1"
                onClick={toggleSelectAll}
              >
                {isAllSelected ? (
                  <MinusSquare className="h-3 w-3" />
                ) : (
                  <CheckSquare className="h-3 w-3" />
                )}
                {t("providers.selectAll")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs gap-1"
                onClick={cancelSelection}
              >
                <X className="h-3 w-3" />
                {t("providers.cancelSelection")}
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                onClick={handleReload}
                disabled={reloadMutation.isPending}
                title={t("providers.reloadConfig")}
              >
                <RotateCw
                  className={`h-3.5 w-3.5 ${reloadMutation.isPending ? "animate-spin" : ""}`}
                />
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={e => void handleImportFile(e)}
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1"
                onClick={handleImportClick}
              >
                <Upload className="h-3 w-3" />
                {t("providers.import")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1"
                onClick={openAddModal}
              >
                <Plus className="h-3 w-3" />
                {t("providers.add")}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Providers List - Compact grid */}
      <div className="grid min-w-0 gap-2 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
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
            <ContextMenu key={provider.id}>
              <ContextMenuTrigger asChild>
                <Card
                  className={`p-0 h-full min-w-0 overflow-hidden border group ${provider.active ? "border-primary shadow-[inset_0_0_0_1px_var(--color-primary),0_0_0_2px_var(--color-primary)] dark:shadow-[inset_0_0_0_1px_var(--color-primary),0_0_0_2px_var(--color-primary)]" : selectedIds.has(provider.id) ? "border-primary ring-1 ring-primary" : "border-border"} ${!provider.enabled ? "opacity-50" : ""}`}
                >
                  <CardHeader className="p-3 pb-1 overflow-hidden">
                    <div className="flex min-w-0 items-center gap-1">
                      {provider.id !== "official" ? (
                        <button
                          type="button"
                          className={`h-3.5 w-3.5 shrink-0 rounded-[3px] border flex items-center justify-center transition-opacity cursor-pointer ${selectedIds.has(provider.id) ? "opacity-100 bg-primary border-primary text-primary-foreground" : isSelectMode ? "opacity-100 bg-background border-border text-muted-foreground" : "opacity-0 group-hover:opacity-100 bg-background border-border text-muted-foreground hover:border-primary"}`}
                          onClick={e => {
                            e.stopPropagation();
                            toggleSelect(provider.id);
                          }}
                        >
                          {selectedIds.has(provider.id) && <Check className="h-2.5 w-2.5" />}
                        </button>
                      ) : (
                        <span className="w-3.5 shrink-0" />
                      )}
                      <CardTitle
                        className="min-w-0 flex-1 truncate text-xs font-medium leading-tight"
                        title={provider.name}
                      >
                        {provider.name}
                      </CardTitle>
                      <div className="flex shrink-0 items-center gap-0.5">
                        {(() => {
                          const proto = PROVIDER_PROTOCOL_LABEL[provider.providerType];
                          return proto ? (
                            <span
                              className={`inline-flex shrink-0 items-center whitespace-nowrap px-1.5 py-0.5 text-[9px] font-semibold leading-none ${proto.className}`}
                              title={t(proto.label)}
                            >
                              {t(proto.label)}
                            </span>
                          ) : null;
                        })()}
                        {provider.active && (
                          <span
                            className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold leading-none text-primary"
                            title={t("providers.badge.active")}
                          >
                            <Check className="h-2.5 w-2.5 shrink-0" aria-hidden />
                            {t("providers.badgeShort.active")}
                          </span>
                        )}
                        {provider.modelMap?.length && provider.modelMappingEnabled === false ? (
                          <Badge
                            variant="outline"
                            className="h-auto shrink-0 whitespace-nowrap rounded-none px-1.5 py-0.5 text-[9px] leading-none text-amber-700 dark:text-amber-400 border-amber-600/40"
                            title={t("providers.badge.mappingOff")}
                          >
                            {t("providers.badgeShort.mappingOff")}
                          </Badge>
                        ) : null}
                        {!provider.enabled && (
                          <Badge
                            variant="outline"
                            className="h-auto shrink-0 whitespace-nowrap rounded-none px-1.5 py-0.5 text-[9px] leading-none text-muted-foreground"
                            title={t("providers.badge.disabled")}
                          >
                            {t("providers.badgeShort.disabled")}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-3 pt-0 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{t("providers.card.id")}:</span>
                      <span className="font-mono text-[10px]">{provider.id}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{t("providers.card.mode")}:</span>
                      <Badge variant="outline" className="text-[10px] px-1 py-0">
                        {provider.mode}
                      </Badge>
                    </div>
                    {provider.baseUrl && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">
                          {t("providers.card.baseUrl")}:
                        </span>
                        <span className="font-mono text-[10px] truncate max-w-[140px]">
                          {provider.baseUrl}
                        </span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </ContextMenuTrigger>
              <ContextMenuContent>
                {!provider.active && provider.enabled ? (
                  <ContextMenuItem onClick={() => handleSwitch(provider.id)}>
                    {t("providers.contextMenu.use")}
                  </ContextMenuItem>
                ) : null}
                <ContextMenuItem onClick={() => openEditModal(provider)}>
                  {t("providers.contextMenu.edit")}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => openDuplicateModal(provider)}>
                  {t("providers.contextMenu.duplicate")}
                </ContextMenuItem>
                {provider.id !== "official" ? (
                  <ContextMenuItem variant="destructive" onClick={() => requestDelete(provider)}>
                    {t("providers.contextMenu.delete")}
                  </ContextMenuItem>
                ) : null}
              </ContextMenuContent>
            </ContextMenu>
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
      {duplicateMutation.error && (
        <p className="text-xs text-destructive text-center">
          {(duplicateMutation.error as Error).message}
        </p>
      )}

      {providers.length === 0 && !isLoading && (
        <Card className="p-0">
          <CardContent className="p-6 text-center text-xs text-muted-foreground">
            {t("providers.emptyState")}
          </CardContent>
        </Card>
      )}

      <WizardDialog
        open={showWizard}
        onOpenChange={setShowWizard}
        onCustom={() => {
          setShowWizard(false);
          openLegacyAddModal();
        }}
        onComplete={() => {
          void queryClient.invalidateQueries({ queryKey: ["providers"] });
        }}
        addMutation={addMutation}
      />

      {/* Add/Edit Provider Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card
            className="w-full max-w-2xl max-h-[90vh] flex flex-col"
            key={editingProvider ? `edit-${editingProvider.id}` : "add-provider"}
          >
            {/* Modal Header */}
            <CardHeader className="border-b p-3 flex-shrink-0">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">
                  {editingProvider ? t("providers.modal.editTitle") : t("providers.modal.addTitle")}
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
                  <Label className="text-xs font-medium">
                    {t("providers.modal.providerId")} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    type="text"
                    className="h-8 text-xs disabled:opacity-50"
                    placeholder={t("providers.placeholder.id")}
                    value={editingProvider != null ? editingProvider.id : formData.id}
                    onChange={e => updateForm("id", e.target.value.replace(/[^A-Za-z0-9_-]/g, ""))}
                    disabled={editingProvider != null}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    {t("providers.modal.providerIdHelp")}
                  </p>
                </div>
                <div className="pt-[26px]">
                  <div className="flex items-center gap-2 h-8">
                    <Checkbox
                      id="enabled"
                      disabled={editingProvider?.id === "official" || formData.id === "official"}
                      checked={
                        editingProvider?.id === "official" || formData.id === "official"
                          ? true
                          : (formData.enabled ?? true)
                      }
                      onCheckedChange={checked => updateForm("enabled", checked === true)}
                    />
                    <Label htmlFor="enabled" className="text-xs font-normal whitespace-nowrap">
                      {t("providers.modal.enabled")}
                    </Label>
                    {(editingProvider?.id === "official" || formData.id === "official") && (
                      <span
                        className="text-[10px] text-muted-foreground"
                        title={t("providers.modal.alwaysOnTooltip")}
                      >
                        {t("providers.modal.alwaysOn")}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Name */}
              <div className="space-y-1">
                <Label className="text-xs font-medium">
                  {t("providers.modal.name")} <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="text"
                  className="h-8 text-xs"
                  placeholder={t("providers.placeholder.name")}
                  value={formData.name}
                  onChange={e => updateForm("name", e.target.value)}
                />
              </div>

              {/* Base URL */}
              <div className="space-y-1">
                <Label className="text-xs font-medium">
                  {t("providers.modal.baseUrl")} <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="text"
                  className="h-8 text-xs"
                  placeholder={t("providers.placeholder.baseUrl")}
                  value={formData.baseUrl}
                  onChange={e => updateForm("baseUrl", e.target.value)}
                />
              </div>

              {/* Type and Mode row */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium">{t("providers.modal.type")}</label>
                  <SelectField
                    value={formData.providerType}
                    options={[
                      { value: "anthropic", label: t("providers.protocol.anthropic") },
                      { value: "openai", label: t("providers.modal.typeOpenaiFull") },
                      { value: "openai_chat", label: t("providers.modal.typeOpenaiChatOnly") },
                    ]}
                    onChange={v => {
                      const t = v as "anthropic" | "openai" | "openai_chat";
                      setFormData(prev => ({
                        ...prev,
                        providerType: t,
                      }));
                    }}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">{t("providers.card.mode")}</label>
                  <SelectField
                    value={formData.mode}
                    options={[
                      { value: "passthrough", label: t("providers.modal.modePassthrough") },
                      { value: "inject", label: t("providers.modal.modeInject") },
                    ]}
                    onChange={v => updateForm("mode", v as "passthrough" | "inject")}
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              {/* API Key */}
              <div className="space-y-1">
                <Label className="text-xs font-medium">{t("providers.modal.apiKey")}</Label>
                {editingProvider ? (
                  <>
                    <Input
                      type="text"
                      className="h-8 cursor-not-allowed bg-muted text-xs"
                      value={
                        formData.apiKey
                          ? `${formData.apiKey.slice(0, 4)}************${formData.apiKey.slice(-4)}`
                          : t("providers.modal.apiKeyNotSet")
                      }
                      disabled
                    />
                    <p className="text-[10px] text-muted-foreground">
                      {t("providers.modal.apiKeyHelpEdit")}
                    </p>
                  </>
                ) : (
                  <>
                    <Input
                      type="password"
                      className="h-8 text-xs"
                      placeholder={t("providers.placeholder.apiKey")}
                      value={formData.apiKey || ""}
                      onChange={e => updateForm("apiKey", e.target.value)}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      {t("providers.modal.apiKeyHelpAdd")}
                    </p>
                  </>
                )}
              </div>

              {/* Custom models list */}
              <div className="space-y-2 rounded-md border border-border/60 p-3">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="use-custom-models-list"
                    checked={formData.useCustomModelsList === true}
                    onCheckedChange={checked => updateForm("useCustomModelsList", checked === true)}
                  />
                  <Label
                    htmlFor="use-custom-models-list"
                    className="cursor-pointer text-xs font-medium"
                  >
                    {t("providers.modal.useCustomModelsList")}
                  </Label>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {t("providers.modal.customModelsListHelp")}
                </p>
                {formData.useCustomModelsList ? (
                  <div className="space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <label className="text-xs font-medium min-w-0 flex-1 leading-snug">
                        {t("providers.modal.modelIds")}
                      </label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-5 shrink-0 px-1.5 text-[10px] mt-0.5"
                        onClick={() => {
                          setCoworkHelperKey(k => k + 1);
                          setCoworkHelperOpen(true);
                        }}
                      >
                        {t("providers.modal.coworkHelper")}
                      </Button>
                    </div>
                    <textarea
                      className="w-full px-2 py-1 text-xs border rounded-md bg-background font-mono"
                      placeholder={t("providers.placeholder.customModelsList")}
                      rows={5}
                      value={customModelsText}
                      onChange={e => setCustomModelsText(e.target.value)}
                    />
                  </div>
                ) : null}
              </div>

              {/* Model Map */}
              <div className="space-y-2 rounded-md border border-border/60 p-3">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="enable-model-mapping"
                    checked={formData.modelMappingEnabled !== false}
                    onCheckedChange={checked => updateForm("modelMappingEnabled", checked === true)}
                  />
                  <Label
                    htmlFor="enable-model-mapping"
                    className="cursor-pointer text-xs font-medium"
                  >
                    {t("providers.modal.enableModelMapping")}
                  </Label>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {t("providers.modal.modelMappingHelp")}
                </p>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    {t("providers.modal.modelMap")}
                  </label>
                  <textarea
                    className={`w-full px-2 py-1 text-xs border rounded-md bg-background font-mono ${modelMapError ? "border-destructive" : ""} ${formData.modelMappingEnabled === false ? "opacity-60 bg-muted/20" : ""}`}
                    placeholder={`- pattern: "claude-*"\n  model: "custom-model"`}
                    rows={6}
                    readOnly={formData.modelMappingEnabled === false}
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
                </div>
                {modelMapError && formData.modelMappingEnabled !== false && (
                  <p className="text-[10px] text-destructive">{modelMapError}</p>
                )}
                <p className="text-[10px] text-muted-foreground">
                  {t("providers.modal.modelMapHelp")}
                </p>
              </div>
            </CardContent>

            {/* Modal Footer */}
            <div className="border-t p-3 flex-shrink-0 flex justify-end gap-2">
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={closeModal}>
                {t("common.cancel")}
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
                  (formData.modelMappingEnabled !== false && !!modelMapError)
                }
              >
                {addMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : editingProvider ? (
                  t("common.save")
                ) : (
                  t("providers.modal.submitAdd")
                )}
              </Button>
            </div>
          </Card>
        </div>
      )}

      <CoworkAliasHelper
        key={coworkHelperKey}
        open={coworkHelperOpen}
        initialCustomModelsText={customModelsText}
        onOpenChange={setCoworkHelperOpen}
        onApply={handleCoworkHelperApply}
      />

      <AlertDialog
        open={deleteConfirmOpen}
        onOpenChange={o => {
          setDeleteConfirmOpen(o);
          if (!o) {
            setPendingDeleteProvider(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("providers.deleteDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("providers.deleteDialog.description", {
                name: pendingDeleteProvider?.name || t("providers.deleteDialog.thisProvider"),
              })}
              {pendingDeleteProvider?.id ? (
                <>
                  {" "}
                  (<span className="font-mono">{pendingDeleteProvider.id}</span>)
                </>
              ) : null}
              {t("providers.deleteDialog.cannotUndo")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={e => {
                e.preventDefault();
                confirmDelete();
              }}
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                t("common.delete")
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Duplicate provider — name + new id (server copies full config including API key) */}
      {showDuplicateModal && duplicateSource && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <Card className="w-full max-w-[400px] flex flex-col">
            <CardHeader className="border-b p-3 flex-shrink-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Copy className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-sm">{t("providers.duplicateModal.title")}</CardTitle>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={closeDuplicateModal}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground font-normal pt-1">
                {t("providers.duplicateModal.description", { sourceId: duplicateSource.id })}
              </p>
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              <div className="space-y-1">
                <Label className="text-xs font-medium">
                  {t("providers.duplicateModal.name")} <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="text"
                  className="h-8 text-xs"
                  value={dupName}
                  onChange={e => setDupName(e.target.value)}
                  placeholder={t("providers.duplicateModal.namePlaceholder")}
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">{t("providers.duplicateModal.newId")}</Label>
                <Input
                  type="text"
                  className="h-8 font-mono text-xs"
                  value={dupNewId}
                  onChange={e => setDupNewId(e.target.value)}
                  placeholder={t("providers.duplicateModal.idPlaceholder")}
                />
                <p className="text-[10px] text-muted-foreground">
                  {t("providers.duplicateModal.idHelp")}
                </p>
              </div>
            </CardContent>
            <div className="border-t p-3 flex-shrink-0 flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={closeDuplicateModal}
              >
                {t("common.cancel")}
              </Button>
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={handleDuplicateSubmit}
                disabled={
                  duplicateMutation.isPending ||
                  !dupName.trim() ||
                  !dupNewId.trim() ||
                  !duplicateSource
                }
              >
                {duplicateMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  t("providers.duplicateModal.action")
                )}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
