import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../../../api/client";
import type { WizardEndpointVariantInput } from "../../../types/api";

export type VariantLineStatus = "testing" | "pass" | "fail";

export interface VariantTestLine {
  key: string;
  name: string;
  providerType: WizardEndpointVariantInput["providerType"];
  status: VariantLineStatus;
  httpStatus?: number;
  detail?: string;
}

export interface EndpointTestState {
  phase: "idle" | "testing" | "done";
  variants: VariantTestLine[];
}

export type TestVariantInput = WizardEndpointVariantInput;

function lineFromVariant(
  v: TestVariantInput,
  extra: Pick<VariantTestLine, "status"> & Partial<Pick<VariantTestLine, "httpStatus" | "detail">>
): VariantTestLine {
  return {
    key: v.id,
    name: v.name,
    providerType: v.providerType,
    ...extra,
  };
}

export interface RunEndpointTestParams {
  variants: TestVariantInput[];
  apiKey: string;
  modelId: string;
  /** When apiKey is missing/masked, server resolves the stored secret. */
  providerId?: string;
}

export function useEndpointTest(): {
  state: EndpointTestState;
  runTest: (params: RunEndpointTestParams) => void;
  abort: () => void;
} {
  const runIdRef = useRef(0);
  const abortControllersRef = useRef<AbortController[]>([]);

  const [state, setState] = useState<EndpointTestState>({
    phase: "idle",
    variants: [],
  });

  const abort = useCallback(() => {
    for (const ac of abortControllersRef.current) {
      ac.abort();
    }
    abortControllersRef.current = [];
    setState({ phase: "idle", variants: [] });
  }, []);

  const runTest = useCallback(
    (params: RunEndpointTestParams) => {
      const { variants, apiKey, modelId, providerId } = params;
      if (!modelId.trim() || variants.length === 0) {
        return;
      }
      if (!apiKey.trim() && !providerId?.trim()) {
        return;
      }

      abort();
      runIdRef.current += 1;
      const runId = runIdRef.current;

      const testingLines: VariantTestLine[] = variants.map(v =>
        lineFromVariant(v, { status: "testing" })
      );

      setState({ phase: "testing", variants: testingLines });

      void (async () => {
        const ac = new AbortController();
        abortControllersRef.current = [ac];

        try {
          const data = await api.wizardEndpointTest(
            {
              apiKey: apiKey.trim() || undefined,
              providerId: providerId?.trim() || undefined,
              modelId: modelId.trim(),
              variants,
            },
            ac.signal
          );

          if (runId !== runIdRef.current) {
            return;
          }

          const lines: VariantTestLine[] = data.results.map(r => {
            const v = variants.find(x => x.id === r.id);
            return lineFromVariant(
              v ?? { id: r.id, name: r.id, baseUrl: "", providerType: "openai_chat" },
              {
                status: r.pass ? "pass" : "fail",
                httpStatus: r.httpStatus,
                detail: r.detail,
              }
            );
          });

          setState({ phase: "done", variants: lines });
        } catch (e) {
          if (e instanceof Error && e.name === "AbortError") {
            return;
          }
          if (runId !== runIdRef.current) {
            return;
          }
          setState({
            phase: "done",
            variants: variants.map(v => lineFromVariant(v, { status: "fail", detail: "network" })),
          });
        } finally {
          abortControllersRef.current = [];
        }
      })();
    },
    [abort]
  );

  useEffect(() => () => abort(), [abort]);

  return { state, runTest, abort };
}
