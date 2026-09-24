import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { APP_LOCALES, applyAppLocale, type AppLocale } from "@/i18n";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import { Button } from "./ui/button";

export function LanguageModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const handleSelect = async (locale: AppLocale) => {
    await applyAppLocale(locale);
    try {
      await api.patchConfig({ section: "server", data: { locale } });
      await queryClient.invalidateQueries({ queryKey: ["config"] });
    } catch {
      // locale applied for this session; backend failure is non-fatal
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={next => next && onOpenChange(next)}>
      <DialogContent className="sm:max-w-xs" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t("language.title")}</DialogTitle>
          <DialogDescription>{t("language.description")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 pt-2">
          {APP_LOCALES.map(locale => (
            <Button
              key={locale}
              variant="outline"
              className="w-full justify-start"
              onClick={() => void handleSelect(locale)}
            >
              {t(`language.${locale}`)}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
