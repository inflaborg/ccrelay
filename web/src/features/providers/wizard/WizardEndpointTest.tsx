import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useEndpointTest, type TestVariantInput, type VariantTestLine } from "./useEndpointTest";

export interface WizardEndpointTestProps {
  /** When false, abort in-flight tests (e.g. dialog closed). */
  wizardOpen?: boolean;
  variants: TestVariantInput[] | null;
  apiKey: string;
  useCustomModels: boolean;
  /** First non-empty model line when custom list is on */
  customFirstModelId: string | null;
  /** Upstream GET /models result when custom list is off */
  probeModels: string[] | null;
  disabled?: boolean;
}

function StatusGlyph({ line }: { line: VariantTestLine }) {
  if (line.status === "testing") {
    return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />;
  }
  if (line.status === "pass") {
    return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-500" />;
  }
  return <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />;
}

function detailToKey(detail: string | undefined): string {
  switch (detail) {
    case "timeout":
      return "wizard.test.timeout";
    case "network":
      return "wizard.test.networkError";
    case "auth":
      return "wizard.test.authError";
    case "server":
      return "wizard.test.serverError";
    case "client":
      return "wizard.test.clientError";
    case "html":
      return "wizard.test.htmlResponse";
    case "format":
      return "wizard.test.formatError";
    default:
      return "wizard.test.fail";
  }
}

export function WizardEndpointTest({
  wizardOpen = true,
  variants,
  apiKey,
  useCustomModels,
  customFirstModelId,
  probeModels,
  disabled = false,
}: WizardEndpointTestProps) {
  const { t } = useTranslation();
  const { state, runTest, abort } = useEndpointTest();
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  /** Selection inside the multi-model modal (confirmed on Continue). */
  const [modalModelId, setModalModelId] = useState<string>("");

  const probeKey = probeModels?.join("\0") ?? "";

  const [prevProbeKey, setPrevProbeKey] = useState(probeKey);
  if (probeKey !== prevProbeKey) {
    setPrevProbeKey(probeKey);
    setModelPickerOpen(false);
  }

  const variantsKey = useMemo(() => (variants ?? []).map(v => v.id).join("|"), [variants]);

  const [prevVariantsKey, setPrevVariantsKey] = useState(variantsKey);
  if (variantsKey !== prevVariantsKey) {
    setPrevVariantsKey(variantsKey);
    abort();
    setModelPickerOpen(false);
  }

  const [prevWizardOpen, setPrevWizardOpen] = useState(wizardOpen);
  if (wizardOpen !== prevWizardOpen) {
    if (prevWizardOpen && !wizardOpen) {
      abort();
      setModelPickerOpen(false);
    }
    setPrevWizardOpen(wizardOpen);
  }

  const canClickTest =
    Boolean(variants?.length) &&
    Boolean(apiKey.trim()) &&
    !disabled &&
    state.phase !== "testing" &&
    (useCustomModels
      ? Boolean(customFirstModelId)
      : Boolean(probeModels && probeModels.length >= 1));

  const noModelReason = useMemo(() => {
    if (useCustomModels && !customFirstModelId) {
      return t("wizard.test.noModel");
    }
    if (!useCustomModels) {
      if (!probeModels || probeModels.length === 0) {
        return t("wizard.test.noProbeModels");
      }
    }
    return null;
  }, [useCustomModels, customFirstModelId, probeModels, t]);

  const runWithModelId = useCallback(
    (modelId: string) => {
      if (!variants?.length || !modelId.trim()) {
        return;
      }
      runTest({
        variants,
        apiKey,
        modelId: modelId.trim(),
      });
    },
    [variants, apiKey, runTest]
  );

  const handleTestClick = useCallback(() => {
    if (!variants?.length || !apiKey.trim()) {
      return;
    }
    if (useCustomModels) {
      if (!customFirstModelId) {
        return;
      }
      runWithModelId(customFirstModelId);
      return;
    }
    const pm = probeModels;
    if (!pm || pm.length === 0) {
      return;
    }
    if (pm.length === 1) {
      runWithModelId(pm[0]);
      return;
    }
    const initial = modalModelId && pm.includes(modalModelId) ? modalModelId : (pm[0] ?? "");
    setModalModelId(initial);
    setModelPickerOpen(true);
  }, [
    variants,
    apiKey,
    useCustomModels,
    customFirstModelId,
    probeModels,
    modalModelId,
    runWithModelId,
  ]);

  const handleModalContinue = useCallback(() => {
    if (!modalModelId.trim()) {
      return;
    }
    setModelPickerOpen(false);
    runWithModelId(modalModelId);
  }, [modalModelId, runWithModelId]);

  if (!variants?.length) {
    return null;
  }

  return (
    <>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 shrink-0"
            disabled={!canClickTest || Boolean(noModelReason)}
            title={noModelReason ?? undefined}
            onClick={handleTestClick}
          >
            {state.phase === "testing" ? (
              <>
                <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />
                {t("wizard.test.testing")}
              </>
            ) : (
              t("wizard.test.button")
            )}
          </Button>
        </div>

        {state.variants.length > 0 ? (
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
            {state.variants.map(line => (
              <span
                key={line.key}
                className="inline-flex max-w-[9rem] items-center gap-1"
                title={
                  line.status === "fail" && line.detail
                    ? t(detailToKey(line.detail), {
                        status: String(line.httpStatus ?? ""),
                      })
                    : line.label
                }
              >
                <StatusGlyph line={line} />
                <span className="truncate font-medium">{line.label}</span>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <Dialog open={modelPickerOpen} onOpenChange={setModelPickerOpen}>
        <DialogContent className="max-w-md gap-3 p-4 sm:p-5">
          <DialogHeader className="space-y-1.5">
            <DialogTitle className="text-base">{t("wizard.test.pickModelTitle")}</DialogTitle>
            <DialogDescription>{t("wizard.test.pickModelDescription")}</DialogDescription>
          </DialogHeader>
          <div
            className="max-h-[min(50vh,16rem)] space-y-1 overflow-y-auto rounded-md border bg-muted/30 p-1"
            role="listbox"
            aria-label={t("wizard.test.pickModelTitle")}
          >
            {(probeModels ?? []).map(id => (
              <button
                key={id}
                type="button"
                role="option"
                aria-selected={modalModelId === id}
                className={cn(
                  "flex w-full rounded-sm px-2 py-1.5 text-left font-mono text-xs transition-colors",
                  modalModelId === id
                    ? "bg-primary/15 text-foreground ring-1 ring-primary/40"
                    : "hover:bg-muted"
                )}
                title={id}
                onClick={() => setModalModelId(id)}
              >
                <span className="min-w-0 truncate">{id}</span>
              </button>
            ))}
          </div>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setModelPickerOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!modalModelId.trim()}
              onClick={handleModalContinue}
            >
              {t("wizard.test.continueWithTest")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
