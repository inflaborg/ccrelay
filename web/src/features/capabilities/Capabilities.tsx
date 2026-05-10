import { useTranslation } from "react-i18next";
import WebSearchGroup from "./WebSearchGroup";

export default function Capabilities() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">{t("capabilities.title")}</h2>
        <p className="text-xs text-muted-foreground">{t("capabilities.subtitle")}</p>
      </div>

      <WebSearchGroup />
    </div>
  );
}
