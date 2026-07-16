import { useId, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { SelectField } from "@/components/select-field";
import { getParallelLocationOptions } from "./parallel-locations";

export interface ParallelAdvancedFormState {
  publishedAfter: string;
  location: string;
  includeDomains: string;
  excludeDomains: string;
  liveFetch: boolean;
  maxCharsPerResult: string;
}

interface ParallelAdvancedOptionsProps {
  value: ParallelAdvancedFormState;
  onChange: (patch: Partial<ParallelAdvancedFormState>) => void;
}

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,7rem)_1fr] items-start gap-x-3 gap-y-1">
      <div className="pt-1.5">
        <Label className="text-xs font-medium leading-tight">{label}</Label>
        {hint ? <p className="text-[10px] text-muted-foreground mt-0.5">{hint}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function EnableRow({
  checked,
  onCheckedChange,
  label,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2 h-8">
      <Checkbox id={id} checked={checked} onCheckedChange={v => onCheckedChange(v === true)} />
      <Label htmlFor={id} className="cursor-pointer text-xs font-normal">
        {label}
      </Label>
    </div>
  );
}

/** Parallel `advanced_settings` fields — shown when search mode is `advanced`. */
export default function ParallelAdvancedOptions({ value, onChange }: ParallelAdvancedOptionsProps) {
  const { t, i18n } = useTranslation();

  const locationOptions = useMemo(
    () =>
      getParallelLocationOptions(
        i18n.language,
        t("capabilities.webSearch.parallelLocationAuto"),
        value.location
      ),
    [i18n.language, t, value.location]
  );

  return (
    <div className="rounded-md border border-border bg-muted/20 p-3 space-y-4">
      <div className="space-y-3">
        <p className="text-xs font-medium text-muted-foreground">
          {t("capabilities.webSearch.parallelSourcePolicy")}
        </p>

        <FieldRow label={t("capabilities.webSearch.parallelPublishedAfter")}>
          <Input
            type="date"
            className="h-8 text-xs font-mono"
            value={value.publishedAfter}
            onChange={e => onChange({ publishedAfter: e.target.value })}
          />
        </FieldRow>

        <FieldRow
          label={t("capabilities.webSearch.parallelLocation")}
          hint={t("capabilities.webSearch.parallelLocationHint")}
        >
          <SelectField
            value={value.location}
            onChange={v => onChange({ location: v })}
            options={locationOptions}
          />
        </FieldRow>

        <FieldRow
          label={t("capabilities.webSearch.parallelIncludeDomains")}
          hint={t("capabilities.webSearch.parallelDomainsHint")}
        >
          <Input
            type="text"
            className="h-8 text-xs font-mono"
            value={value.includeDomains}
            placeholder={t("capabilities.webSearch.parallelIncludeDomainsPlaceholder")}
            onChange={e => onChange({ includeDomains: e.target.value })}
          />
        </FieldRow>

        <FieldRow
          label={t("capabilities.webSearch.parallelExcludeDomains")}
          hint={t("capabilities.webSearch.parallelDomainsHint")}
        >
          <Input
            type="text"
            className="h-8 text-xs font-mono"
            value={value.excludeDomains}
            placeholder={t("capabilities.webSearch.parallelExcludeDomainsPlaceholder")}
            onChange={e => onChange({ excludeDomains: e.target.value })}
          />
        </FieldRow>
      </div>

      <div className="space-y-3 border-t border-border/60 pt-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            {t("capabilities.webSearch.parallelFetchPolicy")}
          </p>
          <EnableRow
            checked={value.liveFetch}
            onCheckedChange={v => onChange({ liveFetch: v })}
            label={t("capabilities.webSearch.parallelLiveFetch")}
          />
        </div>
        {value.liveFetch ? (
          <p className="text-[10px] text-muted-foreground">
            {t("capabilities.webSearch.parallelLiveFetchHint")}
          </p>
        ) : null}

        <FieldRow
          label={t("capabilities.webSearch.parallelMaxCharsPerResult")}
          hint={t("capabilities.webSearch.parallelMaxCharsPerResultHint")}
        >
          <Input
            type="number"
            className="h-8 text-xs font-mono"
            value={value.maxCharsPerResult}
            min={1}
            placeholder={t("capabilities.webSearch.parallelMaxCharsPerResultPlaceholder")}
            onChange={e => onChange({ maxCharsPerResult: e.target.value })}
          />
        </FieldRow>
      </div>
    </div>
  );
}
