import * as React from "react";
import { cn } from "@/lib/utils";

interface ContextMenuProps {
  children: React.ReactNode;
  className?: string;
}

interface ContextMenuItemProps {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  className?: string;
}

interface ContextMenuSeparatorProps {
  className?: string;
}

const ContextMenuContext = React.createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
  position: { x: number; y: number };
  setPosition: (pos: { x: number; y: number }) => void;
}>({
  open: false,
  setOpen: () => {},
  position: { x: 0, y: 0 },
  setPosition: () => {},
});

export function ContextMenu({ children, className }: ContextMenuProps) {
  const [open, setOpen] = React.useState(false);
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const menuRef = React.useRef<HTMLDivElement>(null);

  // Close on click outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
        document.removeEventListener("keydown", handleEscape);
      };
    }
  }, [open]);

  return (
    <ContextMenuContext.Provider value={{ open, setOpen, position, setPosition }}>
      <div
        className={cn("relative", className)}
        onContextMenu={e => {
          e.preventDefault();
          setPosition({ x: e.clientX, y: e.clientY });
          setOpen(true);
        }}
      >
        {children}
        {open && (
          <div
            ref={menuRef}
            className="fixed z-50 min-w-[140px] rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
            style={{
              left: `${Math.min(position.x, window.innerWidth - 160)}px`,
              top: `${Math.min(position.y, window.innerHeight - 200)}px`,
            }}
          >
            <ContextMenuItems />
          </div>
        )}
      </div>
    </ContextMenuContext.Provider>
  );
}

// Internal component to render items
function ContextMenuItems() {
  return null;
}

export function ContextMenuTrigger({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function ContextMenuContent({ children }: { children: React.ReactNode }) {
  const { open, position } = React.useContext(ContextMenuContext);

  if (!open) return null;

  return (
    <div
      className="fixed z-50 min-w-[140px] rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
      style={{
        left: `${Math.min(position.x, window.innerWidth - 160)}px`,
        top: `${Math.min(position.y, window.innerHeight - 200)}px`,
      }}
    >
      {children}
    </div>
  );
}

export function ContextMenuItem({
  children,
  onClick,
  disabled = false,
  destructive = false,
  className,
}: ContextMenuItemProps) {
  const { setOpen } = React.useContext(ContextMenuContext);

  const handleClick = () => {
    if (!disabled) {
      onClick?.();
      setOpen(false);
    }
  };

  return (
    <button
      type="button"
      className={cn(
        "relative flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-xs outline-none transition-colors",
        "hover:bg-accent hover:text-accent-foreground",
        disabled && "pointer-events-none opacity-50",
        destructive && "text-destructive hover:text-destructive",
        className
      )}
      onClick={handleClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function ContextMenuSeparator({ className }: ContextMenuSeparatorProps) {
  return <div className={cn("my-1 h-px bg-border", className)} />;
}

// Combined component for easier usage
export function ContextMenuWrapper({
  children,
  menuItems,
}: {
  children: React.ReactNode;
  menuItems: { label: string; onClick?: () => void; destructive?: boolean; show?: boolean }[];
}) {
  const [open, setOpen] = React.useState(false);
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const menuRef = React.useRef<HTMLDivElement>(null);

  const visibleItems = menuItems.filter(item => item.show !== false);

  // Close on click outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
        document.removeEventListener("keydown", handleEscape);
      };
    }
  }, [open]);

  if (visibleItems.length === 0) {
    return <>{children}</>;
  }

  return (
    <div
      className="relative"
      onContextMenu={e => {
        e.preventDefault();
        setPosition({ x: e.clientX, y: e.clientY });
        setOpen(true);
      }}
    >
      {children}
      {open && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[120px] rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
          style={{
            left: `${Math.min(position.x, window.innerWidth - 140)}px`,
            top: `${Math.min(position.y, window.innerHeight - 200)}px`,
          }}
        >
          {visibleItems.map((item, index) => (
            <button
              key={index}
              type="button"
              className={cn(
                "relative flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-xs outline-none transition-colors",
                "hover:bg-accent hover:text-accent-foreground",
                item.destructive && "text-destructive hover:text-destructive"
              )}
              onClick={() => {
                item.onClick?.();
                setOpen(false);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
