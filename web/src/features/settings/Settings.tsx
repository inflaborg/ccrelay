import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListFilter, Loader2, Plus, Trash2, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { api } from "@/api/client";
import type {
  LoggingSettings,
  ConcurrencySettings,
  ServerSettings,
  RoutingSettings,
  RoutingBlockRule,
} from "@/types/api";

// ─── reusable small inputs ──────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 h-8 cursor-pointer select-none">
      <input
        type="checkbox"
        className="h-4 w-4"
        checked={checked}
        disabled={disabled}
        onChange={e => onChange(e.target.checked)}
      />
      <span className="text-xs">{label}</span>
    </label>
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  className?: string;
}) {
  return (
    <input
      type="number"
      className={`w-full h-8 px-2 text-xs border rounded-md bg-background font-mono ${className ?? ""}`}
      value={value}
      min={min}
      max={max}
      onChange={e => onChange(Number(e.target.value))}
    />
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      type="text"
      className={`w-full h-8 px-2 text-xs border rounded-md bg-background font-mono ${className ?? ""}`}
      value={value}
      placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
    />
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium">{label}</label>
      {children}
    </div>
  );
}

function serializeRoutingForCompare(routing: RoutingSettings): string {
  return JSON.stringify({
    forward: routing.forward ?? [],
    block: routing.block ?? [],
  });
}

function cloneRouting(routing: RoutingSettings): RoutingSettings {
  return structuredClone({
    forward: routing.forward ?? [],
    block: routing.block ?? [],
  });
}

function SaveBar({
  mutation,
  onSave,
  restartRequired,
}: {
  mutation: { isPending: boolean; isError: boolean; error: unknown; isSuccess: boolean };
  onSave: () => void;
  restartRequired?: boolean;
}) {
  return (
    <div className="space-y-2 pt-2">
      <div className="flex items-center gap-2">
        <Button size="sm" className="h-7 text-xs" disabled={mutation.isPending} onClick={onSave}>
          {mutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
        </Button>
        {mutation.isSuccess && !restartRequired && (
          <span className="text-[10px] text-green-600 dark:text-green-500">Saved</span>
        )}
      </div>
      {mutation.isSuccess && restartRequired && (
        <p className="text-[10px] text-amber-600 dark:text-amber-500">
          Changes saved. A server restart is required for these settings to take effect.
        </p>
      )}
      {mutation.isError && (
        <p className="text-[10px] text-destructive">{(mutation.error as Error).message}</p>
      )}
    </div>
  );
}

function RoutingSaveBar({
  mutation,
  onSave,
  hasUnsavedChanges,
  rightSlot,
}: {
  mutation: { isPending: boolean; isError: boolean; error: unknown };
  onSave: () => void;
  hasUnsavedChanges: boolean;
  rightSlot?: ReactNode;
}) {
  const canSave = hasUnsavedChanges && !mutation.isPending;
  return (
    <div className="space-y-2 pt-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <Button
            size="sm"
            className="h-7 text-xs min-w-[7rem]"
            disabled={!canSave}
            onClick={onSave}
          >
            {mutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : hasUnsavedChanges ? (
              "Save routing"
            ) : (
              "Up to date"
            )}
          </Button>
          {hasUnsavedChanges ? (
            <span className="text-[10px] text-amber-600 dark:text-amber-500">Unsaved changes</span>
          ) : (
            <span className="text-[10px] text-muted-foreground">Matches saved config</span>
          )}
        </div>
        {rightSlot != null ? <div className="flex shrink-0 items-center">{rightSlot}</div> : null}
      </div>
      {mutation.isError && (
        <p className="text-[10px] text-destructive">{(mutation.error as Error).message}</p>
      )}
    </div>
  );
}

// ─── section wrapper (always expanded) ─────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-0">
      <CardHeader className="p-3 pb-2">
        <CardTitle className="text-xs font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0 space-y-3">{children}</CardContent>
    </Card>
  );
}

// ─── Server section ─────────────────────────────────────────────────────────

function ServerSection({ data }: { data: ServerSettings }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(data);

  const mutation = useMutation({
    mutationFn: (d: Record<string, unknown>) => api.patchConfig({ section: "server", data: d }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["config"] }),
  });

  const handleLocaleChange = (locale: string) => {
    setForm(f => ({ ...f, locale }));
    void i18n.changeLanguage(locale);
    mutation.mutate({ ...form, locale });
  };

  return (
    <Section title={t("settings.server.title")}>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("settings.server.port")}>
          <NumberInput
            value={form.port ?? 7575}
            onChange={v => setForm(f => ({ ...f, port: v }))}
            min={1}
            max={65535}
          />
        </Field>
        <Field label={t("settings.server.host")}>
          <TextInput
            value={form.host ?? "127.0.0.1"}
            onChange={v => setForm(f => ({ ...f, host: v }))}
            placeholder="127.0.0.1"
          />
        </Field>
      </div>
      <Toggle
        checked={form.autoStart ?? true}
        onChange={v => setForm(f => ({ ...f, autoStart: v }))}
        label={t("settings.server.autoStart")}
      />
      <Field label={t("settings.server.language")}>
        <Select
          value={form.locale || ""}
          options={[
            { value: "", label: t("common.na") },
            { value: "en", label: t("language.en") },
            { value: "zh", label: t("language.zh") },
          ]}
          onChange={handleLocaleChange}
          className="h-8 text-xs"
        />
      </Field>
      <SaveBar
        mutation={mutation}
        onSave={() => mutation.mutate(form as unknown as Record<string, unknown>)}
        restartRequired
      />
    </Section>
  );
}

// ─── forward rule editor ────────────────────────────────────────────────────

/** Normalized path key for bucketing forward rules in the settings UI (file order unchanged). */
function normalizeForwardPathForBucket(path: string): string {
  let p = path.trim();
  if (!p) return "";
  if (!p.startsWith("/")) p = `/${p}`;
  if (p.length > 1 && p.endsWith("/")) {
    p = p.slice(0, -1);
  }
  return p;
}

type ForwardGroupId =
  | "anthropic_messages"
  | "openai_chat"
  | "openai_responses"
  | "openai_models"
  | "anthropic_models"
  | "custom";

const FORWARD_GROUP_ORDER: ForwardGroupId[] = [
  "anthropic_messages",
  "openai_chat",
  "openai_responses",
  "openai_models",
  "anthropic_models",
  "custom",
];

const FORWARD_GROUP_LABEL: Record<ForwardGroupId, { title: string; hint: string }> = {
  anthropic_messages: {
    title: "Anthropic · Messages API",
    hint: "/v1/messages, /v1/messages/count_tokens, /anthropic/v1/messages …",
  },
  openai_chat: {
    title: "OpenAI · Chat Completions",
    hint: "/v1/chat/completions, /openai/chat/completions",
  },
  openai_responses: {
    title: "OpenAI · Responses API",
    hint: "/v1/responses, /openai/responses",
  },
  openai_models: {
    title: "OpenAI · Models list",
    hint: "/v1/models, /openai/models",
  },
  anthropic_models: {
    title: "Anthropic · Models list",
    hint: "/anthropic/v1/models",
  },
  custom: {
    title: "Custom paths",
    hint: "Any other patterns; rows from Add appear here until they match a group above.",
  },
};

function forwardRuleGroupId(path: string): ForwardGroupId {
  const p = normalizeForwardPathForBucket(path);
  if (!p) {
    return "custom";
  }
  if (
    p === "/v1/messages" ||
    p === "/anthropic/v1/messages" ||
    p === "/v1/messages/count_tokens" ||
    p === "/anthropic/v1/messages/count_tokens"
  ) {
    return "anthropic_messages";
  }
  if (p === "/v1/chat/completions" || p === "/openai/chat/completions") {
    return "openai_chat";
  }
  if (p === "/v1/responses" || p === "/openai/responses") {
    return "openai_responses";
  }
  if (p === "/v1/models" || p === "/openai/models") {
    return "openai_models";
  }
  if (p === "/anthropic/v1/models") {
    return "anthropic_models";
  }
  return "custom";
}

function buildForwardDisplayGroups(items: Array<{ path: string; provider: string }>): Array<{
  id: ForwardGroupId;
  title: string;
  hint: string;
  rows: Array<{ flatIndex: number; rule: { path: string; provider: string } }>;
}> {
  const buckets: Record<
    ForwardGroupId,
    Array<{ flatIndex: number; rule: { path: string; provider: string } }>
  > = {
    anthropic_messages: [],
    openai_chat: [],
    openai_responses: [],
    openai_models: [],
    anthropic_models: [],
    custom: [],
  };
  items.forEach((rule, flatIndex) => {
    buckets[forwardRuleGroupId(rule.path)].push({ flatIndex, rule });
  });
  const groups = FORWARD_GROUP_ORDER.map(id => ({
    id,
    ...FORWARD_GROUP_LABEL[id],
    rows: buckets[id],
  })).filter(g => g.rows.length > 0);
  groups.sort((a, b) => {
    const aMin = Math.min(...a.rows.map(r => r.flatIndex));
    const bMin = Math.min(...b.rows.map(r => r.flatIndex));
    if (aMin !== bMin) return aMin - bMin;
    return FORWARD_GROUP_ORDER.indexOf(a.id) - FORWARD_GROUP_ORDER.indexOf(b.id);
  });
  return groups;
}

function ForwardRuleEditor({
  items,
  onChange,
  providerOptions,
}: {
  items: Array<{ path: string; provider: string }>;
  onChange: (v: Array<{ path: string; provider: string }>) => void;
  providerOptions: Array<{ value: string; label: string }>;
}) {
  const groups = useMemo(() => buildForwardDisplayGroups(items), [items]);

  return (
    <div className="space-y-3">
      {items.length > 0 ? (
        <div className="grid grid-cols-[1fr_1fr_28px] gap-1.5 text-[10px] text-muted-foreground px-0.5">
          <span>Path</span>
          <span>Provider</span>
          <span />
        </div>
      ) : null}

      {groups.map(group => (
        <div
          key={group.id}
          className="rounded-md border border-border/60 bg-muted/15 p-2 space-y-1.5"
        >
          <div className="px-0.5 space-y-0.5 border-b border-border/45 pb-1.5">
            <p className="text-[11px] font-semibold text-foreground/90 leading-tight">
              {group.title}
            </p>
            <p className="text-[10px] text-muted-foreground leading-snug">{group.hint}</p>
          </div>
          <div className="space-y-1.5 pt-0.5">
            {group.rows.map(({ flatIndex, rule }) => (
              <div key={`fwd-${flatIndex}`} className="grid grid-cols-[1fr_1fr_28px] gap-1.5">
                <input
                  type="text"
                  className="h-7 px-2 text-xs border rounded-md bg-background font-mono min-w-0"
                  value={rule.path}
                  placeholder="/my/custom/route"
                  onChange={e => {
                    const n = [...items];
                    n[flatIndex] = { ...n[flatIndex], path: e.target.value };
                    onChange(n);
                  }}
                />
                <Select
                  value={rule.provider}
                  options={providerOptions}
                  onChange={v => {
                    const n = [...items];
                    n[flatIndex] = { ...n[flatIndex], provider: v };
                    onChange(n);
                  }}
                  className="h-7 text-xs"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => onChange(items.filter((_, j) => j !== flatIndex))}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 text-xs gap-1"
        onClick={() => onChange([...items, { path: "", provider: "auto" }])}
      >
        <Plus className="h-3 w-3" /> Add rule
      </Button>
      <p className="text-[10px] text-muted-foreground">
        <span className="font-semibold text-foreground/80">Evaluation order</span> follows YAML top
        to bottom. Section cards are sorted by each group’s earliest rule — groups are labels only,
        never a parallel pipeline. First match wins. <span className="font-mono">auto</span> =
        active provider — see{" "}
        <span className="font-semibold text-foreground/80">Routing and 404</span>; unknown paths
        return <span className="font-mono">404</span>.
      </p>
    </div>
  );
}

function dedupePreserveProviderIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const t = id.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function mergeBlockProviderCondition(
  providers: string[],
  providerNot: string[]
): RoutingBlockRule["condition"] | undefined {
  if (providers.length === 0 && providerNot.length === 0) return undefined;
  const c: NonNullable<RoutingBlockRule["condition"]> = {};
  if (providers.length > 0) c.providers = providers;
  if (providerNot.length > 0) c.providerNot = providerNot;
  return c;
}

function summarizeBlockConditionForRow(
  cond: RoutingBlockRule["condition"] | undefined,
  providerIdOptions: Array<{ value: string; label: string }>
): { summary: string; title: string } {
  const allow = dedupePreserveProviderIds(cond?.providers ?? []);
  const skip = dedupePreserveProviderIds(cond?.providerNot ?? []);
  const labelOf = (id: string) => providerIdOptions.find(o => o.value === id)?.label ?? id;
  if (allow.length === 0 && skip.length === 0) {
    return {
      summary: "Any provider",
      title: "No provider condition — click to add Only when / Unless lists",
    };
  }
  const parts: string[] = [];
  if (allow.length > 0) {
    parts.push(`Only: ${allow.map(labelOf).join(", ")}`);
  }
  if (skip.length > 0) {
    parts.push(`Unless: ${skip.map(labelOf).join(", ")}`);
  }
  const summary = parts.join(" · ");
  return { summary, title: summary };
}

function BlockConditionProviderLists({
  allowIds,
  skipIds,
  onChangeAllow,
  onChangeSkip,
  providerIdOptions,
}: {
  allowIds: string[];
  skipIds: string[];
  onChangeAllow: (next: string[]) => void;
  onChangeSkip: (next: string[]) => void;
  providerIdOptions: Array<{ value: string; label: string }>;
}) {
  const allowAvail = providerIdOptions.filter(o => !allowIds.includes(o.value));
  const skipAvail = providerIdOptions.filter(o => !skipIds.includes(o.value));
  const unlessBlocksAllow = skipIds.length > 0;
  const allowBlocksUnless = allowIds.length > 0;

  return (
    <div className="flex flex-col gap-4 pl-0.5">
      <fieldset
        disabled={unlessBlocksAllow}
        className={cn(
          "min-w-0 space-y-1 rounded-md border border-border/50 p-2",
          unlessBlocksAllow && "opacity-[0.45] saturate-75"
        )}
      >
        <legend className="sr-only">Only-when providers</legend>
        <p className="text-[10px] text-muted-foreground leading-tight">
          Only when current provider is
          <span className="font-mono text-[9px] text-foreground/70">
            {" "}
            (YAML condition.providers)
          </span>
        </p>
        {unlessBlocksAllow ? (
          <p className="text-[9px] text-muted-foreground leading-snug italic">
            Clear all entries under “Unless…” below to edit this section.
          </p>
        ) : null}
        <div className="flex flex-wrap items-start gap-1 pt-0.5">
          {allowIds.map(id => {
            const label = providerIdOptions.find(o => o.value === id)?.label ?? id;
            return (
              <Badge
                key={id}
                variant="secondary"
                className="h-6 gap-0.5 pr-1 pl-2 font-mono font-normal text-[10px]"
              >
                {label}
                <button
                  type="button"
                  className="rounded-sm p-0.5 hover:bg-muted-foreground/15"
                  onClick={() => onChangeAllow(allowIds.filter(x => x !== id))}
                  aria-label={`Remove ${id}`}
                >
                  <X className="h-3 w-3 shrink-0" />
                </button>
              </Badge>
            );
          })}
          <div className="w-full min-w-[120px] max-w-[260px]">
            <Select
              options={allowAvail}
              placeholder={
                providerIdOptions.length === 0
                  ? "No providers loaded"
                  : allowAvail.length === 0 && allowIds.length > 0
                    ? "All providers selected"
                    : "Add provider ID…"
              }
              onChange={v => {
                if (!v || allowIds.includes(v)) return;
                onChangeAllow([...allowIds, v]);
              }}
              disabled={
                unlessBlocksAllow || providerIdOptions.length === 0 || allowAvail.length === 0
              }
              className="h-7 text-[10px] px-2"
            />
          </div>
        </div>
      </fieldset>

      <fieldset
        disabled={allowBlocksUnless}
        className={cn(
          "min-w-0 space-y-1 rounded-md border border-border/50 p-2",
          allowBlocksUnless && "opacity-[0.45] saturate-75"
        )}
      >
        <legend className="sr-only">Unless providers</legend>
        <p className="text-[10px] text-muted-foreground leading-tight">
          Unless current provider is
          <span className="font-mono text-[9px] text-foreground/70">
            {" "}
            (YAML condition.providerNot)
          </span>
        </p>
        {allowBlocksUnless ? (
          <p className="text-[9px] text-muted-foreground leading-snug italic">
            Clear all entries under “Only when…” above to edit this section.
          </p>
        ) : null}
        <div className="flex flex-wrap items-start gap-1 pt-0.5">
          {skipIds.map(id => {
            const label = providerIdOptions.find(o => o.value === id)?.label ?? id;
            return (
              <Badge
                key={id}
                variant="outline"
                className="h-6 gap-0.5 pr-1 pl-2 font-mono font-normal text-[10px]"
              >
                {label}
                <button
                  type="button"
                  className="rounded-sm p-0.5 hover:bg-muted"
                  onClick={() => onChangeSkip(skipIds.filter(x => x !== id))}
                  aria-label={`Remove ${id}`}
                >
                  <X className="h-3 w-3 shrink-0" />
                </button>
              </Badge>
            );
          })}
          <div className="w-full min-w-[120px] max-w-[260px]">
            <Select
              options={skipAvail}
              placeholder={
                providerIdOptions.length === 0
                  ? "No providers loaded"
                  : skipAvail.length === 0 && skipIds.length > 0
                    ? "All providers selected"
                    : "Add provider ID…"
              }
              onChange={v => {
                if (!v || skipIds.includes(v)) return;
                onChangeSkip([...skipIds, v]);
              }}
              disabled={
                allowBlocksUnless || providerIdOptions.length === 0 || skipAvail.length === 0
              }
              className="h-7 text-[10px] px-2"
            />
          </div>
        </div>
      </fieldset>
    </div>
  );
}

function BlockRuleEditor({
  items,
  onChange,
  providerIdOptions,
}: {
  items: RoutingBlockRule[];
  onChange: (v: RoutingBlockRule[]) => void;
  providerIdOptions: Array<{ value: string; label: string }>;
}) {
  const [conditionModalIndex, setConditionModalIndex] = useState<number | null>(null);
  const [draftAllow, setDraftAllow] = useState<string[]>([]);
  const [draftSkip, setDraftSkip] = useState<string[]>([]);

  const openConditionModal = (rowIndex: number) => {
    const row = items[rowIndex];
    let nextAllow = dedupePreserveProviderIds(row?.condition?.providers ?? []);
    const nextSkip = dedupePreserveProviderIds(row?.condition?.providerNot ?? []);
    // Editor is mutually exclusive; YAML may set both — keep Unless (matches default routing style).
    if (nextAllow.length > 0 && nextSkip.length > 0) {
      nextAllow = [];
    }
    setDraftAllow(nextAllow);
    setDraftSkip(nextSkip);
    setConditionModalIndex(rowIndex);
  };

  const patchDraftAllow = (next: string[]) => {
    setDraftAllow(next);
    if (next.length > 0) {
      setDraftSkip([]);
    }
  };

  const patchDraftSkip = (next: string[]) => {
    setDraftSkip(next);
    if (next.length > 0) {
      setDraftAllow([]);
    }
  };

  const applyConditionModal = () => {
    if (conditionModalIndex === null) return;
    const n = [...items];
    const a = dedupePreserveProviderIds(draftAllow);
    const s = dedupePreserveProviderIds(draftSkip);
    const condition =
      a.length > 0 ? mergeBlockProviderCondition(a, []) : mergeBlockProviderCondition([], s);
    n[conditionModalIndex] = {
      ...n[conditionModalIndex],
      condition,
    };
    onChange(n);
    setConditionModalIndex(null);
  };

  return (
    <div className="space-y-1.5">
      {items.length > 0 && (
        <div className="grid grid-cols-[1fr_1fr_72px_minmax(9rem,11rem)_28px] gap-1.5 text-[10px] text-muted-foreground px-0.5 items-end">
          <span>Path</span>
          <span>Response</span>
          <span>Code</span>
          <span>Condition</span>
          <span />
        </div>
      )}
      {items.map((item, i) => {
        const { summary, title } = summarizeBlockConditionForRow(item.condition, providerIdOptions);
        return (
          <div
            key={i}
            className="grid grid-cols-[1fr_1fr_72px_minmax(9rem,11rem)_28px] gap-1.5 items-center"
          >
            <input
              type="text"
              className="h-7 px-2 text-xs border rounded-md bg-background font-mono min-w-0"
              value={item.path}
              placeholder="/api/event_logging/*"
              onChange={e => {
                const n = [...items];
                n[i] = { ...n[i], path: e.target.value };
                onChange(n);
              }}
            />
            <input
              type="text"
              className="h-7 px-2 text-xs border rounded-md bg-background font-mono min-w-0"
              value={item.response}
              placeholder='{"ok":true}'
              onChange={e => {
                const n = [...items];
                n[i] = { ...n[i], response: e.target.value };
                onChange(n);
              }}
            />
            <input
              type="number"
              className="h-7 px-2 text-xs border rounded-md bg-background font-mono w-full min-w-[4rem]"
              value={item.code}
              onChange={e => {
                const n = [...items];
                n[i] = { ...n[i], code: Number(e.target.value) || 200 };
                onChange(n);
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 min-w-0 px-2 gap-1 justify-start text-[10px] font-normal font-mono"
              title={title}
              onClick={() => openConditionModal(i)}
            >
              <ListFilter className="h-3 w-3 shrink-0 opacity-80" aria-hidden />
              <span className="truncate text-left">{summary}</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        );
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 text-xs gap-1"
        onClick={() =>
          onChange([...items, { path: "", response: "", code: 200, condition: undefined }])
        }
      >
        <Plus className="h-3 w-3" /> Add
      </Button>
      <p className="text-[10px] text-muted-foreground">
        Runs before <span className="font-mono">forward</span>. One row per rule.{" "}
        <span className="font-medium text-foreground/80">Condition</span> chooses either{" "}
        <span className="font-mono">providers</span> only-when lists or{" "}
        <span className="font-mono">providerNot</span> unless-lists against the dashboard’s active
        provider (not both in the UI).
      </p>

      <Dialog
        open={conditionModalIndex !== null}
        onOpenChange={open => {
          if (!open) setConditionModalIndex(null);
        }}
      >
        <DialogContent className="sm:max-w-lg" onClick={e => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Block condition (provider)</DialogTitle>
            <DialogDescription>
              Pick <strong className="text-foreground/90">one mode</strong> at a time: either “Only
              when” (<span className="font-mono">condition.providers</span>){" "}
              <em className="not-italic text-muted-foreground">or</em> “Unless” (
              <span className="font-mono">condition.providerNot</span>). Adding to one clears the
              other. Empty both = no provider filter. If YAML had both, this dialog keeps Unless and
              drops Only-when lists.
            </DialogDescription>
          </DialogHeader>
          <BlockConditionProviderLists
            allowIds={draftAllow}
            skipIds={draftSkip}
            onChangeAllow={patchDraftAllow}
            onChangeSkip={patchDraftSkip}
            providerIdOptions={providerIdOptions}
          />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConditionModalIndex(null)}
            >
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={applyConditionModal}>
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Routing section ────────────────────────────────────────────────────────

function RoutingSection({
  routing,
  routingDefaults,
  providerOptions,
}: {
  routing: RoutingSettings;
  routingDefaults: RoutingSettings | undefined;
  providerOptions: Array<{ value: string; label: string }>;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() => cloneRouting(routing));
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);

  const providerIdOptions = useMemo(
    () => providerOptions.filter(o => o.value !== "auto"),
    [providerOptions]
  );

  const savedRouting = useMemo(() => cloneRouting(routing), [routing]);
  const hasUnsavedChanges = useMemo(
    () => serializeRoutingForCompare(form) !== serializeRoutingForCompare(savedRouting),
    [form, savedRouting]
  );

  const mutation = useMutation({
    mutationFn: (d: RoutingSettings) =>
      api.patchConfig({ section: "routing", data: d as unknown as Record<string, unknown> }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["config"] }),
  });

  const defaultsAvailable = routingDefaults !== undefined;

  return (
    <Section title="Routing">
      <Field label="Forward rules">
        <ForwardRuleEditor
          items={form.forward ?? []}
          onChange={v => setForm(f => ({ ...f, forward: v }))}
          providerOptions={providerOptions}
        />
      </Field>
      <Field label="Block rules">
        <BlockRuleEditor
          items={form.block ?? []}
          onChange={v => setForm(f => ({ ...f, block: v }))}
          providerIdOptions={providerIdOptions}
        />
      </Field>
      <div className="rounded-md border border-border/70 bg-muted/25 p-2.5 text-[11px] text-muted-foreground space-y-1.5 leading-snug">
        <p className="text-foreground/90 font-medium text-xs">Routing and 404</p>
        <p>
          Rules are evaluated in order: matching <span className="font-mono">block</span> rules run
          first (first match wins), then matching <span className="font-mono">forward</span> rules
          (first match wins). Paths that never match any <span className="font-mono">forward</span>{" "}
          rule return HTTP <strong className="text-foreground">404</strong>; there is no implicit
          catch‑all fallback for unlisted paths.
        </p>
      </div>
      <RoutingSaveBar
        mutation={mutation}
        onSave={() => mutation.mutate(form)}
        hasUnsavedChanges={hasUnsavedChanges}
        rightSlot={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs whitespace-nowrap"
            disabled={!defaultsAvailable || mutation.isPending}
            title={
              defaultsAvailable
                ? "Load bundled defaults into the editor (use Save to write config.yaml)"
                : "Default routing template unavailable from server"
            }
            onClick={() => setRestoreConfirmOpen(true)}
          >
            Restore default routing
          </Button>
        }
      />
      <AlertDialog open={restoreConfirmOpen} onOpenChange={setRestoreConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore default routing?</AlertDialogTitle>
            <AlertDialogDescription>
              This replaces the forward and block lists in the editor with CCRelay’s bundled
              defaults. Nothing is written to disk until you click{" "}
              <span className="font-semibold text-foreground">Save routing</span>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={cn(
                "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
                "focus-visible:ring-ring"
              )}
              onClick={e => {
                e.preventDefault();
                if (routingDefaults) {
                  setForm(cloneRouting(routingDefaults));
                }
                setRestoreConfirmOpen(false);
              }}
            >
              Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  );
}

// ─── Concurrency section ────────────────────────────────────────────────────

function ConcurrencySection({ data }: { data: ConcurrencySettings }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(data);

  const mutation = useMutation({
    mutationFn: (d: ConcurrencySettings) =>
      api.patchConfig({ section: "concurrency", data: d as unknown as Record<string, unknown> }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["config"] }),
  });

  const retry = form.retry429 ?? { enabled: true, maxRetries: 3, delayMs: 1000 };

  return (
    <Section title="Concurrency">
      <Toggle
        checked={form.enabled}
        onChange={v => setForm(f => ({ ...f, enabled: v }))}
        label="Enable concurrency manager"
      />
      <div className="grid grid-cols-3 gap-3">
        <Field label="Max workers">
          <NumberInput
            value={form.maxWorkers ?? 3}
            onChange={v => setForm(f => ({ ...f, maxWorkers: v }))}
            min={1}
          />
        </Field>
        <Field label="Max queue size">
          <NumberInput
            value={form.maxQueueSize ?? 100}
            onChange={v => setForm(f => ({ ...f, maxQueueSize: v }))}
            min={1}
          />
        </Field>
        <Field label="Request timeout (s)">
          <NumberInput
            value={form.requestTimeout ?? 60}
            onChange={v => setForm(f => ({ ...f, requestTimeout: v }))}
            min={1}
          />
        </Field>
      </div>
      <div className="border-t border-border/50 pt-3 space-y-2">
        <p className="text-[10px] font-medium text-foreground/80">Retry on 429</p>
        <Toggle
          checked={retry.enabled}
          onChange={v => setForm(f => ({ ...f, retry429: { ...retry, enabled: v } }))}
          label="Enable 429 retry"
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Max retries">
            <NumberInput
              value={retry.maxRetries ?? 3}
              onChange={v => setForm(f => ({ ...f, retry429: { ...retry, maxRetries: v } }))}
              min={0}
            />
          </Field>
          <Field label="Delay (ms)">
            <NumberInput
              value={retry.delayMs ?? 1000}
              onChange={v => setForm(f => ({ ...f, retry429: { ...retry, delayMs: v } }))}
              min={0}
            />
          </Field>
        </div>
      </div>
      {form.routes && form.routes.length > 0 && (
        <div className="border-t border-border/50 pt-3">
          <p className="text-[10px] text-muted-foreground">
            {form.routes.length} per-route override(s) configured. Edit in YAML for now.
          </p>
        </div>
      )}
      <SaveBar mutation={mutation} onSave={() => mutation.mutate(form)} />
    </Section>
  );
}

// ─── Logging section ────────────────────────────────────────────────────────

function LoggingSection({ data }: { data: LoggingSettings }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(data);

  const mutation = useMutation({
    mutationFn: (d: LoggingSettings) =>
      api.patchConfig({ section: "logging", data: d as unknown as Record<string, unknown> }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["config"] }),
  });

  const db = form.database ?? { type: "sqlite" as const };

  return (
    <Section title="Logging">
      <Toggle
        checked={form.enabled}
        onChange={v => setForm(f => ({ ...f, enabled: v }))}
        label="Enable request log storage"
      />
      <Field label="Database type">
        <Select
          value={db.type}
          options={[
            { value: "sqlite", label: "SQLite" },
            { value: "postgres", label: "PostgreSQL" },
          ]}
          onChange={v =>
            setForm(f => ({ ...f, database: { ...db, type: v as "sqlite" | "postgres" } }))
          }
          className="h-8 text-xs"
        />
      </Field>
      {db.type === "sqlite" ? (
        <>
          <Field label="Database path">
            <TextInput
              value={db.path ?? ""}
              onChange={v =>
                setForm(f => ({
                  ...f,
                  database: { ...db, path: v || undefined },
                }))
              }
              placeholder="~/.ccrelay/logs.db (default)"
            />
          </Field>
          <Field label="sqlite3 executable (optional)">
            <TextInput
              value={db.sqlite3Executable ?? ""}
              onChange={v =>
                setForm(f => ({
                  ...f,
                  database: {
                    ...db,
                    sqlite3Executable: v.trim() ? v.trim() : undefined,
                  },
                }))
              }
              placeholder="Blank = resolve from PATH"
            />
          </Field>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Host">
            <TextInput
              value={db.host ?? ""}
              onChange={v => setForm(f => ({ ...f, database: { ...db, host: v } }))}
              placeholder="localhost"
            />
          </Field>
          <Field label="Port">
            <NumberInput
              value={db.port ?? 5432}
              onChange={v => setForm(f => ({ ...f, database: { ...db, port: v } }))}
            />
          </Field>
          <Field label="Database name">
            <TextInput
              value={db.name ?? ""}
              onChange={v => setForm(f => ({ ...f, database: { ...db, name: v } }))}
              placeholder="ccrelay"
            />
          </Field>
          <Field label="User">
            <TextInput
              value={db.user ?? ""}
              onChange={v => setForm(f => ({ ...f, database: { ...db, user: v } }))}
            />
          </Field>
          <Field label="Password">
            <TextInput
              value={db.password ?? ""}
              onChange={v => setForm(f => ({ ...f, database: { ...db, password: v } }))}
              placeholder="${POSTGRES_PASSWORD}"
            />
          </Field>
          <div className="flex items-end">
            <Toggle
              checked={db.ssl ?? false}
              onChange={v => setForm(f => ({ ...f, database: { ...db, ssl: v } }))}
              label="SSL"
            />
          </div>
        </div>
      )}
      <SaveBar mutation={mutation} onSave={() => mutation.mutate(form)} restartRequired />
    </Section>
  );
}

// ─── main component ─────────────────────────────────────────────────────────

export default function Settings() {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ["config"],
    queryFn: () => api.getConfig(),
  });

  const { data: providersData } = useQuery({
    queryKey: ["providers"],
    queryFn: () => api.getProviders(),
  });

  const providerOptions = [
    { value: "auto", label: "auto (current)" },
    ...(providersData?.providers ?? []).map(p => ({
      value: p.id,
      label: p.name || p.id,
    })),
  ];

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-base font-semibold tracking-tight">{t("settings.title")}</h2>
        <p className="text-xs text-muted-foreground">{t("settings.subtitle")}</p>
      </div>

      {isLoading ? (
        <Card className="p-0">
          <CardContent className="p-3">
            <div className="h-24 animate-pulse bg-muted rounded" />
          </CardContent>
        </Card>
      ) : data ? (
        <>
          <ServerSection key={JSON.stringify(data.server)} data={data.server} />
          <RoutingSection
            key={JSON.stringify(data.routing)}
            routing={{
              forward: data.routing?.forward ?? [],
              block: data.routing?.block ?? [],
            }}
            routingDefaults={data.routingDefaults}
            providerOptions={providerOptions}
          />
          <ConcurrencySection key={JSON.stringify(data.concurrency)} data={data.concurrency} />
          <LoggingSection key={JSON.stringify(data.logging)} data={data.logging} />
        </>
      ) : (
        <Card className="p-0">
          <CardContent className="p-6 text-center text-xs text-muted-foreground">
            {t("settings.loadError")}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
