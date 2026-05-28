import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Copy,
  FileCode2,
  Loader2,
  Monitor,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
import { api } from "@/api/client";
import { CLAUDE_CODE_DEFAULT_MODELS, CODEX_DEFAULT_MODEL } from "@/constants/claudeCodeDefaults";
import type {
  ClientConfigItem,
  ClientConfigItemStatus,
  ClaudeCliVersionInfo,
  ClaudeDesktopBundleVersions,
} from "@/types/api";
import ConfigFieldList from "@/features/client-config/ConfigFieldList";

const metaText = "text-xs text-muted-foreground";
const sectionTitle = "text-sm font-medium";
const monoValue = "text-xs font-mono text-foreground/80";
const actionButton = "h-8 text-xs gap-1";
const actionIcon = "h-3.5 w-3.5";

function homePathVar(): string {
  if (typeof navigator !== "undefined" && navigator.platform.toLowerCase().startsWith("win")) {
    return "%HOME%";
  }
  return "$HOME";
}

function clientConfigPath(relativePath: string): string {
  const sep = homePathVar() === "%HOME%" ? "\\" : "/";
  return `${homePathVar()}${sep}${relativePath.replace(/\//g, sep)}`;
}

function CopyPathButton({ path }: { path: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 w-7 p-0 shrink-0"
      onClick={() => void copy()}
      title={t("clientConfig.copyPath")}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-500" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </Button>
  );
}

function formatBundleList(versions: string[], notInstalledLabel: string): string {
  return versions.length > 0 ? versions.join(", ") : notInstalledLabel;
}

function formatCliVersionText(
  info: ClaudeCliVersionInfo | undefined,
  t: (key: string) => string
): string {
  if (!info) {
    return "—";
  }
  switch (info.status) {
    case "ok":
      return info.version ?? "—";
    case "disabled":
      return t("clientConfig.version.cliDisabled");
    default:
      return t("clientConfig.version.cliNotDetected");
  }
}

function ClaudeDesktopBundleInfo({
  bundles,
  t,
}: {
  bundles: ClaudeDesktopBundleVersions | undefined;
  t: (key: string) => string;
}) {
  const notInstalled = t("clientConfig.version.notInstalled");
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground min-w-0">
      <span className="font-medium text-foreground/90 shrink-0">
        {t("clientConfig.version.desktopBundles")}
      </span>
      <span className="text-border/80 hidden sm:inline" aria-hidden>
        ·
      </span>
      <span className="shrink-0">
        {t("clientConfig.version.native")}{" "}
        <span className={monoValue}>{formatBundleList(bundles?.native ?? [], notInstalled)}</span>
      </span>
      <span className="text-border/80" aria-hidden>
        ·
      </span>
      <span className="shrink-0">
        {t("clientConfig.version.vm")}{" "}
        <span className={monoValue}>{formatBundleList(bundles?.vm ?? [], notInstalled)}</span>
      </span>
    </div>
  );
}

function ClaudeCliVersionInfoRow({
  info,
  t,
  onRefresh,
  refreshing,
}: {
  info: ClaudeCliVersionInfo | undefined;
  t: (key: string) => string;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
      <span className="shrink-0">{t("clientConfig.version.cliVersion")}</span>
      <span className={`${monoValue} truncate min-w-0`} title={formatCliVersionText(info, t)}>
        {formatCliVersionText(info, t)}
      </span>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-6 w-6 p-0 shrink-0"
        disabled={refreshing}
        onClick={onRefresh}
        title={t("clientConfig.version.refresh")}
      >
        {refreshing ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <RefreshCw className="h-3 w-3" />
        )}
      </Button>
    </div>
  );
}

function OptionalModelConfigRow({
  title,
  description,
  children,
  buttonLabel,
  buttonDisabled,
  onConfigure,
}: {
  title: string;
  description: string;
  children: ReactNode;
  buttonLabel: string;
  buttonDisabled?: boolean;
  onConfigure: () => void;
}) {
  return (
    <div className="w-full">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className={sectionTitle}>{title}</p>
          <p className={metaText}>{description}</p>
          {children}
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className={`${actionButton} shrink-0`}
          disabled={buttonDisabled}
          onClick={onConfigure}
        >
          <SlidersHorizontal className={actionIcon} />
          {buttonLabel}
        </Button>
      </div>
    </div>
  );
}

function statusBadge(status: ClientConfigItemStatus, t: (key: string) => string) {
  switch (status) {
    case "ok":
      return (
        <Badge variant="success" className="text-xs px-2 py-0">
          {t("clientConfig.status.ok")}
        </Badge>
      );
    case "missing":
      return (
        <Badge variant="secondary" className="text-xs px-2 py-0">
          {t("clientConfig.status.notSet")}
        </Badge>
      );
    case "wrong_target":
      return (
        <Badge variant="destructive" className="text-xs px-2 py-0">
          {t("clientConfig.status.otherHost")}
        </Badge>
      );
    case "invalid":
      return (
        <Badge variant="destructive" className="text-xs px-2 py-0">
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

/** Only true when API reports full CCRelay template applied (no missing fields). */
function isClientConfigUpToDate(item: ClientConfigItem | null | undefined): boolean {
  return item?.status === "ok";
}

function ClientConfigSection({
  icon,
  title,
  status,
  filePath,
  invalidMessage,
  actions,
  metaBanner,
  children,
}: {
  icon: ReactNode;
  title: string;
  status?: ClientConfigItemStatus;
  filePath: string;
  invalidMessage?: string;
  actions: ReactNode;
  metaBanner?: ReactNode;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const hasMeta = Boolean(metaBanner || children);

  return (
    <div className="rounded-md border border-border/60 p-3.5">
      <div className="flex gap-2.5">
        <div className="shrink-0 mt-1 text-muted-foreground">{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <span className={sectionTitle}>{title}</span>
              {status !== undefined && statusBadge(status, t)}
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-1.5">{actions}</div>
          </div>
          <div className="mt-1.5 flex items-center gap-1 min-w-0">
            <p
              className="text-xs text-muted-foreground font-mono truncate min-w-0 flex-1"
              title={filePath}
            >
              {filePath}
            </p>
            <CopyPathButton path={filePath} />
          </div>
          {invalidMessage && (
            <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">{invalidMessage}</p>
          )}
          {hasMeta ? (
            <div className="mt-3 pt-3 border-t border-border/50 space-y-3">
              {metaBanner ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
                  {metaBanner}
                </div>
              ) : null}
              {children ? <div className="min-w-0 space-y-3">{children}</div> : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
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

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["clientConfig"],
    queryFn: () => api.getClientConfig(),
    refetchInterval: 60_000,
  });

  const { data: settingsConfig } = useQuery({
    queryKey: ["config"],
    queryFn: () => api.getConfig(),
  });

  const detectionEnabled = settingsConfig?.clientVersionDetection?.enabled !== false;

  const detectionToggleMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      api.patchConfig({ section: "clientVersionDetection", data: { enabled } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["config"] });
      void queryClient.invalidateQueries({ queryKey: ["clientConfig"] });
    },
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
    if (isClientConfigUpToDate(item)) {
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
        <CardHeader className="p-4 pb-3 space-y-3">
          <p className={`${metaText} leading-relaxed`}>
            {t("clientConfig.description", {
              port: data?.port ?? "—",
              claudePath: clientConfigPath(".claude/settings.json"),
              codexPath: clientConfigPath(".codex/config.toml"),
            })}
          </p>
          <div className="flex items-start gap-2.5">
            <Checkbox
              id="client-version-detection"
              checked={detectionEnabled}
              disabled={detectionToggleMutation.isPending}
              onCheckedChange={checked => {
                detectionToggleMutation.mutate(checked === true);
              }}
            />
            <Label
              htmlFor="client-version-detection"
              className="text-xs font-normal cursor-pointer leading-relaxed"
            >
              {t("clientConfig.version.detectionToggle")}
              <span className="text-muted-foreground font-normal">
                {" "}
                {t("clientConfig.version.detectionToggleHint")}
              </span>
            </Label>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-3">
          {isLoading ? (
            <div className="h-16 animate-pulse bg-muted rounded" />
          ) : (
            <>
              {data?.claudeDesktop && (
                <ClientConfigSection
                  icon={<Monitor className="h-4 w-4" />}
                  title={t("clientConfig.claudeDesktop.name")}
                  status={data.claudeDesktop.status}
                  filePath={data.claudeDesktop.filePath}
                  invalidMessage={
                    data.claudeDesktop.status === "invalid" ? data.claudeDesktop.message : undefined
                  }
                  actions={
                    <>
                      {isClientConfigUpToDate(data.claudeDesktop) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className={`${actionButton} text-muted-foreground hover:text-destructive`}
                          disabled={restoreMutation.isPending}
                          onClick={() => {
                            setRestoreTarget("claudeDesktop");
                            setRestoreConfirmOpen(true);
                          }}
                        >
                          {restoreMutation.isPending && applyingTo === "claudeDesktop" ? (
                            <Loader2 className={`${actionIcon} animate-spin`} />
                          ) : (
                            <RotateCcw className={actionIcon} />
                          )}
                          <span className="hidden sm:inline">
                            {t("clientConfig.claudeDesktop.restore")}
                          </span>
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant={isClientConfigUpToDate(data.claudeDesktop) ? "outline" : "default"}
                        className={`${actionButton} min-w-[7rem]`}
                        disabled={
                          isClientConfigUpToDate(data.claudeDesktop) || applyMutation.isPending
                        }
                        onClick={() => onConfigureClick("claudeDesktop")}
                      >
                        {applyMutation.isPending && applyingTo === "claudeDesktop" ? (
                          <Loader2 className={`${actionIcon} animate-spin`} />
                        ) : isClientConfigUpToDate(data.claudeDesktop) ? (
                          t("clientConfig.claudeDesktop.upToDate")
                        ) : (
                          t("clientConfig.claudeDesktop.apply")
                        )}
                      </Button>
                    </>
                  }
                  metaBanner={<ClaudeDesktopBundleInfo bundles={data.claudeDesktopBundles} t={t} />}
                >
                  <ConfigFieldList fields={data.claudeDesktop.fields ?? []} />
                </ClientConfigSection>
              )}

              {data?.claudeCode && (
                <ClientConfigSection
                  icon={<FileCode2 className="h-4 w-4" />}
                  title={t("clientConfig.claudeCode.name")}
                  status={data.claudeCode.status}
                  filePath={data.claudeCode.filePath}
                  invalidMessage={
                    data.claudeCode.status === "invalid" ? data.claudeCode.message : undefined
                  }
                  actions={
                    <>
                      {isClientConfigUpToDate(data.claudeCode) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className={`${actionButton} text-muted-foreground hover:text-destructive`}
                          disabled={restoreMutation.isPending}
                          onClick={() => {
                            setRestoreTarget("claudeCode");
                            setRestoreConfirmOpen(true);
                          }}
                        >
                          {restoreMutation.isPending && applyingTo === "claudeCode" ? (
                            <Loader2 className={`${actionIcon} animate-spin`} />
                          ) : (
                            <RotateCcw className={actionIcon} />
                          )}
                          <span className="hidden sm:inline">
                            {t("clientConfig.claudeCode.restore")}
                          </span>
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant={isClientConfigUpToDate(data.claudeCode) ? "outline" : "default"}
                        className={`${actionButton} min-w-[7rem]`}
                        disabled={
                          isClientConfigUpToDate(data.claudeCode) ||
                          applyMutation.isPending ||
                          modelsMutation.isPending
                        }
                        onClick={() => onConfigureClick("claudeCode")}
                      >
                        {applyMutation.isPending && applyingTo === "claudeCode" ? (
                          <Loader2 className={`${actionIcon} animate-spin`} />
                        ) : isClientConfigUpToDate(data.claudeCode) ? (
                          t("clientConfig.claudeCode.upToDate")
                        ) : (
                          t("clientConfig.claudeCode.apply")
                        )}
                      </Button>
                    </>
                  }
                  metaBanner={
                    <ClaudeCliVersionInfoRow
                      info={data.claudeCli}
                      t={t}
                      refreshing={isFetching}
                      onRefresh={() => {
                        void refetch();
                      }}
                    />
                  }
                >
                  <OptionalModelConfigRow
                    title={t("clientConfig.claudeCode.optionalModels.title")}
                    description={t("clientConfig.claudeCode.optionalModels.description")}
                    buttonLabel={t("clientConfig.claudeCode.configureModels")}
                    buttonDisabled={applyMutation.isPending || modelsMutation.isPending}
                    onConfigure={() => {
                      const m = data.claudeDefaultModels;
                      setOpus(m?.opus ?? CLAUDE_CODE_DEFAULT_MODELS.opus);
                      setSonnet(m?.sonnet ?? CLAUDE_CODE_DEFAULT_MODELS.sonnet);
                      setHaiku(m?.haiku ?? CLAUDE_CODE_DEFAULT_MODELS.haiku);
                      setModelModalOpen(true);
                    }}
                  >
                    {data.claudeDefaultModels &&
                    (data.claudeDefaultModels.opus ||
                      data.claudeDefaultModels.sonnet ||
                      data.claudeDefaultModels.haiku) ? (
                      <p className={`${monoValue} break-all`}>
                        Opus: {data.claudeDefaultModels.opus || "—"} · Sonnet:{" "}
                        {data.claudeDefaultModels.sonnet || "—"} · Haiku:{" "}
                        {data.claudeDefaultModels.haiku || "—"}
                      </p>
                    ) : (
                      <p className={metaText}>
                        <span className="italic">
                          {t("clientConfig.claudeCode.optionalModels.notSet")}
                        </span>{" "}
                        {t("clientConfig.claudeCode.optionalModels.suggested")}{" "}
                        <span className="font-mono text-foreground/80">
                          {CLAUDE_CODE_DEFAULT_MODELS.opus} · {CLAUDE_CODE_DEFAULT_MODELS.sonnet} ·{" "}
                          {CLAUDE_CODE_DEFAULT_MODELS.haiku}
                        </span>
                      </p>
                    )}
                  </OptionalModelConfigRow>
                  <ConfigFieldList fields={data.claudeCode.fields ?? []} />
                </ClientConfigSection>
              )}

              {data?.codex && (
                <ClientConfigSection
                  icon={<FileCode2 className="h-4 w-4" />}
                  title={t("clientConfig.codex.name")}
                  status={data.codex.status}
                  filePath={data.codex.filePath}
                  invalidMessage={data.codex.status === "invalid" ? data.codex.message : undefined}
                  actions={
                    <>
                      {isClientConfigUpToDate(data.codex) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className={`${actionButton} text-muted-foreground hover:text-destructive`}
                          disabled={restoreMutation.isPending}
                          onClick={() => {
                            setRestoreTarget("codex");
                            setRestoreConfirmOpen(true);
                          }}
                        >
                          {restoreMutation.isPending && applyingTo === "codex" ? (
                            <Loader2 className={`${actionIcon} animate-spin`} />
                          ) : (
                            <RotateCcw className={actionIcon} />
                          )}
                          <span className="hidden sm:inline">
                            {t("clientConfig.codex.restore")}
                          </span>
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant={isClientConfigUpToDate(data.codex) ? "outline" : "default"}
                        className={`${actionButton} min-w-[7rem]`}
                        disabled={
                          isClientConfigUpToDate(data.codex) ||
                          applyMutation.isPending ||
                          modelsMutation.isPending ||
                          codexModelPatchMutation.isPending
                        }
                        onClick={() => onConfigureClick("codex")}
                      >
                        {applyMutation.isPending && applyingTo === "codex" ? (
                          <Loader2 className={`${actionIcon} animate-spin`} />
                        ) : isClientConfigUpToDate(data.codex) ? (
                          t("clientConfig.codex.upToDate")
                        ) : (
                          t("clientConfig.codex.apply")
                        )}
                      </Button>
                    </>
                  }
                >
                  <OptionalModelConfigRow
                    title={t("clientConfig.codex.model.label")}
                    description={t("clientConfig.codex.model.description")}
                    buttonLabel={t("clientConfig.codex.configureModel")}
                    buttonDisabled={applyMutation.isPending || codexModelPatchMutation.isPending}
                    onConfigure={() => {
                      setCodexModalMode("configure");
                      setCodexModel(data.codex?.model ?? "");
                      setCodexModelModalOpen(true);
                    }}
                  >
                    {data.codex.model ? (
                      <p className={monoValue}>{data.codex.model}</p>
                    ) : (
                      <p className={metaText}>
                        <span className="italic">{t("clientConfig.codex.model.notSet")}</span>{" "}
                        {t("clientConfig.codex.model.default")}{" "}
                        <span className="font-mono text-foreground/80">{CODEX_DEFAULT_MODEL}</span>
                      </p>
                    )}
                  </OptionalModelConfigRow>
                  <ConfigFieldList fields={data.codex.fields ?? []} />
                </ClientConfigSection>
              )}

              {applyMutation.isError && (
                <p className="text-xs text-destructive">{(applyMutation.error as Error).message}</p>
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
                <Loader2 className={`${actionIcon} animate-spin`} />
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
                <Loader2 className={`${actionIcon} animate-spin`} />
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
              <p className={`${metaText} pt-1`}>{t("clientConfig.codexModelModal.description")}</p>
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
                <p className="text-xs text-destructive">{(applyMutation.error as Error).message}</p>
              )}
              {codexModelPatchMutation.isError && (
                <p className="text-xs text-destructive">
                  {(codexModelPatchMutation.error as Error).message}
                </p>
              )}
            </CardContent>
            <div className="border-t p-3 flex justify-end">
              <Button
                type="button"
                size="sm"
                className={actionButton}
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
                  <Loader2 className={`${actionIcon} animate-spin`} />
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
              <p className={`${metaText} pt-1`}>{t("clientConfig.modelsModal.description")}</p>
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
                <p className="text-xs text-destructive">
                  {(modelsMutation.error as Error).message}
                </p>
              )}
            </CardContent>
            <div className="border-t p-3 flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className={actionButton}
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
                className={actionButton}
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
                className={actionButton}
                disabled={modelsMutation.isPending}
                onClick={() => modelsMutation.mutate({ opus: "", sonnet: "", haiku: "" })}
              >
                {t("clientConfig.modelsModal.removeAll")}
              </Button>
              <Button
                type="button"
                size="sm"
                className={actionButton}
                disabled={modelsMutation.isPending}
                onClick={() => modelsMutation.mutate({ opus, sonnet, haiku })}
              >
                {modelsMutation.isPending ? (
                  <Loader2 className={`${actionIcon} animate-spin`} />
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
