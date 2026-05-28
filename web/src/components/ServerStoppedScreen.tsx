import { useTranslation } from "react-i18next";
import { Loader2, ServerOff } from "lucide-react";
import { getApiOriginLabel } from "@/api/serverReachability";

type ServerStoppedScreenProps = {
  checking: boolean;
};

export default function ServerStoppedScreen({ checking }: ServerStoppedScreenProps) {
  const { t } = useTranslation();
  const endpoint = getApiOriginLabel();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-12 text-center">
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
