import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import ClientConfigStatus from "./ClientConfigStatus";

export default function ClientConfig() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await queryClient.refetchQueries({ queryKey: ["clientConfig"] });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold tracking-tight">{t("clientConfig.title")}</h2>
          <p className="text-xs text-muted-foreground">{t("clientConfig.pageSubtitle")}</p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1 shrink-0"
          onClick={handleRefresh}
          disabled={refreshing}
          title={t("common.refresh")}
        >
          {refreshing ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RotateCw className="h-3 w-3" />
          )}
          <span className="hidden sm:inline">{t("common.refresh")}</span>
        </Button>
      </div>

      <ClientConfigStatus />
    </div>
  );
}
