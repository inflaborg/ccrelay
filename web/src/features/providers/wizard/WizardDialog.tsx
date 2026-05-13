import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { AddProviderRequest } from "@/types/api";
import type { PartnerPreset, WizardInput } from "./types";
import { buildTemplateValues, generateProviders, initSelections, resolveTemplate } from "./engine";
import { defaultModelIdsAsText } from "./presets";
import { WizardChooser } from "./WizardChooser";
import { WizardOptions } from "./WizardOptions";
import {
  WizardCredentials,
  wizardCredentialsCanSubmit,
  type WizardCredentialsFields,
} from "./WizardCredentials";
import { WizardReview, type WizardPreviewResult } from "./WizardReview";
import { useUpstreamModels } from "./useUpstreamModels";
import { WizardEndpointTest } from "./WizardEndpointTest";
import type { TestVariantInput } from "./useEndpointTest";

export type WizardPhase = "choose" | "brand";

export interface WizardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCustom: () => void;
  onComplete: () => void;
  addMutation: {
    mutateAsync: (data: AddProviderRequest) => Promise<unknown>;
  };
}

function resetWizardState() {
  return {
    phase: "choose" as WizardPhase,
    preset: null as PartnerPreset | null,
    selections: {} as Record<string, string | boolean>,
    nameBase: "",
    apiKey: "",
    userBaseUrl: "",
    modelIdsText: "",
    claudeSupport: true,
    useCustomModels: true,
  };
}

export function WizardDialog({
  open,
  onOpenChange,
  onCustom,
  onComplete,
  addMutation,
}: WizardDialogProps) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<WizardPhase>("choose");
  const [preset, setPreset] = useState<PartnerPreset | null>(null);
  const [selections, setSelections] = useState<Record<string, string | boolean>>({});
  const [nameBase, setNameBase] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [userBaseUrl, setUserBaseUrl] = useState("");
  const [modelIdsText, setModelIdsText] = useState("");
  const [claudeSupport, setClaudeSupport] = useState(true);
  const [useCustomModels, setUseCustomModels] = useState(true);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const resolvedBaseForProbe = useMemo(() => {
    if (!preset) {
      return "";
    }
    if (preset.fixedBaseUrl) {
      return preset.fixedBaseUrl;
    }
    if (preset.requireUserBaseUrl) {
      return userBaseUrl.trim();
    }
    try {
      const tv = buildTemplateValues(preset, selections, userBaseUrl);
      return resolveTemplate(preset.variants[0].urlTemplate, tv);
    } catch {
      return "";
    }
  }, [preset, selections, userBaseUrl]);

  const probeProviderType = preset?.variants[0]?.providerType ?? "openai_chat";

  const upstreamProbeEnabled =
    phase === "brand" &&
    preset !== null &&
    Boolean(resolvedBaseForProbe.trim()) &&
    Boolean(apiKey.trim());

  const upstreamModels = useUpstreamModels(
    resolvedBaseForProbe,
    apiKey,
    probeProviderType,
    upstreamProbeEnabled
  );

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        const r = resetWizardState();
        setPhase(r.phase);
        setPreset(r.preset);
        setSelections(r.selections);
        setNameBase(r.nameBase);
        setApiKey(r.apiKey);
        setUserBaseUrl(r.userBaseUrl);
        setModelIdsText(r.modelIdsText);
        setClaudeSupport(r.claudeSupport);
        setUseCustomModels(r.useCustomModels);
        setSubmitError(null);
        setBusy(false);
      }
      onOpenChange(next);
    },
    [onOpenChange]
  );

  const handleSelectCustom = useCallback(() => {
    handleOpenChange(false);
    onCustom();
  }, [handleOpenChange, onCustom]);

  const handleSelectPreset = useCallback((p: PartnerPreset) => {
    setPhase("brand");
    setPreset(p);
    setSelections(initSelections(p));
    setNameBase(p.namePrefix);
    setApiKey("");
    setUserBaseUrl(p.defaultUserBaseUrl ?? "");
    setUseCustomModels(p.defaultCustomModels);
    setModelIdsText(p.defaultCustomModels ? defaultModelIdsAsText(p) : "");
    setClaudeSupport(true);
    setSubmitError(null);
  }, []);

  const handleBackToChoose = useCallback(() => {
    const r = resetWizardState();
    setPhase(r.phase);
    setPreset(r.preset);
    setSelections(r.selections);
    setNameBase(r.nameBase);
    setApiKey(r.apiKey);
    setUserBaseUrl(r.userBaseUrl);
    setModelIdsText(r.modelIdsText);
    setClaudeSupport(r.claudeSupport);
    setUseCustomModels(r.useCustomModels);
    setSubmitError(null);
  }, []);

  const previewResult: WizardPreviewResult | null = useMemo(() => {
    if (!preset) {
      return null;
    }
    const wi: WizardInput = {
      selections,
      apiKey,
      userBaseUrl: userBaseUrl.trim() || undefined,
      nameBase: nameBase.trim() || undefined,
      modelIds: useCustomModels
        ? modelIdsText
            .split("\n")
            .map(l => l.trim())
            .filter(l => l.length > 0)
        : [],
      claudeSupport,
      useCustomModels,
    };
    try {
      return { ok: true, preview: generateProviders(preset, wi) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, [
    preset,
    selections,
    apiKey,
    userBaseUrl,
    nameBase,
    modelIdsText,
    claudeSupport,
    useCustomModels,
  ]);

  const credentialFields: WizardCredentialsFields = useMemo(
    () => ({
      nameBase,
      apiKey,
      userBaseUrl,
      modelIdsText,
    }),
    [nameBase, apiKey, userBaseUrl, modelIdsText]
  );

  const canSubmit =
    phase === "brand" &&
    preset !== null &&
    wizardCredentialsCanSubmit(preset, credentialFields, useCustomModels) &&
    previewResult?.ok === true;

  const handleCreate = useCallback(async () => {
    if (!previewResult?.ok || !preset) {
      return;
    }
    setSubmitError(null);
    setBusy(true);
    try {
      for (const req of previewResult.preview) {
        await addMutation.mutateAsync(req);
      }
      onComplete();
      handleOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSubmitError(msg);
    } finally {
      setBusy(false);
    }
  }, [previewResult, preset, addMutation, onComplete, handleOpenChange]);

  const title =
    phase === "brand" && preset !== null
      ? t("wizard.titleBrand", { brand: t(preset.nameKey) })
      : t("wizard.title");

  const modelsPlaceholder = preset ? defaultModelIdsAsText(preset) : undefined;

  const customFirstModelId = useMemo(() => {
    const first = modelIdsText
      .split("\n")
      .map(l => l.trim())
      .find(l => l.length > 0);
    if (!first) {
      return null;
    }
    const i = first.indexOf(";");
    if (i === -1) {
      return first;
    }
    const id = first.slice(0, i).trim();
    return id.length > 0 ? id : null;
  }, [modelIdsText]);

  const testVariants: TestVariantInput[] | null = useMemo(() => {
    if (!previewResult?.ok) {
      return null;
    }
    return previewResult.preview.map(p => ({
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      providerType: p.providerType,
      authHeader: p.authHeader,
    }));
  }, [previewResult]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-full max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 space-y-1 border-b px-6 pb-4 pt-6 text-left">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {phase === "choose" ? (
            <WizardChooser
              onSelectCustom={handleSelectCustom}
              onSelectPreset={handleSelectPreset}
            />
          ) : preset ? (
            <div className="flex flex-col gap-8">
              <WizardOptions
                preset={preset}
                selections={selections}
                onChange={(key, value) => setSelections(prev => ({ ...prev, [key]: value }))}
              />

              <div
                className={preset.options.length > 0 ? "border-t border-border pt-8" : undefined}
              >
                <WizardCredentials
                  preset={preset}
                  modelsPlaceholder={modelsPlaceholder}
                  useCustomModels={useCustomModels}
                  onUseCustomModelsChange={setUseCustomModels}
                  upstreamModels={upstreamModels}
                  nameBase={nameBase}
                  onNameBaseChange={setNameBase}
                  apiKey={apiKey}
                  onApiKeyChange={setApiKey}
                  userBaseUrl={userBaseUrl}
                  onUserBaseUrlChange={setUserBaseUrl}
                  modelIdsText={modelIdsText}
                  onModelIdsTextChange={setModelIdsText}
                  claudeSupport={claudeSupport}
                  onClaudeSupportChange={setClaudeSupport}
                />
              </div>

              <div className="border-t border-border pt-8">
                <WizardReview previewResult={previewResult} />
              </div>

              {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}
            </div>
          ) : null}
        </div>

        <DialogFooter className="shrink-0 flex-col gap-3 border-t px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          {phase === "choose" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={() => handleOpenChange(false)}
              disabled={busy}
            >
              {t("wizard.step.cancel")}
            </Button>
          ) : (
            <>
              <WizardEndpointTest
                wizardOpen={open}
                variants={testVariants}
                apiKey={apiKey}
                useCustomModels={useCustomModels}
                customFirstModelId={customFirstModelId}
                probeModels={useCustomModels ? null : upstreamModels.models}
                disabled={busy}
              />
              <div className="flex w-full shrink-0 flex-wrap justify-end gap-2 sm:w-auto">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleBackToChoose}
                  disabled={busy}
                >
                  {t("wizard.step.back")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleOpenChange(false)}
                  disabled={busy}
                >
                  {t("wizard.step.cancel")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleCreate()}
                  disabled={!canSubmit || busy}
                >
                  {busy ? (
                    <>
                      <Loader2 className="mr-1 inline h-4 w-4 animate-spin" />
                      {t("wizard.confirm.working")}
                    </>
                  ) : (
                    t("wizard.confirm.submit")
                  )}
                </Button>
              </div>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
