import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Loader2, Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { api } from "@/api/client";
import type {
  LoggingSettings,
  ConcurrencySettings,
  ServerSettings,
  RoutingSettings,
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

// ─── collapsible section wrapper ────────────────────────────────────────────

function Section({
  title,
  icon,
  defaultOpen,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <Card className="p-0">
      <button
        type="button"
        className="flex w-full items-center gap-2 p-3 text-left hover:bg-muted/50 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        {icon}
        <CardTitle className="text-xs font-medium flex-1">{title}</CardTitle>
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {open && <CardContent className="p-3 pt-0 space-y-3">{children}</CardContent>}
    </Card>
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
    <Section
      title="Logging"
      icon={<span className="text-[10px]">📋</span>}
      defaultOpen={data.enabled}
    >
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
        <Field label="Database path">
          <TextInput
            value={db.path ?? ""}
            onChange={v => setForm(f => ({ ...f, database: { ...db, path: v || undefined } }))}
            placeholder="~/.ccrelay/logs.db (default)"
          />
        </Field>
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
    <Section title="Concurrency" icon={<span className="text-[10px]">⚡</span>}>
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

// ─── Server section ─────────────────────────────────────────────────────────

function ServerSection({ data }: { data: ServerSettings }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(data);

  const mutation = useMutation({
    mutationFn: (d: ServerSettings) =>
      api.patchConfig({ section: "server", data: d as unknown as Record<string, unknown> }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["config"] }),
  });

  return (
    <Section title="Server" icon={<span className="text-[10px]">🖥️</span>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Port">
          <NumberInput
            value={form.port ?? 7575}
            onChange={v => setForm(f => ({ ...f, port: v }))}
            min={1}
            max={65535}
          />
        </Field>
        <Field label="Host">
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
        label="Auto-start server on extension activation"
      />
      <SaveBar mutation={mutation} onSave={() => mutation.mutate(form)} restartRequired />
    </Section>
  );
}

// ─── forward rule editor ────────────────────────────────────────────────────

function ForwardRuleEditor({
  items,
  onChange,
}: {
  items: Array<{ path: string; provider: string }>;
  onChange: (v: Array<{ path: string; provider: string }>) => void;
}) {
  return (
    <div className="space-y-1.5">
      {items.length > 0 && (
        <div className="grid grid-cols-[1fr_1fr_28px] gap-1.5 text-[10px] text-muted-foreground px-0.5">
          <span>Path</span>
          <span>Provider</span>
          <span />
        </div>
      )}
      {items.map((item, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_28px] gap-1.5">
          <input
            type="text"
            className="h-7 px-2 text-xs border rounded-md bg-background font-mono"
            value={item.path}
            placeholder="/v1/messages"
            onChange={e => {
              const n = [...items];
              n[i] = { ...n[i], path: e.target.value };
              onChange(n);
            }}
          />
          <input
            type="text"
            className="h-7 px-2 text-xs border rounded-md bg-background font-mono"
            value={item.provider}
            placeholder="auto"
            onChange={e => {
              const n = [...items];
              n[i] = { ...n[i], provider: e.target.value };
              onChange(n);
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 text-xs gap-1"
        onClick={() => onChange([...items, { path: "", provider: "auto" }])}
      >
        <Plus className="h-3 w-3" /> Add
      </Button>
      <p className="text-[10px] text-muted-foreground">
        First match wins. <span className="font-mono">auto</span> = current active provider; or enter a
        specific provider ID (e.g. <span className="font-mono">official</span>). Unmatched paths return
        404.
      </p>
    </div>
  );
}

function BlockRuleEditor({
  items,
  onChange,
}: {
  items: Array<{ path: string; condition?: { kind?: string[] }; response: string; code: number }>;
  onChange: (
    v: Array<{ path: string; condition?: { kind?: string[] }; response: string; code: number }>
  ) => void;
}) {
  return (
    <div className="space-y-1.5">
      {items.length > 0 && (
        <div className="grid grid-cols-[1fr_120px_1fr_50px_28px] gap-1.5 text-[10px] text-muted-foreground px-0.5">
          <span>Path</span>
          <span>Kind filter</span>
          <span>Response</span>
          <span>Code</span>
          <span />
        </div>
      )}
      {items.map((item, i) => (
        <div key={i} className="grid grid-cols-[1fr_120px_1fr_50px_28px] gap-1.5">
          <input
            type="text"
            className="h-7 px-2 text-xs border rounded-md bg-background font-mono"
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
            className="h-7 px-2 text-[10px] border rounded-md bg-background font-mono"
            value={item.condition?.kind?.join(", ") ?? ""}
            placeholder="all"
            title="Comma-separated: anthropic, openai, openai_chat, openai_responses"
            onChange={e => {
              const raw = e.target.value.trim();
              const kind = raw
                ? raw.split(",").map(s => s.trim()).filter(Boolean)
                : undefined;
              const n = [...items];
              n[i] = { ...n[i], condition: kind ? { kind } : undefined };
              onChange(n);
            }}
          />
          <input
            type="text"
            className="h-7 px-2 text-xs border rounded-md bg-background font-mono"
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
            className="h-7 px-2 text-xs border rounded-md bg-background font-mono"
            value={item.code}
            onChange={e => {
              const n = [...items];
              n[i] = { ...n[i], code: Number(e.target.value) || 200 };
              onChange(n);
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ))}
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
        Block is checked before forward. Leave kind empty to block all protocols. Kind values:{" "}
        <span className="font-mono">anthropic</span>, <span className="font-mono">openai</span>,{" "}
        <span className="font-mono">openai_chat</span>, <span className="font-mono">openai_responses</span>.
      </p>
    </div>
  );
}

// ─── Routing section ────────────────────────────────────────────────────────

function RoutingSection({ data }: { data: RoutingSettings }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(data);

  const mutation = useMutation({
    mutationFn: (d: RoutingSettings) =>
      api.patchConfig({ section: "routing", data: d as unknown as Record<string, unknown> }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["config"] }),
  });

  return (
    <Section title="Routing" icon={<span className="text-[10px]">🔀</span>}>
      <Field label="Forward rules">
        <ForwardRuleEditor
          items={form.forward ?? []}
          onChange={v => setForm(f => ({ ...f, forward: v }))}
        />
      </Field>
      <Field label="Block rules">
        <BlockRuleEditor
          items={form.block ?? []}
          onChange={v => setForm(f => ({ ...f, block: v }))}
        />
      </Field>
      <SaveBar mutation={mutation} onSave={() => mutation.mutate(form)} />
    </Section>
  );
}

// ─── main component ─────────────────────────────────────────────────────────

export default function Settings() {
  const { data, isLoading } = useQuery({
    queryKey: ["config"],
    queryFn: () => api.getConfig(),
  });

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Settings</h2>
        <p className="text-xs text-muted-foreground">
          Manage logging, concurrency, server, and routing configuration.
        </p>
      </div>

      {isLoading ? (
        <Card className="p-0">
          <CardContent className="p-3">
            <div className="h-24 animate-pulse bg-muted rounded" />
          </CardContent>
        </Card>
      ) : data ? (
        <>
          <LoggingSection key={JSON.stringify(data.logging)} data={data.logging} />
          <ConcurrencySection key={JSON.stringify(data.concurrency)} data={data.concurrency} />
          <ServerSection key={JSON.stringify(data.server)} data={data.server} />
          <RoutingSection key={JSON.stringify(data.routing)} data={data.routing} />
        </>
      ) : (
        <Card className="p-0">
          <CardContent className="p-6 text-center text-xs text-muted-foreground">
            Failed to load settings.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
