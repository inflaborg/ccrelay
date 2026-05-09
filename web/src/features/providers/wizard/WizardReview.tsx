import { useTranslation } from "react-i18next";
import type { AddProviderRequest } from "@/types/api";

export type WizardPreviewResult =
  | { ok: true; preview: AddProviderRequest[] }
  | { ok: false; error: string };

export interface WizardReviewProps {
  previewResult: WizardPreviewResult | null;
}

export function WizardReview({ previewResult }: WizardReviewProps) {
  const { t } = useTranslation();

  if (previewResult === null) {
    return null;
  }

  if (!previewResult.ok) {
    return (
      <div>
        <p className="text-sm text-destructive">{previewResult.error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t("wizard.confirm.lead")}</p>

      <ul className="space-y-2 rounded-md border bg-muted/30 p-3 text-xs">
        {previewResult.preview.map(p => (
          <li key={p.id} className="border-b border-border/50 pb-2 last:border-0 last:pb-0">
            <div className="font-medium">{p.name}</div>
            <div className="text-muted-foreground font-mono mt-1">{p.id}</div>
            <div className="text-muted-foreground mt-0.5">{p.providerType}</div>
            <div className="text-muted-foreground truncate mt-0.5" title={p.baseUrl}>
              {p.baseUrl}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
