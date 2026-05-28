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

function OkFieldRow({
  field,
  t,
}: {
  field: ClientConfigField;
  t: (k: string, options?: Record<string, unknown>) => string;
}) {
  const label = fieldLabel(field.key, t);
  const value = field.current ?? "";

  return (
    <div className="flex items-start gap-1.5 min-w-0 rounded-md border border-border/40 bg-muted/20 px-2 py-1.5">
      <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-500 shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1 grid grid-cols-1 gap-0.5 sm:grid-cols-[minmax(5.5rem,42%)_1fr] sm:gap-x-2 sm:items-baseline">
        <span className="text-xs text-muted-foreground truncate" title={label}>
          {label}
        </span>
        {value ? (
          <span className="text-xs font-mono text-muted-foreground truncate" title={value}>
            {value}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground/60">—</span>
        )}
      </div>
    </div>
  );
}

function GapFieldRow({
  field,
  t,
}: {
  field: ClientConfigField;
  t: (k: string, options?: Record<string, unknown>) => string;
}) {
  const label = fieldLabel(field.key, t);

  return (
    <div className="rounded border border-amber-500/40 px-2.5 py-2 space-y-1 col-span-full">
      <p className="text-xs font-medium text-amber-700 dark:text-amber-400">{label}</p>
      <p className="text-xs text-muted-foreground">
        <span className="text-amber-600 dark:text-amber-500">
          {t("clientConfig.diff.expectedLabel")}
        </span>{" "}
        <span className="font-mono break-all">{expectedHint(field.expected, t)}</span>
      </p>
      <p className="text-xs text-muted-foreground">
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
  const gaps = fields.filter(f => !f.ok);
  const okFields = fields.filter(f => f.ok);
  const allOk = gaps.length === 0;
  const [expanded, setExpanded] = useState(allOk);

  if (fields.length === 0) {
    return null;
  }

  const toggleButton = okFields.length > 0 && (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 px-2 text-xs gap-1 shrink-0"
      onClick={() => setExpanded(v => !v)}
    >
      {expanded ? (
        <>
          <ChevronUp className="h-3.5 w-3.5" />
          {allOk ? t("clientConfig.diff.collapse") : t("clientConfig.diff.collapseOk")}
        </>
      ) : (
        <>
          <ChevronDown className="h-3.5 w-3.5" />
          {allOk ? t("clientConfig.diff.expandAll") : t("clientConfig.diff.expandOk")}
        </>
      )}
    </Button>
  );

  if (allOk) {
    return (
      <div className="space-y-2 w-full">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{t("clientConfig.diff.allConfigured")}</p>
          {toggleButton}
        </div>
        {expanded && (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
            {okFields.map(field => (
              <OkFieldRow key={field.key} field={field} t={t} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2 w-full">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
        {gaps.map(field => (
          <GapFieldRow key={field.key} field={field} t={t} />
        ))}
      </div>
      {okFields.length > 0 && (
        <>
          <div className="flex items-center justify-end gap-2 pt-1">{toggleButton}</div>
          {expanded && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
              {okFields.map(field => (
                <OkFieldRow key={field.key} field={field} t={t} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
