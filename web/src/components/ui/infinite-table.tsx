import { useEffect, useRef, useCallback, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface InfiniteTableColumn<T> {
  id: string;
  header: string;
  cell: (item: T, index: number) => React.ReactNode;
  className?: string;
  headerClassName?: string;
  width?: string | number;
}

interface InfiniteTableProps<T> {
  data: T[];
  columns: InfiniteTableColumn<T>[];
  isLoading?: boolean;
  isLoadingMore?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  keyExtractor: (item: T, index: number) => string | number;
  onRowClick?: (item: T, index: number) => void;
  rowClassName?: string | ((item: T, index: number) => string);
  emptyMessage?: string;
  className?: string;
  height?: string | number;
}

export function InfiniteTable<T>({
  data,
  columns,
  isLoading = false,
  isLoadingMore = false,
  hasMore = false,
  onLoadMore,
  keyExtractor,
  onRowClick,
  rowClassName,
  emptyMessage = "No data found",
  className,
  height = "100%",
}: InfiniteTableProps<T>) {
  const loadMoreRef = useRef<HTMLTableRowElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const handleIntersection = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const [entry] = entries;
      console.log("[InfiniteTable] Intersection:", {
        isIntersecting: entry.isIntersecting,
        hasMore,
        isLoading,
        isLoadingMore,
        willLoad: entry.isIntersecting && hasMore && !isLoading && !isLoadingMore && !!onLoadMore,
      });
      if (entry.isIntersecting && hasMore && !isLoading && !isLoadingMore && onLoadMore) {
        console.log("[InfiniteTable] Triggering loadMore");
        onLoadMore();
      }
    },
    [hasMore, isLoading, isLoadingMore, onLoadMore]
  );

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) {
      console.log("[InfiniteTable] Scroll container not ready");
      return;
    }

    console.log("[InfiniteTable] Setting up observer with root:", scrollContainer);

    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    const observer = new IntersectionObserver(handleIntersection, {
      root: scrollContainer,
      rootMargin: "100px",
      threshold: 0.01,
    });

    observerRef.current = observer;

    const currentRef = loadMoreRef.current;
    if (currentRef) {
      console.log("[InfiniteTable] Observing loadMoreRef:", currentRef);
      observer.observe(currentRef);
    } else {
      console.log("[InfiniteTable] loadMoreRef is null");
    }

    return () => {
      observer.disconnect();
    };
  }, [handleIntersection, data.length]);

  const containerStyle = useMemo(() => {
    if (height === "100%") {
      return undefined;
    }
    return { height: typeof height === "number" ? `${height}px` : height };
  }, [height]);

  return (
    <div
      className={cn(
        "border rounded-md bg-card overflow-hidden",
        height === "100%" ? "h-full" : "",
        className
      )}
      style={containerStyle}
    >
      <div ref={scrollContainerRef} className="h-full overflow-auto table-scroll">
        {/* Use native table element to avoid nested overflow-auto from Table component */}
        <table
          style={{ tableLayout: "fixed", minWidth: "100%" }}
          className="w-full caption-bottom text-sm"
        >
          <colgroup>
            {columns.map(col => (
              <col
                key={col.id}
                style={{
                  width:
                    col.width !== undefined
                      ? typeof col.width === "number"
                        ? `${col.width}px`
                        : col.width
                      : undefined,
                }}
              />
            ))}
          </colgroup>
          <thead className="[&_tr]:border-b sticky top-0 bg-background z-10">
            <tr className="border-b transition-colors hover:bg-muted/50">
              {columns.map(col => (
                <th
                  key={col.id}
                  className={cn(
                    "h-8 px-4 text-left align-middle font-medium text-muted-foreground text-[11px]",
                    col.headerClassName
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="[&_tr:last-child]:border-0">
            {data.length === 0 ? (
              <tr className="border-b transition-colors hover:bg-muted/50">
                <td
                  colSpan={columns.length}
                  className="p-4 align-middle h-24 text-center text-xs text-muted-foreground"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              <>
                {data.map((item, index) => {
                  const key = keyExtractor(item, index);
                  const rowClass =
                    typeof rowClassName === "function" ? rowClassName(item, index) : rowClassName;

                  const isLast = index === data.length - 1;

                  return (
                    <tr
                      key={key}
                      ref={isLast ? loadMoreRef : null}
                      onClick={() => onRowClick?.(item, index)}
                      className={cn(
                        "cursor-pointer text-xs border-b transition-colors hover:bg-muted/50",
                        rowClass
                      )}
                      data-last-row={isLast ? "true" : undefined}
                    >
                      {columns.map(col => (
                        <td
                          key={`${key}-${col.id}`}
                          className={cn("p-4 align-middle py-1.5 px-2", col.className)}
                        >
                          {col.cell(item, index)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </>
            )}
          </tbody>
        </table>

        {/* Loading indicator */}
        {(isLoading || isLoadingMore) && data.length > 0 && (
          <div className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground border-t">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>{isLoading ? "Loading..." : "Loading more..."}</span>
          </div>
        )}
      </div>

      <style>{`
        .table-scroll {
          scrollbar-gutter: stable;
          scrollbar-width: thin;
          scrollbar-color: hsl(var(--muted-foreground) / 0.2) transparent;
        }
        .table-scroll::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        .table-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .table-scroll::-webkit-scrollbar-thumb {
          background-color: hsl(var(--muted-foreground) / 0.15);
          border-radius: 4px;
        }
        .table-scroll::-webkit-scrollbar-thumb:hover {
          background-color: hsl(var(--muted-foreground) / 0.25);
        }
        .table-scroll::-webkit-scrollbar-corner {
          background: transparent;
        }
      `}</style>
    </div>
  );
}
