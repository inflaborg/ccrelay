import { useEffect, useRef, useState } from "react";

import { api } from "../../../api/client";

export type UpstreamModelsErrorCode = "auth" | "network" | "format" | null;

export interface UpstreamModelsResult {
  loading: boolean;
  models: string[] | null;
  errorCode: UpstreamModelsErrorCode;
}

const DEBOUNCE_MS = 500;

export function useUpstreamModels(
  baseUrl: string,
  apiKey: string,
  providerType: "anthropic" | "openai" | "openai_chat",
  enabled: boolean
): UpstreamModelsResult {
  const canProbe = enabled && Boolean(baseUrl.trim()) && Boolean(apiKey.trim());

  const [result, setResult] = useState<UpstreamModelsResult>({
    loading: false,
    models: null,
    errorCode: null,
  });

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!canProbe) {
      return;
    }

    abortRef.current?.abort();
    abortRef.current = null;

    const timeoutId = window.setTimeout(() => {
      const ac = new AbortController();
      abortRef.current = ac;

      setResult({
        loading: true,
        models: null,
        errorCode: null,
      });

      void api
        .wizardProbeModels(
          {
            baseUrl: baseUrl.trim(),
            apiKey: apiKey.trim(),
            providerType,
          },
          ac.signal
        )
        .then(data => {
          if (ac.signal.aborted) {
            return;
          }
          if (!data.ok) {
            setResult({
              loading: false,
              models: null,
              errorCode: data.errorCode,
            });
            return;
          }
          setResult({
            loading: false,
            models: data.modelIds,
            errorCode: null,
          });
        })
        .catch(e => {
          if (ac.signal.aborted || (e instanceof Error && e.name === "AbortError")) {
            return;
          }
          setResult({ loading: false, models: null, errorCode: "network" });
        });
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [canProbe, baseUrl, apiKey, providerType]);

  if (!canProbe) {
    return { loading: false, models: null, errorCode: null };
  }

  return result;
}
