import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ModelMapEntry } from "@/types/api";
import { buildModelConfig } from "./wizard/engine";

export interface CoworkAliasHelperProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (result: { customModelsList: string[]; modelMap: ModelMapEntry[] }) => void;
}

type HelperRow = { id: string; realId: string; displayName: string };

function newRow(): HelperRow {
  return { id: crypto.randomUUID(), realId: "", displayName: "" };
}

export function CoworkAliasHelper({ open, onOpenChange, onApply }: CoworkAliasHelperProps) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<HelperRow[]>([newRow()]);
  const lastRealIdInputRef = useRef<HTMLInputElement | null>(null);

  const preview = useMemo(() => {
    const validLines = rows
      .map(r => ({ real: r.realId.trim(), dn: r.displayName.trim() }))
      .filter(r => r.real.length > 0)
      .map(r => (r.dn.length > 0 ? `${r.real};${r.dn}` : r.real));

    if (validLines.length === 0) {
      return null;
    }
    const c = buildModelConfig(validLines, true, true);
    if (!c.useCustomModelsList) {
      return null;
    }
    return { customModelsList: c.customModelsList, modelMap: c.modelMap };
  }, [rows]);

  const addRow = useCallback(() => {
    setRows(prev => [...prev, newRow()]);
  }, []);

  const removeOrClearRow = useCallback((id: string) => {
    setRows(prev => {
      if (prev.length <= 1) {
        return [newRow()];
      }
      return prev.filter(r => r.id !== id);
    });
  }, []);

  const updateRow = useCallback(
    (id: string, patch: Partial<Pick<HelperRow, "realId" | "displayName">>) => {
      setRows(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)));
    },
    []
  );

  const handleDisplayKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>, index: number) => {
      if (e.key !== "Enter") {
        return;
      }
      e.preventDefault();
      if (index === rows.length - 1) {
        const id = crypto.randomUUID();
        setRows(prev => [...prev, { id, realId: "", displayName: "" }]);
        setTimeout(() => {
          lastRealIdInputRef.current?.focus();
        }, 0);
      }
    },
    [rows.length]
  );

  const handleApply = () => {
    if (!preview) {
      return;
    }
    onApply(preview);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("providers.modal.coworkHelper")}</DialogTitle>
          <DialogDescription>{t("providers.modal.coworkHelperDesc")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {rows.map((row, index) => (
            <div key={row.id} className="flex items-center gap-1.5">
              <Input
                ref={index === rows.length - 1 ? lastRealIdInputRef : undefined}
                className="h-8 text-xs font-mono flex-1 min-w-0"
                placeholder={t("providers.modal.coworkHelperRealId")}
                value={row.realId}
                onChange={e => updateRow(row.id, { realId: e.target.value })}
              />
              <Input
                className="h-8 text-xs flex-1 min-w-0"
                placeholder={t("providers.modal.coworkHelperDisplayName")}
                value={row.displayName}
                onChange={e => updateRow(row.id, { displayName: e.target.value })}
                onKeyDown={e => handleDisplayKeyDown(e, index)}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8 shrink-0"
                aria-label={t("providers.modal.coworkHelperRemoveRow")}
                onClick={() => removeOrClearRow(row.id)}
              >
                <Minus className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={addRow}
          >
            <Plus className="h-3.5 w-3.5" />
            {t("providers.modal.coworkHelperAdd")}
          </Button>
        </div>

        <div className="space-y-1">
          <p className="text-xs font-medium">{t("providers.modal.coworkHelperPreview")}</p>
          <div className="rounded-md border bg-muted/30 p-2 text-[10px] font-mono text-muted-foreground whitespace-pre-wrap break-all">
            {preview ? (
              <>
                <span className="text-foreground/80">customModelsList</span>
                {"\n"}
                {preview.customModelsList.join("\n")}
                {"\n\n"}
                <span className="text-foreground/80">modelMap</span>
                {"\n"}
                {preview.modelMap.map(e => `${e.pattern} -> ${e.model}`).join("\n")}
              </>
            ) : (
              "—"
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="button" size="sm" onClick={handleApply} disabled={!preview}>
            {t("providers.modal.coworkHelperApply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
