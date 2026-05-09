import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { PartnerPreset } from "./types";

export interface WizardOptionsProps {
  preset: PartnerPreset;
  selections: Record<string, string | boolean>;
  onChange: (key: string, value: string | boolean) => void;
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

export function WizardOptions({ preset, selections, onChange }: WizardOptionsProps) {
  const { t } = useTranslation();

  if (preset.options.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {preset.options.map(opt => (
        <div key={opt.key} className="space-y-2">
          <div className="text-xs font-medium">{t(opt.label)}</div>
          {opt.type === "select" && opt.options ? (
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t(opt.label)}>
              {opt.options.map(choice => {
                const current = String(selections[opt.key] ?? opt.defaultValue);
                const selected = current === choice.value;
                return (
                  <button
                    key={choice.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={cn(cardButtonClass(selected), "min-w-[8rem] flex-1 sm:flex-none")}
                    onClick={() => onChange(opt.key, choice.value)}
                  >
                    {t(choice.label)}
                  </button>
                );
              })}
            </div>
          ) : (
            <div
              className="grid grid-cols-2 gap-2 sm:max-w-md"
              role="radiogroup"
              aria-label={t(opt.label)}
            >
              <button
                type="button"
                role="radio"
                aria-checked={!(selections[opt.key] ?? opt.defaultValue)}
                className={cardButtonClass(!(selections[opt.key] ?? opt.defaultValue))}
                onClick={() => onChange(opt.key, false)}
              >
                {t("wizard.toggle.off")}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={Boolean(selections[opt.key] ?? opt.defaultValue)}
                className={cardButtonClass(Boolean(selections[opt.key] ?? opt.defaultValue))}
                onClick={() => onChange(opt.key, true)}
              >
                {t("wizard.toggle.on")}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
