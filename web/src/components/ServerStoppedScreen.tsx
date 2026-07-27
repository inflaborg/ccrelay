import { useTranslation } from "react-i18next";
import { Loader2, ServerOff } from "lucide-react";
import { getApiOriginLabel } from "@/api/serverReachability";
import { WindowCaptionButtons } from "./WindowCaptionButtons";
import { isDarwinDesktop, isElectronDesktop, needsWindowCaptionButtons } from "@/lib/desktopShell";
import { cn } from "@/lib/utils";

type ServerStoppedScreenProps = {
  checking: boolean;
};

export default function ServerStoppedScreen({ checking }: ServerStoppedScreenProps) {
  const { t } = useTranslation();
  const endpoint = getApiOriginLabel();
  const electronDesktop = isElectronDesktop();
  const darwinDesktop = isDarwinDesktop();
  const showCaptionButtons = needsWindowCaptionButtons();

  return (
    <div
      className={cn(
        "relative flex min-h-screen flex-col items-center justify-center bg-background px-6 py-12 text-center",
        electronDesktop && "electron-drag select-none",
        darwinDesktop && "pt-10"
      )}
    >
      {showCaptionButtons && (
        <div className="absolute right-0 top-0 z-10">
          <WindowCaptionButtons />
        </div>
      )}
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <ServerOff className="h-7 w-7 text-muted-foreground" aria-hidden />
      </div>
      <h1 className="text-base font-semibold">{t("serverOffline.title")}</h1>
      <p className="mt-2 max-w-md text-xs text-muted-foreground">
        {t("serverOffline.description")}
      </p>
      <p className="mt-3 font-mono text-[11px] text-muted-foreground">{endpoint}</p>
      <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
        {checking ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            <span>{t("serverOffline.checking")}</span>
          </>
        ) : (
          <span>{t("serverOffline.waiting")}</span>
        )}
      </div>
      <p className="mt-4 max-w-sm text-[10px] text-muted-foreground">{t("serverOffline.hint")}</p>
    </div>
  );
}
