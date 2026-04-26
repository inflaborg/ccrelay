import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileCode2, Loader2, SlidersHorizontal, Terminal, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { api } from "@/api/client";
import { CLAUDE_CODE_DEFAULT_MODELS } from "@/constants/claudeCodeDefaults";
import type { ClientConfigItem, ClientConfigItemStatus } from "@/types/api";

function statusBadge(status: ClientConfigItemStatus) {
  switch (status) {
    case "ok":
      return (
        <Badge variant="success" className="text-[10px] px-1.5 py-0">
          OK
        </Badge>
      );
    case "missing":
      return (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
          Not set
        </Badge>
      );
    case "wrong_target":
      return (
        <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
          Other host
        </Badge>
      );
    case "invalid":
      return (
        <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
          Invalid file
        </Badge>
      );
    default:
      return null;
  }
}

function needsOverwriteBeforeApply(item: ClientConfigItem): boolean {
  return item.status === "wrong_target" || item.status === "invalid";
}

export default function ClientConfigStatus() {
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingTarget, setPendingTarget] = useState<"claudeCode" | "codex" | null>(null);
  const [applyingTo, setApplyingTo] = useState<"claudeCode" | "codex" | null>(null);
  const [modelModalOpen, setModelModalOpen] = useState(false);
  const [opus, setOpus] = useState("");
  const [sonnet, setSonnet] = useState("");
  const [haiku, setHaiku] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["clientConfig"],
    queryFn: () => api.getClientConfig(),
    refetchInterval: 60_000,
  });

  const applyMutation = useMutation({
    mutationFn: (args: { target: "claudeCode" | "codex"; overwrite: boolean }) =>
      api.applyClientConfig(args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clientConfig"] });
      setConfirmOpen(false);
      setPendingTarget(null);
    },
    onSettled: () => {
      setApplyingTo(null);
    },
  });

  const modelsMutation = useMutation({
    mutationFn: (m: { opus: string; sonnet: string; haiku: string }) =>
      api.applyClientConfig({
        target: "claudeCode",
        patchClaudeModelsOnly: true,
        claudeDefaultModels: m,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clientConfig"] });
      setModelModalOpen(false);
    },
  });

  const runApply = (target: "claudeCode" | "codex", overwrite: boolean) => {
    setApplyingTo(target);
    applyMutation.mutate({ target, overwrite });
  };

  const onConfigureClick = (target: "claudeCode" | "codex") => {
    const item = target === "claudeCode" ? data?.claudeCode : data?.codex;
    if (!item) {
      return;
    }
    if (item.status === "ok") {
      return;
    }
    if (needsOverwriteBeforeApply(item)) {
      setPendingTarget(target);
      setConfirmOpen(true);
      return;
    }
    runApply(target, false);
  };

  const onConfirmOverwrite = () => {
    if (pendingTarget) {
      runApply(pendingTarget, true);
    }
  };

  const pendingItem =
    pendingTarget === "claudeCode" ? data?.claudeCode : pendingTarget === "codex" ? data?.codex : null;

  return (
    <>
      <Card className="p-0">
        <CardHeader className="p-3 pb-2">
          <CardTitle className="text-xs font-medium flex items-center gap-2">
            <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
            Client configuration
          </CardTitle>
          <p className="text-[10px] text-muted-foreground font-normal pt-0.5">
            Check Claude Code (<span className="font-mono">~/.claude/settings.json</span>) and Codex (
            <span className="font-mono">~/.codex/config.toml</span>) for CCRelay on port{" "}
            {data?.port ?? "—"}.
          </p>
        </CardHeader>
        <CardContent className="p-3 pt-0 space-y-2">
          {isLoading ? (
            <div className="h-16 animate-pulse bg-muted rounded" />
          ) : (
            <>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-md border border-border/60 p-2.5">
                <div className="flex items-start gap-2 min-w-0">
                  <FileCode2 className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium">Claude Code</span>
                      {data?.claudeCode && statusBadge(data.claudeCode.status)}
                    </div>
                    <p className="text-[10px] text-muted-foreground font-mono truncate mt-0.5">
                      {data?.claudeCode.filePath}
                    </p>
                    {data?.claudeCode.currentValue && (
                      <p className="text-[10px] text-muted-foreground truncate">
                        ANTHROPIC_BASE_URL: {data.claudeCode.currentValue}
                      </p>
                    )}
                    {data?.claudeCode.message && data.claudeCode.status !== "ok" && (
                      <p className="text-[10px] text-amber-600 dark:text-amber-500 mt-0.5">
                        {data.claudeCode.message}
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Expected:{" "}
                      <span className="font-mono">{data?.expectedAnthropicBase ?? "—"}</span>
                    </p>
                    <div className="mt-2 pt-2 border-t border-border/50 space-y-1.5">
                      <p className="text-[10px] text-muted-foreground">
                        <span className="font-medium text-foreground/90">Optional default model names</span>{" "}
                        (CCRelay <span className="font-mono">modelMap</span> is usually enough. Set these only if
                        you want Claude Code to request specific ids.)
                      </p>
                      {data?.claudeDefaultModels &&
                      (data.claudeDefaultModels.opus ||
                        data.claudeDefaultModels.sonnet ||
                        data.claudeDefaultModels.haiku) ? (
                        <p className="text-[10px] font-mono break-all text-foreground/80">
                          Opus: {data.claudeDefaultModels.opus || "—"} · Sonnet:{" "}
                          {data.claudeDefaultModels.sonnet || "—"} · Haiku:{" "}
                          {data.claudeDefaultModels.haiku || "—"}
                        </p>
                      ) : (
                        <p className="text-[10px] text-muted-foreground">
                          <span className="italic">Not set in settings.json.</span> Suggested:{" "}
                          <span className="font-mono text-foreground/80">
                            {CLAUDE_CODE_DEFAULT_MODELS.opus} · {CLAUDE_CODE_DEFAULT_MODELS.sonnet} ·{" "}
                            {CLAUDE_CODE_DEFAULT_MODELS.haiku}
                          </span>
                        </p>
                      )}
                      <div>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="h-7 text-xs gap-1"
                          disabled={applyMutation.isPending || modelsMutation.isPending}
                          onClick={() => {
                            const m = data?.claudeDefaultModels;
                            setOpus(m?.opus ?? CLAUDE_CODE_DEFAULT_MODELS.opus);
                            setSonnet(m?.sonnet ?? CLAUDE_CODE_DEFAULT_MODELS.sonnet);
                            setHaiku(m?.haiku ?? CLAUDE_CODE_DEFAULT_MODELS.haiku);
                            setModelModalOpen(true);
                          }}
                        >
                          <SlidersHorizontal className="h-3 w-3" />
                          Configure default models
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 sm:pl-2">
                  <Button
                    size="sm"
                    variant={data?.claudeCode.status === "ok" ? "outline" : "default"}
                    className="h-7 text-xs"
                    disabled={
                      data?.claudeCode.status === "ok" ||
                      applyMutation.isPending ||
                      modelsMutation.isPending
                    }
                    onClick={() => onConfigureClick("claudeCode")}
                  >
                    {applyMutation.isPending && applyingTo === "claudeCode" ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : data?.claudeCode.status === "ok" ? (
                      "Up to date"
                    ) : (
                      "Apply CCRelay settings"
                    )}
                  </Button>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-md border border-border/60 p-2.5">
                <div className="flex items-start gap-2 min-w-0">
                  <FileCode2 className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium">Codex</span>
                      {data?.codex && statusBadge(data.codex.status)}
                    </div>
                    <p className="text-[10px] text-muted-foreground font-mono truncate mt-0.5">
                      {data?.codex.filePath}
                    </p>
                    {data?.codex.currentValue && (
                      <p className="text-[10px] text-muted-foreground truncate">
                        base_url ({data.codex.modelProvider ?? "?"}): {data.codex.currentValue}
                      </p>
                    )}
                    {data?.codex.message && data.codex.status !== "ok" && (
                      <p className="text-[10px] text-amber-600 dark:text-amber-500 mt-0.5">
                        {data.codex.message}
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Expected: <span className="font-mono">{data?.expectedCodexBaseUrl ?? "—"}</span>
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 sm:pl-2">
                  <Button
                    size="sm"
                    variant={data?.codex.status === "ok" ? "outline" : "default"}
                    className="h-7 text-xs"
                    disabled={
                      data?.codex.status === "ok" || applyMutation.isPending || modelsMutation.isPending
                    }
                    onClick={() => onConfigureClick("codex")}
                  >
                    {applyMutation.isPending && applyingTo === "codex" ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : data?.codex.status === "ok" ? (
                      "Up to date"
                    ) : (
                      "Apply CCRelay template"
                    )}
                  </Button>
                </div>
              </div>

              {applyMutation.isError && (
                <p className="text-[10px] text-destructive">{(applyMutation.error as Error).message}</p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={o => {
          setConfirmOpen(o);
          if (!o) {
            setPendingTarget(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingTarget === "codex" ? "Replace Codex config?" : "Overwrite Claude Code settings?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingTarget === "codex" ? (
                <>
                  Your <span className="font-mono">~/.codex/config.toml</span> points to another API (
                  {pendingItem?.currentValue ?? "unknown"}). Applying will{" "}
                  <strong>replace the file</strong> with the CCRelay template (model{" "}
                  <span className="font-mono">glm-5-turbo</span>, provider{" "}
                  <span className="font-mono">ccrelay</span>).
                </>
              ) : (
                <>
                  Your <span className="font-mono">settings.json</span> is missing CCRelay or points to{" "}
                  {pendingItem?.currentValue ?? "another URL"}. Applying will merge recommended{" "}
                  <span className="font-mono">env</span> keys (including{" "}
                  <span className="font-mono">ANTHROPIC_BASE_URL</span> →{" "}
                  {data?.expectedAnthropicBase ?? "this server"}).
                  {pendingItem?.status === "invalid" && (
                    <> Invalid JSON will be replaced by a new object with the merged env block.</>
                  )}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={e => {
                e.preventDefault();
                onConfirmOverwrite();
              }}
            >
              {applyMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Overwrite"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {modelModalOpen && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
          <Card className="w-full max-w-[420px] flex flex-col">
            <CardHeader className="border-b p-3 flex-shrink-0">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Claude Code default model names</CardTitle>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => setModelModalOpen(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground font-normal pt-1">
                Written to <span className="font-mono">env.ANTHROPIC_DEFAULT_*_MODEL</span> in settings.json.
                Leave blank and save to remove a key. Empty all three to rely only on CCRelay mapping.
              </p>
            </CardHeader>
            <CardContent className="p-4 space-y-2">
              <div className="space-y-1">
                <label className="text-xs font-medium">Opus</label>
                <input
                  type="text"
                  className="w-full h-8 px-2 text-xs border rounded-md bg-background font-mono"
                  value={opus}
                  onChange={e => setOpus(e.target.value)}
                  placeholder={CLAUDE_CODE_DEFAULT_MODELS.opus}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Sonnet</label>
                <input
                  type="text"
                  className="w-full h-8 px-2 text-xs border rounded-md bg-background font-mono"
                  value={sonnet}
                  onChange={e => setSonnet(e.target.value)}
                  placeholder={CLAUDE_CODE_DEFAULT_MODELS.sonnet}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Haiku</label>
                <input
                  type="text"
                  className="w-full h-8 px-2 text-xs border rounded-md bg-background font-mono"
                  value={haiku}
                  onChange={e => setHaiku(e.target.value)}
                  placeholder={CLAUDE_CODE_DEFAULT_MODELS.haiku}
                />
              </div>
              {modelsMutation.isError && (
                <p className="text-[10px] text-destructive">{(modelsMutation.error as Error).message}</p>
              )}
            </CardContent>
            <div className="border-t p-3 flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-7 text-xs"
                disabled={modelsMutation.isPending}
                onClick={() => {
                  setOpus(CLAUDE_CODE_DEFAULT_MODELS.opus);
                  setSonnet(CLAUDE_CODE_DEFAULT_MODELS.sonnet);
                  setHaiku(CLAUDE_CODE_DEFAULT_MODELS.haiku);
                }}
              >
                Use suggested defaults
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => {
                  setOpus("");
                  setSonnet("");
                  setHaiku("");
                }}
                disabled={modelsMutation.isPending}
              >
                Clear fields
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-7 text-xs"
                disabled={modelsMutation.isPending}
                onClick={() => modelsMutation.mutate({ opus: "", sonnet: "", haiku: "" })}
              >
                Remove all from file
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-7 text-xs"
                disabled={modelsMutation.isPending}
                onClick={() => modelsMutation.mutate({ opus, sonnet, haiku })}
              >
                {modelsMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
