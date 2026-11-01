"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

interface HistoryPaginationProps {
  total: number;
  currentPage?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
}

export function HistoryPagination({
  total,
  currentPage = 1,
  pageSize = 10,
  onPageChange,
}: HistoryPaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(currentPage, totalPages);

  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);

  // Show a window of up to 5 page numbers centered on the current page.
  const windowSize = 5;
  let start = Math.max(1, page - Math.floor(windowSize / 2));
  const end = Math.min(totalPages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);
  const pageNumbers = Array.from(
    { length: end - start + 1 },
    (_, i) => start + i,
  );

  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t border-kk-line bg-[rgba(246,243,242,0.5)] px-6 py-4 sm:flex-row">
      <p className="text-sm text-kk-cocoa">
        Showing {rangeStart} to {rangeEnd} of {total} orders
      </p>
      {totalPages > 1 && (
        <div className="flex gap-1">
          <button
            type="button"
            disabled={page === 1}
            onClick={() => onPageChange?.(page - 1)}
            aria-label="Previous page"
            className="flex size-10 items-center justify-center rounded-lg border border-kk-line bg-kk-card transition-colors hover:bg-kk-fill disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-kk-card"
          >
            <ChevronLeft className="size-4" />
          </button>
          {pageNumbers.map((num) => (
            <button
              key={num}
              type="button"
              onClick={() => onPageChange?.(num)}
              aria-current={num === page ? "page" : undefined}
              className={`flex size-10 items-center justify-center rounded-lg text-sm font-medium transition-colors ${
                num === page
                  ? "bg-kk-red text-white"
                  : "border border-kk-line bg-kk-card text-kk-ink hover:bg-kk-fill"
              }`}
            >
              {num}
            </button>
          ))}
          <button
            type="button"
            disabled={page === totalPages}
            onClick={() => onPageChange?.(page + 1)}
            aria-label="Next page"
            className="flex size-10 items-center justify-center rounded-lg border border-kk-line bg-kk-card transition-colors hover:bg-kk-fill disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-kk-card"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}
