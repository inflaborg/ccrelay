import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../../../api/client";

export type VariantLineStatus = "testing" | "pass" | "fail";

export interface VariantTestLine {
  key: string;
  label: string;
  status: VariantLineStatus;
  httpStatus?: number;
  detail?: string;
}

export interface EndpointTestState {
  phase: "idle" | "testing" | "done";
  variants: VariantTestLine[];
}

export interface TestVariantInput {
  id: string;
  name: string;
  baseUrl: string;
  providerType: "anthropic" | "openai" | "openai_chat";
  authHeader?: string;
}

export interface RunEndpointTestParams {
  variants: TestVariantInput[];
  apiKey: string;
  modelId: string;
}

export function shortLabel(name: string, id: string): string {
  const parts = name.split("-").filter(Boolean);
  const last = parts[parts.length - 1];
  if (last && last.length <= 24) {
    return last;
  }
  return id.length <= 20 ? id : `${id.slice(0, 17)}…`;
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
      const { variants, apiKey, modelId } = params;
      if (!modelId.trim() || variants.length === 0) {
        return;
      }

      abort();
      runIdRef.current += 1;
      const runId = runIdRef.current;

      const testingLines: VariantTestLine[] = variants.map(v => ({
        key: v.id,
        label: shortLabel(v.name, v.id),
        status: "testing",
      }));

      setState({ phase: "testing", variants: testingLines });

      void (async () => {
        const ac = new AbortController();
        abortControllersRef.current = [ac];

        try {
          const data = await api.wizardEndpointTest(
            {
              apiKey,
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
            return {
              key: r.id,
              label: shortLabel(v?.name ?? r.id, r.id),
              status: r.pass ? "pass" : "fail",
              httpStatus: r.httpStatus,
              detail: r.detail,
            };
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
            variants: variants.map(v => ({
              key: v.id,
              label: shortLabel(v.name, v.id),
              status: "fail",
              detail: "network",
            })),
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
