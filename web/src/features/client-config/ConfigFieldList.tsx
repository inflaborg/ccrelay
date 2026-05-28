import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ClientConfigField } from "@/types/api";

const EXPECTED_RULE_SLUGS: Record<string, string> = {
  "(non-empty)": "nonEmpty",
  "(positive number)": "positiveNumber",
  "(truthy)": "truthy",
  "(absent)": "absent",
  "(any non-empty)": "anyNonEmpty",
  '(non-empty array including "*")': "nonEmptyArrayIncludingStar",
  "x-ccrelay-model-alias: (non-empty, key case-insensitive)": "aliasHeaderNonEmpty",
};

function fieldLabel(key: string, t: (k: string) => string): string {
  const translated = t(`clientConfig.fields.${key}`);
  return translated === `clientConfig.fields.${key}` ? key : translated;
}

function expectedHint(
  expected: string,
  t: (k: string, options?: Record<string, unknown>) => string
): string {
  const slug = EXPECTED_RULE_SLUGS[expected];
  if (!slug) {
    return expected;
  }
  const translated = t(`clientConfig.rules.${slug}`);
  return translated === `clientConfig.rules.${slug}` ? expected : translated;
}

function FieldRow({
  field,
  variant,
  t,
}: {
  field: ClientConfigField;
  variant: "gap" | "ok";
  t: (k: string, options?: Record<string, unknown>) => string;
}) {
  const label = fieldLabel(field.key, t);

  if (variant === "ok") {
    return (
      <div className="flex items-start gap-1.5 py-0.5">
        <Check className="h-3 w-3 text-green-600 dark:text-green-500 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <span className="text-[10px] text-muted-foreground">{label}</span>
          {field.current && (
            <p className="text-[10px] font-mono text-muted-foreground break-all">{field.current}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded border border-amber-500/40 px-2 py-1.5 space-y-0.5">
      <p className="text-[10px] font-medium text-amber-700 dark:text-amber-400">{label}</p>
      <p className="text-[10px] text-muted-foreground">
        <span className="text-amber-600 dark:text-amber-500">
          {t("clientConfig.diff.expectedLabel")}
        </span>{" "}
        <span className="font-mono break-all">{expectedHint(field.expected, t)}</span>
      </p>
      <p className="text-[10px] text-muted-foreground">
        <span className="text-amber-600 dark:text-amber-500">
          {t("clientConfig.diff.currentLabel")}
        </span>{" "}
        <span className="font-mono break-all">
          {field.current ?? t("clientConfig.diff.notSetCurrent")}
        </span>
      </p>
    </div>
  );
}

export default function ConfigFieldList({ fields }: { fields: ClientConfigField[] }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  if (fields.length === 0) {
    return null;
  }

  const gaps = fields.filter(f => !f.ok);
  const okFields = fields.filter(f => f.ok);
  const allOk = gaps.length === 0;

  if (allOk) {
    return (
      <div className="mt-2 pt-2 border-t border-border/50 space-y-1 w-full">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] text-muted-foreground">
            {t("clientConfig.diff.allConfigured")}
          </p>
          {okFields.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-[10px] gap-0.5"
              onClick={() => setExpanded(v => !v)}
            >
              {expanded ? (
                <>
                  <ChevronUp className="h-3 w-3" />
                  {t("clientConfig.diff.collapse")}
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3" />
                  {t("clientConfig.diff.expandAll")}
                </>
              )}
            </Button>
          )}
        </div>
        {expanded && (
          <div className="space-y-0.5">
            {okFields.map(field => (
              <FieldRow key={field.key} field={field} variant="ok" t={t} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mt-2 pt-2 border-t border-border/50 space-y-1.5 w-full">
      {gaps.map(field => (
        <FieldRow key={field.key} field={field} variant="gap" t={t} />
      ))}
      {okFields.length > 0 && (
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-[10px] gap-0.5"
            onClick={() => setExpanded(v => !v)}
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3 w-3" />
                {t("clientConfig.diff.collapseOk")}
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3" />
                {t("clientConfig.diff.expandOk")}
              </>
            )}
          </Button>
          {expanded && (
            <div className="space-y-0.5">
              {okFields.map(field => (
                <FieldRow key={field.key} field={field} variant="ok" t={t} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
