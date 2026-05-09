import { useTranslation } from "react-i18next";
import { Layers, MessageSquare, Settings2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PartnerPreset } from "./types";
import { GENERIC_ENDPOINT_PRESETS, PARTNER_PRESETS } from "./presets";

export interface WizardChooserProps {
  onSelectCustom: () => void;
  onSelectPreset: (preset: PartnerPreset) => void;
}

function PresetCardIcon({ presetId }: { presetId: string }) {
  if (presetId === "generic-openai-chat") {
    return <MessageSquare className="h-4 w-4 shrink-0 text-sky-600" />;
  }
  if (presetId === "generic-anthropic") {
    return <Layers className="h-4 w-4 shrink-0 text-violet-600" />;
  }
  return <Sparkles className="h-4 w-4 shrink-0 text-emerald-600" />;
}

export function WizardChooser({ onSelectCustom, onSelectPreset }: WizardChooserProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">
          {t("wizard.chooser.genericSection")}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {GENERIC_ENDPOINT_PRESETS.map(preset => (
            <button
              key={preset.id}
              type="button"
              className={cn(
                "flex flex-col items-start gap-1 rounded-lg border bg-card p-3 text-left transition-colors",
                "hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-ring"
              )}
              onClick={() => onSelectPreset(preset)}
            >
              <div className="flex items-center gap-2">
                <PresetCardIcon presetId={preset.id} />
                <span className="text-sm font-medium">{t(preset.nameKey)}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">
          {t("wizard.chooser.customSection")}
        </p>
        <button
          type="button"
          className={cn(
            "flex w-full items-start gap-3 rounded-lg border bg-card p-4 text-left transition-colors",
            "hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-ring"
          )}
          onClick={onSelectCustom}
        >
          <Settings2 className="h-5 w-5 shrink-0 text-muted-foreground mt-0.5" />
          <div>
            <div className="text-sm font-medium">{t("wizard.chooser.custom")}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {t("wizard.chooser.customDesc")}
            </div>
          </div>
        </button>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">{t("wizard.chooser.partners")}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {PARTNER_PRESETS.map(preset => (
            <button
              key={preset.id}
              type="button"
              className={cn(
                "flex flex-col items-start gap-1 rounded-lg border bg-card p-3 text-left transition-colors",
                "hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-ring"
              )}
              onClick={() => onSelectPreset(preset)}
            >
              <div className="flex items-center gap-2">
                <PresetCardIcon presetId={preset.id} />
                <span className="text-sm font-medium">{t(preset.nameKey)}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
