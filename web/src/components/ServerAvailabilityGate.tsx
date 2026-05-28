import type { ReactNode } from "react";
import ServerStoppedScreen from "./ServerStoppedScreen";
import { useServerAvailability } from "@/hooks/useServerAvailability";

type ServerAvailabilityGateProps = {
  children: ReactNode;
};

export default function ServerAvailabilityGate({ children }: ServerAvailabilityGateProps) {
  const available = useServerAvailability();

  if (available === false) {
    return <ServerStoppedScreen checking />;
  }

  return children;
}
