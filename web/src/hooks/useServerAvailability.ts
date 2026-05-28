import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { probeServerReachable } from "@/api/serverReachability";

const HEARTBEAT_MS = 3000;

/** null = first probe not finished yet (render main UI optimistically). */
export type ServerAvailability = boolean | null;

export function useServerAvailability(): ServerAvailability {
  const queryClient = useQueryClient();
  const [available, setAvailable] = useState<ServerAvailability>(null);
  const prevAvailable = useRef<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      const ok = await probeServerReachable();
      if (cancelled) {
        return;
      }

      if (prevAvailable.current === false && ok) {
        void queryClient.invalidateQueries();
      }
      prevAvailable.current = ok;
      setAvailable(ok);

      timer = setTimeout(() => {
        void tick();
      }, HEARTBEAT_MS);
    };

    void tick();

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [queryClient]);

  return available;
}
