import { useTranslation } from "react-i18next";
import { Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PartnerPreset } from "./types";
import type { UpstreamModelsResult } from "./useUpstreamModels";

export interface WizardCredentialsFields {
  nameBase: string;
  apiKey: string;
  userBaseUrl: string;
  modelIdsText: string;
}

export function wizardCredentialsCanSubmit(
  preset: PartnerPreset,
  fields: WizardCredentialsFields,
  useCustomModels: boolean
): boolean {
  const baseOk =
    fields.nameBase.trim().length > 0 &&
    fields.apiKey.trim().length > 0 &&
    (!preset.requireUserBaseUrl || fields.userBaseUrl.trim().length > 0);

  if (!useCustomModels) {
    return baseOk;
  }

  const hasModels = fields.modelIdsText
    .split("\n")
    .map(l => l.trim())
    .some(l => l.length > 0);
  return baseOk && hasModels;
}

function cardButtonClass(selected: boolean) {
  return cn(
    "rounded-lg border bg-card px-3 py-2.5 text-left text-xs font-medium transition-colors",
    "focus:outline-none focus:ring-2 focus:ring-ring",
    selected
      ? "border-primary ring-2 ring-primary/20 bg-accent"
      : "border-border hover:bg-accent/50"
  );
}

export interface WizardCredentialsProps {
  preset: PartnerPreset;
  modelsPlaceholder?: string;
  useCustomModels: boolean;
  onUseCustomModelsChange: (v: boolean) => void;
  upstreamModels: UpstreamModelsResult;
  nameBase: string;
  onNameBaseChange: (v: string) => void;
  apiKey: string;
  onApiKeyChange: (v: string) => void;
  userBaseUrl: string;
  onUserBaseUrlChange: (v: string) => void;
  modelIdsText: string;
  onModelIdsTextChange: (v: string) => void;
  claudeSupport: boolean;
  onClaudeSupportChange: (v: boolean) => void;
}

export function WizardCredentials({
  preset,
  modelsPlaceholder,
  useCustomModels,
  onUseCustomModelsChange,
  upstreamModels,
  nameBase,
  onNameBaseChange,
  apiKey,
  onApiKeyChange,
  userBaseUrl,
  onUserBaseUrlChange,
  modelIdsText,
  onModelIdsTextChange,
  claudeSupport,
  onClaudeSupportChange,
}: WizardCredentialsProps) {
  const { t } = useTranslation();

  /** Custom list ON: show left reference only when fetch succeeded with ≥1 model */
  const showUpstreamReferenceColumn =
    useCustomModels &&
    Boolean(upstreamModels.models && upstreamModels.models.length > 0 && !upstreamModels.errorCode);

  /** Inline hint shown next to the model IDs label during/after upstream fetch */
  const upstreamFetchHint: { icon: "spinner" | "warn"; text: string } | null = (() => {
    if (!useCustomModels) return null;
    if (upstreamModels.loading) return { icon: "spinner", text: t("wizard.models.fetchingHint") };
    if (upstreamModels.errorCode) return { icon: "warn", text: t("wizard.models.fetchFailedHint") };
    if (upstreamModels.models && upstreamModels.models.length === 0)
      return { icon: "warn", text: t("wizard.models.fetchFailedHint") };
    return null;
  })();

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <label className="text-xs font-medium">
          {t("wizard.field.name")} <span className="text-destructive">*</span>
        </label>
        <input
          type="text"
          className="w-full h-8 px-2 text-xs border rounded-md bg-background"
          value={nameBase}
          onChange={e => onNameBaseChange(e.target.value)}
          placeholder={preset.namePrefix}
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium">
          {t("wizard.field.apiKey")} <span className="text-destructive">*</span>
        </label>
        <input
          type="password"
          className="w-full h-8 px-2 text-xs border rounded-md bg-background font-mono"
          value={apiKey}
          onChange={e => onApiKeyChange(e.target.value)}
          autoComplete="off"
        />
      </div>

      {preset.requireUserBaseUrl ? (
        <div className="space-y-1">
          <label className="text-xs font-medium">
            {t("wizard.field.baseUrl")} <span className="text-destructive">*</span>
          </label>
          <input
            type="text"
            className="w-full h-8 px-2 text-xs border rounded-md bg-background font-mono"
            value={userBaseUrl}
            onChange={e => onUserBaseUrlChange(e.target.value)}
            placeholder={
              preset.id === "azure-openai"
                ? "https://xxx.cognitiveservices.azure.com/openai/v1"
                : (preset.defaultUserBaseUrl ?? "https://upstream.example.com/v1")
            }
          />
          <p className="text-[10px] text-muted-foreground">
            {preset.id === "azure-openai"
              ? t("wizard.help.azureEndpoint")
              : preset.defaultUserBaseUrl
                ? t("wizard.help.presetEndpointDefault")
                : t("wizard.help.customEndpoint")}
          </p>
        </div>
      ) : null}

      <div className="space-y-2">
        <div className="text-xs font-medium">{t("wizard.field.customModels")}</div>
        <div
          className="grid grid-cols-2 gap-2 sm:max-w-md"
          role="radiogroup"
          aria-label={t("wizard.field.customModels")}
        >
          <button
            type="button"
            role="radio"
            aria-checked={!useCustomModels}
            className={cardButtonClass(!useCustomModels)}
            onClick={() => onUseCustomModelsChange(false)}
          >
            {t("wizard.toggle.off")}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={useCustomModels}
            className={cardButtonClass(useCustomModels)}
            onClick={() => onUseCustomModelsChange(true)}
          >
            {t("wizard.toggle.on")}
          </button>
        </div>
      </div>

      {!useCustomModels ? (
        <div className="space-y-2 rounded-md border bg-muted/20 p-3">
          {upstreamModels.loading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin shrink-0" />
              {t("wizard.models.loading")}
            </div>
          ) : null}
          {!upstreamModels.loading && upstreamModels.errorCode ? (
            <p className="text-xs text-destructive">
              {upstreamModels.errorCode === "auth"
                ? t("wizard.models.authError")
                : upstreamModels.errorCode === "network"
                  ? t("wizard.models.networkError")
                  : t("wizard.models.formatError")}
            </p>
          ) : null}
          {!upstreamModels.loading &&
          !upstreamModels.errorCode &&
          upstreamModels.models &&
          upstreamModels.models.length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                {t("wizard.models.success", { count: upstreamModels.models.length })}
              </p>
              <ul className="max-h-40 overflow-y-auto space-y-0.5 text-xs font-mono border rounded-md bg-background p-2">
                {upstreamModels.models.map(id => (
                  <li key={id} className="truncate" title={id}>
                    {id}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {!upstreamModels.loading &&
          !upstreamModels.errorCode &&
          upstreamModels.models &&
          upstreamModels.models.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("wizard.models.empty")}</p>
          ) : null}
        </div>
      ) : (
        <div
          className={cn(
            "grid gap-3 items-start",
            showUpstreamReferenceColumn ? "sm:grid-cols-2" : "grid-cols-1"
          )}
        >
          {showUpstreamReferenceColumn ? (
            <div className="flex min-h-[120px] min-w-0 flex-col space-y-1 rounded-md border bg-muted/20 p-3">
              <div className="text-xs font-medium">{t("wizard.models.referenceTitle")}</div>
              {upstreamModels.loading ? (
                <div className="flex flex-1 items-center gap-2 py-2 text-xs text-muted-foreground">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                  {t("wizard.models.loading")}
                </div>
              ) : (
                <>
                  <p className="text-[10px] text-muted-foreground">
                    {t("wizard.models.success", {
                      count: upstreamModels.models?.length ?? 0,
                    })}
                  </p>
                  <ul className="max-h-48 flex-1 space-y-0.5 overflow-y-auto rounded-md border bg-background p-2 font-mono text-xs">
                    {(upstreamModels.models ?? []).map(id => (
                      <li key={id} className="truncate" title={id}>
                        {id}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ) : null}
          <div className="min-w-0 space-y-1">
            <label className="text-xs font-medium flex items-center gap-2">
              <span>
                {t("wizard.field.models")} <span className="text-destructive">*</span>
              </span>
              {upstreamFetchHint ? (
                <span className="inline-flex items-center gap-1 font-normal text-muted-foreground">
                  {upstreamFetchHint.icon === "spinner" ? (
                    <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                  ) : (
                    <AlertCircle className="h-3 w-3 shrink-0" />
                  )}
                  {upstreamFetchHint.text}
                </span>
              ) : null}
            </label>
            <textarea
              className="min-h-[120px] w-full px-2 py-1.5 font-mono text-xs border rounded-md bg-background"
              value={modelIdsText}
              onChange={e => onModelIdsTextChange(e.target.value)}
              placeholder={modelsPlaceholder ?? t("wizard.placeholder.models")}
            />
            <p className="text-[10px] text-muted-foreground">{t("wizard.help.models")}</p>
          </div>
        </div>
      )}

      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          className="h-4 w-4 mt-0.5 rounded border"
          checked={claudeSupport}
          onChange={e => onClaudeSupportChange(e.target.checked)}
        />
        <span className="text-xs leading-snug">
          <span className="font-medium">{t("wizard.field.claudeSupport")}</span>
          <span className="block text-muted-foreground mt-0.5">
            {t("wizard.help.claudeSupport")}
          </span>
        </span>
      </label>
    </div>
  );
}
