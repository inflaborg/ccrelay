import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { api } from "@/api/client";
import type { UpdateCheckResponse, UpdateCheckStatus } from "@/types/api";
import { UpdateAvailableModal } from "./UpdateAvailableModal";

const POLL_INTERVAL_MS = 2000;

function shouldStopPolling(status: UpdateCheckStatus): boolean {
  return status === "idle" || status === "available";
}

function statusTitleKey(status: UpdateCheckStatus): string {
  switch (status) {
    case "pending":
      return "update.checkNowHint";
    case "idle":
      return "update.recheckHint";
    default:
      return "";
  }
}

function readInjectedUpdateChannel(): "prod" | "dev" | null {
  if (typeof window === "undefined") {
    return null;
  }
  const value = window.CCRELAY_UPDATE_CHANNEL;
  return value === "prod" || value === "dev" ? value : null;
}

export function VersionFooter() {
  const { t } = useTranslation();
  const nativeUpdater = typeof window !== "undefined" && window.CCRELAY_NATIVE_UPDATER === true;
  const [version, setVersion] = useState<string | null>(null);
  const [updateChannel, setUpdateChannel] = useState<"prod" | "dev" | null>(
    readInjectedUpdateChannel
  );
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckResponse | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [manualChecking, setManualChecking] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Last latestVersion we auto-opened the modal for (re-open when a newer release appears). */
  const lastAutoShownVersionRef = useRef<string | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    if (nativeUpdater) {
      return;
    }
    stopPolling();
    pollRef.current = setInterval(() => {
      void api
        .getUpdateCheck()
        .then(state => {
          setUpdateCheck(state);
          if (shouldStopPolling(state.status)) {
            stopPolling();
          }
        })
        .catch(() => {
          stopPolling();
        });
    }, POLL_INTERVAL_MS);
  }, [nativeUpdater, stopPolling]);

  useEffect(() => {
    api
      .getVersion()
      .then(v => setVersion(v.version))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onChannel = (event: Event): void => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (detail === "prod" || detail === "dev") {
        setUpdateChannel(detail);
        return;
      }
      setUpdateChannel(readInjectedUpdateChannel());
    };
    window.addEventListener("ccrelay-update-channel", onChannel);
    return () => window.removeEventListener("ccrelay-update-channel", onChannel);
  }, []);

  const pollUpdateCheck = useCallback(async () => {
    if (nativeUpdater) {
      return;
    }
    try {
      const state = await api.getUpdateCheck();
      setUpdateCheck(state);
      if (shouldStopPolling(state.status)) {
        stopPolling();
      }
    } catch {
      stopPolling();
    }
  }, [nativeUpdater, stopPolling]);

  useEffect(() => {
    if (nativeUpdater) {
      return;
    }
    void pollUpdateCheck();
    startPolling();
    return () => stopPolling();
  }, [nativeUpdater, pollUpdateCheck, startPolling, stopPolling]);

  useEffect(() => {
    if (nativeUpdater) {
      return;
    }
    if (
      updateCheck?.status !== "available" ||
      !updateCheck.latestVersion ||
      !updateCheck.releaseUrl
    ) {
      return;
    }
    if (lastAutoShownVersionRef.current === updateCheck.latestVersion) {
      return;
    }
    lastAutoShownVersionRef.current = updateCheck.latestVersion;
    setModalOpen(true);
  }, [nativeUpdater, updateCheck]);

  const handleRecheck = async () => {
    if (nativeUpdater || manualChecking || updateCheck?.status === "checking") {
      return;
    }
    setManualChecking(true);
    startPolling();
    try {
      const state = await api.triggerUpdateCheck();
      setUpdateCheck(state);
      if (shouldStopPolling(state.status)) {
        stopPolling();
      }
    } catch {
      stopPolling();
    } finally {
      setManualChecking(false);
    }
  };

  const displayVersion = version ?? updateCheck?.currentVersion ?? null;
  const channelLabel =
    updateChannel === "dev"
      ? t("update.channelDev")
      : updateChannel === "prod"
        ? t("update.channelStable")
        : null;

  const versionAndChannel = (
    <>
      {displayVersion && <span>{displayVersion}</span>}
      {channelLabel && (
        <>
          {displayVersion && <span aria-hidden>·</span>}
          <span title={t("update.channelHint")}>{channelLabel}</span>
        </>
      )}
    </>
  );

  if (nativeUpdater) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        {versionAndChannel}
      </div>
    );
  }

  const status: UpdateCheckStatus = updateCheck?.status ?? "pending";
  const isChecking = manualChecking || status === "checking";
  const isUpdateAvailable = status === "available";

  const statusLabel = (() => {
    if (isChecking) {
      return t("update.checking");
    }
    switch (status) {
      case "pending":
        return t("update.pending");
      case "idle":
        return t("update.upToDate");
      case "available":
        return t("update.available");
      default:
        return t("update.pending");
    }
  })();

  const titleKey = isChecking ? "" : statusTitleKey(status);
  const statusButtonClass =
    status === "available"
      ? "text-primary hover:underline"
      : "text-muted-foreground hover:text-foreground hover:underline";

  const handleStatusClick = () => {
    if (isChecking) {
      return;
    }
    if (status === "available") {
      setModalOpen(true);
      return;
    }
    void handleRecheck();
  };

  return (
    <>
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        {isChecking && <Loader2 className="h-3 w-3 animate-spin shrink-0" aria-hidden />}
        {versionAndChannel}
        <button
          type="button"
          className={`shrink-0 disabled:opacity-50 disabled:pointer-events-none ${statusButtonClass}`}
          title={titleKey ? t(titleKey) : undefined}
          disabled={isChecking}
          onClick={handleStatusClick}
        >
          {statusLabel}
        </button>
      </div>
      {isUpdateAvailable && updateCheck?.latestVersion && updateCheck.releaseUrl && (
        <UpdateAvailableModal
          key={updateCheck.latestVersion}
          open={modalOpen}
          onOpenChange={setModalOpen}
          currentVersion={updateCheck.currentVersion}
          latestVersion={updateCheck.latestVersion}
          releaseUrl={updateCheck.releaseUrl}
          releaseNotes={updateCheck.releaseNotes ?? ""}
        />
      )}
    </>
  );
}
