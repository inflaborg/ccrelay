/**
 * Windows/Linux caption buttons for frameless Electron windows.
 */

import { useEffect, useState } from "react";
import { Minus, Square, Copy, X } from "lucide-react";
import { cn } from "../lib/utils";

function desktopApi(): Window["ccrelayDesktop"] | undefined {
  return typeof window !== "undefined" ? window.ccrelayDesktop : undefined;
}

export function WindowCaptionButtons({ className }: { className?: string }) {
  const api = desktopApi();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!api) {
      return;
    }
    void api.isMaximized().then(setMaximized);
    return api.onMaximizedChange(setMaximized);
  }, [api]);

  if (!api) {
    return null;
  }

  return (
    <div className={cn("electron-no-drag flex h-10 shrink-0 items-stretch", className)}>
      <button
        type="button"
        aria-label="Minimize"
        className="flex w-11 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={() => void api.minimize()}
      >
        <Minus className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        aria-label={maximized ? "Restore" : "Maximize"}
        className="flex w-11 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={() => void api.toggleMaximize()}
      >
        {maximized ? (
          <Copy className="h-3 w-3 scale-x-[-1]" strokeWidth={1.75} />
        ) : (
          <Square className="h-3 w-3" strokeWidth={1.75} />
        )}
      </button>
      <button
        type="button"
        aria-label="Close"
        className="flex w-11 items-center justify-center text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
        onClick={() => void api.close()}
      >
        <X className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
    </div>
  );
}
