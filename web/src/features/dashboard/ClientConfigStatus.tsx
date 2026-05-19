import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FileCode2,
  Loader2,
  Monitor,
  RotateCcw,
  SlidersHorizontal,
  Terminal,
  X,
} from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/api/client";
import { CLAUDE_CODE_DEFAULT_MODELS, CODEX_DEFAULT_MODEL } from "@/constants/claudeCodeDefaults";
import type { ClientConfigItem, ClientConfigItemStatus } from "@/types/api";

function statusBadge(status: ClientConfigItemStatus, t: (key: string) => string) {
  switch (status) {
    case "ok":
      return (
        <Badge variant="success" className="text-[10px] px-1.5 py-0">
          {t("clientConfig.status.ok")}
        </Badge>
      );
    case "missing":
      return (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
          {t("clientConfig.status.notSet")}
        </Badge>
      );
    case "wrong_target":
      return (
        <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
          {t("clientConfig.status.otherHost")}
        </Badge>
      );
    case "invalid":
      return (
        <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
          {t("clientConfig.status.invalidFile")}
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
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingTarget, setPendingTarget] = useState<
    "claudeCode" | "codex" | "claudeDesktop" | null
  >(null);
  const [applyingTo, setApplyingTo] = useState<"claudeCode" | "codex" | "claudeDesktop" | null>(
    null
  );
  const [modelModalOpen, setModelModalOpen] = useState(false);
  const [opus, setOpus] = useState("");
  const [sonnet, setSonnet] = useState("");
  const [haiku, setHaiku] = useState("");
  const [codexModelModalOpen, setCodexModelModalOpen] = useState(false);
  const [codexModalMode, setCodexModalMode] = useState<"apply" | "configure">("apply");
  const [codexModel, setCodexModel] = useState("");
  const [pendingCodexModel, setPendingCodexModel] = useState<string | undefined>(undefined);
  const [restoreTarget, setRestoreTarget] = useState<
    "claudeCode" | "codex" | "claudeDesktop" | null
  >(null);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["clientConfig"],
    queryFn: () => api.getClientConfig(),
    refetchInterval: 60_000,
  });

  const applyMutation = useMutation({
    mutationFn: (args: { target: "claudeCode" | "codex" | "claudeDesktop"; overwrite: boolean }) =>
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

  const codexModelPatchMutation = useMutation({
    mutationFn: (model: string) =>
      api.applyClientConfig({
        target: "codex",
        patchCodexModelOnly: true,
        model,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clientConfig"] });
      setCodexModelModalOpen(false);
    },
  });

  const restoreMutation = useMutation({
    mutationFn: (target: "claudeCode" | "codex" | "claudeDesktop") =>
      api.applyClientConfig({ target, restore: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clientConfig"] });
      setRestoreConfirmOpen(false);
      setRestoreTarget(null);
    },
    onSettled: () => {
      setApplyingTo(null);
    },
  });

  const runApply = (
    target: "claudeCode" | "codex" | "claudeDesktop",
    overwrite: boolean,
    model?: string
  ) => {
    setApplyingTo(target);
    applyMutation.mutate({ target, overwrite, ...(model ? { model } : {}) });
  };

  const onConfigureClick = (target: "claudeCode" | "codex" | "claudeDesktop") => {
    const item =
      target === "claudeCode"
        ? data?.claudeCode
        : target === "codex"
          ? data?.codex
          : data?.claudeDesktop;
    if (!item) {
      return;
    }
    if (item.status === "ok") {
      return;
    }
    if (target === "codex") {
      setCodexModalMode("apply");
      setCodexModel("");
      setCodexModelModalOpen(true);
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
      const model = pendingTarget === "codex" ? pendingCodexModel : undefined;
      runApply(pendingTarget, true, model);
    }
  };

  const pendingItem =
    pendingTarget === "claudeCode"
      ? data?.claudeCode
      : pendingTarget === "codex"
        ? data?.codex
        : pendingTarget === "claudeDesktop"
          ? data?.claudeDesktop
          : null;

  return (
    <>
      <Card className="p-0">
        <CardHeader className="p-3 pb-2">
          <CardTitle className="text-xs font-medium flex items-center gap-2">
            <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
            {t("clientConfig.title")}
          </CardTitle>
          <p className="text-[10px] text-muted-foreground font-normal pt-0.5">
            {t("clientConfig.description", {
              port: data?.port ?? "—",
              claudePath: "~/.claude/settings.json",
              codexPath: "~/.codex/config.toml",
            })}
          </p>
        </CardHeader>
        <CardContent className="p-3 pt-0 space-y-2">
          {isLoading ? (
            <div className="h-16 animate-pulse bg-muted rounded" />
          ) : (
            <>
              {data?.claudeDesktop && (
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-md border border-border/60 p-2.5">
                  <div className="flex items-start gap-2 min-w-0">
                    <Monitor className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium">
                          {t("clientConfig.claudeDesktop.name")}
                        </span>
                        {statusBadge(data.claudeDesktop.status, t)}
                      </div>
                      <p className="text-[10px] text-muted-foreground font-mono truncate mt-0.5">
                        {data.claudeDesktop.filePath}
                      </p>
                      {data.claudeDesktop.currentValue && (
                        <p className="text-[10px] text-muted-foreground truncate">
                          inferenceGatewayBaseUrl: {data.claudeDesktop.currentValue}
                        </p>
                      )}
                      {data.claudeDesktop.message && data.claudeDesktop.status !== "ok" && (
                        <p className="text-[10px] text-amber-600 dark:text-amber-500 mt-0.5">
                          {data.claudeDesktop.message}
                        </p>
                      )}
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {t("clientConfig.claudeDesktop.expected")}{" "}
                        <span className="font-mono">{data?.expectedAnthropicBase ?? "—"}</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 sm:pl-2 gap-1">
                    {data.claudeDesktop.status === "ok" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs gap-1 text-muted-foreground hover:text-destructive"
                        disabled={restoreMutation.isPending}
                        onClick={() => {
                          setRestoreTarget("claudeDesktop");
                          setRestoreConfirmOpen(true);
                        }}
                      >
                        {restoreMutation.isPending && applyingTo === "claudeDesktop" ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RotateCcw className="h-3 w-3" />
                        )}
                        <span className="hidden sm:inline">
                          {t("clientConfig.claudeDesktop.restore")}
                        </span>
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant={data.claudeDesktop.status === "ok" ? "outline" : "default"}
                      className="h-7 text-xs"
                      disabled={data.claudeDesktop.status === "ok" || applyMutation.isPending}
                      onClick={() => onConfigureClick("claudeDesktop")}
                    >
                      {applyMutation.isPending && applyingTo === "claudeDesktop" ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : data.claudeDesktop.status === "ok" ? (
                        t("clientConfig.claudeDesktop.upToDate")
                      ) : (
                        t("clientConfig.claudeDesktop.apply")
                      )}
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-md border border-border/60 p-2.5">
                <div className="flex items-start gap-2 min-w-0">
                  <FileCode2 className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium">
                        {t("clientConfig.claudeCode.name")}
                      </span>
                      {data?.claudeCode && statusBadge(data.claudeCode.status, t)}
                    </div>
                    <p className="text-[10px] text-muted-foreground font-mono truncate mt-0.5">
                      {data?.claudeCode.filePath}
                    </p>
                    {data?.claudeCode.currentValue && (
                      <p className="text-[10px] text-muted-foreground truncate">
                        {t("clientConfig.claudeCode.envVarLabel")}: {data.claudeCode.currentValue}
                      </p>
                    )}
                    {data?.claudeCode.message && data.claudeCode.status !== "ok" && (
                      <p className="text-[10px] text-amber-600 dark:text-amber-500 mt-0.5">
                        {data.claudeCode.message}
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {t("clientConfig.claudeCode.expected")}{" "}
                      <span className="font-mono">{data?.expectedAnthropicBase ?? "—"}</span>
                    </p>
                    <div className="mt-2 pt-2 border-t border-border/50 space-y-1.5">
                      <p className="text-[10px] text-muted-foreground">
                        <span className="font-medium text-foreground/90">
                          {t("clientConfig.claudeCode.optionalModels.title")}
                        </span>{" "}
                        {t("clientConfig.claudeCode.optionalModels.description")}
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
                          <span className="italic">
                            {t("clientConfig.claudeCode.optionalModels.notSet")}
                          </span>{" "}
                          {t("clientConfig.claudeCode.optionalModels.suggested")}{" "}
                          <span className="font-mono text-foreground/80">
                            {CLAUDE_CODE_DEFAULT_MODELS.opus} · {CLAUDE_CODE_DEFAULT_MODELS.sonnet}{" "}
                            · {CLAUDE_CODE_DEFAULT_MODELS.haiku}
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
                          {t("clientConfig.claudeCode.configureModels")}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 sm:pl-2 gap-1">
                  {data?.claudeCode.status === "ok" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs gap-1 text-muted-foreground hover:text-destructive"
                      disabled={restoreMutation.isPending}
                      onClick={() => {
                        setRestoreTarget("claudeCode");
                        setRestoreConfirmOpen(true);
                      }}
                    >
                      {restoreMutation.isPending && applyingTo === "claudeCode" ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3 w-3" />
                      )}
                      <span className="hidden sm:inline">
                        {t("clientConfig.claudeCode.restore")}
                      </span>
                    </Button>
                  )}
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
                      t("clientConfig.claudeCode.upToDate")
                    ) : (
                      t("clientConfig.claudeCode.apply")
                    )}
                  </Button>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-md border border-border/60 p-2.5">
                <div className="flex items-start gap-2 min-w-0">
                  <FileCode2 className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium">{t("clientConfig.codex.name")}</span>
                      {data?.codex && statusBadge(data.codex.status, t)}
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
                      {t("clientConfig.codex.expected")}{" "}
                      <span className="font-mono">{data?.expectedCodexBaseUrl ?? "—"}</span>
                    </p>
                    <div className="mt-2 pt-2 border-t border-border/50 space-y-1.5">
                      <p className="text-[10px] text-muted-foreground">
                        <span className="font-medium text-foreground/90">
                          {t("clientConfig.codex.model.label")}
                        </span>{" "}
                        {t("clientConfig.codex.model.description")}
                      </p>
                      {data?.codex?.model ? (
                        <p className="text-[10px] font-mono text-foreground/80">
                          {data.codex.model}
                        </p>
                      ) : (
                        <p className="text-[10px] text-muted-foreground">
                          <span className="italic">{t("clientConfig.codex.model.notSet")}</span>{" "}
                          {t("clientConfig.codex.model.default")}{" "}
                          <span className="font-mono text-foreground/80">
                            {CODEX_DEFAULT_MODEL}
                          </span>
                        </p>
                      )}
                      <div>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="h-7 text-xs gap-1"
                          disabled={applyMutation.isPending || codexModelPatchMutation.isPending}
                          onClick={() => {
                            setCodexModalMode("configure");
                            setCodexModel(data?.codex?.model ?? "");
                            setCodexModelModalOpen(true);
                          }}
                        >
                          <SlidersHorizontal className="h-3 w-3" />
                          {t("clientConfig.codex.configureModel")}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 sm:pl-2 gap-1">
                  {data?.codex.status === "ok" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs gap-1 text-muted-foreground hover:text-destructive"
                      disabled={restoreMutation.isPending}
                      onClick={() => {
                        setRestoreTarget("codex");
                        setRestoreConfirmOpen(true);
                      }}
                    >
                      {restoreMutation.isPending && applyingTo === "codex" ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3 w-3" />
                      )}
                      <span className="hidden sm:inline">{t("clientConfig.codex.restore")}</span>
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant={data?.codex.status === "ok" ? "outline" : "default"}
                    className="h-7 text-xs"
                    disabled={
                      data?.codex.status === "ok" ||
                      applyMutation.isPending ||
                      modelsMutation.isPending ||
                      codexModelPatchMutation.isPending
                    }
                    onClick={() => onConfigureClick("codex")}
                  >
                    {applyMutation.isPending && applyingTo === "codex" ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : data?.codex.status === "ok" ? (
                      t("clientConfig.codex.upToDate")
                    ) : (
                      t("clientConfig.codex.apply")
                    )}
                  </Button>
                </div>
              </div>

              {applyMutation.isError && (
                <p className="text-[10px] text-destructive">
                  {(applyMutation.error as Error).message}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={restoreConfirmOpen}
        onOpenChange={o => {
          setRestoreConfirmOpen(o);
          if (!o) setRestoreTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("clientConfig.dialog.restore.title", {
                name:
                  restoreTarget === "codex"
                    ? t("clientConfig.codex.name")
                    : restoreTarget === "claudeDesktop"
                      ? t("clientConfig.claudeDesktop.name")
                      : t("clientConfig.claudeCode.name"),
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {restoreTarget === "codex"
                ? t("clientConfig.dialog.restore.codexDescription")
                : restoreTarget === "claudeDesktop"
                  ? t("clientConfig.dialog.restore.claudeDesktopDescription")
                  : t("clientConfig.dialog.restore.claudeDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={e => {
                e.preventDefault();
                if (restoreTarget) {
                  setApplyingTo(restoreTarget);
                  restoreMutation.mutate(restoreTarget);
                }
              }}
            >
              {restoreMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                t("clientConfig.dialog.restore.action")
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
              {pendingTarget === "codex"
                ? t("clientConfig.dialog.replaceCodex.title")
                : pendingTarget === "claudeDesktop"
                  ? t("clientConfig.dialog.replaceClaudeDesktop.title")
                  : t("clientConfig.dialog.overwrite.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingTarget === "codex" ? (
                <>
                  Your <span className="font-mono">~/.codex/config.toml</span> points to another API
                  ({pendingItem?.currentValue ?? "unknown"}). Applying will{" "}
                  <strong>replace the file</strong> with the CCRelay template (model{" "}
                  <span className="font-mono">{pendingCodexModel || CODEX_DEFAULT_MODEL}</span>,
                  provider <span className="font-mono">ccrelay</span>).
                </>
              ) : pendingTarget === "claudeDesktop" ? (
                <>
                  Your Claude Desktop config points to{" "}
                  <span className="font-mono">{pendingItem?.currentValue ?? "another URL"}</span>.
                  Applying will merge CCRelay settings into the Claude-3p config directory.
                  {pendingItem?.status === "invalid" && (
                    <> {t("clientConfig.dialog.overwrite.invalidJson")}</>
                  )}
                </>
              ) : (
                <>
                  Your <span className="font-mono">settings.json</span> is missing CCRelay or points
                  to {pendingItem?.currentValue ?? "another URL"}. Applying will merge recommended{" "}
                  <span className="font-mono">env</span> keys (including{" "}
                  <span className="font-mono">ANTHROPIC_BASE_URL</span> →{" "}
                  {data?.expectedAnthropicBase ?? "this server"}).
                  {pendingItem?.status === "invalid" && (
                    <> {t("clientConfig.dialog.overwrite.invalidJson")}</>
                  )}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={e => {
                e.preventDefault();
                onConfirmOverwrite();
              }}
            >
              {applyMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                t("clientConfig.dialog.overwrite.action")
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {codexModelModalOpen && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
          <Card className="w-full max-w-[360px] flex flex-col">
            <CardHeader className="border-b p-3 flex-shrink-0">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">{t("clientConfig.codexModelModal.title")}</CardTitle>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => setCodexModelModalOpen(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground font-normal pt-1">
                {t("clientConfig.codexModelModal.description")}
              </p>
            </CardHeader>
            <CardContent className="p-4 space-y-2">
              <div className="space-y-1">
                <Label className="text-xs font-medium">
                  {t("clientConfig.codexModelModal.label")}
                </Label>
                <Input
                  type="text"
                  className="h-8 font-mono text-xs"
                  value={codexModel}
                  onChange={e => setCodexModel(e.target.value)}
                  placeholder={CODEX_DEFAULT_MODEL}
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      if (codexModalMode === "configure") {
                        codexModelPatchMutation.mutate(codexModel.trim() || CODEX_DEFAULT_MODEL);
                      } else {
                        const effectiveModel = codexModel.trim() || CODEX_DEFAULT_MODEL;
                        const codexItem = data?.codex;
                        setCodexModelModalOpen(false);
                        if (codexItem && needsOverwriteBeforeApply(codexItem)) {
                          setPendingCodexModel(effectiveModel);
                          setPendingTarget("codex");
                          setConfirmOpen(true);
                        } else {
                          runApply("codex", false, effectiveModel);
                        }
                      }
                    }
                  }}
                />
              </div>
              {applyMutation.isError && (
                <p className="text-[10px] text-destructive">
                  {(applyMutation.error as Error).message}
                </p>
              )}
              {codexModelPatchMutation.isError && (
                <p className="text-[10px] text-destructive">
                  {(codexModelPatchMutation.error as Error).message}
                </p>
              )}
            </CardContent>
            <div className="border-t p-3 flex justify-end">
              <Button
                type="button"
                size="sm"
                className="h-7 text-xs"
                disabled={applyMutation.isPending || codexModelPatchMutation.isPending}
                onClick={() => {
                  if (codexModalMode === "configure") {
                    codexModelPatchMutation.mutate(codexModel.trim() || CODEX_DEFAULT_MODEL);
                  } else {
                    const effectiveModel = codexModel.trim() || CODEX_DEFAULT_MODEL;
                    const codexItem = data?.codex;
                    setCodexModelModalOpen(false);
                    if (codexItem && needsOverwriteBeforeApply(codexItem)) {
                      setPendingCodexModel(effectiveModel);
                      setPendingTarget("codex");
                      setConfirmOpen(true);
                    } else {
                      runApply("codex", false, effectiveModel);
                    }
                  }
                }}
              >
                {applyMutation.isPending || codexModelPatchMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : codexModalMode === "configure" ? (
                  t("common.save")
                ) : (
                  t("clientConfig.codexModelModal.saveAndApply")
                )}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {modelModalOpen && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
          <Card className="w-full max-w-[420px] flex flex-col">
            <CardHeader className="border-b p-3 flex-shrink-0">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">{t("clientConfig.modelsModal.title")}</CardTitle>
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
                {t("clientConfig.modelsModal.description")}
              </p>
            </CardHeader>
            <CardContent className="p-4 space-y-2">
              <div className="space-y-1">
                <Label className="text-xs font-medium">{t("clientConfig.modelsModal.opus")}</Label>
                <Input
                  type="text"
                  className="h-8 font-mono text-xs"
                  value={opus}
                  onChange={e => setOpus(e.target.value)}
                  placeholder={CLAUDE_CODE_DEFAULT_MODELS.opus}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">
                  {t("clientConfig.modelsModal.sonnet")}
                </Label>
                <Input
                  type="text"
                  className="h-8 font-mono text-xs"
                  value={sonnet}
                  onChange={e => setSonnet(e.target.value)}
                  placeholder={CLAUDE_CODE_DEFAULT_MODELS.sonnet}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">{t("clientConfig.modelsModal.haiku")}</Label>
                <Input
                  type="text"
                  className="h-8 font-mono text-xs"
                  value={haiku}
                  onChange={e => setHaiku(e.target.value)}
                  placeholder={CLAUDE_CODE_DEFAULT_MODELS.haiku}
                />
              </div>
              {modelsMutation.isError && (
                <p className="text-[10px] text-destructive">
                  {(modelsMutation.error as Error).message}
                </p>
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
                {t("clientConfig.modelsModal.useDefaults")}
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
                {t("clientConfig.modelsModal.clearFields")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-7 text-xs"
                disabled={modelsMutation.isPending}
                onClick={() => modelsMutation.mutate({ opus: "", sonnet: "", haiku: "" })}
              >
                {t("clientConfig.modelsModal.removeAll")}
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-7 text-xs"
                disabled={modelsMutation.isPending}
                onClick={() => modelsMutation.mutate({ opus, sonnet, haiku })}
              >
                {modelsMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  t("common.save")
                )}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
