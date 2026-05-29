import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { MarkdownViewer } from "./ui/markdown-viewer";

export function UpdateAvailableModal({
  open,
  onOpenChange,
  currentVersion,
  latestVersion,
  releaseUrl,
  releaseNotes,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  releaseNotes: string;
}) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("update.modalTitle", { version: latestVersion })}</DialogTitle>
          <DialogDescription>{t("update.current", { version: currentVersion })}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] overflow-y-auto text-xs">
          {releaseNotes.trim() ? (
            <MarkdownViewer content={releaseNotes} />
          ) : (
            <p className="text-muted-foreground">{t("update.noNotes")}</p>
          )}
        </div>
        <DialogFooter>
          <Button
            size="sm"
            onClick={() => {
              window.open(releaseUrl, "_blank", "noopener,noreferrer");
            }}
          >
            {t("update.download")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
